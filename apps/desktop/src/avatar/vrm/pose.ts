import { Euler, Quaternion, Vector3 } from "three";
import type { Emotion } from "@hikari/protocol";
import type { Visemes } from "../types";

/**
 * Pure pose maths for the VRM renderer: a small set of named joint angles (degrees) that gestures, idle life and
 * look-at write, and the mapping from those angles to rotations of VRM *normalized* humanoid bones.
 *
 * Normalized bones (three-vrm) are the same for VRM 0.x and 1.0: every bone's rest rotation is identity, the model
 * stands in a T-pose facing +Z, its left side is +X and +Y is up. A rotation set on a normalized bone is relative to
 * its parent, in that T-pose frame. So for the left arm (pointing +X in the T-pose):
 *  - lowering it toward the side is a rotation about Z (negative for the left, positive for the right arm),
 *  - raising the lowered arm forward is a rotation about the parent's X (negative for both arms),
 *  - twisting it about its own axis is a rotation about X (positive = internal rotation: a bent forearm swings
 *    toward the body's midline),
 *  - the elbow bends the forearm forward about the forearm's own Y (negative left, positive right): a hinge, so a
 *    bent elbow never folds sideways or backwards.
 */
export type Pose = Record<string, number>;

export type Side = "L" | "R";

/** Joint channels and what a positive value does. All degrees, except finger curl (degrees per joint). */
export const CHANNELS = [
  // Torso and head map 1:1 onto bone Euler angles: +X pitches forward (nod down), +Y turns toward her left (the
  // viewer's right), +Z rolls toward her right (the viewer's left).
  "spineX", "spineY", "spineZ", "chestX", "chestY", "chestZ", "neckX", "neckY", "neckZ", "headX", "headY", "headZ",
  /** Shoulder shrug (raise). */
  "shoulderL", "shoulderR",
  /** Upper arm: degrees below the T-pose (90 = hanging straight down). */
  "armDownL", "armDownR",
  /** Upper arm raised forward from where `armDown` put it (90 from hanging = pointing ahead). */
  "armFwdL", "armFwdR",
  /** Upper arm internal rotation about its own axis. */
  "armTwistL", "armTwistR",
  /** Elbow flexion (0 = straight). */
  "elbowL", "elbowR",
  /** Wrist flexion toward the palm. */
  "handL", "handR",
  /** Finger curl per joint (all four fingers), and index finger extension (0..1: straightens the index). */
  "curlL", "curlR", "indexL", "indexR",
] as const;

/** Natural standing rest: arms down beside the body (not glued to it), elbows soft, fingers relaxed. */
export const REST: Pose = {
  armDownL: 72, armDownR: 72, armFwdL: 4, armFwdR: 4, armTwistL: 8, armTwistR: 8,
  elbowL: 14, elbowR: 14, handL: 6, handR: 6, curlL: 14, curlR: 14,
};

/** Hard joint limits, so no combination of idle + gesture + spring overshoot breaks a shoulder or elbow. */
export const LIMITS: Record<string, [number, number]> = {
  armDownL: [-35, 88], armDownR: [-35, 88],
  armFwdL: [-25, 115], armFwdR: [-25, 115],
  armTwistL: [-95, 95], armTwistR: [-95, 95],
  // Elbows only bend one way, and stop short of the forearm folding into the upper arm.
  elbowL: [0, 145], elbowR: [0, 145],
  handL: [-45, 60], handR: [-45, 60],
  curlL: [0, 80], curlR: [0, 80], indexL: [0, 1], indexR: [0, 1],
  shoulderL: [-8, 18], shoulderR: [-8, 18],
  headX: [-35, 35], headY: [-50, 50], headZ: [-30, 30],
  neckX: [-25, 25], neckY: [-30, 30], neckZ: [-20, 20],
  spineX: [-25, 30], spineY: [-25, 25], spineZ: [-12, 12],
  chestX: [-20, 25], chestY: [-20, 20], chestZ: [-12, 12],
};

export const clampPose = (p: Pose): Pose => {
  const out: Pose = {};
  for (const [k, v] of Object.entries(p)) {
    const lim = LIMITS[k];
    out[k] = lim ? Math.max(lim[0], Math.min(lim[1], v)) : v;
  }
  return out;
};

/** Sum of poses, channel by channel. */
export function addPoses(...poses: Pose[]): Pose {
  const out: Pose = {};
  for (const p of poses) for (const [k, v] of Object.entries(p)) out[k] = (out[k] ?? 0) + v;
  return out;
}

const D2R = Math.PI / 180;
const X = new Vector3(1, 0, 0), Y = new Vector3(0, 1, 0), Z = new Vector3(0, 0, 1);
const tmp = new Quaternion();
const euler = new Euler();
/** Left side mirrors right: s = -1 for the left arm, +1 for the right. */
const sign = (side: Side) => (side === "L" ? -1 : 1);

/** Upper arm rotation: twist about its own axis, lowered in the frontal plane, then raised forward. */
export function upperArmQuat(side: Side, down: number, fwd: number, twist: number, out = new Quaternion()): Quaternion {
  out.setFromAxisAngle(X, -fwd * D2R);
  out.multiply(tmp.setFromAxisAngle(Z, sign(side) * down * D2R));
  return out.multiply(tmp.setFromAxisAngle(X, twist * D2R));
}

