import type { Emotion } from "@hikari/protocol";
import type { AvatarState } from "../types";
import { EmotionLayer, type FaceExtras } from "./emotion";
import { Blinker, Breath, LookAway, Saccades, WeightShift, critStep, mulberry32, smoothstep, type Rng } from "./life";
import { NEUTRAL_POSTURE, POSTURE_KEYS, cloneTuning, type Posture, type Tuning } from "./tuning";

/**
 * The four animation layers every renderer (Live2D, Iki, VRM) applies each frame, bottom to top:
 *
 *  1. **Base life** — breathing, blinks, micro sway, eye saccades, occasional look-aways, slow weight shifts.
 *  2. **State posture** — idle / listening / thinking / speaking / working / sleeping / waking, as offsets that
 *     cross-fade between states on critically damped springs (a state change never snaps).
 *  3. **Gesture** — the renderer's own gestures and motions, added over the posture. While one plays, the posture
 *     and the state's gaze duck under it (`gesture.duck`), so a hand-to-face gesture still meets the face when the
 *     state changes mid-gesture; when it ends the body settles its weight (a small damped sway).
 *  4. **Face** — emotion (decaying to neutral unless refreshed), lip-sync visemes (renderer side) and look-at.
 *
 * This class is renderer-agnostic and pure (no DOM): it turns inputs (state, emotion cues, cursor look, whether a
 * gesture plays) into a {@link LayerFrame} of abstract numbers that each renderer maps onto its own parameters
 * (layers/mapping.ts). The numbers it uses live in {@link Tuning}, which the dev tuner edits live.
 */

export const AVATAR_STATES: AvatarState[] = ["idle", "listening", "thinking", "speaking", "working", "sleeping", "waking"];

export interface LayerFrame {
  /** Animator clock, s. */
  t: number;
  /** Clock for renderer-side noise (sway), advancing at the sway tempo. */
  lifeTime: number;
  // ---- layer 1
  /** 0 (out) .. 1 (in), and the posture's depth multiplier. */
  breath: number;
  breathDepth: number;
  /** Multiplier on renderer-side idle sway. */
  sway: number;
  /** Spontaneous + event blink lid closure, 0..1 (renderers with their own blink get only event blinks). */
  blink: number;
  /** -1 (weight on the viewer's left leg) .. 1. */
  weightShift: number;
  // ---- layer 2
  /** Blended state posture, scaled and ducked under a gesture. */
  posture: Posture;
  stateWeights: Record<AvatarState, number>;
  /** State the posture is heading for (waking becomes idle after `state.wakeDuration`). */
  effectiveState: AvatarState;
  // ---- layer 3
  /** 0..1 how much a gesture is playing (smoothed). */
  gesture: number;
  /** Post-gesture settle, degrees (head roll/pitch, body roll/lean). */
  settle: { roll: number; pitch: number; lean: number };
  /** A gesture the state suggests (thinking → "think_chin"), set for one frame. */
  cue?: string;
  // ---- layer 4
  /** Final gaze goal in look units; `active` false = nothing to hold (renderers may let their own idle gaze run). */
  gaze: { x: number; y: number; active: boolean };
  /** Combined lid closure 0..1 (blink ∪ state ∪ emotion) and widening 0..0.3. */
  eyeClose: number;
  eyeWiden: number;
  /** Brows -1..1 (state + emotion). */
  brow: number;
  /** Emotion extras (smile -1..1 …). */
  face: FaceExtras;
  emotion: { name: Emotion; weight: number };
}

export interface AnimatorOptions {
  tuning?: Tuning;
  rng?: Rng;
  /** The renderer has no blink of its own: schedule spontaneous blinks here (Live2D with its blink off, VRM). */
  ownBlink?: boolean;
}

export interface AnimatorInput {
  /** A gesture/motion is playing this frame. */
  gesturing?: boolean;
}

const OFFSET_KEYS = ["headYaw", "headPitch", "headRoll", "bodyYaw", "bodyLean", "bodyRoll", "shoulders", "eyeOpen", "brow"] as const;
const BODY_KEYS = ["headYaw", "headPitch", "headRoll", "bodyYaw", "bodyLean", "bodyRoll", "shoulders"] as const;

/** Blend postures by weight (weights are normalised, so the result stays a proper mix). */
export function blendPostures(postures: Record<AvatarState, Posture>, weights: Partial<Record<AvatarState, number>>): Posture {
  const out: Posture = { ...NEUTRAL_POSTURE };
  for (const k of POSTURE_KEYS) out[k] = 0;
  let sum = 0;
  for (const s of AVATAR_STATES) sum += Math.max(0, weights[s] ?? 0);
  if (sum < 1e-6) return { ...NEUTRAL_POSTURE };
  for (const s of AVATAR_STATES) {
    const w = Math.max(0, weights[s] ?? 0) / sum;
    if (!w) continue;
    const p = postures[s];
    for (const k of POSTURE_KEYS) out[k] += w * p[k];
  }
  return out;
}

