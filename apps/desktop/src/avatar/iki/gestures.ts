/**
 * Body language for Iki models in Hikari: idle life, gestures and Makima's signature moves, all on
 * Iki's standard full-body parameters (ParamArmL/R raise the arm outward, ParamElbowL/R bend the
 * forearm toward the body, ParamAngleX/Y/Z turn/nod/tilt the head, ParamBodyAngle* the torso).
 *
 * Everything here is an OFFSET added on top of what IkiMotion wrote this frame (blink, breath, gaze,
 * head drift, hair physics). {@link applyOffsets} restores last frame's base values first, so offsets
 * never accumulate: parameters IkiMotion does not drive (the arms) would otherwise creep to their
 * limits and stay there (the "left hand always up, right hand always bent" bug).
 */
export type Pose = Record<string, number>;

const clamp01 = (t: number) => (t < 0 ? 0 : t > 1 ? 1 : t);
/** Smooth in-out (quintic smootherstep): no visible start or stop. */
export const smoother = (t: number) => { t = clamp01(t); return t * t * t * (t * (6 * t - 15) + 10); };
/** In over `a`, hold, out over `b` (fractions of the gesture). */
export const envelope = (t: number, a = 0.22, b = 0.28) => Math.min(smoother(t / a), smoother((1 - t) / b));
/** Cheap smooth noise in [-1, 1] (sum of incommensurate sines), different per seed. */
export const noise = (t: number, seed: number) =>
  (Math.sin(t * 0.73 + seed * 1.7) * 0.5 + Math.sin(t * 1.31 + seed * 4.1) * 0.3 + Math.sin(t * 2.17 + seed * 2.3) * 0.2);

export interface Gesture {
  /** Seconds. */
  dur: number;
  pose: (t: number) => Pose;
  /** Expression to hold for the gesture's length, if the model declares it. */
  expression?: string;
}

/**
 * Gestures. Iki's elbow bends only toward the body, so a raised-hand wave needs a drawn raised
 * forearm; here a wave is the whole arm swinging out and back, which the rig does well.
 */
export const GESTURES: Record<string, Gesture> = {
  wave: { dur: 2.8, expression: "smile", pose: (t) => { const e = envelope(t, 0.2, 0.3); const s = Math.sin((t - 0.2) * Math.PI * 5) * smoother((t - 0.15) / 0.15); return { ParamArmR: (20 + 7 * s) * e, ParamElbowR: (-4 + 6 * s) * e, ParamAngleZ: -4 * e, ParamAngleX: -5 * e, ParamBodyAngleZ: -1.5 * e }; } },
  point: { dur: 2.2, pose: (t) => { const e = envelope(t, 0.18, 0.3); return { ParamArmR: 24 * e, ParamElbowR: 6 * e, ParamAngleX: -9 * e, ParamAngleY: 2 * e }; } },
  shrug: { dur: 1.9, pose: (t) => { const e = envelope(t, 0.3, 0.35); return { ParamArmL: 9 * e, ParamArmR: 9 * e, ParamElbowL: 38 * e, ParamElbowR: 42 * e, ParamAngleZ: 7 * e, ParamAngleY: 3 * e }; } },
  clap: { dur: 2.4, expression: "laugh", pose: (t) => { const e = envelope(t, 0.2, 0.25); const c = 0.5 + 0.5 * Math.sin(t * Math.PI * 9); return { ParamArmL: (2 + 3 * c) * e, ParamArmR: (2 + 3 * c) * e, ParamElbowL: 74 * e, ParamElbowR: 78 * e }; } },
  cross_arms: { dur: 3.4, pose: (t) => { const e = envelope(t, 0.2, 0.25); return { ParamElbowL: 84 * e, ParamElbowR: 88 * e, ParamArmL: -4 * e, ParamArmR: -3 * e, ParamAngleY: -3 * e, ParamAngleZ: 3 * e }; } },
  think_chin: { dur: 3.2, pose: (t) => { const e = envelope(t, 0.25, 0.25); return { ParamArmR: 5 * e, ParamElbowR: 86 * e, ParamArmL: -2 * e, ParamElbowL: 30 * e, ParamAngleZ: 6 * e, ParamAngleY: 5 * e, ParamAngleX: 6 * e }; } },
  facepalm: { dur: 2.6, pose: (t) => { const e = envelope(t, 0.25, 0.3); return { ParamArmR: 8 * e, ParamElbowR: 88 * e, ParamAngleY: -12 * e, ParamAngleZ: 4 * e }; } },
  bow: { dur: 2.2, pose: (t) => { const e = envelope(t, 0.3, 0.35); return { ParamAngleY: -16 * e, ParamBodyAngleY: -6 * e, ParamElbowL: 20 * e, ParamElbowR: 20 * e }; } },
  shy_look_away: { dur: 2.6, expression: "smile", pose: (t) => { const e = envelope(t, 0.25, 0.3); return { ParamAngleX: 16 * e, ParamAngleY: -8 * e, ParamElbowL: 28 * e, ParamArmL: -2 * e }; } },
  laugh: { dur: 2.0, expression: "laugh", pose: (t) => { const e = envelope(t, 0.15, 0.3); return { ParamAngleY: (3 + 3 * Math.sin(t * Math.PI * 8)) * e, ParamBodyAngleY: 2.5 * e, ParamAngleZ: 3 * e }; } },
  pout: { dur: 2.0, pose: (t) => { const e = envelope(t); return { ParamAngleZ: -5 * e, ParamAngleX: 8 * e }; } },
  head_pat_react: { dur: 2.2, expression: "smile", pose: (t) => { const e = envelope(t); return { ParamAngleY: -6 * e, ParamAngleZ: 6 * e }; } },

  // Makima's signature moves.
  /** Her composed stance: hands folded low in front, head inclined, a calm closed-lip smile. */
  "signature-clasp": { dur: 7.5, expression: "smile", pose: (t) => { const e = envelope(t, 0.12, 0.14); return { ParamElbowL: 62 * e, ParamElbowR: 70 * e, ParamArmL: -1 * e, ParamArmR: -2 * e, ParamAngleZ: 5 * e, ParamAngleY: -3 * e, ParamEyeLOpen: -0.22 * e, ParamEyeROpen: -0.22 * e, ParamBodyAngleZ: 1 * e }; } },
  /** Her knowing smile: head tilted, eyes closing into the smile, a slight lean. */
  "signature-smile": { dur: 4.2, expression: "smile", pose: (t) => { const e = envelope(t, 0.18, 0.25); const shut = smoother((t - 0.15) / 0.2) * smoother((0.85 - t) / 0.15); return { ParamAngleZ: 9 * e, ParamAngleY: 3 * e, ParamAngleX: -3 * e, ParamEyeLOpen: -0.9 * shut, ParamEyeROpen: -0.9 * shut, ParamBodyAngleZ: 2 * e }; } },
  /** "Bang": the arm comes up and out, a small recoil, held a beat, smile. */
  "signature-bang": { dur: 3.4, expression: "smile", pose: (t) => { const up = smoother(t / 0.14) * smoother((1 - t) / 0.3); const kick = Math.max(0, Math.sin(Math.PI * clamp01((t - 0.32) / 0.1))) * smoother((1 - t) / 0.3); return { ParamArmR: (27 + 5 * kick) * up, ParamElbowR: (-6 + 4 * kick) * up, ParamAngleZ: (-6 - 2 * kick) * up, ParamAngleX: -7 * up, ParamAngleY: (2 + 2 * kick) * up, ParamBodyAngleZ: -1.5 * up }; } },
};

