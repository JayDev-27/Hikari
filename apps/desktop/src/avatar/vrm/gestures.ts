import type { GestureTag } from "@hikari/protocol";
import { REST, type Pose } from "./pose";

/**
 * Body language for VRM models: idle life and the generic gestures, as joint-angle offsets from {@link REST}
 * (see pose.ts for the channels). Every gesture eases in and out (quintic smootherstep), so it starts and ends at
 * rest with zero velocity; the avatar also runs the result through a critically damped spring so an interrupted
 * gesture blends instead of snapping.
 *
 * Arm targets are written as absolute joint angles via {@link arm} and converted to offsets, which keeps the
 * numbers readable (and testable with forward kinematics in gestures.test.ts).
 */
const clamp01 = (t: number) => (t < 0 ? 0 : t > 1 ? 1 : t);
/** Smooth in-out (quintic smootherstep): no visible start or stop. */
export const smoother = (t: number) => { t = clamp01(t); return t * t * t * (t * (6 * t - 15) + 10); };
/** In over `a`, hold, out over `b` (fractions of the gesture). */
export const envelope = (t: number, a = 0.22, b = 0.28) => Math.min(smoother(t / a), smoother((1 - t) / b));
/** A pulse that is 0 outside [from, to] and fades in/out over `edge`. */
export const window01 = (t: number, from: number, to: number, edge = 0.08) => smoother((t - from) / edge) * smoother((to - t) / edge);
/** Cheap smooth noise in [-1, 1] (sum of incommensurate sines), different per seed. */
export const noise = (t: number, seed: number) =>
  Math.sin(t * 0.73 + seed * 1.7) * 0.5 + Math.sin(t * 1.31 + seed * 4.1) * 0.3 + Math.sin(t * 2.17 + seed * 2.3) * 0.2;

export interface ArmTarget { down?: number; fwd?: number; twist?: number; elbow?: number; hand?: number; curl?: number; index?: number }

/** Offsets that move one arm from rest to `target` (absolute angles), scaled by `e` (0 = rest, 1 = target). */
export function arm(side: "L" | "R", target: ArmTarget, e: number): Pose {
  const out: Pose = {};
  const put = (ch: string, v: number | undefined) => {
    if (v === undefined) return;
    const key = ch + side;
    out[key] = (v - (REST[key] ?? 0)) * e;
  };
  put("armDown", target.down);
  put("armFwd", target.fwd);
  put("armTwist", target.twist);
  put("elbow", target.elbow);
  put("hand", target.hand);
  put("curl", target.curl);
  put("index", target.index);
  return out;
}

const merge = (...p: Pose[]): Pose => Object.assign({}, ...p);
const scale = (p: Pose, k: number): Pose => Object.fromEntries(Object.entries(p).map(([key, v]) => [key, v * k]));

export interface Gesture {
  /** Seconds. */
  dur: number;
  pose: (t: number) => Pose;
  /** VRM expression weights held over the gesture (eased by the same envelope). */
  expression?: Record<string, number>;
  /** Extra mouth opening (aa) and eye closing over the gesture, 0..1 at the envelope peak. */
  face?: (t: number) => { aa?: number; eyes?: number };
  /** Exact reach and timing (palms that must meet): no amplitude variation. */
  timed?: boolean;
}

