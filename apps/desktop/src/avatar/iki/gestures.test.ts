import { describe, expect, it } from "vitest";
import { GESTURES, SpringSet, addPoses, applyOffsets, idlePose, resolveGesture, restoreBases } from "./gestures";

/** Iki's standard full-body ranges (as auto-rigged), plus eye openness 0..1. */
const RANGE: Record<string, [number, number]> = {
  ParamArmL: [-8, 32], ParamArmR: [-8, 32], ParamElbowL: [-10, 90], ParamElbowR: [-10, 90],
  ParamAngleX: [-30, 30], ParamAngleY: [-30, 30], ParamAngleZ: [-30, 30],
  ParamBodyAngleX: [-10, 10], ParamBodyAngleY: [-10, 10], ParamBodyAngleZ: [-10, 10],
  ParamEyeLOpen: [-1, 0], ParamEyeROpen: [-1, 0], ParamLegShift: [-1, 1],
};

function store(init: Record<string, number> = {}) {
  const v = new Map(Object.entries(init));
  return {
    get: (id: string) => v.get(id) ?? 0,
    set: (id: string, x: number) => { const [lo, hi] = RANGE[id] ?? [-Infinity, Infinity]; v.set(id, Math.max(lo === -1 && id.startsWith("ParamEye") ? 0 : lo, Math.min(hi === 0 && id.startsWith("ParamEye") ? 1 : hi, x))); },
    has: (id: string) => id in RANGE,
  };
}

describe("Iki gestures", () => {
  it.each(Object.keys(GESTURES))("%s starts and ends at rest and stays inside the rig's ranges", (name) => {
    const g = GESTURES[name];
    // "-raised" variants run on models with extended ranges (arm to 150, elbow open to −170).
    const R = name.endsWith("-raised") ? { ...RANGE, ParamArmR: [-8, 150] as [number, number], ParamElbowR: [-170, 90] as [number, number] } : RANGE;
    for (const [id, v] of Object.entries(g.pose(0))) expect(Math.abs(v), `${id} at t=0`).toBeLessThan(1e-6);
    for (const [id, v] of Object.entries(g.pose(1))) expect(Math.abs(v), `${id} at t=1`).toBeLessThan(1e-6);
    for (let t = 0; t <= 1; t += 0.01) {
      for (const [id, v] of Object.entries(g.pose(t))) {
        const [lo, hi] = R[id] ?? [-Infinity, Infinity];
        expect(v, `${name} ${id} at t=${t.toFixed(2)}`).toBeGreaterThanOrEqual(lo - 1e-9);
        expect(v, `${name} ${id} at t=${t.toFixed(2)}`).toBeLessThanOrEqual(hi + 1e-9);
      }
    }
  });

  it("offsets do not accumulate on parameters nothing else writes (the stuck-arm bug)", () => {
    const p = store({ ParamArmL: 0, ParamElbowR: 0 });
    const bases = new Map<string, number>();
    for (let frame = 0; frame < 600; frame++) {
      restoreBases(p, bases);
      // IkiMotion would run here; it never writes the arms.
      applyOffsets(p, { ParamArmL: 5, ParamElbowR: 12 }, bases);
    }
    expect(p.get("ParamArmL")).toBeCloseTo(5);
    expect(p.get("ParamElbowR")).toBeCloseTo(12);
    restoreBases(p, bases);
    expect(p.get("ParamArmL")).toBe(0);
  });

  it("offsets ride on top of what the motion layer wrote this frame", () => {
    const p = store();
    const bases = new Map<string, number>();
    for (let frame = 0; frame < 50; frame++) {
      restoreBases(p, bases);
      p.set("ParamAngleZ", 4); // the motion layer's head tilt
      applyOffsets(p, { ParamAngleZ: 3 }, bases);
    }
    expect(p.get("ParamAngleZ")).toBeCloseTo(7);
  });

  it("springs ease into a target and settle back to rest", () => {
    const s = new SpringSet(9);
    let out = {};
    for (let i = 0; i < 120; i++) out = s.step({ ParamElbowR: 60 }, 1 / 60);
    expect((out as Record<string, number>).ParamElbowR).toBeGreaterThan(59);
    const first = new SpringSet(9).step({ ParamElbowR: 60 }, 1 / 60).ParamElbowR;
    expect(first).toBeLessThan(5); // no snap on the first frame
    for (let i = 0; i < 240; i++) out = s.step({}, 1 / 60);
    expect(Math.abs((out as Record<string, number>).ParamElbowR ?? 0)).toBeLessThan(0.05);
  });

  it("idle arms hang relaxed (slightly bent, close to the body) and follow the weight shift", () => {
    for (let t = 0; t < 120; t += 0.37) {
      const pose = idlePose(t, 0, false, 0);
      expect(pose.ParamElbowL).toBeGreaterThan(0);
      expect(pose.ParamElbowL).toBeLessThan(12);
      expect(Math.abs(pose.ParamArmR)).toBeLessThan(4);
    }
    const left = idlePose(10, -0.8, false, 0), right = idlePose(10, 0.8, false, 0);
    expect(left.ParamBodyAngleZ).toBeGreaterThan(right.ParamBodyAngleZ);
  });

  it("uses the raised wave only when the model's arm ranges allow them", () => {
    expect(resolveGesture("wave", 150, -170)).toBe("wave-raised");
    expect(resolveGesture("wave", 150, -120)).toBe("wave"); // elbow cannot open far enough
    expect(resolveGesture("signature-bang", 150, -170)).toBe("signature-bang");
    expect(resolveGesture("wave", 32, -10)).toBe("wave");
    expect(resolveGesture("clap", 150, -170)).toBe("clap");
  });

  it("adds poses", () => {
    expect(addPoses({ a: 1, b: 2 }, { b: 3 })).toEqual({ a: 1, b: 5 });
  });
});
