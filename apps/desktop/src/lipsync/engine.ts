import type { Phoneme } from "@hikari/protocol";
import { ZERO_VISEMES, type Visemes } from "../avatar/types";
import { resolvePhoneme, splitDiphthong, type VisemeTarget } from "./phonemeMap";

const KEYS = ["aa", "ih", "ou", "ee", "oh"] as const;

interface Segment {
  /** Absolute AudioContext time (s). */
  start: number;
  end: number;
  target: VisemeTarget;
  stress: number;
}

/**
 * Phoneme-driven lip sync.
 *
 * - Segments are stored on the **AudioContext clock** (chunk start + phoneme ms),
 *   so visuals are locked to the audio scheduler, not to message arrival.
 * - Coarticulation: Cohen–Massaro dominance blending — each segment's influence
 *   decays exponentially outside its span; bilabials dominate so lips close fully.
 * - Attack/release envelope smooths frame to frame (fast open, slower close).
 * - Jaw follows audio energy (if an analyser RMS is provided) on top of the shape.
 * - Fallback with no phonemes: energy + spectral band → a/i/u/e/o heuristic.
 */
export class LipSyncEngine {
  private segs: Segment[] = [];
  private cur: Visemes = { ...ZERO_VISEMES };
  attack = 0.035; // s, time constant for opening
  release = 0.07; // s, time constant for closing

  /** Register phonemes for a chunk that starts playing at `ctxStart` (AudioContext seconds). */
  addChunk(ctxStart: number, phonemes: Phoneme[]): void {
    for (const ph of phonemes) {
      const start = ctxStart + ph.start / 1000;
      const end = ctxStart + ph.end / 1000;
      const parts = splitDiphthong(ph.p);
      if (parts) {
        const mid = (start + end) / 2;
        this.push(parts[0], start, mid, ph.stress);
        this.push(parts[1], mid, end, ph.stress);
      } else {
        this.push(ph.p, start, end, ph.stress);
      }
    }
    this.segs.sort((a, b) => a.start - b.start);
  }

  private push(p: string, start: number, end: number, stress = 0.5) {
    const r = resolvePhoneme(p);
    if (r.aspirated && !r.target.closed && end - start > 0.04) {
      // Stop closure/contact for ~65% then a breathy open puff.
      const split = start + (end - start) * 0.65;
      this.segs.push({ start, end: split, target: r.target, stress });
      this.segs.push({ start: split, end, target: { v: { aa: 0.3 }, dominance: 0.5, spread: 0.03 }, stress });
    } else if (r.aspirated && r.target.closed) {
      const split = start + (end - start) * 0.7;
      this.segs.push({ start, end: split, target: r.target, stress });
      this.segs.push({ start: split, end, target: { v: { aa: 0.3 }, dominance: 0.6, spread: 0.03 }, stress });
    } else {
      this.segs.push({ start, end, target: r.target, stress });
    }
  }

  /** Drop everything (barge-in). */
  clear(): void {
    this.segs = [];
  }

  get hasPending(): boolean {
    return this.segs.length > 0;
  }

  /**
   * Visemes at audible time `t` (AudioContext seconds, already latency-compensated).
   * `energy` 0..1 normalised RMS of what is playing now; `dt` frame delta.
   */
  sample(t: number, dt: number, energy?: number, fallback?: Visemes): Visemes {
    // Forget segments well in the past.
    while (this.segs.length && this.segs[0].end < t - 0.5) this.segs.shift();

    let target: Visemes;
    if (this.segs.length) target = this.blend(t);
    else if (fallback) target = fallback;
    else target = ZERO_VISEMES;

    if (energy !== undefined && this.segs.length) {
      // Jaw follows energy: scale openness 0.55..1.15 with loudness.
      const k = 0.55 + 0.6 * Math.min(1, energy);
      target = scale(target, k);
    }

    // Attack/release envelopes per channel.
    const out = { ...this.cur };
    for (const key of KEYS) {
      const tau = target[key] > out[key] ? this.attack : this.release;
      const a = 1 - Math.exp(-dt / tau);
      out[key] += (target[key] - out[key]) * a;
    }
    this.cur = out;
    return out;
  }

  private blend(t: number): Visemes {
    const acc: Visemes = { ...ZERO_VISEMES };
    let wsum = 0;
    // Only segments within a small window matter.
    for (const s of this.segs) {
      if (s.start > t + 0.25) break;
      if (s.end < t - 0.25) continue;
      const d = t < s.start ? s.start - t : t > s.end ? t - s.end : 0;
      const w = s.target.dominance * (0.75 + 0.5 * s.stress) * Math.exp(-d / s.target.spread);
      if (w < 1e-3) continue;
      wsum += w;
      for (const key of KEYS) acc[key] += w * (s.target.v[key] ?? 0);
    }
    if (wsum < 1e-3) return { ...ZERO_VISEMES };
    // Add a "rest" pseudo-segment so isolated short phonemes don't snap fully open.
    const rest = 0.15;
    const norm = wsum + rest;
    for (const key of KEYS) acc[key] /= norm;
    return acc;
  }
}

function scale(v: Visemes, k: number): Visemes {
  return { aa: v.aa * k, ih: v.ih * k, ou: v.ou * k, ee: v.ee * k, oh: v.oh * k };
}

/**
 * Energy/formant fallback when no phoneme timings exist: uses band energies of
 * an AnalyserNode spectrum. Rough but better than plain mouth-flapping.
 *  low band (F1 ~ 300–900 Hz) ↔ jaw opening;  high/low ratio (F2 region) ↔ i/e vs o/u.
 */
export function visemesFromSpectrum(freq: Float32Array, sampleRate: number, rms: number): Visemes {
  if (rms < 0.01) return { ...ZERO_VISEMES };
  const bin = sampleRate / 2 / freq.length;
  const band = (lo: number, hi: number) => {
    let s = 0;
    let n = 0;
    for (let i = Math.floor(lo / bin); i < Math.min(freq.length, Math.ceil(hi / bin)); i++) {
      s += Math.pow(10, freq[i] / 20);
      n++;
    }
    return n ? s / n : 0;
  };
  const f1 = band(300, 900);
  const f2lo = band(700, 1300);
  const f2hi = band(1700, 2800);
  const open = Math.min(1, rms * 6);
  const front = f2hi / (f2lo + 1e-6); // high → i/e, low → o/u
  const jaw = f1 / (f1 + f2hi + 1e-6);
  const v: Visemes = { ...ZERO_VISEMES };
  if (front > 0.9) {
    v.ih = open * (1 - jaw);
    v.ee = open * jaw;
  } else if (front < 0.35) {
    v.ou = open * (1 - jaw);
    v.oh = open * jaw;
  } else {
    v.aa = open;
  }
  return v;
}

/** Live2D standard params from visemes. form: -1 (pucker/frown) .. 1 (wide/smile). */
export function visemesToLive2D(v: Visemes): { open: number; form: number } {
  const open = Math.min(1, v.aa * 1.0 + v.oh * 0.85 + v.ee * 0.6 + v.ou * 0.45 + v.ih * 0.35);
  const total = v.aa + v.ih + v.ou + v.ee + v.oh + 1e-6;
  const form = (v.ih * 0.9 + v.ee * 0.6 - v.ou * 0.9 - v.oh * 0.5) / total;
  return { open, form: Math.max(-1, Math.min(1, form)) };
}
