/**
 * Streaming downsampler (e.g. 48 kHz / 44.1 kHz mic → 16 kHz for STT).
 *
 * Windowed-sinc low-pass + fractional resampling in one pass: each output sample
 * is a Blackman-windowed sinc sum over `taps` neighbouring input samples, with the
 * cutoff just under the output Nyquist so speech energy above 8 kHz doesn't alias
 * into the band STT cares about. State carries across blocks, so arbitrary block
 * sizes (128-frame AudioWorklet quanta) give the same result as one big buffer.
 * Pure — runs in the AudioWorklet and in unit tests.
 */
export class Downsampler {
  private readonly ratio: number; // input samples per output sample
  private readonly half: number;
  private readonly cutoff: number; // normalised to input rate (cycles/sample)
  private hist: Float32Array; // tail of previous input for the filter window
  private pos: number; // next output position, in input-sample units relative to hist start

  constructor(readonly inRate: number, readonly outRate = 16000, taps = 32) {
    if (outRate > inRate) throw new Error("Downsampler only reduces the rate");
    this.ratio = inRate / outRate;
    this.half = Math.ceil(taps / 2);
    this.cutoff = (0.45 * outRate) / inRate; // 0.9 × output Nyquist
    this.hist = new Float32Array(this.half * 2);
    this.pos = this.half;
  }

  /** Feed a block of input samples; returns the output samples now available. */
  process(input: Float32Array): Float32Array {
    const buf = new Float32Array(this.hist.length + input.length);
    buf.set(this.hist);
    buf.set(input, this.hist.length);
    const out: number[] = [];
    const end = buf.length - this.half;
    const fc = this.cutoff;
    while (this.pos < end) {
      const c = Math.floor(this.pos);
      const frac = this.pos - c;
      let acc = 0;
      let wsum = 0;
      for (let k = -this.half + 1; k <= this.half; k++) {
        const x = k - frac; // distance from the ideal sample point
        const sinc = x === 0 ? 2 * fc : Math.sin(2 * Math.PI * fc * x) / (Math.PI * x);
        const n = (x + this.half) / (2 * this.half); // 0..1 across the window
        const win = 0.42 - 0.5 * Math.cos(2 * Math.PI * n) + 0.08 * Math.cos(4 * Math.PI * n);
        const h = sinc * win;
        acc += buf[c + k] * h;
        wsum += h;
      }
      out.push(wsum !== 0 ? acc / wsum : 0);
      this.pos += this.ratio;
    }
    // Keep the last 2·half samples as history; rebase pos onto the new history.
    const keep = this.half * 2;
    const dropped = buf.length - keep;
    this.hist = buf.slice(dropped);
    this.pos -= dropped;
    return Float32Array.from(out);
  }
}

/** Collects samples into fixed-size Int16 frames (320 samples = 20 ms at 16 kHz). */
export class Framer {
  private buf: Int16Array;
  private n = 0;
  constructor(readonly frameSize = 320) {
    this.buf = new Int16Array(frameSize);
  }

  push(samples: Float32Array, onFrame: (frame: Int16Array, rms: number) => void): void {
    for (let i = 0; i < samples.length; i++) {
      const s = Math.max(-1, Math.min(1, samples[i]));
      this.buf[this.n++] = Math.round(s * 32767);
      if (this.n === this.frameSize) {
        let sum = 0;
        for (let j = 0; j < this.frameSize; j++) sum += (this.buf[j] / 32768) ** 2;
        onFrame(this.buf, Math.sqrt(sum / this.frameSize));
        this.buf = new Int16Array(this.frameSize);
        this.n = 0;
      }
    }
  }
}

/** Int16 PCM → base64 (protocol `audio.in.chunk.data`). */
export function int16ToBase64(frame: Int16Array): string {
  const bytes = new Uint8Array(frame.buffer, frame.byteOffset, frame.byteLength);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
