import { describe, expect, it } from "vitest";
import { LipSyncEngine, visemesToLive2D } from "./engine";
import { resolvePhoneme, splitDiphthong } from "./phonemeMap";

/** Run the engine to steady state at time t (ms) and return Live2D params. */
function at(engine: LipSyncEngine, ms: number) {
  let v = engine.sample(ms / 1000, 1 / 60);
  for (let i = 0; i < 30; i++) v = engine.sample(ms / 1000, 1 / 60);
  return { v, ...visemesToLive2D(v) };
}

describe("phoneme map", () => {
  it("covers Hindi aspirated, retroflex and nasal phones", () => {
    expect(resolvePhoneme("bʱ").aspirated).toBe(true);
    expect(resolvePhoneme("bʱ").target.closed).toBe(true);
    expect(resolvePhoneme("ɽ").target.v.aa).toBeGreaterThan(0);
    const nasal = resolvePhoneme("ã");
    expect(nasal.nasal).toBe(true);
    expect(nasal.target.v.aa!).toBeLessThan(resolvePhoneme("a").target.v.aa!);
    expect(resolvePhoneme("ũː").target.v.ou).toBeGreaterThan(0.5);
  });
  it("splits diphthongs", () => {
    expect(splitDiphthong("aɪ")).toEqual(["a", "ɪ"]);
    expect(splitDiphthong("a")).toBeNull();
  });
});

describe("LipSyncEngine", () => {
  it("opens on vowels and fully closes lips on bilabials", () => {
    const e = new LipSyncEngine();
    e.addChunk(0, [
      { p: "a", start: 0, end: 200 },
      { p: "m", start: 200, end: 320 },
      { p: "a", start: 320, end: 520 },
    ]);
    expect(at(e, 100).open).toBeGreaterThan(0.5);
    expect(at(e, 260).open).toBeLessThan(0.08);
    expect(at(e, 420).open).toBeGreaterThan(0.5);
  });

  it("rounds for u/o and spreads for i/e (MouthForm sign)", () => {
    const e = new LipSyncEngine();
    e.addChunk(0, [
      { p: "u", start: 0, end: 300 },
      { p: "sil", start: 300, end: 400 },
      { p: "i", start: 400, end: 700 },
    ]);
    expect(at(e, 150).form).toBeLessThan(-0.3);
    expect(at(e, 550).form).toBeGreaterThan(0.3);
  });

  it("schedules on the audio clock (chunk offset)", () => {
    const e = new LipSyncEngine();
    e.addChunk(10, [{ p: "a", start: 0, end: 200 }]);
    expect(at(e, 5000).open).toBeLessThan(0.05); // before the chunk starts
    expect(at(e, 10100).open).toBeGreaterThan(0.5);
  });

  it("clear() (barge-in) closes the mouth", () => {
    const e = new LipSyncEngine();
    e.addChunk(0, [{ p: "a", start: 0, end: 1000 }]);
    expect(at(e, 300).open).toBeGreaterThan(0.5);
    e.clear();
    expect(at(e, 400).open).toBeLessThan(0.05);
  });
});
