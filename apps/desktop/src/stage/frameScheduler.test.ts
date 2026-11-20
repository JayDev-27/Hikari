import { describe, expect, it } from "vitest";
import { FrameScheduler } from "./frameScheduler";

/** Simulate rAF ticks at `hz` for `ms`, returning rendered frames per second. */
function fps(s: FrameScheduler, hz: number, ms: number, tierAt: (t: number) => Parameters<FrameScheduler["shouldRender"]>[1], t0 = 0) {
  let frames = 0;
  const ticks = Math.round((hz * ms) / 1000);
  for (let i = 0; i < ticks; i++) {
    const t = t0 + (i * 1000) / hz;
    if (s.shouldRender(t, tierAt(t))) frames++;
  }
  return (frames * 1000) / ms;
}

describe("FrameScheduler", () => {
  it("renders 60 fps active and 30 fps idle on a 60 Hz display", () => {
    expect(fps(new FrameScheduler(), 60, 2000, () => "active")).toBeCloseTo(60, 0);
    expect(fps(new FrameScheduler(), 60, 2000, () => "idle")).toBeCloseTo(30, 0);
  });

  it("stays at 60/30 on a 120 Hz ProMotion display", () => {
    expect(fps(new FrameScheduler(), 120, 2000, () => "active")).toBeCloseTo(60, 0);
    expect(fps(new FrameScheduler(), 120, 2000, () => "idle")).toBeCloseTo(30, 0);
  });

  it("uses every tick when Low Power Mode caps rAF at 30 Hz", () => {
    expect(fps(new FrameScheduler(), 30, 2000, () => "active")).toBeCloseTo(30, 0);
    expect(fps(new FrameScheduler(), 30, 2000, () => "idle")).toBeCloseTo(30, 0);
  });

  it("renders nothing while paused", () => {
    expect(fps(new FrameScheduler(), 60, 1000, () => "paused")).toBe(0);
  });

  it("goes active on busy/poke and back to idle after the tail", () => {
    const s = new FrameScheduler(800);
    expect(s.tier(0, true, false)).toBe("idle");
    expect(s.tier(100, true, true)).toBe("active"); // busy → active
    expect(s.tier(800, true, false)).toBe("active"); // still in tail (until 900)
    expect(s.tier(950, true, false)).toBe("idle");
    s.poke(1000);
    expect(s.tier(1500, true, false)).toBe("active");
    expect(s.tier(1500, false, true)).toBe("paused"); // hidden wins over busy
  });
});
