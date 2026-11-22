import type { TtsChunk } from "@hikari/protocol";

export interface ScheduledChunk {
  seq: number;
  ctxStart: number;
  ctxEnd: number;
  text: string;
  chunk: TtsChunk;
  /** Decoded mono samples, for latency-free loudness at any audible time. */
  samples: Float32Array;
  sampleRate: number;
}

/**
 * Gapless TTS playback on the WebAudio clock.
 * - Chunks are scheduled back to back by `seq` (out-of-order arrivals wait).
 * - `audibleTime()` is the AudioContext time the user is *hearing right now*
 *   (via getOutputTimestamp, falling back to currentTime - outputLatency), which
 *   the lip-sync engine samples so lips match audio within a frame.
 * - `stop()` is the barge-in path: cuts audio within one render quantum.
 */
export class PlaybackQueue {
  readonly ctx: AudioContext;
  readonly analyser: AnalyserNode;
  private gain: GainNode;
  private nextSeq = 0;
  private pending = new Map<number, TtsChunk>();
  private sources: AudioBufferSourceNode[] = [];
  private cursor = 0;
  readonly scheduled: ScheduledChunk[] = [];
  private timeBuf: Float32Array<ArrayBuffer>;
  onChunkScheduled?: (c: ScheduledChunk) => void;
  onDrained?: () => void;

  constructor(ctx = new AudioContext({ latencyHint: "interactive" })) {
    this.ctx = ctx;
    this.gain = ctx.createGain();
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    this.analyser.smoothingTimeConstant = 0.3;
    this.gain.connect(this.analyser).connect(ctx.destination);
    this.timeBuf = new Float32Array(this.analyser.fftSize);
  }

  /** Start a new turn; seq numbering restarts at 0. */
  reset(): void {
    this.stop();
    this.nextSeq = 0;
  }

  enqueue(chunk: TtsChunk): void {
    if (this.ctx.state === "suspended") void this.ctx.resume();
    this.pending.set(chunk.seq, chunk);
    while (this.pending.has(this.nextSeq)) {
      const c = this.pending.get(this.nextSeq)!;
      this.pending.delete(this.nextSeq);
      this.schedule(c);
      this.nextSeq++;
    }
  }

  private schedule(c: TtsChunk): void {
    const buf = decodePcm(this.ctx, c);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.connect(this.gain);
    // 30 ms safety lead for the first chunk so its start isn't clipped.
    const start = Math.max(this.cursor, this.ctx.currentTime + 0.03);
    src.start(start);
    this.cursor = start + buf.duration;
    this.sources.push(src);
    src.onended = () => {
      this.sources = this.sources.filter((s) => s !== src);
      if (!this.sources.length && !this.pending.size) this.onDrained?.();
    };
    const sc: ScheduledChunk = {
      seq: c.seq, ctxStart: start, ctxEnd: this.cursor, text: c.text, chunk: c,
      samples: buf.getChannelData(0), sampleRate: buf.sampleRate,
    };
    this.scheduled.push(sc);
    if (this.scheduled.length > 64) this.scheduled.shift();
    this.onChunkScheduled?.(sc);
  }

  /** Barge-in: silence now. Returns how far playback got for history trimming. */
  stop(): { playedUntilSeq: number; playedMsInSeq: number } {
    const t = this.audibleTime();
    const cur = this.scheduled.find((s) => t >= s.ctxStart && t < s.ctxEnd) ?? this.scheduled.at(-1);
    const now = this.ctx.currentTime;
    this.gain.gain.setTargetAtTime(0, now, 0.005); // ~5 ms fade, no click
    for (const s of this.sources) {
      try {
        s.stop(now + 0.03);
      } catch {
        /* already stopped */
      }
    }
    this.sources = [];
    this.pending.clear();
    this.cursor = 0;
    this.scheduled.length = 0;
    this.gain.gain.setTargetAtTime(1, now + 0.04, 0.005);
    return {
      playedUntilSeq: cur?.seq ?? -1,
      playedMsInSeq: cur ? Math.max(0, (t - cur.ctxStart) * 1000) : 0,
    };
  }

  /** Barge-in duck: drop her to ~25 % while the user starts talking over her. */
  duck(on: boolean): void {
    const now = this.ctx.currentTime;
    this.gain.gain.cancelScheduledValues(now);
    this.gain.gain.setTargetAtTime(on ? 0.25 : 1, now, on ? 0.02 : 0.08);
  }

  get isPlaying(): boolean {
    return this.sources.length > 0;
  }

  /** AudioContext time currently reaching the speakers. */
  audibleTime(): number {
    const ts = this.ctx.getOutputTimestamp?.();
    if (ts && ts.contextTime !== undefined && ts.performanceTime !== undefined && ts.contextTime > 0) {
      return ts.contextTime + (performance.now() - ts.performanceTime) / 1000;
    }
    return this.ctx.currentTime - (this.ctx.outputLatency || this.ctx.baseLatency || 0);
  }

  /**
   * RMS of the audio *heard* at AudioContext time `t` (20 ms window), computed
   * from the decoded samples. Unlike an AnalyserNode (which sees audio when it is
   * processed — 100+ ms before it is heard on Bluetooth), this is aligned with
   * the lip-sync timeline regardless of output latency.
   */
  energyAt(t: number, windowS = 0.02): number {
    const c = this.scheduled.find((s) => t >= s.ctxStart && t < s.ctxEnd);
    if (!c) return 0;
    const mid = Math.floor((t - c.ctxStart) * c.sampleRate);
    const half = Math.floor((windowS * c.sampleRate) / 2);
    const a = Math.max(0, mid - half);
    const b = Math.min(c.samples.length, mid + half);
    let sum = 0;
    for (let i = a; i < b; i++) sum += c.samples[i] * c.samples[i];
    return b > a ? Math.sqrt(sum / (b - a)) : 0;
  }

  /** RMS of the signal currently being processed (NOT latency-aligned; debug/fallback only). */
  rms(): number {
    this.analyser.getFloatTimeDomainData(this.timeBuf);
    let s = 0;
    for (const x of this.timeBuf) s += x * x;
    return Math.sqrt(s / this.timeBuf.length);
  }
}

export function decodePcm(ctx: BaseAudioContext, c: TtsChunk): AudioBuffer {
  const bytes = Uint8Array.from(atob(c.pcm), (ch) => ch.charCodeAt(0));
  let samples: Float32Array<ArrayBuffer>;
  if (c.encoding === "pcm_f32le") {
    samples = new Float32Array(bytes.buffer, 0, bytes.byteLength >> 2);
  } else {
    const i16 = new Int16Array(bytes.buffer, 0, bytes.byteLength >> 1);
    samples = new Float32Array(i16.length);
    for (let i = 0; i < i16.length; i++) samples[i] = i16[i] / 32768;
  }
  const buf = ctx.createBuffer(1, Math.max(1, samples.length), c.sampleRate);
  buf.copyToChannel(samples, 0);
  return buf;
}

export function encodePcm16(samples: Float32Array): string {
  const i16 = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) i16[i] = Math.max(-1, Math.min(1, samples[i])) * 32767;
  const bytes = new Uint8Array(i16.buffer);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
