import type { AvatarState } from "../types";

/**
 * Every number the four animation layers use (see animator.ts), in one plain object so the dev tuner
 * (`#/tuner`) can edit it live and copy the result out. Renderers read it every frame, so a change shows at once.
 *
 * Units: seconds, degrees in the Cubism head/body convention (shared by Live2D and Iki; vrm/ maps them onto its
 * joints), gaze in -1..1 look units (+x = the viewer's right, +y = up), eye opening as an offset (-1 = shut).
 */

/** One state's body language: offsets added on top of base life, blended between states. */
export interface Posture {
  /** Head turn toward the viewer's right, degrees. */
  headYaw: number;
  /** Head up (+) / down (-), degrees. */
  headPitch: number;
  /** Head tilt, top toward the viewer's right (+), degrees. */
  headRoll: number;
  /** Body turn toward the viewer's right, degrees. */
  bodyYaw: number;
  /** Upper body leaning toward the viewer (+), degrees. */
  bodyLean: number;
  /** Body tilt, top toward the viewer's right (+), degrees. */
  bodyRoll: number;
  /** Shoulders raised (+) / dropped (-), degrees (VRM only). */
  shoulders: number;
  /** Where the state wants the eyes (look units) and how much that wins over the cursor (0..1). */
  gazeX: number;
  gazeY: number;
  gazeWeight: number;
  /** Eyelids: -1 shut … 0 normal … +0.2 wide. */
  eyeOpen: number;
  /** Brows raised (+) / lowered (-), -1..1. */
  brow: number;
  /** Multipliers on base life. */
  breathRate: number;
  breathDepth: number;
  sway: number;
  blinkRate: number;
  /** Multiplier on how often idle look-aways happen (0 = never in this state). */
  lookAway: number;
  /** Multiplier on micro-saccade size. */
  saccade: number;
  /** 0..1: chance the state cues a hand-to-chin gesture after `state.cueDelay` (thinking). */
  chinHand: number;
}

export const POSTURE_KEYS = [
  "headYaw", "headPitch", "headRoll", "bodyYaw", "bodyLean", "bodyRoll", "shoulders",
  "gazeX", "gazeY", "gazeWeight", "eyeOpen", "brow",
  "breathRate", "breathDepth", "sway", "blinkRate", "lookAway", "saccade", "chinHand",
] as const satisfies readonly (keyof Posture)[];

/** Offset channels (0 at rest); the rest are multipliers (1 at rest) or weights. */
export const NEUTRAL_POSTURE: Posture = {
  headYaw: 0, headPitch: 0, headRoll: 0, bodyYaw: 0, bodyLean: 0, bodyRoll: 0, shoulders: 0,
  gazeX: 0, gazeY: 0, gazeWeight: 0, eyeOpen: 0, brow: 0,
  breathRate: 1, breathDepth: 1, sway: 1, blinkRate: 1, lookAway: 1, saccade: 1, chinHand: 0,
};

const P = (p: Partial<Posture>): Posture => ({ ...NEUTRAL_POSTURE, ...p });