/** Life when nothing else plays: relaxed arms that sway a little with breath and weight, talking emphasis. */
export function idlePose(t: number, legShift: number, speaking: boolean, speakEnergy: number): Pose {
  const pose: Pose = {
    // Relaxed hanging arms are never straight: a few degrees of elbow, drifting slowly and independently.
    ParamElbowL: 6 + 2.5 * noise(t * 0.5, 1),
    ParamElbowR: 5 + 2.5 * noise(t * 0.5, 2),
    // Hips shift → the hanging arms swing a little the other way, and the torso counter-leans.
    ParamArmL: 1.2 + 0.9 * noise(t * 0.4, 3) + legShift * 1.6,
    ParamArmR: 1.0 + 0.9 * noise(t * 0.4, 4) - legShift * 1.6,
    ParamBodyAngleZ: -legShift * 3 + 0.6 * noise(t * 0.25, 5),
    ParamBodyAngleX: 0.8 * noise(t * 0.2, 6),
  };
  if (speaking) {
    // Talking: small head emphasis following the voice, an occasional low hand gesture.
    const beat = speakEnergy * (0.5 + 0.5 * noise(t * 2.2, 7));
    pose.ParamAngleY = (pose.ParamAngleY ?? 0) + 2.2 * beat;
    pose.ParamAngleZ = (pose.ParamAngleZ ?? 0) + 1.5 * noise(t * 0.7, 8);
    const hand = smoother((noise(t * 0.35, 9) - 0.2) / 0.5);
    pose.ParamElbowR += 26 * hand * (0.6 + 0.4 * speakEnergy);
    pose.ParamArmR -= 2 * hand;
  }
  return pose;
}

/** Critically damped spring per parameter: offsets ease in, follow through and settle (no snapping). */
export class SpringSet {
  private v = new Map<string, { x: number; vel: number }>();
  constructor(private omega = 9) {}
  step(target: Pose, dt: number): Pose {
    const out: Pose = {};
    const ids = new Set([...Object.keys(target), ...this.v.keys()]);
    const w = this.omega, h = Math.min(dt, 0.05);
    for (const id of ids) {
      const s = this.v.get(id) ?? { x: 0, vel: 0 };
      const goal = target[id] ?? 0;
      // semi-implicit critically damped step
      const acc = w * w * (goal - s.x) - 2 * w * s.vel;
      s.vel += acc * h;
      s.x += s.vel * h;
      if (!(id in target) && Math.abs(s.x) < 1e-3 && Math.abs(s.vel) < 1e-3) { this.v.delete(id); continue; }
      this.v.set(id, s);
      out[id] = s.x;
    }
    return out;
  }
}

export interface ParamAccess {
  get(id: string): number;
  set(id: string, v: number): void;
  has(id: string): boolean;
}

/**
 * Put back the values our offsets were added to last frame (call BEFORE IkiMotion.update), so
 * parameters nothing else writes do not keep the previous frame's offset.
 */
export function restoreBases(p: ParamAccess, bases: Map<string, number>): void {
  for (const [id, v] of bases) p.set(id, v);
  bases.clear();
}

/** Add offsets on top of the current values (call AFTER IkiMotion.update), remembering the bases. */
export function applyOffsets(p: ParamAccess, offsets: Pose, bases: Map<string, number>): void {
  for (const [id, off] of Object.entries(offsets)) {
    if (!p.has(id) || !Number.isFinite(off)) continue;
    const base = bases.has(id) ? bases.get(id)! : p.get(id);
    bases.set(id, base);
    p.set(id, base + off);
  }
}

/** Sum poses. */
export function addPoses(...poses: Pose[]): Pose {
  const out: Pose = {};
  for (const pose of poses) for (const [k, v] of Object.entries(pose)) out[k] = (out[k] ?? 0) + v;
  return out;
}
