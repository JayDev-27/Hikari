import { describe, expect, it } from "vitest";
import { AVATAR_STATES, LayerAnimator, blendPostures } from "./animator";
import { EmotionLayer } from "./emotion";
import { Blinker, critStep, mulberry32 } from "./life";
import { cubismOffsets, eyeOpenValue, vrmOffsets } from "./mapping";
import { DEFAULT_POSTURES, DEFAULT_TUNING, cloneTuning, diffTuning, mergeTuning } from "./tuning";

const DT = 1 / 60;
/** Run `secs` of frames; returns every frame. */
function run(a: LayerAnimator, secs: number, input: { gesturing?: boolean } = {}) {
  const frames = [];
  for (let i = 0; i < Math.round(secs / DT); i++) frames.push(a.update(DT, input));
  return frames;
}

describe("posture blending", () => {
  it("weights mix postures and are normalised", () => {
    const p = blendPostures(DEFAULT_POSTURES, { idle: 1, sleeping: 1 });
    expect(p.headPitch).toBeCloseTo(DEFAULT_POSTURES.sleeping.headPitch / 2);
    expect(p.breathRate).toBeCloseTo((1 + DEFAULT_POSTURES.sleeping.breathRate) / 2);
    expect(blendPostures(DEFAULT_POSTURES, {}).headPitch).toBe(0);
  });

  it("critically damped step never overshoots and starts with zero velocity", () => {
    let x = 0, v = 0, max = 0;
    const first = critStep(0, 0, 1, 5, DT)[0];
    for (let i = 0; i < 600; i++) {
      [x, v] = critStep(x, v, 1, 5, DT);
      max = Math.max(max, x);
    }
    expect(max).toBeLessThanOrEqual(1 + 1e-9);
    expect(x).toBeCloseTo(1, 4);
    // The first frame moves far less than a first-order lag would (1 - e^{-5·dt} ≈ 0.08).
    expect(first).toBeLessThan(0.01);
  });
});

describe("state transitions", () => {
  it("cross-fades into the new state smoothly (no snap) and the weights keep summing to 1", () => {
    const a = LayerAnimator.seeded(1);
    run(a, 1);
    a.setState("thinking");
    const frames = run(a, 2.5);
    let maxStep = 0;
    for (let i = 1; i < frames.length; i++) maxStep = Math.max(maxStep, Math.abs(frames[i].posture.headPitch - frames[i - 1].posture.headPitch));
    // 5° of head pitch over ~1 s: no frame jumps more than a fraction of a degree.
    expect(maxStep).toBeLessThan(0.35);
    const last = frames.at(-1)!;
    expect(last.posture.headPitch).toBeCloseTo(DEFAULT_POSTURES.thinking.headPitch, 1);
    for (const f of frames) {
      const sum = AVATAR_STATES.reduce((s, k) => s + f.stateWeights[k], 0);
      expect(sum).toBeCloseTo(1, 3);
    }
  });

  it("thinking holds the gaze up and to the side; listening keeps eye contact with the cursor mostly", () => {
    const a = LayerAnimator.seeded(2);
    a.lookAt(-0.5, 0);
    a.setState("thinking");
    const f = run(a, 3).at(-1)!;
    expect(f.gaze.x).toBeGreaterThan(0.2);
    expect(f.gaze.y).toBeGreaterThan(0.35);
    a.setState("listening");
    const g = run(a, 3).at(-1)!;
    expect(g.gaze.x).toBeLessThan(-0.1);
  });

  it("sleeping shuts the eyes, slows the breath and stops spontaneous blinks; waking turns into idle", () => {
    const a = LayerAnimator.seeded(3);
    a.setState("sleeping");
    const sleep = run(a, 8);
    const f = sleep.at(-1)!;
    expect(f.eyeClose).toBeGreaterThan(0.95);
    expect(f.posture.breathRate).toBeLessThan(0.7);
    expect(Math.max(...sleep.slice(-240).map((x) => x.blink))).toBe(0);
    a.setState("waking");
    run(a, 0.5);
    expect(a.effectiveState()).toBe("waking");
    const w = run(a, DEFAULT_TUNING.state.wakeDuration + 3).at(-1)!;
    expect(a.state).toBe("waking");
    expect(w.effectiveState).toBe("idle");
    expect(w.eyeClose).toBeLessThan(0.5);
  });

  it("a gesture keeps playing through a state change: the posture ducks under it, then settles", () => {
    const a = LayerAnimator.seeded(4);
    a.setState("thinking");
    run(a, 3);
    const before = a.frame!.posture.headPitch;
    // A gesture starts, and the state changes mid-gesture.
    run(a, 0.6, { gesturing: true });
    a.setState("listening");
    const during = run(a, 0.8, { gesturing: true }).at(-1)!;
    expect(during.gesture).toBeGreaterThan(0.9);
    expect(Math.abs(during.posture.headPitch)).toBeLessThan(Math.abs(before) * 0.3);
    expect(during.posture.gazeWeight).toBeLessThan(DEFAULT_POSTURES.listening.gazeWeight * 0.3);
    // Gesture ends: posture comes back (listening) and the body settles with a small damped sway.
    const after = run(a, 2);
    const rolls = after.map((f) => Math.abs(f.settle.roll));
    expect(Math.max(...rolls)).toBeGreaterThan(0.05);
    expect(Math.max(...rolls)).toBeLessThan(DEFAULT_TUNING.gesture.settle + 0.01);
    expect(Math.abs(after[0].settle.roll)).toBeLessThan(0.05);
    expect(after.at(-1)!.posture.headRoll).toBeGreaterThan(DEFAULT_POSTURES.listening.headRoll * 0.8);
  });

  it("thinking cues a hand-to-chin gesture once, only into a pause", () => {
    const t = cloneTuning();
    t.postures.thinking.chinHand = 1;
    const a = new LayerAnimator({ tuning: t, rng: mulberry32(5) });
    a.setState("thinking");
    const cues = run(a, 4).filter((f) => f.cue);
    expect(cues.map((f) => f.cue)).toEqual(["think_chin"]);
    const b = new LayerAnimator({ tuning: t, rng: mulberry32(5) });
    b.setState("thinking");
    expect(run(b, 4, { gesturing: true }).some((f) => f.cue)).toBe(false);
  });
});

