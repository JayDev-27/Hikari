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
  /** Exact timing and reach: no spring lag or random amplitude (a clap whose palms must meet, not miss). */
  timed?: boolean;
}

/** Cheng Xiaoshi's clap, measured on render_poses with his palm-side hands in (ParamChengPalm 1: flat, fingers
 *  together, wrists bent so the hands stand straight up): at elbow 124° (forearm full length) his palms press flat
 *  and straight together in front of his chest, fingers up; at 132°, slightly foreshortened, they are a hand's
 *  width apart, palms facing. */
export const CLAP_CONTACT = 124, CLAP_OPEN = 132, CLAP_OPEN_DEPTH = 0.3;

/**
 * Hands for a clap on a rig whose elbow folds inward to 170° and whose forearm foreshortens
 * (ParamChengClapDepth, dev/iki-pipeline/pose-cheng.mjs). The upper arms stay near the sides (at most ~12° out,
 * where the raglan shoulder holds), so the shoulders never open. Rising and lowering, the forearms point at the
 * viewer (foreshortened) and the elbows ease out, so the hands come up in front of the chest a hand apart instead
 * of sweeping across each other; at the top the palms meet. A forearm folded up in the picture plane turns its
 * hand palm-out, so on the way up (hands moving fast, near the centre) the hands swap to palm-side twins
 * (ParamChengPalm, dev/iki-pipeline/palm-swap.mjs): palms meet palms, not the backs of the hands.
 * `up` 0 rest → 1 hands up; `gap` 0 palms pressed → 1 open.
 */
export function foldClap(up: number, gap: number): Pose {
  const top = smoother((up - 0.75) / 0.25);
  const elbow = (CLAP_CONTACT + (CLAP_OPEN - CLAP_CONTACT) * gap) * up;
  const depth = smoother(up / 0.3) * (1 - top) + CLAP_OPEN_DEPTH * gap * top;
  const arm = 12 * Math.sin(Math.PI * clamp01(up / 0.9)) * (1 - top) + 2 * top;
  // A one-frame swap (both half-transparent would show through), at the speed peak of the rise.
  const palm = smoother((up - 0.8) / 0.03);
  return { ParamElbowL: elbow, ParamElbowR: elbow, ParamChengClapDepth: depth, ParamChengPalm: palm, ParamArmL: arm, ParamArmR: arm };
}

/**
 * Gestures. Iki's elbow bends only toward the body, so a raised-hand wave needs a drawn raised
 * forearm; here a wave is the whole arm swinging out and back, which the rig does well.
 */