export class LayerAnimator {
  tuning: Tuning;
  readonly emotion: EmotionLayer;
  private readonly rng: Rng;
  private readonly ownBlink: boolean;
  private readonly blinker: Blinker;
  private readonly saccades: Saccades;
  private readonly lookAway: LookAway;
  private readonly weight: WeightShift;
  private readonly breath: Breath;

  private t = 0;
  private lifeTime = 0;
  private stateName: AvatarState = "idle";
  private enteredAt = 0;
  private cued = false;
  private weights = new Map<AvatarState, { x: number; v: number }>();
  private look = { x: 0, y: 0, active: false };
  private gestureLevel = 0;
  private wasGesturing = false;
  private settleAt = -10;
  private settleSign = 1;
  private gazeSample = { x: 0, y: 0, at: 0 };
  private lastFrame?: LayerFrame;

  constructor(opts: AnimatorOptions = {}) {
    this.tuning = opts.tuning ?? cloneTuning();
    this.rng = opts.rng ?? Math.random;
    this.ownBlink = opts.ownBlink ?? true;
    const tuning = () => this.tuning;
    this.emotion = new EmotionLayer(tuning);
    this.blinker = new Blinker(this.rng, tuning);
    this.saccades = new Saccades(this.rng, tuning);
    this.lookAway = new LookAway(this.rng, tuning);
    this.weight = new WeightShift(this.rng, tuning);
    this.breath = new Breath(this.rng);
    for (const s of AVATAR_STATES) this.weights.set(s, { x: s === "idle" ? 1 : 0, v: 0 });
  }

  /** For tests: a deterministic animator. */
  static seeded(seed: number, opts: Omit<AnimatorOptions, "rng"> = {}): LayerAnimator {
    return new LayerAnimator({ ...opts, rng: mulberry32(seed) });
  }

  get state(): AvatarState {
    return this.stateName;
  }

  get frame(): LayerFrame | undefined {
    return this.lastFrame;
  }

  /** Waking is a transition: once it has played out, the posture heads for idle. */
  effectiveState(): AvatarState {
    if (this.stateName === "waking" && this.t - this.enteredAt >= this.tuning.state.wakeDuration) return "idle";
    return this.stateName;
  }

  setState(state: AvatarState): void {
    if (state === this.stateName) return;
    const before = this.tuning.postures[this.effectiveState()];
    const after = this.tuning.postures[state];
    this.stateName = state;
    this.enteredAt = this.t;
    this.cued = false;
    // The eyes jump to the new state's gaze (thinking looks up-aside): blink with the jump, as people do.
    const jump = Math.hypot(after.gazeX * after.gazeWeight - before.gazeX * before.gazeWeight,
      after.gazeY * after.gazeWeight - before.gazeY * before.gazeWeight);
    if (jump > this.tuning.blink.gazeShift && this.rng() < this.tuning.blink.gazeShiftChance) this.blinker.trigger(this.t);
    // Waking from sleep: the first blink comes quickly.
    if (state === "waking") this.blinker.trigger(this.t + 0.3);
  }

  setEmotion(name: Emotion, intensity: number): void {
    this.emotion.set(name, intensity);
  }

  /** Cursor / face target in look units (already scaled by the renderer's gaze scale). */
  lookAt(x: number, y: number): void {
    this.look = { x: Math.max(-1, Math.min(1, x)), y: Math.max(-1, Math.min(1, y)), active: true };
  }

  /** Nothing to look at any more (idle reset). */
  releaseLook(): void {
    this.look = { x: 0, y: 0, active: false };
  }

  /** Request a blink now (e.g. a tap on the face). */
  blink(): void {
    this.blinker.trigger(this.t);
  }