describe("emotion decay", () => {
  const layer = () => new EmotionLayer(() => DEFAULT_TUNING);
  const step = (e: EmotionLayer, secs: number) => { for (let i = 0; i < secs / DT; i++) e.update(DT); };

  it("eases in, holds, then decays back to neutral", () => {
    const e = layer();
    e.set("joy", 0.8);
    step(e, 0.05);
    expect(e.dominant().weight).toBeLessThan(0.4);
    step(e, 2);
    expect(e.dominant()).toEqual({ name: "joy", weight: expect.closeTo(0.8, 1) });
    step(e, DEFAULT_TUNING.emotion.hold - 1.5);
    expect(e.dominant().weight).toBeGreaterThan(0.7);
    step(e, DEFAULT_TUNING.emotion.halfLife * 1.2);
    expect(e.dominant().weight).toBeLessThan(0.45);
    step(e, 20);
    expect(e.dominant().name).toBe("neutral");
  });

  it("a refresh restores the intensity; a new emotion cross-fades with the old", () => {
    const e = layer();
    e.set("joy", 0.8);
    step(e, DEFAULT_TUNING.emotion.hold + 4);
    const decayed = e.dominant().weight;
    e.set("joy", 0.8);
    step(e, 1.5);
    expect(e.dominant().weight).toBeGreaterThan(decayed + 0.2);
    e.set("angry", 0.7);
    step(e, 0.15);
    // Both still showing mid cross-fade.
    expect(e.levels.get("joy")!).toBeGreaterThan(0.2);
    expect(e.levels.get("angry")!).toBeGreaterThan(0.2);
    step(e, 3);
    expect(e.dominant().name).toBe("angry");
    expect(e.levels.get("joy") ?? 0).toBeLessThan(0.02);
  });

  it("neutral fades everything out without a snap", () => {
    const e = layer();
    e.set("sorrow", 1);
    step(e, 2);
    e.set("neutral", 0);
    e.update(DT);
    expect(e.dominant().weight).toBeGreaterThan(0.9);
    step(e, 4);
    expect(e.dominant().weight).toBe(0);
    expect(e.face().smile).toBe(0);
  });

  it("face extras follow the emotion and its decay", () => {
    const a = LayerAnimator.seeded(6);
    a.setEmotion("joy", 1);
    const f = run(a, 2).at(-1)!;
    expect(f.face.smile).toBeGreaterThan(0.4);
    const later = run(a, 40).at(-1)!;
    expect(later.face.smile).toBeLessThan(0.01);
  });
});

