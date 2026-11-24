/**
 * Body language for Iki models in Hikari: idle life, gestures and character signatures, all on
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

  /** Raised-hand wave as in her reference: elbow low beside the waist, forearm upright, hand at chin height, the
   *  forearm swaying from the elbow. Needs a model whose elbow opens to −170 (dev/iki-pipeline/extend-arms.mjs). */
  "wave-raised": { dur: 3.0, expression: "smile", pose: (t) => {
    // Up: the forearm folds first and the shoulder follows. Down: the shoulder lowers first and the forearm unfolds
    // last. Either way the forearm passes horizontal with the elbow at her side, so the hand stays close to the body.
    const fold = envelope(t, 0.05, 0.07), lift = envelope(t, 0.24, 0.3);
    const s = Math.sin((t - 0.2) * Math.PI * 7) * smoother((t - 0.18) / 0.12) * smoother((0.84 - t) / 0.1);
    // While the forearm swings through horizontal (fold half-way, shoulder still low) the upper arm tucks in, so the
    // hand passes close to the body instead of sweeping out to the window edge.
    const tuck = -8 * Math.sin(Math.PI * fold) * (1 - lift);
    return { ParamArmR: (22 + 2 * s) * lift + tuck, ParamElbowR: (-158 + 10 * s) * fold, ParamAngleZ: -5 * lift, ParamAngleX: -6 * lift, ParamBodyAngleZ: -1.5 * lift };
  } },

  // Makima's signature moves.
  /** Her composed stance: hands folded low in front, head inclined, a calm closed-lip smile. */
  "signature-clasp": { dur: 7.5, expression: "smile", pose: (t) => { const e = envelope(t, 0.12, 0.14); return { ParamElbowL: 62 * e, ParamElbowR: 70 * e, ParamArmL: -1 * e, ParamArmR: -2 * e, ParamAngleZ: 5 * e, ParamAngleY: -3 * e, ParamEyeLOpen: -0.22 * e, ParamEyeROpen: -0.22 * e, ParamBodyAngleZ: 1 * e }; } },
  /** Her knowing smile: head tilted, eyes closing into the smile, a slight lean. */
  "signature-smile": { dur: 4.2, expression: "smile", pose: (t) => { const e = envelope(t, 0.18, 0.25); const shut = smoother((t - 0.15) / 0.2) * smoother((0.85 - t) / 0.15); return { ParamAngleZ: 9 * e, ParamAngleY: 3 * e, ParamAngleX: -3 * e, ParamEyeLOpen: -0.9 * shut, ParamEyeROpen: -0.9 * shut, ParamBodyAngleZ: 2 * e }; } },
  /** "Bang": the arm comes up and out, a small recoil, held a beat, smile. */
  "signature-bang": { dur: 3.4, expression: "smile", pose: (t) => { const up = smoother(t / 0.14) * smoother((1 - t) / 0.3); const kick = Math.max(0, Math.sin(Math.PI * clamp01((t - 0.32) / 0.1))) * smoother((1 - t) / 0.3); return { ParamArmR: (25 + 5 * kick) * up, ParamElbowR: (-6 + 4 * kick) * up, ParamAngleZ: (-6 - 2 * kick) * up, ParamAngleX: -7 * up, ParamAngleY: (2 + 2 * kick) * up, ParamBodyAngleZ: -1.5 * up }; } },

  "signature-flower": { dur: 4.8, expression: "smile", pose: (t) => {
    // She bends her own arm in across the waist (as if taking the flower), the painted offer arm
    // cuts in, and the hand then comes forward. Back out in reverse. The arm is never squashed
    // (ParamOfferLift shrinks the upper arm into a stub, so it stays at 0).
    const bend = smoother((t - 0.04) / 0.2) * smoother((0.98 - t) / 0.13);
    // One opacity parameter swaps the two arms; halfway through a slow dissolve both are half
    // transparent (a ghost arm), so the swap is a ~70 ms cut.
    const offer = smoother((t - 0.255) / 0.015) * smoother((0.85 - t) / 0.015);
    const reach = smoother((t - 0.27) / 0.22) * smoother((0.82 - t) / 0.17);
    const tilt = envelope(t, 0.22, 0.27);
    return {
      ParamArmR: -3 * bend,
      ParamElbowR: 110 * bend,
      ParamOfferFlower: offer,
      ParamOfferReach: reach,
      ParamAngleZ: 9 * tilt,
      ParamAngleY: -3 * tilt,
      ParamBodyAngleY: 3 * reach,
      ParamEyeLOpen: -0.12 * tilt,
      ParamEyeROpen: -0.12 * tilt,
    };
  } },
  "signature-wave-shy": { dur: 3.6, pose: (t) => {
    const lift = envelope(t, 0.22, 0.29);
    const sway = Math.sin((t - 0.25) * Math.PI * 8) * envelope(t, 0.32, 0.36);
    return {
      ParamArmR: 5 * lift,
      ParamElbowR: 149 * lift + 4 * sway,
      ParamAngleZ: -7 * lift,
      ParamAngleY: -4 * lift,
      ParamEyeLOpen: -0.45 * lift,
      ParamEyeROpen: -0.45 * lift,
    };
  } },
  "signature-lean": { dur: 5.5, expression: "smile", pose: (t) => {
    const shift = envelope(t, 0.18, 0.23);
    const tuck = envelope(t, 0.23, 0.29);
    return {
      ParamLegShift: 0.78 * shift,
      ParamArmL: -4 * tuck,
      ParamArmR: -4 * tuck,
      ParamElbowL: 13 * tuck,
      ParamElbowR: 15 * tuck,
      ParamHandsBehind: envelope(t, 0.11, 0.14),
      ParamBodyAngleZ: -2.5 * shift,
      ParamAngleZ: 11 * shift,
      ParamAngleX: 5 * shift,
    };
  } },
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
  /** omegaFor: stiffer springs for light parts (a forearm follows faster than a whole arm). */
  constructor(private omega = 9, private omegaFor: Record<string, number> = {}) {}
  step(target: Pose, dt: number): Pose {
    const out: Pose = {};
    const ids = new Set([...Object.keys(target), ...this.v.keys()]);
    const h = Math.min(dt, 0.05);
    for (const id of ids) {
      const w = this.omegaFor[id] ?? this.omega;
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

/** Use the raised variant of a gesture when the model's arm ranges allow it (see dev/iki-pipeline/extend-arms.mjs). */
/** Soft upper limit: unchanged below 60 % of max, then eased so it approaches max without a hard stop. */
export function softLimit(v: number, max: number): number {
  const knee = 0.6 * max, room = max - knee;
  return v <= knee ? v : knee + room * Math.tanh((v - knee) / room);
}

/**
 * Limits how far a gesture swings the upper arms out (ParamArmL/R), for art that opens at the armpit.
 * A near-straight arm keeps its hand direction by bending the elbow outward by the angle taken off
 * the shoulder (a point becomes a point from the elbow); an already folded arm (a wave) is left as is.
 */
export function limitArmLift(pose: Pose, max: number | undefined): Pose {
  if (max === undefined) return pose;
  for (const side of ["L", "R"]) {
    const arm = `ParamArm${side}`, elbow = `ParamElbow${side}`;
    const v = pose[arm];
    if (v === undefined) continue;
    const limited = softLimit(v, max);
    pose[arm] = limited;
    const e = pose[elbow] ?? 0;
    if (Math.abs(e) < 90) pose[elbow] = e - (v - limited) * (1 - Math.abs(e) / 90);
  }
  return pose;
}

export function resolveGesture(name: string, armMax: number, elbowMin: number): string {
  const raised = armMax >= 32 && elbowMin <= -168;
  if (raised && name === "wave") return "wave-raised";
  return name;
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