// Arm targets, tuned with forward kinematics on a standard VRoid-proportioned skeleton (gestures.test.ts).
/** Hand up beside the head, palm to the viewer, forearm upright. */
const WAVE_UP: ArmTarget = { down: 18, fwd: 18, twist: -80, elbow: 100, hand: -8, curl: 4 };
/** Hand at the chin, knuckles under it. */
const CHIN: ArmTarget = { down: 80, fwd: 42, twist: 62, elbow: 138, hand: 30, curl: 45 };
/** The supporting forearm across the waist, under the chin hand's elbow. */
const CHIN_SUPPORT: ArmTarget = { down: 82, fwd: 22, twist: 66, elbow: 95, hand: 10, curl: 30 };
/** Palm over the brow. */
const FACEPALM: ArmTarget = { down: 70, fwd: 58, twist: 58, elbow: 140, hand: 20, curl: 12 };
/** Forearms folded across the chest, one just above the other. */
const FOLD_L: ArmTarget = { down: 80, fwd: 26, twist: 78, elbow: 110, hand: 0, curl: 40 };
const FOLD_R: ArmTarget = { down: 82, fwd: 20, twist: 82, elbow: 104, hand: 0, curl: 40 };
/** Hands in front of the chest, a hand's width apart (clap open); CLAP_SHUT brings the palms together. */
const CLAP_OPEN: ArmTarget = { down: 78, fwd: 38, twist: 50, elbow: 98, hand: -10, curl: 8 };
const CLAP_SHUT: ArmTarget = { down: 78, fwd: 40, twist: 58, elbow: 104, hand: -10, curl: 8 };
/** Arm forward and slightly out, index finger toward the viewer. */
const POINT: ArmTarget = { down: 80, fwd: 72, twist: 10, elbow: 14, hand: 0, curl: 60, index: 1 };
/** Shrug: elbows at the sides, forearms out, palms up. */
const SHRUG: ArmTarget = { down: 80, fwd: 10, twist: -55, elbow: 80, hand: -18, curl: 10 };
/** Bow: hands folded in front of the thighs. */
const BOW_HANDS: ArmTarget = { down: 84, fwd: 14, twist: 40, elbow: 34, curl: 20 };
/** Shy: a hand drawn up to the chest. */
const SHY_HAND: ArmTarget = { down: 82, fwd: 18, twist: 60, elbow: 118, hand: 20, curl: 40 };

function clapAt(gap: number, e: number): Pose {
  const a: ArmTarget = {}, b = CLAP_OPEN, c = CLAP_SHUT;
  for (const k of Object.keys(b) as (keyof ArmTarget)[]) a[k] = c[k]! + (b[k]! - c[k]!) * gap;
  return merge(arm("L", a, e), arm("R", a, e));
}

