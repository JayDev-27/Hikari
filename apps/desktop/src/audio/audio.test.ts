import { describe, expect, it } from "vitest";
import { Downsampler, Framer, int16ToBase64 } from "./resample";
import { LocalVad } from "./localVad";

const tone = (hz: number, rate: number, n: number, amp = 0.5) =>
  Float32Array.from({ length: n }, (_, i) => amp * Math.sin((2 * Math.PI * hz * i) / rate));
const rms = (x: Float32Array) => Math.sqrt(x.reduce((a, v) => a + v * v, 0) / x.length);

describe("Downsampler", () => {
  it("produces 16 kHz output length from 48 kHz and 44.1 kHz", () => {
    for (const rate of [48000, 44100]) {
      const d = new Downsampler(rate);
      const out = d.process(tone(440, rate, rate)); // 1 s
      expect(Math.abs(out.length - 16000)).toBeLessThan(40); // filter delay only
    }
  });

  it("passes speech-band tones and rejects content above 8 kHz (no aliasing)", () => {
    const rate = 48000;
    const pass = new Downsampler(rate).process(tone(1000, rate, rate)).slice(200);
    const stop = new Downsampler(rate).process(tone(12000, rate, rate)).slice(200);
    expect(rms(pass)).toBeGreaterThan(0.3); // ~0.354 for amp 0.5
    expect(rms(stop)).toBeLessThan(0.02); // 12 kHz would alias to 4 kHz without the filter
  });

  it("gives the same result in 128-sample worklet blocks as in one buffer", () => {
    const rate = 44100;
    const x = tone(700, rate, 128 * 300);
    const whole = new Downsampler(rate).process(x);
    const d = new Downsampler(rate);
    const parts: number[] = [];
    for (let i = 0; i < x.length; i += 128) parts.push(...d.process(x.subarray(i, i + 128)));
    expect(parts.length).toBe(whole.length);
    for (let i = 0; i < whole.length; i++) expect(parts[i]).toBeCloseTo(whole[i], 5);
  });
});

describe("Framer", () => {
  it("emits 20 ms Int16 frames with RMS and keeps the remainder", () => {
    const f = new Framer(320);
    const frames: Array<[Int16Array, number]> = [];
    f.push(new Float32Array(700).fill(0.5), (fr, r) => frames.push([fr, r]));
    expect(frames.length).toBe(2);
    expect(frames[0][0].length).toBe(320);
    expect(frames[0][0][0]).toBe(Math.round(0.5 * 32767));
    expect(frames[0][1]).toBeCloseTo(0.5, 2);
    f.push(new Float32Array(260).fill(0), (fr, r) => frames.push([fr, r])); // 60 left + 260 = 320
    expect(frames.length).toBe(3);
    expect(frames[1][0]).not.toBe(frames[0][0]); // each frame is a fresh buffer (safe to transfer)
  });

  it("encodes frames as little-endian base64", () => {
    expect(int16ToBase64(Int16Array.from([1, -1]))).toBe(btoa(String.fromCharCode(1, 0, 255, 255)));
  });
});

describe("LocalVad barge-in", () => {
  const run = (v: LocalVad, rmsVal: number, frames: number, speaking = true) =>
    Array.from({ length: frames }, () => v.push(rmsVal, speaking));

  it("ignores background noise, ducks at 250 ms of speech and cuts at 450 ms", () => {
    const v = new LocalVad();
    expect(run(v, 0.006, 50).every((a) => a === "none")).toBe(true); // noise learns the floor
    const acts = run(v, 0.15, 25); // 500 ms of speech
    expect(acts.indexOf("duck")).toBe(12); // 13th frame = 260 ms ≥ 250 ms
    expect(acts.indexOf("cut")).toBe(22); // 23rd frame = 460 ms ≥ 450 ms
    expect(acts.filter((a) => a === "cut").length).toBe(1);
  });

  it("un-ducks when the user stops before the cut", () => {
    const v = new LocalVad();
    run(v, 0.006, 30);
    const speech = run(v, 0.15, 15); // 300 ms: duck, no cut
    expect(speech).toContain("duck");
    expect(speech).not.toContain("cut");
    const after = run(v, 0.006, 10); // silence beyond the 120 ms hangover
    expect(after).toContain("unduck");
  });

  it("never acts while Hikari is silent", () => {
    const v = new LocalVad();
    expect(run(v, 0.2, 40, false).every((a) => a === "none")).toBe(true);
  });

  it("adapts to a louder room instead of triggering on it", () => {
    const v = new LocalVad();
    run(v, 0.03, 100, false); // steady fan noise above minRms, before she speaks
    expect(run(v, 0.035, 60).every((a) => a === "none")).toBe(true); // fan continues while she speaks
    expect(run(v, 0.2, 25)).toContain("cut"); // real speech still cuts through
  });

  it("still barges in right after the user's own long turn (floor never learns their voice)", () => {
    const v = new LocalVad();
    run(v, 0.006, 30, false);
    // 4 s user turn while she's silent: words (0.15) with short pauses (0.008) between them
    for (let i = 0; i < 20; i++) {
      run(v, 0.15, 8, false);
      run(v, 0.008, 2, false);
    }
    expect(v.noiseFloor).toBeLessThan(0.02);
    run(v, 0.006, 20, true); // she replies; user quiet
    expect(run(v, 0.15, 25, true)).toContain("cut"); // user interrupts at the same loudness
  });
});