export const DEFAULT_POSTURES: Record<AvatarState, Posture> = {
  idle: P({}),
  // Attentive: leans in a little, head tilted, eyes on you (wider, brows up), stiller, no looking away.
  listening: P({ headPitch: 1, headRoll: 4, bodyLean: 2.5, gazeX: 0, gazeY: 0.05, gazeWeight: 0.55, eyeOpen: 0.08, brow: 0.2, sway: 0.6, lookAway: 0, saccade: 0.6, blinkRate: 0.85 }),
  // Eyes up and to the side, head lifted and turned, brows up; the hand tends to the chin.
  thinking: P({ headYaw: 4, headPitch: 5, headRoll: -3, bodyYaw: 1.5, gazeX: 0.45, gazeY: 0.6, gazeWeight: 0.85, eyeOpen: -0.05, brow: 0.25, sway: 0.7, lookAway: 0, saccade: 1.6, blinkRate: 0.7, chinHand: 0.7 }),
  // Engaged with you, a slight lean, a bit more movement; people glance away now and then while talking.
  speaking: P({ headPitch: 0.5, bodyLean: 1.2, gazeY: 0.03, gazeWeight: 0.3, sway: 1.15, lookAway: 0.6, blinkRate: 1.1 }),
  // Focused on something low and to the side (a task), lids lowered, stiller, fewer blinks.
  working: P({ headYaw: -6, headPitch: -7, headRoll: 2, bodyYaw: -2, bodyLean: 2, gazeX: -0.35, gazeY: -0.55, gazeWeight: 0.85, eyeOpen: -0.22, brow: -0.1, breathRate: 0.9, sway: 0.5, lookAway: 0, saccade: 1.3, blinkRate: 0.6 }),
  // Head down and tilted, eyes shut, slow deep breaths, nearly still.
  sleeping: P({ headPitch: -12, headRoll: 6, bodyLean: 2, bodyRoll: 1, shoulders: -3, gazeY: -0.4, gazeWeight: 1, eyeOpen: -1, brow: -0.1, breathRate: 0.55, breathDepth: 1.6, sway: 0.3, blinkRate: 0, lookAway: 0, saccade: 0 }),
  // Coming round: head still low, lids heavy and fluttering (frequent blinks); becomes idle after `state.wakeDuration`.
  waking: P({ headPitch: -4, headRoll: 2, bodyLean: 1, eyeOpen: -0.45, brow: 0.1, breathRate: 0.8, breathDepth: 1.3, sway: 0.6, blinkRate: 2.6, lookAway: 0, saccade: 0.5 }),
};

export interface Tuning {
  blink: {
    /** Mean seconds between spontaneous blinks (log-normal around it, clamped to min..max). */
    mean: number; min: number; max: number;
    /** Chance a blink comes as a quick pair. */
    double: number;
    /** Lid close / open time, s. */
    close: number; open: number;
    /** A gaze jump larger than `gazeShift` (look units) blinks with this chance (eyes blink as they move). */
    gazeShift: number; gazeShiftChance: number;
  };
  saccade: { amplitude: number; min: number; max: number };
  lookAway: { min: number; max: number; holdMin: number; holdMax: number; amplitude: number; weight: number };
  breath: { rate: number; depth: number };
  sway: { amplitude: number; tempo: number };
  weightShift: { min: number; max: number; amplitude: number; ease: number };
  state: {
    /** Time constant of a posture change, s (sleeping eases in slower, see `sleep`). */
    transition: number; sleep: number;
    /** Waking turns into idle after this long, s. */
    wakeDuration: number;
    /** Scales every posture offset. */
    scale: number;
    /** Seconds in a state before its gesture tendency (chinHand) may fire. */
    cueDelay: number;
  };
  emotion: {
    /** Expression fade in / out time constants, s. */
    attack: number; release: number;
    /** Seconds an emotion holds at full intensity before it starts to decay, and its half-life after that. */
    hold: number; halfLife: number;
    /** Below this weight the expression is dropped (renderers with on/off expressions). */
    threshold: number;
    scale: number;
  };
  gesture: {
    /** Scales gesture amplitude (exact "timed" gestures keep their reach). */
    intensity: number;
    /** Playback speed (>1 = faster); timed gestures stay in sync because the whole timeline scales. */
    speed: number;
    /** How much a running gesture overrides state posture and gaze (0..1). */
    duck: number;
    /** Weight-shift settle after a gesture ends: degrees and seconds. */
    settle: number; settleTime: number;
  };
  face: {
    /** Multiplies lip-sync visemes (mouth opening). */
    mouthGain: number;
    /** Multiplies emotion face extras (smile, brows, lids). */
    emotionFace: number;
  };
  lipsync: { attack: number; release: number };
  postures: Record<AvatarState, Posture>;
}