export const GESTURES: Record<string, Gesture> = {
  wave: { dur: 2.8, expression: { happy: 0.6 }, pose: (t) => {
    // The forearm folds up first, then the shoulder lifts; on the way down the shoulder lowers first.
    const lift = envelope(t, 0.2, 0.26), fold = envelope(t, 0.14, 0.2);
    const sway = Math.sin((t - 0.2) * Math.PI * 7) * window01(t, 0.18, 0.78, 0.1);
    const a = arm("R", { ...WAVE_UP, elbow: undefined, twist: undefined }, lift);
    const f = arm("R", { twist: WAVE_UP.twist, elbow: WAVE_UP.elbow! + 18 * sway }, fold);
    return merge(a, f, { handR: (WAVE_UP.hand! - REST.handR + 8 * sway) * fold, headZ: 4 * lift, headY: 5 * lift, chestZ: 1.5 * lift, spineZ: 1 * lift });
  } },
  point: { dur: 2.2, pose: (t) => {
    const e = envelope(t, 0.2, 0.3);
    return merge(arm("R", POINT, e), { headX: -3 * e, chestY: -6 * e, headY: 3 * e });
  } },
  shrug: { dur: 1.9, expression: { relaxed: 0.4 }, pose: (t) => {
    const e = envelope(t, 0.28, 0.34), up = window01(t, 0.25, 0.72, 0.15);
    return merge(arm("L", SHRUG, e), arm("R", SHRUG, e), { shoulderL: 12 * up, shoulderR: 12 * up, headZ: 8 * e, headX: -3 * e, neckZ: 2 * e });
  } },
  clap: { dur: 2.4, timed: true, expression: { happy: 0.8 }, pose: (t) => {
    const e = envelope(t, 0.2, 0.24);
    // Four claps while the hands are up: palms meet at the bottom of each beat.
    const beats = window01(t, 0.2, 0.78, 0.05);
    const gap = 1 - beats * (0.5 - 0.5 * Math.cos((t - 0.2) / 0.58 * Math.PI * 8));
    return merge(clapAt(gap, e), { headX: 2 * e, chestX: -1.5 * e });
  } },
  cross_arms: { dur: 3.4, expression: { angry: 0.25 }, pose: (t) => {
    // The left forearm folds in first, the right lays over it.
    const l = envelope(t, 0.18, 0.24), r = envelope(t, 0.24, 0.2);
    return merge(arm("L", FOLD_L, l), arm("R", FOLD_R, r), { headX: -4 * l, headZ: -3 * l, chestX: -2 * l, headY: -4 * l });
  } },
  think_chin: { dur: 3.2, expression: { relaxed: 0.3 }, pose: (t) => {
    const e = envelope(t, 0.24, 0.24), look = envelope(t, 0.3, 0.26);
    return merge(arm("R", CHIN, e), arm("L", CHIN_SUPPORT, e), { headZ: 7 * look, headY: 6 * look, headX: -6 * look, chestY: 3 * e });
  }, face: (t) => ({ eyes: 0.15 * envelope(t, 0.3, 0.26) }) },
  facepalm: { dur: 2.6, expression: { sad: 0.4 }, pose: (t) => {
    const e = envelope(t, 0.22, 0.26), bow = envelope(t, 0.32, 0.22);
    const shake = Math.sin((t - 0.32) * Math.PI * 6) * window01(t, 0.34, 0.74, 0.1);
    return merge(arm("R", FACEPALM, e), { headX: 16 * bow, headZ: 5 * bow, headY: 4 * shake, chestX: 5 * bow });
  }, face: (t) => ({ eyes: 0.9 * envelope(t, 0.32, 0.22) }) },
  bow: { dur: 2.2, pose: (t) => {
    const e = envelope(t, 0.3, 0.35);
    return merge(arm("L", BOW_HANDS, e), arm("R", BOW_HANDS, e), { spineX: 16 * e, chestX: 8 * e, headX: 10 * e });
  }, face: (t) => ({ eyes: 0.5 * envelope(t, 0.35, 0.35) }) },
  nod: { dur: 1.3, pose: (t) => {
    const e = envelope(t, 0.12, 0.25);
    // Two nods, the second smaller.
    const n = Math.max(0, Math.sin(t * Math.PI * 4)) * (t < 0.5 ? 1 : 0.6);
    return { headX: (3 + 11 * n) * e, neckX: 3 * n * e };
  } },
  head_tilt: { dur: 2.0, pose: (t) => { const e = envelope(t, 0.25, 0.3); return { headZ: 13 * e, neckZ: 3 * e, headY: 4 * e }; } },
  shy_look_away: { dur: 2.6, expression: { happy: 0.5 }, pose: (t) => {
    const e = envelope(t, 0.25, 0.3);
    return merge(arm("L", SHY_HAND, e), { headY: -22 * e, headX: 10 * e, headZ: -5 * e, shoulderL: 4 * e, shoulderR: 4 * e });
  }, face: (t) => ({ eyes: 0.25 * envelope(t, 0.25, 0.3) }) },
  laugh: { dur: 2.0, expression: { happy: 1 }, pose: (t) => {
    const e = envelope(t, 0.12, 0.3);
    const bob = Math.sin(t * Math.PI * 9);
    return { headX: (-6 + 3 * bob) * e, chestX: (-3 + 2 * bob) * e, spineX: 1.5 * bob * e, headZ: 4 * e, shoulderL: 3 * (0.5 + 0.5 * bob) * e, shoulderR: 3 * (0.5 + 0.5 * bob) * e };
  }, face: (t) => ({ aa: (0.35 + 0.15 * Math.sin(t * Math.PI * 9)) * envelope(t, 0.12, 0.3), eyes: 0.35 * envelope(t, 0.12, 0.3) }) },
  pout: { dur: 2.0, expression: { angry: 0.5 }, pose: (t) => { const e = envelope(t); return { headY: -12 * e, headZ: -6 * e, headX: -3 * e }; },
    face: (t) => ({ eyes: 0.2 * envelope(t) }) },
  head_pat_react: { dur: 2.2, expression: { happy: 0.9 }, pose: (t) => {
    const e = envelope(t);
    return { headZ: 8 * e, headX: 5 * e, shoulderL: 6 * e, shoulderR: 6 * e, ...scale(merge(arm("L", SHY_HAND, 1), arm("R", SHY_HAND, 1)), 0.35 * e) };
  }, face: (t) => ({ eyes: 0.85 * envelope(t) }) },
};