  update(dt: number, input: AnimatorInput = {}): LayerFrame {
    dt = Math.max(0, Math.min(0.1, Number.isFinite(dt) ? dt : 0));
    this.t += dt;
    const tn = this.tuning;
    const t = this.t;

    // ---- layer 2: state weights on critically damped springs (sum stays 1: same linear system for every state).
    const eff = this.effectiveState();
    const slow = eff === "sleeping" || this.weights.get("sleeping")!.x > 0.5;
    const omega = 2.15 / Math.max(0.05, slow ? tn.state.sleep : tn.state.transition);
    const stateWeights = {} as Record<AvatarState, number>;
    for (const s of AVATAR_STATES) {
      const w = this.weights.get(s)!;
      [w.x, w.v] = critStep(w.x, w.v, s === eff ? 1 : 0, omega, dt);
      stateWeights[s] = Math.max(0, w.x);
    }
    const raw = blendPostures(tn.postures, stateWeights);

    // ---- layer 3 input: gesture activity (eases in fast, out slower), settle after it ends.
    const gesturing = !!input.gesturing;
    const gTau = gesturing ? 0.18 : 0.45;
    this.gestureLevel += ((gesturing ? 1 : 0) - this.gestureLevel) * (1 - Math.exp(-dt / gTau));
    if (this.wasGesturing && !gesturing) {
      this.settleAt = t;
      this.settleSign = this.rng() < 0.5 ? -1 : 1;
      this.weight.shift(t, 0.8);
    }
    this.wasGesturing = gesturing;
    const g = this.gestureLevel;
    const duck = 1 - tn.gesture.duck * g;

    const posture: Posture = { ...raw };
    for (const k of OFFSET_KEYS) posture[k] = raw[k] * tn.state.scale;
    for (const k of BODY_KEYS) posture[k] *= duck;
    posture.gazeWeight = raw.gazeWeight * duck;

    // ---- layer 1: base life.
    const sway = tn.sway.amplitude * raw.sway;
    this.lifeTime += dt * tn.sway.tempo * (0.6 + 0.4 * Math.min(1.5, raw.sway));
    const breath = this.breath.update(dt, tn.breath.rate * raw.breathRate);
    const weightShift = this.weight.update(t, dt, tn.sway.tempo) * Math.min(1, raw.sway);
    this.saccades.update(t, raw.saccade);
    const awayJump = this.lookAway.update(t, raw.lookAway, g < 0.1);

    // ---- layer 4: gaze. Cursor → state gaze (by weight) → look-away → saccade.
    const base = this.look.active ? this.look : { x: 0, y: 0 };
    const w = posture.gazeWeight;
    let gx = base.x + (raw.gazeX - base.x) * w;
    let gy = base.y + (raw.gazeY - base.y) * w;
    const away = this.lookAway.active ? tn.lookAway.weight * duck : 0;
    gx += this.lookAway.x * away;
    gy += this.lookAway.y * away;
    // Gaze jumps blink with them: a look-away, the glance back, a quick cursor sweep.
    if (t - this.gazeSample.at >= 0.12) {
      const moved = Math.hypot(gx - this.gazeSample.x, gy - this.gazeSample.y);
      if ((moved > tn.blink.gazeShift || (awayJump && away > 0)) && this.rng() < tn.blink.gazeShiftChance) this.blinker.trigger(t);
      this.gazeSample = { x: gx, y: gy, at: t };
    } else if (awayJump && away > 0 && this.rng() < tn.blink.gazeShiftChance) this.blinker.trigger(t);
    const sacc = raw.saccade > 0 ? 1 : 0;
    const gaze = {
      x: Math.max(-1, Math.min(1, gx + this.saccades.x * sacc)),
      y: Math.max(-1, Math.min(1, gy + this.saccades.y * sacc)),
      active: this.look.active || w > 0.02 || away > 0.02,
    };

    // ---- blinks (spontaneous only when the renderer has none of its own; never while asleep).
    const blink = this.blinker.update(t, raw.blinkRate, this.ownBlink);

    // ---- layer 4: emotion and the eyelids/brows it shares with the posture.
    this.emotion.update(dt);
    const face = this.emotion.face();
    const lids = posture.eyeOpen + face.eyes;
    const lidClose = Math.max(0, Math.min(1, -lids));
    const eyeClose = 1 - (1 - blink) * (1 - lidClose);
    const eyeWiden = Math.max(0, Math.min(0.3, lids));

    // ---- layer 3: settle after a gesture (a small damped sway that eases in, so it never kicks).
    const su = (t - this.settleAt) / Math.max(0.1, tn.gesture.settleTime);
    let settle = { roll: 0, pitch: 0, lean: 0 };
    if (su >= 0 && su < 1) {
      const env = smoothstep(su / 0.12) * Math.exp(-3.2 * su) * (1 - su);
      const a = tn.gesture.settle * env * this.settleSign;
      settle = { roll: a * Math.sin(2 * Math.PI * su * 1.15), pitch: -0.35 * Math.abs(a) * Math.sin(Math.PI * Math.min(1, su * 2)), lean: 0.45 * a * Math.sin(2 * Math.PI * su * 1.15 + 0.9) };
    }

    // ---- state cue: thinking reaches for the chin once, if nothing else is playing.
    let cue: string | undefined;
    const cur = tn.postures[eff];
    if (!this.cued && cur.chinHand > 0 && t - this.enteredAt >= tn.state.cueDelay && g < 0.05) {
      this.cued = true;
      if (this.rng() < cur.chinHand) cue = "think_chin";
    }

    const frame: LayerFrame = {
      t, lifeTime: this.lifeTime,
      breath, breathDepth: tn.breath.depth * raw.breathDepth, sway, blink, weightShift,
      posture, stateWeights, effectiveState: eff,
      gesture: g, settle, cue,
      gaze, eyeClose, eyeWiden, brow: posture.brow + face.brow, face,
      emotion: this.emotion.dominant(),
    };
    this.lastFrame = frame;
    return frame;
  }
}