export const GESTURES: Record<string, Gesture> = {
  wave: { dur: 2.8, expression: "smile", pose: (t) => { const e = envelope(t, 0.2, 0.3); const s = Math.sin((t - 0.2) * Math.PI * 5) * smoother((t - 0.15) / 0.15); return { ParamArmR: (20 + 7 * s) * e, ParamElbowR: (-4 + 6 * s) * e, ParamAngleZ: -4 * e, ParamAngleX: -5 * e, ParamBodyAngleZ: -1.5 * e }; } },
  point: { dur: 2.2, pose: (t) => { const e = envelope(t, 0.18, 0.3); return { ParamArmR: 24 * e, ParamElbowR: 6 * e, ParamAngleX: -9 * e, ParamAngleY: 2 * e }; } },
  shrug: { dur: 1.9, pose: (t) => { const e = envelope(t, 0.3, 0.35); return { ParamArmL: 9 * e, ParamArmR: 9 * e, ParamElbowL: 38 * e, ParamElbowR: 42 * e, ParamAngleZ: 7 * e, ParamAngleY: 3 * e }; } },
  /** Hands beat between slightly apart (elbows ~37°) and touching at the centre (~53°); past ~60° the forearms
   *  cross into an X instead of meeting. */
  clap: { dur: 2.4, expression: "laugh", pose: (t) => { const e = envelope(t, 0.2, 0.25); const c = 0.5 + 0.5 * Math.sin(t * Math.PI * 9); return { ParamArmL: 3 * e, ParamArmR: 3 * e, ParamElbowL: (36 + 16 * c) * e, ParamElbowR: (38 + 16 * c) * e }; } },
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
  /** think_chin on a rig whose elbow folds inward past 150° (dev/iki-pipeline/elbow-in.mjs): the hand rises across the
   *  chest to the chin, the other forearm resting under it, head tilted up in thought. The fold gestures stay at or
   *  under ~156° so the ±5 % variation never reaches the 170° stop, where the forearm lies along the upper arm and
   *  the hand ends up back at the shoulder. */
  "think_chin-fold": { dur: 3.4, pose: (t) => {
    const e = envelope(t, 0.24, 0.24), look = envelope(t, 0.3, 0.26);
    return { ParamArmR: 2 * e, ParamElbowR: 150 * e, ParamArmL: -2 * e, ParamElbowL: 32 * e, ParamAngleZ: 6 * look, ParamAngleY: 5 * look, ParamAngleX: 4 * look, ParamEyeLOpen: -0.15 * look, ParamEyeROpen: -0.15 * look };
  } },
  /** facepalm on the same rig: the hand comes up across the chest, then the head bows into it, eyes shut, a slow
   *  small shake while it is held. */
  "facepalm-fold": { dur: 3.0, pose: (t) => {
    const e = envelope(t, 0.2, 0.24), bow = envelope(t, 0.32, 0.22);
    const shake = Math.sin((t - 0.32) * Math.PI * 6) * smoother((t - 0.34) / 0.1) * smoother((0.74 - t) / 0.1);
    return { ParamArmR: -6 * e, ParamElbowR: 156 * e, ParamAngleX: -14 * bow, ParamAngleZ: 9 * bow, ParamAngleY: -7 * bow + 3 * shake, ParamEyeLOpen: -0.85 * bow, ParamEyeROpen: -0.85 * bow };
  } },

  // Makima's signature moves.
  /** Her composed stance: hands folded low in front, head inclined, a calm closed-lip smile. */
  "signature-clasp": { dur: 7.5, expression: "smile", pose: (t) => { const e = envelope(t, 0.12, 0.14); return { ParamElbowL: 62 * e, ParamElbowR: 70 * e, ParamArmL: -1 * e, ParamArmR: -2 * e, ParamAngleZ: 5 * e, ParamAngleY: -3 * e, ParamEyeLOpen: -0.22 * e, ParamEyeROpen: -0.22 * e, ParamBodyAngleZ: 1 * e }; } },
  /** Her knowing smile: head tilted, eyes closing into the smile, a slight lean. */
  "signature-smile": { dur: 4.2, expression: "smile", pose: (t) => { const e = envelope(t, 0.18, 0.25); const shut = smoother((t - 0.15) / 0.2) * smoother((0.85 - t) / 0.15); return { ParamAngleZ: 9 * e, ParamAngleY: 3 * e, ParamAngleX: -3 * e, ParamEyeLOpen: -0.9 * shut, ParamEyeROpen: -0.9 * shut, ParamBodyAngleZ: 2 * e }; } },
  /** "Bang": the arm comes up and out, a small recoil, held a beat, smile. */
  "signature-bang": { dur: 3.4, expression: "smile", pose: (t) => { const up = smoother(t / 0.14) * smoother((1 - t) / 0.3); const kick = Math.max(0, Math.sin(Math.PI * clamp01((t - 0.32) / 0.1))) * smoother((1 - t) / 0.3); return { ParamArmR: (25 + 5 * kick) * up, ParamElbowR: (-6 + 4 * kick) * up, ParamAngleZ: (-6 - 2 * kick) * up, ParamAngleX: -7 * up, ParamAngleY: (2 + 2 * kick) * up, ParamBodyAngleZ: -1.5 * up }; } },

  "signature-flower": { dur: 4.8, pose: (t) => {
    // She bends her own arm in across the waist (as if taking the flower), the painted offer arm
    // cuts in, and the hand then comes forward. Back out in reverse. The arm is never squashed
    // (ParamOfferLift shrinks the upper arm into a stub, so it stays at 0).
    const bend = smoother((t - 0.04) / 0.2) * smoother((0.98 - t) / 0.13);
    // One opacity parameter swaps the two arms; halfway through a slow dissolve both are half
    // transparent (a ghost arm), so the swap is a ~70 ms cut.
    const offer = smoother((t - 0.255) / 0.015) * smoother((0.85 - t) / 0.015);
    const reach = smoother((t - 0.27) / 0.22) * smoother((0.82 - t) / 0.17);
    const smile = smoother((t - 0.19) / 0.23) * smoother((0.94 - t) / 0.19);
    const tilt = envelope(t, 0.22, 0.27);
    return {
      ParamArmR: -3 * bend,
      ParamElbowR: 110 * bend,
      ParamOfferFlower: offer,
      ParamOfferReach: reach,
      ParamMouthForm: smile,
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

  "signature-glasses": { dur: 6.4, pose: (t) => {
    const reach = smoother((t - 0.035) / 0.33) * smoother((0.92 - t) / 0.31);
    const push = smoother((t - 0.37) / 0.09) * smoother((0.66 - t) / 0.10);
    const smile = smoother((t - 0.47) / 0.20) * smoother((1 - t) / 0.16);
    return {
      ParamGlassesReach: reach,
      ParamGlassesPush: push,
      ParamMouthForm: 0.8 * smile,
      ParamAngleZ: 5 * smile * (1 - reach),
      ParamEyeLOpen: -0.13 * smile,
      ParamEyeROpen: -0.13 * smile,
    };
  } },
  /** She holds an open book low in front, cradled in both hands, and reads it: head bowed, eyes lowered, weight on
   *  one leg. The book (ParamRizeBook) shows once the hands are nearly there and goes before they drop. */
  "signature-book": { dur: 7.2, pose: (t) => {
    const hold = envelope(t, 0.27, 0.29);
    // A ~0.1 s swap while the hands are still moving: a slow fade would show a see-through book over the hands.
    const book = smoother((t - 0.215) / 0.015) * smoother((0.775 - t) / 0.015);
    return {
      ParamRizeBook: book,
      ParamElbowL: 44 * hold,
      ParamElbowR: 46 * hold,
      ParamArmL: 2 * hold,
      ParamArmR: 2 * hold,
      ParamAngleY: -9 * hold,
      ParamAngleZ: 5 * hold,
      ParamEyeLOpen: -0.47 * hold,
      ParamEyeROpen: -0.47 * hold,
      ParamLegShift: 0.47 * hold,
    };
  } },
  "signature-ghoul": { dur: 6.4, pose: (t) => {
    const reveal = smoother((t - 0.23) / 0.06) * smoother((0.89 - t) / 0.06);
    const shut = Math.max(
      smoother((t - 0.10) / 0.10) * smoother((0.42 - t) / 0.13),
      smoother((t - 0.71) / 0.10) * smoother((0.99 - t) / 0.10),
    );
    const lean = envelope(t, 0.25, 0.22);
    return {
      ParamRizeGhoul: reveal,
      ParamEyeLOpen: -shut,
      ParamEyeROpen: -shut,
      ParamAngleY: -7 * lean + 7 * reveal * (1 - shut),
      ParamAngleZ: 6 * lean,
      ParamBodyAngleZ: 1.2 * lean,
      ParamMouthForm: 0.67 * reveal,
      ParamLegShift: 0.55 * lean,
    };
  } },

  /** His clap before he dives into a photo: hands up, one sharp clap, palms held pressed while he focuses with
   *  eyes shut, then he opens his eyes on the photo and the hands come down. */
  "signature-photo-dive": { dur: 3.3, timed: true, pose: (t) => {
    const up = smoother(t / 0.2) * smoother((0.9 - t) / 0.24);
    // Open just before contact (a wind-up), then the palms snap together in ~70 ms and stay pressed.
    const gap = t < 0.2 ? 1 : 1 - smoother((t - 0.235) / 0.022);
    const impact = Math.exp(-(((t - 0.262) / 0.025) ** 2));
    const blink = smoother((t - 0.25) / 0.03) * smoother((0.6 - t) / 0.06);
    const focus = smoother((t - 0.5) / 0.1) * smoother((1 - t) / 0.18);
    const dip = envelope(t, 0.29, 0.52);
    return {
      ...foldClap(up, Math.max(gap, 1 - up)),
      ParamEyeLOpen: -blink - 0.10 * focus * (1 - blink),
      ParamEyeROpen: -blink - 0.10 * focus * (1 - blink),
      ParamAngleY: -7 * dip + 4 * focus - 2.5 * impact,
      ParamAngleX: -3 * focus,
      ParamBodyAngleY: -2.5 * dip - 1.2 * impact,
      ParamBrowLY: -0.18 * focus,
      ParamBrowRY: -0.18 * focus,
      ParamMouthForm: -0.24 * focus,
      ParamLegShift: 0.45 * dip,
    };
  } },
  /** clap on Cheng Xiaoshi's elbow-fold rig: hands up, three quick claps that bounce off at contact, hands down. */
  "clap-fold": { dur: 2.4, timed: true, expression: "laugh", pose: (t) => {
    const up = smoother(t / 0.2) * smoother((1 - t) / 0.2);
    const beat = smoother((t - 0.2) / 0.04) * smoother((0.8 - t) / 0.04);
    // Contact at t = 0.35, 0.5, 0.65: the hands bounce straight off each other, as a clap does.
    const gap = 1 - beat * (1 - Math.abs(Math.sin(Math.PI * (t - 0.2) / 0.15)));
    return { ...foldClap(up, gap), ParamAngleY: 1.5 * beat * (1 - gap), ParamAngleZ: 3 * up };
  } },
  /** The sheepish neck rub: the hand comes up across the chest to the back of the neck (needs the elbow to fold
   *  inward to 170°, dev/iki-pipeline/elbow-in.mjs) and rubs it, head tilted, a sheepish grin. */
  "signature-sheepish": { dur: 3.4, pose: (t) => {
    const e = envelope(t, 0.20, 0.30);
    const bob = Math.sin((t - 0.19) * Math.PI * 7) * envelope(t, 0.32, 0.43);
    return {
      ParamElbowR: (152 + 4 * bob) * e,
      ParamArmL: 5 * e,
      ParamArmR: -6 * e,
      ParamAngleZ: 10 * e,
      ParamAngleX: 8 * e,
      ParamAngleY: -5 * e + 2.5 * bob,
      ParamEyeLOpen: -0.32 * e,
      ParamEyeROpen: -0.32 * e,
      ParamMouthForm: 0.9 * e,
      ParamMouthOpenY: 0.31 * e,
      ParamLegShift: -0.65 * e,
    };
  } },
  "signature-wink": { dur: 2.9, pose: (t) => {
    const fold = envelope(t, 0.060, 0.080), lift = envelope(t, 0.28, 0.32);
    const wink = smoother((t - 0.29) / 0.09) * smoother((0.64 - t) / 0.13);
    return {
      ParamArmR: 11 * lift - 7 * Math.sin(Math.PI * fold) * (1 - lift),
      ParamElbowR: -155 * fold,
      ParamAngleZ: -7 * lift,
      ParamAngleY: 4 * lift,
      ParamEyeROpen: -wink,
      ParamMouthForm: 0.84 * lift,
      ParamLegShift: 0.58 * lift,
    };
  } },
  /** clap on Lu Guang's rig: his left hand palm-up at the waist, his right turned palm-down (a mirrored hand,
   *  ParamLuPalm, swapped in while it rises) claps onto it three times — palm meets palm, a quiet, polite clap.
   *  Elbows measured on render_poses: right 92° rests on the left palm at 88°, 100° lifts it clear. */
  "clap-palm-down": { dur: 2.4, timed: true, expression: "smile", pose: (t) => {
    const up = smoother(t / 0.2) * smoother((1 - t) / 0.2);
    const beat = smoother((t - 0.2) / 0.04) * smoother((0.8 - t) / 0.04);
    // Contact at t = 0.35, 0.5, 0.65; the right hand bounces up off the left between claps.
    const gap = 1 - beat * (1 - Math.abs(Math.sin(Math.PI * (t - 0.2) / 0.15)));
    const palm = smoother((up - 0.45) / 0.05);
    return {
      ParamElbowL: 88 * up,
      ParamElbowR: (92 + 8 * gap) * up,
      ParamLuPalm: palm,
      ParamAngleY: -4 * up - 1.5 * beat * (1 - gap),
      ParamAngleZ: 2 * up,
    };
  } },
  /** think_chin on Lu Guang's rig: his chin lift at 0.72 with the elbow folded 45° more puts his fingers on his
   *  jaw while the shoulder holds (the full lift's 52° shows the sleeve's bend seam). */
  "think_chin-lift": { dur: 3.2, timed: true, pose: (t) => {
    const e = envelope(t, 0.25, 0.25);
    return { ParamLuThought: 0.72 * e, ParamElbowR: 45 * e, ParamAngleY: -8 * e, ParamAngleZ: 4 * e, ParamEyeLOpen: -0.12 * e, ParamEyeROpen: -0.12 * e };
  } },
  /** facepalm on Lu Guang's rig: the same hand to his jaw, head bowed further, eyes shut — a weary sigh. */
  "facepalm-lift": { dur: 2.8, timed: true, pose: (t) => {
    const e = envelope(t, 0.25, 0.3);
    const shut = smoother((t - 0.2) / 0.08) * smoother((0.8 - t) / 0.08);
    return { ParamLuThought: 0.72 * e, ParamElbowR: 45 * e, ParamAngleY: -16 * e, ParamAngleZ: -3 * e, ParamEyeLOpen: -shut, ParamEyeROpen: -shut, ParamMouthForm: -0.3 * e };
  } },
  /** Lu Guang's signature: he lifts a photo he's holding (ParamLuPhoto, a prop riding his right forearm; we see
   *  its back, the picture faces him) up to mid-chest and studies it, head bowed, lids lowered, a slight turn of
   *  the wrist as he looks, his irises glowing blue as he reads it (ParamLuGlow); then he lowers it.
   *  The hand comes up from the elbow alone (folded inward to 130°, dev/iki-pipeline/elbow-in.mjs 140): the
   *  shoulder stays down, so the sleeve never opens at the armpit. */
  "signature-study-photo": { dur: 8.6, timed: true, pose: (t) => {
    const raise = envelope(t, 0.17, 0.19);
    // The photo is in his hand as it starts to move, and gone once the hand is back down.
    const photo = smoother((t - 0.01) / 0.03) * smoother((0.99 - t) / 0.03);
    const focus = smoother((t - 0.13) / 0.1) * smoother((0.84 - t) / 0.1);
    // A small turn of the photo toward him, and a slower drift of his gaze over it.
    const look = Math.sin(Math.PI * clamp01((t - 0.3) / 0.4));
    // The glow wakes once his eyes are on the photo and fades before he looks up.
    const glow = smoother((t - 0.21) / 0.07) * smoother((0.79 - t) / 0.06);
    return {
      ParamLuPhoto: photo,
      ParamLuGlow: glow,
      ParamElbowR: 130 * raise + 4 * look * focus,
      ParamArmR: 2 * raise,
      ParamAngleY: -18 * focus,
      ParamAngleX: (6 - 3 * look) * focus,
      ParamAngleZ: 2 * focus,
      ParamEyeBallY: -0.8 * focus,
      ParamEyeBallX: (0.15 - 0.25 * look) * focus,
      ParamEyeLOpen: -0.3 * focus,
      ParamEyeROpen: -0.3 * focus,
      ParamBrowLY: -0.08 * focus,
      ParamBrowRY: -0.08 * focus,
    };
  } },
  "signature-folded-nod": { dur: 7.9, timed: true, pose: (t) => {
    const left = smoother((t - 0.06) / 0.25) * smoother((1 - t) / 0.32);
    const right = smoother(t / 0.24) * smoother((0.94 - t) / 0.24);
    const nod = smoother((t - 0.35) / 0.14) * smoother((0.71 - t) / 0.15);
    return {
      ParamLuFoldL: left,
      ParamLuFoldR: right,
      ParamAngleY: -5.5 * nod,
      ParamEyeLOpen: -0.10 * nod,
      ParamEyeROpen: -0.10 * nod,
      ParamMouthForm: 0.23 * left,
    };
  } },
  /** Lu Guang's quiet thought: fingers to his jaw, head bowed a little, eyes half-lowered. The rig's chin lift
   *  (ParamLuThought) swings the upper arm up 52° at full, which shows the sleeve's bend seam and a step at the
   *  shoulder; at 0.72 (≈37°) with the elbow folded 45° more, the hand still reaches his jaw and the shoulder holds. */
  "signature-quiet-thought": { dur: 7.4, timed: true, pose: (t) => {
    const raise = envelope(t, 0.31, 0.31);
    const consider = smoother((t - 0.22) / 0.19) * smoother((0.88 - t) / 0.20);
    return {
      ParamLuThought: 0.72 * raise,
      ParamElbowR: 45 * raise,
      ParamAngleY: -10 * raise,
      ParamAngleZ: 3 * raise,
      ParamEyeLOpen: -0.16 * consider,
      ParamEyeROpen: -0.16 * consider,
      ParamMouthForm: -0.12 * consider,
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

/** Springs ease offsets in and settle. Lower damping allows a little overshoot. */
export class SpringSet {
  private v = new Map<string, { x: number; vel: number }>();
  /** omegaFor: stiffer springs for light parts (a forearm follows faster than a whole arm). */
  constructor(private omega = 9, private omegaFor: Record<string, number> = {}, private damping = 1) {}
  step(target: Pose, dt: number): Pose {
    const out: Pose = {};
    const ids = new Set([...Object.keys(target), ...this.v.keys()]);
    const h = Math.min(dt, 0.05);
    for (const id of ids) {
      const w = this.omegaFor[id] ?? this.omega;
      const s = this.v.get(id) ?? { x: 0, vel: 0 };
      const goal = target[id] ?? 0;
      // semi-implicit critically damped step
      const acc = w * w * (goal - s.x) - 2 * this.damping * w * s.vel;
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

/**
 * The variant of a gesture this rig can do well. `has` tells whether the model declares a parameter (a boolean
 * stands for "has ParamChengClapDepth", the forearm foreshortening, as older callers pass).
 */
export function resolveGesture(name: string, armMax: number, elbowMin: number, elbowMax = 0, has: boolean | ((id: string) => boolean) = false): string {
  const declares = typeof has === "function" ? has : (id: string) => has && id === "ParamChengClapDepth";
  const raised = armMax >= 32 && elbowMin <= -168;
  if (raised && name === "wave") return "wave-raised";
  // Palms meet only with the elbow fold plus a forearm that foreshortens on the way up (Cheng Xiaoshi).
  if (elbowMax >= 168 && declares("ParamChengClapDepth") && name === "clap") return "clap-fold";
  // Lu Guang: his right hand turns palm-down (ParamLuPalm) to clap onto his upturned left palm; his chin lift
  // (ParamLuThought) carries the hand-to-face gestures his short forearms can't reach from the elbow.
  if (declares("ParamLuPalm") && name === "clap") return "clap-palm-down";
  if (declares("ParamLuThought") && (name === "think_chin" || name === "facepalm")) return `${name}-lift`;
  // A forearm that folds inward past 150° brings the hand to the face across the chest.
  if (elbowMax >= 168 && (name === "think_chin" || name === "facepalm")) return `${name}-fold`;
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
