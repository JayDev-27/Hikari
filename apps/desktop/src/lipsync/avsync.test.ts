import { describe, expect, it } from "vitest";
import { analyzeSync, ctxToPerfMs, type FrameSample } from "./avsync";
import { LipSyncEngine, visemesToLive2D } from "./engine";

/** Mouth trace: closed, then opens to 1 starting at `openAt` (ms), frames every `dt`. */
function trace(onsets: number[], lagMs: number, dt = 1000 / 60, end = 3000): FrameSample[] {
  const out: FrameSample[] = [];
  for (let t = 0; t < end; t += dt) {
    const open = onsets.some((o) => t >= o + lagMs && t < o + lagMs + 150) ? 1 : 0;
    out.push({ t, open });
  }
  return out;
}

describe("analyzeSync", () => {
  const onsets = [300, 900, 1500, 2100];

  it("measures a constant lag within one frame", () => {
    const r = analyzeSync(onsets, trace(onsets, 25));
    expect(r.missed).toBe(0);
    expect(r.meanMs).toBeGreaterThanOrEqual(25);
    expect(r.meanMs).toBeLessThan(25 + 1000 / 60);
    expect(r.pass).toBe(true);
  });

  it("fails when lips are late beyond tolerance", () => {
    const r = analyzeSync(onsets, trace(onsets, 80));
    expect(r.pass).toBe(false);
    expect(r.minMs).toBeGreaterThan(40);
  });

  it("detects early lips as negative offset", () => {
    const r = analyzeSync(onsets, trace(onsets, -60));
    expect(r.maxMs).toBeLessThan(-40);
    expect(r.pass).toBe(false);
  });

  it("adds display latency and counts missed bursts", () => {
    const frames = trace([300, 900], 0);
    const r = analyzeSync([300, 900, 1500], frames, { displayLatencyMs: 16 });
    expect(r.missed).toBe(1);
    expect(r.offsets[0]).toBeGreaterThanOrEqual(16);
    expect(r.pass).toBe(false);
  });

  it("maps context time to heard time via the output timestamp", () => {
    expect(ctxToPerfMs(2.5, { contextTime: 2.0, performanceTime: 10_000 })).toBe(10_500);
  });
});

describe("LipSyncEngine intrinsic lag (no audio device)", () => {
  it("opens to half within ±40 ms of a vowel onset after silence", () => {
    // Engine alone at 60 fps on an ideal clock: isolates envelope + coarticulation lag
    // from device/output latency. The in-app probe measures the full chain.
    const e = new LipSyncEngine();
    const onsets = [400, 1000, 1600, 2200];
    const ph = onsets.flatMap((o, i) => [
      { p: "sil", start: i === 0 ? 0 : onsets[i - 1] + 150, end: o },
      { p: "a", start: o, end: o + 150 },
    ]);
    e.addChunk(0, ph);
    const frames: FrameSample[] = [];
    for (let t = 0; t < 2600; t += 1000 / 60) {
      frames.push({ t, open: visemesToLive2D(e.sample(t / 1000, 1 / 60)).open });
    }
    const r = analyzeSync(onsets, frames);
    expect(r.missed).toBe(0);
    expect(r.pass).toBe(true);
  });
});
