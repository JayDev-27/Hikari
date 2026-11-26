/**
 * Audio helpers for Voice Lab clips: mono 16-bit PCM WAV encode/parse, base64, levels and take checks.
 * Pure (no DOM), so they run in unit tests.
 */

/** Sample rate clips are recorded at. 24 kHz is what Hima/Maya-class TTS fine-tunes train on; 16 kHz is enough for ASR. */
export const CLIP_RATE = 24000;

/** Float samples (−1..1) → a RIFF/WAVE file: mono, 16-bit little-endian PCM. */
export function encodeWav(samples: Float32Array, sampleRate: number): Uint8Array {
  const bytes = new Uint8Array(44 + samples.length * 2);
  const v = new DataView(bytes.buffer);
  const ascii = (at: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(at + i, s.charCodeAt(i)); };
  ascii(0, "RIFF");
  v.setUint32(4, 36 + samples.length * 2, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  v.setUint32(16, 16, true); // fmt chunk size
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true); // byte rate
  v.setUint16(32, 2, true); // block align
  v.setUint16(34, 16, true); // bits per sample
  ascii(36, "data");
  v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(44 + i * 2, Math.round(s < 0 ? s * 32768 : s * 32767), true);
  }
  return bytes;
}

export interface ParsedWav {
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  /** First channel as floats. */
  samples: Float32Array;
}

/** Parse a PCM WAV (16-bit; mono or the first channel of multi-channel). Throws on anything else. */
export function parseWav(bytes: Uint8Array): ParsedWav {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (at: number) => String.fromCharCode(...bytes.subarray(at, at + 4));
  if (bytes.length < 12 || tag(0) !== "RIFF" || tag(8) !== "WAVE") throw new Error("not a WAV file");
  let at = 12;
  let fmt: { channels: number; sampleRate: number; bits: number; format: number } | undefined;
  while (at + 8 <= bytes.length) {
    const id = tag(at);
    const size = v.getUint32(at + 4, true);
    const body = at + 8;
    if (id === "fmt ") fmt = { format: v.getUint16(body, true), channels: v.getUint16(body + 2, true), sampleRate: v.getUint32(body + 4, true), bits: v.getUint16(body + 14, true) };
    else if (id === "data") {
      if (!fmt || fmt.format !== 1 || fmt.bits !== 16) throw new Error("only 16-bit PCM WAV is supported");
      const frames = Math.floor(Math.min(size, bytes.length - body) / (2 * fmt.channels));
      const samples = new Float32Array(frames);
      for (let i = 0; i < frames; i++) samples[i] = v.getInt16(body + i * 2 * fmt.channels, true) / 32768;
      return { sampleRate: fmt.sampleRate, channels: fmt.channels, bitsPerSample: fmt.bits, samples };
    }
    at = body + size + (size % 2);
  }
  throw new Error("WAV has no data chunk");
}

export function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Linear amplitude → dBFS (−Infinity for silence). */
export const toDb = (x: number) => (x > 0 ? 20 * Math.log10(x) : -Infinity);

/** Meter position 0..1 for an RMS level: −60 dBFS at the left edge, 0 dBFS at the right. */
export function meterLevel(rms: number): number {
  const db = toDb(rms);
  if (!Number.isFinite(db)) return 0;
  return Math.max(0, Math.min(1, (db + 60) / 60));
}

export interface TakeStats {
  durationMs: number;
  peak: number;
  rms: number;
  /** Share of samples at or near full scale. */
  clippedShare: number;
}

export function takeStats(samples: Float32Array, sampleRate: number): TakeStats {
  let peak = 0;
  let sum = 0;
  let clipped = 0;
  for (let i = 0; i < samples.length; i++) {
    const a = Math.abs(samples[i]);
    if (a > peak) peak = a;
    if (a >= 0.99) clipped++;
    sum += samples[i] * samples[i];
  }
  const n = samples.length || 1;
  return { durationMs: (samples.length / sampleRate) * 1000, peak, rms: Math.sqrt(sum / n), clippedShare: clipped / n };
}

export type TakeProblem = "too_short" | "too_quiet" | "clipped" | "too_long";

/** Why a take shouldn't go into the dataset (empty = fine). Thresholds are on the generous side; the core decides finally. */
export function takeProblems(s: TakeStats, { minMs = 800, maxMs = 30_000 } = {}): TakeProblem[] {
  const out: TakeProblem[] = [];
  if (s.durationMs < minMs) out.push("too_short");
  if (s.durationMs > maxMs) out.push("too_long");
  if (toDb(s.rms) < -45 || s.peak < 0.03) out.push("too_quiet");
  if (s.clippedShare > 0.001) out.push("clipped");
  return out;
}

export const problemText: Record<TakeProblem, string> = {
  too_short: "That was very short. Read the whole line.",
  too_long: "That was over 30 seconds. Keep to one line per take.",
  too_quiet: "Too quiet. Move closer to the mic or speak up.",
  clipped: "Too loud: the recording clipped. Move back a little.",
};

/** Trim leading/trailing silence (below `floorDb`), keeping `padMs` of room either side. */
export function trimSilence(samples: Float32Array, sampleRate: number, { floorDb = -42, padMs = 150 } = {}): Float32Array {
  const floor = 10 ** (floorDb / 20);
  const win = Math.max(1, Math.round(sampleRate * 0.02));
  const loud = (start: number) => {
    let s = 0;
    const end = Math.min(samples.length, start + win);
    for (let i = start; i < end; i++) s += samples[i] * samples[i];
    return Math.sqrt(s / Math.max(1, end - start)) >= floor;
  };
  let first = -1;
  let last = -1;
  for (let i = 0; i < samples.length; i += win) {
    if (loud(i)) {
      if (first < 0) first = i;
      last = Math.min(samples.length, i + win);
    }
  }
  if (first < 0) return samples.slice(0, 0);
  const pad = Math.round((sampleRate * padMs) / 1000);
  return samples.slice(Math.max(0, first - pad), Math.min(samples.length, last + pad));
}