/** Gestures the protocol names that every VRM can play. */
export const GENERIC_GESTURES: GestureTag[] = Object.keys(GESTURES) as GestureTag[];

/** Map a requested name (protocol tag or a pack's motionMap alias) to one of {@link GESTURES}, or null. */
export function resolveGesture(name: string, motionMap?: Record<string, { group: string }>): string | null {
  if (GESTURES[name]) return name;
  const alias = motionMap?.[name]?.group;
  if (alias && GESTURES[alias]) return alias;
  // Stage taps ask for these.
  if (name === "tap_head") return "head_pat_react";
  if (name === "tap_body") return "wave";
  return null;
}

/**
 * Idle life at time `t` (s): breathing (chest and shoulders), a slow weight sway, small head drift, arms that hang
 * and swing very slightly. `talk` 0..1 adds the small head beats people make while speaking.
 */
export function idlePose(t: number, talk = 0): Pose {
  const breath = Math.sin(t * Math.PI * 2 / 4.2);
  const sway = noise(t * 0.35, 1);
  const p: Pose = {
    chestX: -1.1 * breath, spineX: 0.4 * breath,
    shoulderL: 0.9 * (0.5 + 0.5 * breath), shoulderR: 0.9 * (0.5 + 0.5 * breath),
    spineZ: 1.3 * sway, chestZ: -0.6 * sway, spineY: 1.2 * noise(t * 0.27, 2),
    headX: 1.8 * noise(t * 0.5, 3), headY: 2.5 * noise(t * 0.4, 4), headZ: 1.8 * noise(t * 0.45, 5) + 0.8 * sway,
    armDownL: -1.2 * sway + 0.6 * breath, armDownR: 1.2 * sway + 0.6 * breath,
    armFwdL: 1.5 * noise(t * 0.6, 6), armFwdR: 1.5 * noise(t * 0.6, 7),
    elbowL: 2 * noise(t * 0.5, 8), elbowR: 2 * noise(t * 0.5, 9),
    curlL: 3 * noise(t * 0.4, 10), curlR: 3 * noise(t * 0.4, 11),
  };
  if (talk > 0) {
    p.headX += talk * (2.2 * noise(t * 2.1, 12));
    p.headY += talk * (2 * noise(t * 1.3, 13));
    p.headZ += talk * (1.5 * noise(t * 1.1, 14));
    p.chestY = talk * 1.2 * noise(t * 0.8, 15);
  }
  return p;
}

/**
 * Critically damped spring per channel (stable at any dt): the pose follows its target with no overshoot, and a
 * gesture that is cut short or replaced eases into the next one.
 */
export class PoseSpring {
  private x = new Map<string, number>();
  private v = new Map<string, number>();
  constructor(private omega = 11) {}

  step(target: Pose, dt: number, omega = this.omega): Pose {
    const out: Pose = {};
    const keys = new Set([...Object.keys(target), ...this.x.keys()]);
    const a = Math.exp(-omega * dt);
    for (const k of keys) {
      const goal = target[k] ?? 0;
      const x = this.x.get(k) ?? 0, v = this.v.get(k) ?? 0;
      // Exact solution of x'' = -2ωx' - ω²(x - goal) over dt.
      const d = x - goal;
      const c = v + omega * d;
      const nx = goal + (d + c * dt) * a;
      const nv = (c - omega * (d + c * dt)) * a;
      if (Math.abs(nx) < 1e-4 && Math.abs(nv) < 1e-4 && goal === 0) {
        this.x.delete(k);
        this.v.delete(k);
        continue;
      }
      this.x.set(k, nx);
      this.v.set(k, nv);
      out[k] = nx;
    }
    return out;
  }

  /** Largest remaining distance to the last target (deg): the stage keeps 60 fps until it settles. */
  settled(target: Pose, eps = 0.3): boolean {
    for (const [k, x] of this.x) if (Math.abs(x - (target[k] ?? 0)) > eps || Math.abs(this.v.get(k) ?? 0) > eps) return false;
    return true;
  }
}