export const elbowQuat = (side: Side, bend: number, out = new Quaternion()) => out.setFromAxisAngle(Y, sign(side) * bend * D2R);
/** Wrist flexion and finger curl both fold toward the palm (palms face down in the T-pose). */
export const flexQuat = (side: Side, deg: number, out = new Quaternion()) => out.setFromAxisAngle(Z, sign(side) * deg * D2R);
export const shoulderQuat = (side: Side, raise: number, out = new Quaternion()) => out.setFromAxisAngle(Z, -sign(side) * raise * D2R);
const eulerQuat = (x: number, y: number, z: number, out = new Quaternion()) => out.setFromEuler(euler.set(x * D2R, y * D2R, z * D2R, "YXZ"));

const FINGERS = ["Index", "Middle", "Ring", "Little"] as const;
const JOINTS = ["Proximal", "Intermediate", "Distal"] as const;

/**
 * Bone rotations for a pose (rest + offsets already summed and clamped). Keys are VRM humanoid bone names;
 * `has` reports which bones the model has: a missing chest folds into the spine, a missing neck into the head.
 */
export function poseToBones(pose: Pose, has: (bone: string) => boolean = () => true): Map<string, Quaternion> {
  const g = (k: string) => pose[k] ?? 0;
  const out = new Map<string, Quaternion>();
  const chestIn = has("chest") ? 0 : 1, neckIn = has("neck") ? 0 : 1;
  out.set("spine", eulerQuat(g("spineX") + chestIn * g("chestX"), g("spineY") + chestIn * g("chestY"), g("spineZ") + chestIn * g("chestZ")));
  if (!chestIn) out.set("chest", eulerQuat(g("chestX"), g("chestY"), g("chestZ")));
  if (!neckIn) out.set("neck", eulerQuat(g("neckX"), g("neckY"), g("neckZ")));
  out.set("head", eulerQuat(g("headX") + neckIn * g("neckX"), g("headY") + neckIn * g("neckY"), g("headZ") + neckIn * g("neckZ")));
  for (const side of ["L", "R"] as const) {
    const s = side === "L" ? "left" : "right";
    out.set(`${s}Shoulder`, shoulderQuat(side, g(`shoulder${side}`)));
    out.set(`${s}UpperArm`, upperArmQuat(side, g(`armDown${side}`), g(`armFwd${side}`), g(`armTwist${side}`)));
    out.set(`${s}LowerArm`, elbowQuat(side, g(`elbow${side}`)));
    out.set(`${s}Hand`, flexQuat(side, g(`hand${side}`)));
    const curl = g(`curl${side}`), index = g(`index${side}`);
    for (const f of FINGERS) {
      // Outer fingers curl a little more than the index, as a relaxed hand does.
      const c = f === "Index" ? curl * (1 - index) : curl * (f === "Little" ? 1.25 : f === "Ring" ? 1.15 : 1);
      for (const j of JOINTS) out.set(`${s}${f}${j}`, flexQuat(side, c * (j === "Proximal" ? 0.8 : 1)));
    }
  }
  return out;
}

// ---- lip sync and expressions ----

export const VISEME_KEYS = ["aa", "ih", "ou", "ee", "oh"] as const;

/**
 * Visemes → VRM mouth expression weights (aa/ih/ou/ee/oh are VRM 1.0 preset names; three-vrm maps VRM 0.x's
 * a/i/u/e/o onto them). The mouth morphs add up on most models, so a sum over `cap` is scaled down instead of
 * opening the jaw past its sculpted range.
 */
export function visemesToVrm(v: Visemes, gain = 1, cap = 1): Visemes {
  const out = { aa: 0, ih: 0, ou: 0, ee: 0, oh: 0 };
  let sum = 0;
  for (const k of VISEME_KEYS) {
    out[k] = Math.max(0, Math.min(1, (v[k] ?? 0) * gain));
    sum += out[k];
  }
  if (sum > cap) for (const k of VISEME_KEYS) out[k] *= cap / sum;
  return out;
}

/** Hikari emotion → VRM preset expression weights (relative to intensity). VRM 0.x joy/sorrow/fun arrive as happy/sad/relaxed. */
export const EMOTION_TO_VRM: Record<Emotion, Record<string, number>> = {
  neutral: {},
  joy: { happy: 1 },
  fun: { happy: 0.8, relaxed: 0.2 },
  teasing: { relaxed: 0.7, happy: 0.25 },
  angry: { angry: 1 },
  sorrow: { sad: 1 },
  surprised: { surprised: 1 },
  shy: { happy: 0.45, relaxed: 0.3 },
  sleepy: { relaxed: 0.6 },
  thinking: { relaxed: 0.15 },
};

/** Expressions emotions (and gestures) drive; reset to 0 when no longer wanted. */
export const EMOTION_EXPRESSIONS = ["happy", "angry", "sad", "relaxed", "surprised"] as const;

/**
 * Target expression weights for an emotion. A pack's `expressionMap` can name a model's own (custom) expression for
 * an emotion. Expressions the model lacks are dropped; `surprised` (not in VRM 0.x) falls back to an open mouth.
 */
export function emotionToVrm(emotion: Emotion, intensity: number, has: (name: string) => boolean,
  override?: string | number): Record<string, number> {
  const k = Math.max(0, Math.min(1, intensity));
  const out: Record<string, number> = {};
  if (typeof override === "string" && has(override)) {
    out[override] = k;
    return out;
  }
  for (const [name, w] of Object.entries(EMOTION_TO_VRM[emotion] ?? {})) {
    if (has(name)) out[name] = (out[name] ?? 0) + w * k;
    else if (name === "surprised" && has("oh")) out.oh = 0.35 * w * k;
  }
  return out;
}

/** Sleepy and shy half-close the eyes (on top of blinking). */
export const EMOTION_EYES: Partial<Record<Emotion, number>> = { sleepy: 0.45, shy: 0.15, teasing: 0.2 };
