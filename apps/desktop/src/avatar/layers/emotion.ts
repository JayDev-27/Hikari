import type { Emotion } from "@hikari/protocol";
import type { Tuning } from "./tuning";

/**
 * Layer 4 (face), emotion part: an emotion cue sets a target intensity that holds for `emotion.hold` seconds and
 * then decays back to neutral with half-life `emotion.halfLife`, unless the core refreshes it (a new cue). A new
 * emotion cross-fades with the old one instead of switching, and every level eases (attack/release), so the face
 * never snaps. Pure: renderers read {@link dominant} / {@link face} each frame.
 */

export const EMOTIONS: Emotion[] = ["neutral", "joy", "fun", "teasing", "angry", "sorrow", "surprised", "shy", "sleepy", "thinking"];

/** Small renderer-agnostic face extras per emotion at full intensity: mouth smile (-1..1), brows, eyelids. */
export interface FaceExtras { smile: number; brow: number; eyes: number }

export const EMOTION_FACE: Record<Emotion, FaceExtras> = {
  neutral: { smile: 0, brow: 0, eyes: 0 },
  joy: { smile: 0.5, brow: 0.15, eyes: -0.1 },
  fun: { smile: 0.4, brow: 0.1, eyes: -0.15 },
  teasing: { smile: 0.3, brow: -0.05, eyes: -0.2 },
  angry: { smile: -0.35, brow: -0.45, eyes: -0.05 },
  sorrow: { smile: -0.25, brow: -0.25, eyes: -0.2 },
  surprised: { smile: 0, brow: 0.6, eyes: 0.2 },
  shy: { smile: 0.2, brow: 0.05, eyes: -0.15 },
  sleepy: { smile: 0, brow: -0.1, eyes: -0.45 },
  thinking: { smile: -0.05, brow: 0.15, eyes: -0.05 },
};

export class EmotionLayer {
  /** Current eased level per emotion (neutral is the absence of the others). */
  readonly levels = new Map<Emotion, number>();
  private target: { name: Emotion; intensity: number } | null = null;
  private setAt = 0;
  private now = 0;

  constructor(private tuning: () => Tuning) {}

  /** A cue (or a refresh of the same one). Intensity ≤ 0 or "neutral" fades everything out. */
  set(name: Emotion, intensity: number): void {
    const k = Math.max(0, Math.min(1, intensity * this.tuning().emotion.scale));
    this.target = name === "neutral" || k <= 0 ? null : { name, intensity: k };
    this.setAt = this.now;
  }

  /** Target intensity right now, after hold and decay. */
  targetNow(): number {
    if (!this.target) return 0;
    const e = this.tuning().emotion;
    const age = this.now - this.setAt;
    if (age <= e.hold) return this.target.intensity;
    return this.target.intensity * Math.pow(0.5, (age - e.hold) / Math.max(0.05, e.halfLife));
  }

  update(dt: number): void {
    this.now += dt;
    const e = this.tuning().emotion;
    // Below a few percent the decayed cue is gone (it would otherwise linger at a trace for ever).
    let goal = this.targetNow();
    if (goal < 0.03) goal = 0;
    const names = new Set<Emotion>(this.levels.keys());
    if (this.target) names.add(this.target.name);
    for (const name of names) {
      const want = this.target?.name === name ? goal : 0;
      const cur = this.levels.get(name) ?? 0;
      const tau = want > cur ? e.attack : e.release;
      const next = cur + (want - cur) * (1 - Math.exp(-dt / Math.max(0.01, tau)));
      if (next < 5e-3 && want === 0) this.levels.delete(name);
      else this.levels.set(name, next);
    }
    // Fully decayed: forget the cue so a later refresh of "the same" emotion starts fresh.
    if (this.target && goal === 0) this.target = null;
  }

  /** Strongest emotion and its weight ("neutral", 0 when nothing shows). */
  dominant(): { name: Emotion; weight: number } {
    let best: Emotion = "neutral", w = 0;
    for (const [name, level] of this.levels) if (level > w) { best = name; w = level; }
    return { name: best, weight: w };
  }

  /** Face extras summed over every emotion still showing (a cross-fade blends both faces). */
  face(): FaceExtras {
    const k = this.tuning().face.emotionFace;
    const out: FaceExtras = { smile: 0, brow: 0, eyes: 0 };
    for (const [name, level] of this.levels) {
      const f = EMOTION_FACE[name] ?? EMOTION_FACE.neutral;
      out.smile += f.smile * level * k;
      out.brow += f.brow * level * k;
      out.eyes += f.eyes * level * k;
    }
    return out;
  }
}
