/**
 * Blind A/B listening test. The core sends two samples of the same text from two systems (e.g. "base" and
 * "adapter"); the UI decides which plays as A and which as B (a fair coin per trial), hides the systems until the
 * listener has chosen, and reports the result with the order it used.
 */
export interface AbSample {
  id: string;
  /** Which system made it, e.g. "base" / "adapter" / "reference". Hidden from the listener until they choose. */
  system: string;
  /** base64 WAV */
  audio: string;
  label?: string;
}

export interface AbPair {
  pairId: string;
  text?: string;
  samples: [AbSample, AbSample];
}

export interface AbTrial {
  pairId: string;
  text?: string;
  A: AbSample;
  B: AbSample;
  /** true when the core's second sample plays as A. */
  swapped: boolean;
}

export type AbChoice = "A" | "B" | "same";

export interface AbResult {
  pairId: string;
  choice: AbChoice;
  /** System the listener preferred; null for "about the same". */
  preferred: string | null;
  other: string | null;
  shown: { A: string; B: string };
  listened: { A: boolean; B: boolean };
  decisionMs: number;
}

/** Small seeded PRNG (mulberry32), so shuffles are reproducible in tests. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function makeTrial(pair: AbPair, rand: () => number = Math.random): AbTrial {
  const swapped = rand() < 0.5;
  const [x, y] = pair.samples;
  return { pairId: pair.pairId, text: pair.text, A: swapped ? y : x, B: swapped ? x : y, swapped };
}

/** May the listener choose yet? Both samples must have been heard. */
export const canChoose = (listened: { A: boolean; B: boolean }) => listened.A && listened.B;

export function choose(trial: AbTrial, choice: AbChoice, listened: { A: boolean; B: boolean }, decisionMs: number): AbResult {
  const pick = choice === "A" ? trial.A : choice === "B" ? trial.B : null;
  const rest = choice === "A" ? trial.B : choice === "B" ? trial.A : null;
  return {
    pairId: trial.pairId, choice, preferred: pick?.system ?? null, other: rest?.system ?? null,
    shown: { A: trial.A.system, B: trial.B.system }, listened, decisionMs: Math.round(decisionMs),
  };
}

export interface AbTally {
  trials: number;
  ties: number;
  wins: Record<string, number>;
  /** System with the most wins (undefined while level). */
  leader?: string;
  /** Leader's share of decided (non-tie) trials, 0..1. */
  share: number;
  /** Two-sided exact binomial p-value for "the leader is preferred more than chance" (ties excluded). */
  p: number;
  /** How often A was chosen among decided trials: far from 0.5 hints at position bias. */
  aShare: number;
}

/** P(X = k) for X ~ Binomial(n, 0.5). */
function binomHalf(n: number, k: number): number {
  let logC = 0;
  for (let i = 1; i <= k; i++) logC += Math.log(n - k + i) - Math.log(i);
  return Math.exp(logC - n * Math.LN2);
}

/** Two-sided exact binomial test against p = 0.5. */
export function binomialTwoSided(k: number, n: number): number {
  if (n === 0) return 1;
  const pk = binomHalf(n, k);
  let p = 0;
  for (let i = 0; i <= n; i++) {
    const pi = binomHalf(n, i);
    if (pi <= pk * (1 + 1e-9)) p += pi;
  }
  return Math.min(1, p);
}

export function tally(results: AbResult[]): AbTally {
  const wins: Record<string, number> = {};
  let ties = 0;
  let aWins = 0;
  for (const r of results) {
    for (const s of [r.shown.A, r.shown.B]) wins[s] ??= 0;
    if (!r.preferred) ties++;
    else wins[r.preferred]++;
    if (r.choice === "A") aWins++;
  }
  const decided = results.length - ties;
  const ranked = Object.entries(wins).sort((a, b) => b[1] - a[1]);
  const leader = ranked.length && (ranked.length === 1 || ranked[0][1] > ranked[1][1]) && ranked[0][1] > 0 ? ranked[0][0] : undefined;
  const top = ranked[0]?.[1] ?? 0;
  return {
    trials: results.length,
    ties,
    wins,
    leader,
    share: decided ? top / decided : 0,
    p: binomialTwoSided(top, decided),
    aShare: decided ? aWins / decided : 0,
  };
}

/** Human summary for the tally line. */
export function verdict(t: AbTally, name: (system: string) => string = (s) => s): string {
  if (!t.trials) return "No comparisons yet.";
  const decided = t.trials - t.ties;
  if (!t.leader) return decided ? "Level so far." : "No preference so far.";
  const lead = `${name(t.leader)} preferred in ${t.wins[t.leader]} of ${decided}`;
  if (decided < 6) return `${lead}. Keep going: too few to tell.`;
  return t.p < 0.05 ? `${lead}: a clear preference (p = ${t.p.toFixed(3)}).` : `${lead}: not conclusive yet (p = ${t.p.toFixed(2)}).`;
}

/** FNV-1a hash of a string. */
function hashStr(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

/**
 * The coin for one pair: a per-session secret seed mixed with the pair id. Deterministic for a given pair (so a
 * re-render never flips A and B under the listener), unpredictable across sessions.
 */
export const trialRng = (sessionSeed: number, pairId: string) => mulberry32((sessionSeed ^ hashStr(pairId)) >>> 0);
