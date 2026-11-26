import type { Tuning } from "./tuning";

/**
 * Layer 1, base life: the small involuntary movements that make a figure read as alive — blinks, breath, eye
 * micro-saccades, occasional look-aways and slow weight shifts. Everything is driven by a random source with
 * varied intervals, so nothing repeats on a fixed beat. Pure (no DOM, no renderer), seeded in tests.
 */

export type Rng = () => number;

/** Small, fast, seedable PRNG (mulberry32). */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
export const smoothstep = (t: number) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
const between = (rng: Rng, lo: number, hi: number) => lo + (hi - lo) * rng();
/** Standard normal (Box–Muller). */
function gauss(rng: Rng): number {
  const u = Math.max(1e-9, rng()), v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/**
 * Spontaneous blinks at log-normal intervals around `mean` (people blink in irregular bursts, not on a clock),
 * sometimes as a quick pair, plus blinks on request (a gaze jump). Close is quick, opening a little slower.
 */
export class Blinker {
  private next: number;
  private start = -1;
  private second = false;
  private lastEnd = -10;
  /** Last rate the schedule was drawn for, so a state change (e.g. waking: frequent) reschedules. */
  private rate = 1;

  constructor(private rng: Rng, private tuning: () => Tuning, now = 0) {
    this.next = now + this.interval(1);
  }

  interval(rate: number): number {
    const b = this.tuning().blink;
    if (rate <= 0.001) return Infinity;
    const sigma = 0.5;
    const raw = b.mean * Math.exp(sigma * gauss(this.rng) - (sigma * sigma) / 2);
    return clamp(raw, b.min, b.max) / rate;
  }

  /** Blink as soon as possible (not in the middle of one, nor right after one). */
  trigger(now: number): boolean {
    if (this.start >= 0 || now - this.lastEnd < 0.35) return false;
    this.start = now;
    this.second = false;
    return true;
  }

  get blinking(): boolean {
    return this.start >= 0;
  }

  /** Lid closure 0..1 at `now`. `rate` 0 stops spontaneous blinks (asleep). */
  update(now: number, rate: number, spontaneous = true): number {
    const b = this.tuning().blink;
    if (Math.abs(rate - this.rate) > 0.05) {
      // A new rate (state change): draw the next blink for it, but never later than already planned when faster.
      const n = now + this.interval(rate);
      this.next = rate > this.rate ? Math.min(this.next, n) : n;
      this.rate = rate;
    }
    if (spontaneous && this.start < 0 && now >= this.next) {
      this.start = now;
      this.second = this.rng() < b.double;
    }
    if (this.start < 0) return 0;
    const u = now - this.start, c = Math.max(0.02, b.close), o = Math.max(0.03, b.open);
    // A short hold closed (~20 ms) reads as a blink rather than a flicker.
    const v = u < c ? smoothstep(u / c) : u < c + 0.02 ? 1 : 1 - smoothstep((u - c - 0.02) / o);
    if (u >= c + 0.02 + o) {
      this.lastEnd = now;
      if (this.second) {
        // The pair's second blink follows after ~80–140 ms.
        this.second = false;
        this.start = now + between(this.rng, 0.08, 0.14);
      } else {
        this.start = -1;
        this.next = now + this.interval(rate);
      }
      return 0;
    }
    return u < 0 ? 0 : v;
  }
}

/** Micro-saccades: the eyes hop to a nearby point every 0.5–2.6 s and hold (eyes never drift smoothly). */
export class Saccades {
  x = 0;
  y = 0;
  private next = 0;
  constructor(private rng: Rng, private tuning: () => Tuning) {}
  update(now: number, scale: number): void {
    if (now < this.next) return;
    const s = this.tuning().saccade;
    // Back near centre more often than not: fixations cluster on the face being looked at.
    const back = this.rng() < 0.35;
    const a = s.amplitude * scale;
    this.x = back ? 0 : clamp(gauss(this.rng) * a, -2.5 * a, 2.5 * a);
    this.y = back ? 0 : clamp(gauss(this.rng) * a * 0.6, -1.5 * a, 1.5 * a);
    this.next = now + between(this.rng, s.min, s.max) / Math.max(0.2, scale || 0.2);
  }
}

/** Occasional look-away and glance back: eyes (and with them the head) go off to the side for a moment. */
export class LookAway {
  /** Offset from the current gaze while looking away. */
  x = 0;
  y = 0;
  active = false;
  private until = 0;
  private next: number;
  constructor(private rng: Rng, private tuning: () => Tuning, now = 0) {
    this.next = now + this.wait(1);
  }
  private wait(rate: number): number {
    const l = this.tuning().lookAway;
    return between(this.rng, l.min, l.max) / Math.max(0.05, rate);
  }
  /** Returns true on the frame the gaze jumps (away or back). `rate` 0 = not in this state; `allowed` false defers. */
  update(now: number, rate: number, allowed: boolean): boolean {
    const l = this.tuning().lookAway;
    // A state that doesn't look away still has a sliver of weight while the cross-fade settles: that's "never".
    if (rate < 0.05) rate = 0;
    if (this.active) {
      if (now >= this.until || rate <= 0) {
        this.active = false;
        this.next = now + this.wait(Math.max(rate, 0.05));
        return true;
      }
      return false;
    }
    if (rate <= 0) {
      // Not looking away in this state: start counting again once it allows it.
      this.next = Math.max(this.next, now + l.min * 0.5);
      return false;
    }
    if (now < this.next) return false;
    if (!allowed) {
      this.next = now + 1.5;
      return false;
    }
    const side = this.rng() < 0.5 ? -1 : 1;
    this.x = side * l.amplitude * between(this.rng, 0.6, 1);
    // Mostly sideways and a little down (looking down-aside is the common thinking/recall glance).
    this.y = l.amplitude * between(this.rng, -0.6, 0.3);
    this.active = true;
    this.until = now + between(this.rng, l.holdMin, l.holdMax);
    return true;
  }
}

/** Slow weight shift between the legs: a new side every 7–14 s, eased over ~2 s (critically damped, no snap). */
export class WeightShift {
  value = 0;
  private vel = 0;
  private target: number;
  private next: number;
  constructor(private rng: Rng, private tuning: () => Tuning, now = 0) {
    this.target = (rng() < 0.5 ? -1 : 1) * 0.6 * tuning().weightShift.amplitude;
    this.next = now + between(rng, tuning().weightShift.min, tuning().weightShift.max);
  }
  /** Move onto the other leg now (after a gesture: the body re-settles its weight). */
  shift(now: number, strength = 1): void {
    const w = this.tuning().weightShift;
    this.target = -Math.sign(this.target || 1) * w.amplitude * between(this.rng, 0.45, 1) * strength;
    this.next = now + between(this.rng, w.min, w.max);
  }
  update(now: number, dt: number, tempo: number): number {
    const w = this.tuning().weightShift;
    if (now >= this.next) {
      this.shift(now);
      this.next = now + between(this.rng, w.min, w.max) / Math.max(0.2, tempo);
    }
    const omega = 2.15 / Math.max(0.1, w.ease);
    [this.value, this.vel] = critStep(this.value, this.vel, this.target, omega, dt);
    return this.value;
  }
}

/** Breath: a phase that advances at `rate`, each cycle a little longer or shorter than the last. */
export class Breath {
  phase = 0;
  private period = 4.2;
  constructor(private rng: Rng) {}
  /** 0 (out) .. 1 (in). */
  update(dt: number, rate: number): number {
    const before = this.phase;
    this.phase += (dt * 2 * Math.PI * Math.max(0.05, rate)) / this.period;
    if (Math.floor(before / (2 * Math.PI)) !== Math.floor(this.phase / (2 * Math.PI))) {
      this.period = 4.2 * between(this.rng, 0.85, 1.18);
    }
    return 0.5 - 0.5 * Math.cos(this.phase);
  }
}

/**
 * Exact step of a critically damped spring x'' = -2ωx' - ω²(x - goal): stable at any dt, never overshoots, and its
 * velocity starts from zero, so a target change eases in rather than jumping.
 */
export function critStep(x: number, v: number, goal: number, omega: number, dt: number): [number, number] {
  const a = Math.exp(-omega * dt);
  const d = x - goal;
  const c = v + omega * d;
  return [goal + (d + c * dt) * a, (c - omega * (d + c * dt)) * a];
}