describe("base life realism", () => {
  it("blink intervals vary (no fixed beat) and stay within the tuned range", () => {
    const b = new Blinker(mulberry32(7), () => DEFAULT_TUNING);
    const starts: number[] = [];
    let was = 0;
    for (let i = 0; i < 60 * 240; i++) {
      const v = b.update(i * DT, 1);
      if (v > 0 && was === 0) starts.push(i * DT);
      was = v;
    }
    const gaps = starts.slice(1).map((s, i) => s - starts[i]);
    expect(starts.length).toBeGreaterThan(40);
    const mean = gaps.reduce((s, g) => s + g, 0) / gaps.length;
    const sd = Math.sqrt(gaps.reduce((s, g) => s + (g - mean) ** 2, 0) / gaps.length);
    expect(sd / mean).toBeGreaterThan(0.3);
    // Pairs (double blinks) show as short gaps; everything else within min..max.
    expect(gaps.some((g) => g < 0.5)).toBe(true);
    expect(Math.max(...gaps)).toBeLessThanOrEqual(DEFAULT_TUNING.blink.max + 0.5);
  });

  it("blinks on a big gaze shift, even when the renderer blinks on its own", () => {
    const t = cloneTuning();
    t.blink.gazeShiftChance = 1;
    const a = new LayerAnimator({ tuning: t, rng: mulberry32(8), ownBlink: false });
    a.lookAt(-0.8, 0);
    const calm = run(a, 1.5);
    expect(Math.max(...calm.slice(30).map((f) => f.blink))).toBe(0);
    a.lookAt(0.8, 0.2);
    expect(Math.max(...run(a, 0.5).map((f) => f.blink))).toBeGreaterThan(0.9);
  });

  it("looks away now and then while idle and glances back; never while listening", () => {
    const a = LayerAnimator.seeded(9);
    a.lookAt(0, 0);
    const frames = run(a, 60);
    const away = frames.filter((f) => Math.abs(f.gaze.x) > 0.2);
    expect(away.length).toBeGreaterThan(30);
    expect(away.length).toBeLessThan(frames.length * 0.4);
    expect(Math.abs(frames.at(-1)!.gaze.x) < 0.2 || away.length > 0).toBe(true);
    const b = LayerAnimator.seeded(9);
    b.lookAt(0, 0);
    b.setState("listening");
    expect(run(b, 60).slice(120).filter((f) => Math.abs(f.gaze.x) > 0.2).length).toBe(0);
  });

  it("weight shift and breath move but stay bounded", () => {
    const a = LayerAnimator.seeded(10);
    const frames = run(a, 40);
    const ws = frames.map((f) => f.weightShift);
    expect(Math.max(...ws) - Math.min(...ws)).toBeGreaterThan(0.3);
    expect(Math.max(...ws.map(Math.abs))).toBeLessThanOrEqual(DEFAULT_TUNING.weightShift.amplitude + 1e-6);
    for (const f of frames) {
      expect(f.breath).toBeGreaterThanOrEqual(0);
      expect(f.breath).toBeLessThanOrEqual(1);
    }
  });
});

describe("mapping and tuning", () => {
  it("maps posture onto Cubism and VRM conventions (head up, lean forward)", () => {
    const a = LayerAnimator.seeded(11);
    a.setState("thinking");
    const f = run(a, 3).at(-1)!;
    const c = cubismOffsets(f);
    expect(c.ParamAngleY).toBeGreaterThan(3); // thinking looks up: Cubism +AngleY
    const v = vrmOffsets(f);
    expect(v.headX).toBeLessThan(-3); // VRM +headX nods down, so up is negative
    a.setState("sleeping");
    const s = run(a, 8).at(-1)!;
    expect(cubismOffsets(s).ParamBodyAngleY).toBeLessThan(0); // bows forward
    expect(vrmOffsets(s).spineX).toBeGreaterThan(0);
    expect(eyeOpenValue(1, s)).toBeLessThan(0.05);
  });

  it("posture never touches arm channels (shoulders and elbows stay with the rig)", () => {
    const a = LayerAnimator.seeded(12);
    for (const st of AVATAR_STATES) {
      a.setState(st);
      const f = run(a, 2).at(-1)!;
      for (const k of Object.keys(cubismOffsets(f))) expect(k).not.toMatch(/Arm|Elbow|Hand/);
      for (const [k, v] of Object.entries(vrmOffsets(f))) {
        expect(k).not.toMatch(/arm|elbow|hand/);
        if (k.startsWith("shoulder")) expect(Math.abs(v)).toBeLessThanOrEqual(8);
      }
    }
  });

  it("tuning merges overrides, ignores junk and diffs back to only the changes", () => {
    const t = mergeTuning(DEFAULT_TUNING, { blink: { mean: 5, bogus: 1 }, postures: { thinking: { headPitch: 9 } }, state: "x" });
    expect(t.blink.mean).toBe(5);
    expect(t.postures.thinking.headPitch).toBe(9);
    expect(t.postures.thinking.gazeX).toBe(DEFAULT_POSTURES.thinking.gazeX);
    expect(diffTuning(t)).toEqual({ blink: { mean: 5 }, postures: { thinking: { headPitch: 9 } } });
    expect(DEFAULT_TUNING.blink.mean).toBe(3.6);
  });

  it("tuning overrides cannot pollute Object.prototype", () => {
    const hostile = JSON.parse('{"__proto__":{"polluted":1},"constructor":{"prototype":{"polluted":1}},"blink":{"__proto__":{"polluted":1},"mean":4}}');
    const t = mergeTuning(DEFAULT_TUNING, hostile);
    expect(t.blink.mean).toBe(4);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.prototype).not.toHaveProperty("polluted");
  });
});
