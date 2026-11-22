// AudioWorklet (runs on the audio thread): mic → 16 kHz mono → 20 ms Int16 frames.
// Bundled separately by Vite (`?worker&url`); posts { frame: ArrayBuffer, rms } per frame.
import { Downsampler, Framer } from "./resample";

// Minimal AudioWorkletGlobalScope typings (not in lib.dom).
declare const sampleRate: number;
declare function registerProcessor(name: string, ctor: unknown): void;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}

class CaptureProcessor extends AudioWorkletProcessor {
  private down = new Downsampler(sampleRate, 16000);
  private framer = new Framer(320);

  process(inputs: Float32Array[][]): boolean {
    const ch = inputs[0]?.[0];
    if (ch && ch.length) {
      const out = this.down.process(ch);
      this.framer.push(out, (frame, rms) => {
        this.port.postMessage({ frame: frame.buffer, rms }, [frame.buffer]);
      });
    }
    return true; // keep alive
  }
}

registerProcessor("hikari-capture", CaptureProcessor);
