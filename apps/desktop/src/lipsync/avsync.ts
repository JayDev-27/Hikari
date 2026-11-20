/**
 * A/V sync analysis (§2.5: lips within ±40 ms of the audio actually heard).
 *
 * Inputs, all on the performance.now() clock (ms):
 *  - audio onsets: when each test burst leaves the output device, derived from
 *    AudioContext.getOutputTimestamp() (includes device/output latency)
 *  - frames: each rendered frame's time + mouth opening 0..1
 *
 * Visual onset of a burst = first frame after (onset − searchBeforeMs) where the
 * mouth crosses `threshold` × that burst's peak opening, plus `displayLatencyMs`
 * (a frame rendered in rAF at t reaches the screen at the next vsync).
 * offset = visual − audio: positive → lips late, negative → lips early.
 */
export interface FrameSample {
  t: number;
  open: number;
}

export interface SyncReport {
  offsets: number[];
  meanMs: number;
  minMs: number;
  maxMs: number;
  /** Mean absolute deviation from the mean (frame-quantisation jitter). */
  jitterMs: number;
  missed: number;
  pass: boolean;
  toleranceMs: number;
}

export interface AnalyzeOptions {
  threshold?: number;
  searchBeforeMs?: number;
  windowMs?: number;
  displayLatencyMs?: number;
  toleranceMs?: number;
}

export function analyzeSync(audioOnsets: number[], frames: FrameSample[], opts: AnalyzeOptions = {}): SyncReport {
  const { threshold = 0.5, searchBeforeMs = 120, windowMs = 300, displayLatencyMs = 0, toleranceMs = 40 } = opts;
  const offsets: number[] = [];
  let missed = 0;
  for (const onset of audioOnsets) {
    const win = frames.filter((f) => f.t >= onset - searchBeforeMs && f.t <= onset + windowMs);
    const peak = Math.max(0, ...win.map((f) => f.open));
    if (peak < 0.1) {
      missed++;
      continue;
    }
    const hit = win.find((f) => f.open >= threshold * peak);
    if (!hit) {
      missed++;
      continue;
    }
    offsets.push(hit.t + displayLatencyMs - onset);
  }
  const n = offsets.length || 1;
  const meanMs = offsets.reduce((a, b) => a + b, 0) / n;
  const jitterMs = offsets.reduce((a, b) => a + Math.abs(b - meanMs), 0) / n;
  const minMs = offsets.length ? Math.min(...offsets) : NaN;
  const maxMs = offsets.length ? Math.max(...offsets) : NaN;
  const pass = offsets.length > 0 && missed === 0 && Math.abs(minMs) <= toleranceMs && Math.abs(maxMs) <= toleranceMs;
  return { offsets, meanMs, minMs, maxMs, jitterMs, missed, pass, toleranceMs };
}

/** Map an AudioContext time (s) to the performance.now() time (ms) it is heard. */
export function ctxToPerfMs(ctxTime: number, ts: { contextTime: number; performanceTime: number }): number {
  return ts.performanceTime + (ctxTime - ts.contextTime) * 1000;
}
