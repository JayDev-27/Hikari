// AudioWorklet (audio thread) for Voice Lab takes: mic → mono float at the clip rate (24 kHz), posted every ~50 ms
// with the block's RMS and peak for the level meter. Unlike the voice-input worklet it keeps full float precision
// and doesn't frame for streaming. Bundled separately by Vite (`?worker&url`).
import { Downsampler } from "../audio/resample";

declare const sampleRate: number;
declare function registerProcessor(name: string, ctor: unknown): void;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor(options?: unknown);
}

class VoiceLabRecorder extends AudioWorkletProcessor {
  private down?: Downsampler;
  private out: number[] = [];
  private sum = 0;
  private peak = 0;
  private n = 0;
  private readonly every: number;

  constructor(options: { processorOptions?: { outRate?: number } }) {
    super(options);
    const outRate = options.processorOptions?.outRate ?? 24000;
    if (sampleRate > outRate) this.down = new Downsampler(sampleRate, outRate, 48);
    this.every = Math.round(sampleRate * 0.05);
  }

  process(inputs: Float32Array[][]): boolean {
    const ch = inputs[0]?.[0];
    if (ch && ch.length) {
      for (let i = 0; i < ch.length; i++) {
        const a = Math.abs(ch[i]);
        if (a > this.peak) this.peak = a;
        this.sum += ch[i] * ch[i];
      }
      this.n += ch.length;
      const block = this.down ? this.down.process(ch) : ch;
      for (let i = 0; i < block.length; i++) this.out.push(block[i]);
      if (this.n >= this.every) {
        const samples = Float32Array.from(this.out);
        this.port.postMessage({ samples: samples.buffer, rms: Math.sqrt(this.sum / this.n), peak: this.peak }, [samples.buffer]);
        this.out = [];
        this.sum = this.peak = this.n = 0;
      }
    }
    return true;
  }
}

registerProcessor("hikari-voicelab-rec", VoiceLabRecorder);