export const DEFAULT_TUNING: Tuning = {
  blink: { mean: 3.6, min: 1.1, max: 9, double: 0.14, close: 0.07, open: 0.15, gazeShift: 0.32, gazeShiftChance: 0.55 },
  saccade: { amplitude: 0.05, min: 0.5, max: 2.6 },
  lookAway: { min: 7, max: 18, holdMin: 0.7, holdMax: 2.2, amplitude: 0.55, weight: 0.85 },
  breath: { rate: 1, depth: 1 },
  sway: { amplitude: 1, tempo: 1 },
  weightShift: { min: 7, max: 14, amplitude: 0.7, ease: 0.9 },
  state: { transition: 0.4, sleep: 1.3, wakeDuration: 2.4, scale: 1, cueDelay: 1.4 },
  emotion: { attack: 0.22, release: 0.6, hold: 5, halfLife: 3, threshold: 0.15, scale: 1 },
  gesture: { intensity: 1, speed: 1, duck: 0.85, settle: 1.6, settleTime: 1.3 },
  face: { mouthGain: 1, emotionFace: 1 },
  lipsync: { attack: 0.035, release: 0.07 },
  postures: DEFAULT_POSTURES,
};

type Plain = { [k: string]: number | Plain };

export function cloneTuning(t: Tuning = DEFAULT_TUNING): Tuning {
  return JSON.parse(JSON.stringify(t)) as Tuning;
}

/** Deep-merge `overrides` (any subset of a Tuning) into a copy of `base`; unknown keys and non-numbers are ignored. */
export function mergeTuning(base: Tuning, overrides: unknown): Tuning {
  const out = cloneTuning(base) as unknown as Plain;
  const walk = (dst: Plain, src: unknown) => {
    if (!src || typeof src !== "object") return;
    for (const [k, v] of Object.entries(src as Record<string, unknown>)) {
      if (!(k in dst)) continue;
      const d = dst[k];
      if (typeof d === "number") {
        if (typeof v === "number" && Number.isFinite(v)) dst[k] = v;
      } else walk(d, v);
    }
  };
  walk(out, overrides);
  return out as unknown as Tuning;
}

/** Only the numbers that differ from `base` (what the tuner copies out and stores). */
export function diffTuning(t: Tuning, base: Tuning = DEFAULT_TUNING): Record<string, unknown> {
  const walk = (a: Plain, b: Plain): Plain | undefined => {
    const out: Plain = {};
    let any = false;
    for (const [k, v] of Object.entries(a)) {
      const w = b[k];
      if (typeof v === "number") {
        if (typeof w !== "number" || Math.abs(v - w) > 1e-9) { out[k] = v; any = true; }
      } else if (w && typeof w === "object") {
        const sub = walk(v, w);
        if (sub) { out[k] = sub; any = true; }
      }
    }
    return any ? out : undefined;
  };
  return walk(t as unknown as Plain, base as unknown as Plain) ?? {};
}

export const TUNING_KEY = (characterId: string) => `hikari.tuning.${characterId}`;

/**
 * The tuning a character's avatar starts with: the defaults, plus (dev builds only) overrides saved by the tuner in
 * localStorage. Release builds never read them, so a stray dev override can't ship.
 */
export function loadTuning(characterId: string | undefined): Tuning {
  if (!import.meta.env.DEV || !characterId) return cloneTuning();
  try {
    const raw = localStorage.getItem(TUNING_KEY(characterId));
    return raw ? mergeTuning(DEFAULT_TUNING, JSON.parse(raw)) : cloneTuning();
  } catch {
    return cloneTuning();
  }
}

/** Dev tuner: store only the differences from the defaults (an empty diff removes the key). */
export function saveTuning(characterId: string, t: Tuning): void {
  try {
    const diff = diffTuning(t);
    if (Object.keys(diff).length) localStorage.setItem(TUNING_KEY(characterId), JSON.stringify(diff));
    else localStorage.removeItem(TUNING_KEY(characterId));
  } catch {
    /* storage unavailable: the tuning lasts for this page only */
  }
}
