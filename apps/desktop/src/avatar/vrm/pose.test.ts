import { describe, expect, it } from "vitest";
import { Quaternion, Vector3 } from "three";
import { LIMITS, REST, clampPose, emotionToVrm, poseToBones, toVrm0Frame, upperArmQuat, elbowQuat, visemeWeights } from "./pose";

const sum = (v: object) => (Object.values(v) as number[]).reduce((a, b) => a + b, 0);

describe("visemes → VRM mouth expressions", () => {
  it("passes single visemes straight through to the matching preset", () => {
    expect(visemeWeights({ aa: 0.8, ih: 0, ou: 0, ee: 0, oh: 0 })).toEqual({ aa: 0.8, ih: 0, ou: 0, ee: 0, oh: 0 });
    expect(visemeWeights({ aa: 0, ih: 0, ou: 0.5, ee: 0, oh: 0 }).ou).toBe(0.5);
    expect(visemeWeights({ aa: 0, ih: 0, ou: 0, ee: 0.3, oh: 0 }).ee).toBe(0.3);
  });

  it("normalises stacked shapes so the mouth never opens past its sculpted range", () => {
    const v = visemeWeights({ aa: 0.9, ih: 0.4, ou: 0, ee: 0.5, oh: 0.6 });
    expect(sum(v)).toBeCloseTo(1, 6);
    // Proportions survive the scaling.
    expect(v.aa / v.oh).toBeCloseTo(0.9 / 0.6, 6);
  });

  it("clamps out-of-range input and closes fully on silence", () => {
    expect(visemeWeights({ aa: 2, ih: -1, ou: 0, ee: 0, oh: 0 })).toEqual({ aa: 1, ih: 0, ou: 0, ee: 0, oh: 0 });
    expect(sum(visemeWeights({ aa: 0, ih: 0, ou: 0, ee: 0, oh: 0 }))).toBe(0);
  });

  it("scales down under a smile and holds a laugh's open mouth", () => {
    expect(visemeWeights({ aa: 0.6, ih: 0, ou: 0, ee: 0, oh: 0 }, 0, 1).aa).toBeCloseTo(0.39, 6);
    expect(visemeWeights({ aa: 0.1, ih: 0, ou: 0, ee: 0, oh: 0 }, 0.4).aa).toBe(0.4);
  });
});

describe("emotions → VRM expressions", () => {
  const all = () => true;
  it("maps emotions onto VRM 1.0 presets, scaled by intensity", () => {
    expect(emotionToVrm("joy", 0.5, all)).toEqual({ happy: 0.5 });
    expect(emotionToVrm("sorrow", 1, all)).toEqual({ sad: 1 });
    expect(emotionToVrm("angry", 1, all)).toEqual({ angry: 1 });
    expect(emotionToVrm("neutral", 1, all)).toEqual({});
  });

  it("drops expressions the model lacks; surprised falls back to a round mouth (VRM 0.x has no preset)", () => {
    const vrm0 = (n: string) => ["happy", "angry", "sad", "relaxed", "oh"].includes(n);
    expect(emotionToVrm("surprised", 1, vrm0)).toEqual({ oh: 0.35 });
    expect(emotionToVrm("joy", 1, () => false)).toEqual({});
  });

  it("honours a pack's expressionMap naming a custom expression", () => {
    expect(emotionToVrm("shy", 0.8, (n) => n === "Blush", "Blush")).toEqual({ Blush: 0.8 });
    // A name the model doesn't have falls back to the presets.
    expect(emotionToVrm("joy", 1, (n) => n === "happy", "Missing")).toEqual({ happy: 1 });
  });
});

describe("pose → normalized bones", () => {
  const dir = (q: Quaternion, v: Vector3) => v.clone().applyQuaternion(q);

  it("lowers both arms from the T-pose toward the sides, mirrored", () => {
    const l = dir(upperArmQuat("L", 90, 0, 0), new Vector3(1, 0, 0));
    const r = dir(upperArmQuat("R", 90, 0, 0), new Vector3(-1, 0, 0));
    expect(l.y).toBeCloseTo(-1, 6);
    expect(r.y).toBeCloseTo(-1, 6);
  });

  it("raises a hanging arm forward (+Z, toward the viewer)", () => {
    const l = dir(upperArmQuat("L", 90, 90, 0), new Vector3(1, 0, 0));
    expect(l.z).toBeCloseTo(1, 6);
  });

  it("bends elbows forward only (a hinge, no sideways fold)", () => {
    expect(dir(elbowQuat("L", 90), new Vector3(1, 0, 0)).z).toBeCloseTo(1, 6);
    expect(dir(elbowQuat("R", 90), new Vector3(-1, 0, 0)).z).toBeCloseTo(1, 6);
    expect(clampPose({ elbowL: -30, elbowR: 200 })).toEqual({ elbowL: LIMITS.elbowL[0], elbowR: LIMITS.elbowR[1] });
  });

  it("folds a missing chest into the spine and a missing neck into the head", () => {
    const bones = poseToBones({ ...REST, chestX: 10, neckY: 20 }, (b) => b !== "chest" && b !== "neck");
    expect(bones.has("chest")).toBe(false);
    expect(bones.has("neck")).toBe(false);
    const face = dir(bones.get("head")!, new Vector3(0, 0, 1));
    expect(face.x).toBeCloseTo(Math.sin(20 * Math.PI / 180), 6);
    const up = dir(bones.get("spine")!, new Vector3(0, 1, 0));
    expect(up.z).toBeCloseTo(Math.sin(10 * Math.PI / 180), 6);
  });

  it("VRM 0.x frame: the conjugated rotation does in the −Z-facing frame what the original does in the +Z one", () => {
    const halfTurn = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI);
    const q = upperArmQuat("L", 70, 30, 20);
    const q0 = toVrm0Frame(q.clone());
    // Her left arm points −X in a VRM 0.x model's own frame; rotated into the scene it must match the VRM 1.0 result.
    const vrm0 = new Vector3(-1, 0, 0).applyQuaternion(q0).applyQuaternion(halfTurn);
    const vrm1 = new Vector3(1, 0, 0).applyQuaternion(q);
    expect(vrm0.distanceTo(vrm1)).toBeLessThan(1e-6);
  });
});
