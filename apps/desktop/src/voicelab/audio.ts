import { useCallback, useEffect, useRef, useState } from "react";
import workletUrl from "./recorderWorklet.ts?worker&url";
import { inTauri } from "../ui/coreBridge";
import { base64ToBytes, bytesToBase64, CLIP_RATE, encodeWav, takeProblems, takeStats, trimSilence, type TakeProblem, type TakeStats } from "./wav";

/**
 * Microphone recording for Voice Lab, separate from the stage's voice input on purpose: training data wants the raw
 * mic (no echo cancellation, noise suppression or auto gain, which smear the voice) at 24 kHz, not 16 kHz frames
 * shaped for streaming STT. Opening it shows macOS's orange mic indicator; it's closed whenever no step needs it.
 */
export class ClipRecorder {
  private ctx?: AudioContext;
  private stream?: MediaStream;
  private nodes: AudioNode[] = [];
  private chunks: Float32Array[] = [];
  private recording = false;
  private opening?: Promise<void>;
  /** Rate the samples actually come out at (the clip rate, or the device rate if that's lower). */
  rate = CLIP_RATE;
  private onLevel?: (rms: number, peak: number) => void;

  /** Level callback (~20×/s while open); undefined to stop. */
  listen(f: ((rms: number, peak: number) => void) | undefined) {
    this.onLevel = f;
  }

  /** `fake`: DEV preview only, a synthetic voice-like signal instead of the mic. */
  constructor(private readonly fake = false) {}

  get isOpen() {
    return !!this.ctx;
  }

  open(): Promise<void> {
    if (this.ctx) return Promise.resolve();
    this.opening ??= this.doOpen().finally(() => (this.opening = undefined));
    return this.opening;
  }

  private async doOpen() {
    const ctx = new AudioContext();
    try {
      await ctx.audioWorklet.addModule(workletUrl);
      this.rate = Math.min(CLIP_RATE, ctx.sampleRate);
      const node = new AudioWorkletNode(ctx, "hikari-voicelab-rec", { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1, processorOptions: { outRate: this.rate } });
      node.port.onmessage = (e: MessageEvent<{ samples: ArrayBuffer; rms: number; peak: number }>) => {
        if (this.recording) this.chunks.push(new Float32Array(e.data.samples));
        this.onLevel?.(e.data.rms, e.data.peak);
      };
      const sink = ctx.createGain();
      sink.gain.value = 0; // pull the worklet without making a sound
      node.connect(sink).connect(ctx.destination);
      this.nodes = [node, sink];
      if (this.fake) this.nodes.push(...fakeVoice(ctx, node));
      else {
        this.stream = await navigator.mediaDevices.getUserMedia({
          audio: { channelCount: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: false },
        });
        const src = ctx.createMediaStreamSource(this.stream);
        src.connect(node);
        this.nodes.push(src);
      }
      if (ctx.state === "suspended") await ctx.resume();
      this.ctx = ctx;
    } catch (e) {
      this.stream?.getTracks().forEach((t) => t.stop());
      this.stream = undefined;
      void ctx.close();
      throw e;
    }
  }

  start() {
    this.chunks = [];
    this.recording = true;
  }

  /** Stop and return everything recorded since start(). */
  stop(): Float32Array {
    this.recording = false;
    const n = this.chunks.reduce((a, c) => a + c.length, 0);
    const out = new Float32Array(n);
    let at = 0;
    for (const c of this.chunks) {
      out.set(c, at);
      at += c.length;
    }
    this.chunks = [];
    return out;
  }

  close() {
    this.recording = false;
    this.nodes.forEach((n) => {
      if (n instanceof AudioScheduledSourceNode) n.stop();
      n.disconnect();
    });
    this.nodes = [];
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = undefined;
    void this.ctx?.close();
    this.ctx = undefined;
  }
}

/** DEV: a buzzy formant tone with a syllable-rate envelope, so meters and takes can be tried without a mic. */
function fakeVoice(ctx: AudioContext, into: AudioNode): AudioNode[] {
  const osc = new OscillatorNode(ctx, { type: "sawtooth", frequency: 170 });
  const vib = new OscillatorNode(ctx, { frequency: 0.8 });
  const vibAmt = new GainNode(ctx, { gain: 14 });
  const formant = new BiquadFilterNode(ctx, { type: "bandpass", frequency: 900, Q: 0.9 });
  const env = new GainNode(ctx, { gain: 0.25 });
  const lfo = new OscillatorNode(ctx, { frequency: 3.1 });
  const lfoAmt = new GainNode(ctx, { gain: 0.22 });
  vib.connect(vibAmt).connect(osc.frequency);
  lfo.connect(lfoAmt).connect(env.gain);
  osc.connect(formant).connect(env).connect(into);
  [osc, vib, lfo].forEach((o) => o.start());
  return [osc, vib, vibAmt, formant, env, lfo, lfoAmt];
}

/** DEV browser preview with `?fakemic` in the hash query: use the synthetic voice. Never in the app. */
export const fakeMicWanted = () => !inTauri() && import.meta.env.DEV && new URLSearchParams(location.hash.split("?")[1] ?? "").has("fakemic");

export interface FinishedTake {
  wavBase64: string;
  url: string;
  sampleRate: number;
  stats: TakeStats;
  problems: TakeProblem[];
}

/** Trim, check and encode a take. */
export function finishTake(samples: Float32Array, rate: number, opts?: { minMs?: number; maxMs?: number }): FinishedTake {
  const trimmed = trimSilence(samples, rate, { padMs: 250 });
  const stats = takeStats(trimmed, rate);
  const problems = trimmed.length ? takeProblems(stats, opts) : (["too_quiet"] as TakeProblem[]);
  const wav = encodeWav(trimmed, rate);
  return { wavBase64: bytesToBase64(wav), url: URL.createObjectURL(new Blob([wav.buffer as ArrayBuffer], { type: "audio/wav" })), sampleRate: rate, stats, problems };
}

export type RecorderState = "closed" | "ready" | "recording" | "error";

/**
 * The window's one recorder, open while `active`. Level is reported ~20×/s for the meter.
 * Errors (permission denied, no device) come back as text for the UI.
 */
export function useRecorder(active: boolean) {
  const [rec] = useState(() => new ClipRecorder(fakeMicWanted()));
  const [opened, setOpened] = useState(false);
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState<string>();
  const [level, setLevel] = useState({ rms: 0, peak: 0 });

  useEffect(() => {
    if (!active) return;
    let live = true;
    rec.listen((rms, peak) => live && setLevel({ rms, peak }));
    rec.open().then(
      () => live && (setOpened(true), setError(undefined)),
      (e: unknown) => live && setError(micError(e)),
    );
    return () => {
      live = false;
      rec.listen(undefined);
      rec.close();
      setOpened(false);
      setRecording(false);
      setLevel({ rms: 0, peak: 0 });
    };
  }, [active, rec]);

  const start = useCallback(() => {
    if (!rec.isOpen) return false;
    rec.start();
    setRecording(true);
    return true;
  }, [rec]);
  const stop = useCallback(() => {
    setRecording(false);
    return { samples: rec.stop(), rate: rec.rate };
  }, [rec]);

  const state: RecorderState = error ? "error" : recording ? "recording" : opened ? "ready" : "closed";
  return { state, error, level, start, stop, fake: fakeMicWanted() };
}

function micError(e: unknown): string {
  const name = (e as { name?: string })?.name;
  if (name === "NotAllowedError") return "Hikari isn't allowed to use the microphone. Allow it in System Settings → Privacy & Security → Microphone.";
  if (name === "NotFoundError") return "No microphone found. Plug one in or pick an input in System Settings → Sound.";
  return `Couldn't open the microphone (${String((e as Error)?.message ?? e)}).`;
}

/**
 * One audio element for the window: play a base64 WAV or an object URL by id; starting another stops the first.
 * `onEnded(id)` fires when a clip plays to the end (the A/B test uses it to know both were heard).
 */
export function usePlayer(onEnded?: (id: string) => void) {
  const audio = useRef<HTMLAudioElement | null>(null);
  const urls = useRef(new Map<string, string>());
  const [playing, setPlaying] = useState<string | null>(null);
  const ended = useRef(onEnded);
  useEffect(() => {
    ended.current = onEnded;
  });

  useEffect(() => {
    const cache = urls.current;
    return () => {
      audio.current?.pause();
      cache.forEach((u) => URL.revokeObjectURL(u));
      cache.clear();
    };
  }, []);

  const stop = useCallback(() => {
    audio.current?.pause();
    setPlaying(null);
  }, []);

  const play = useCallback((id: string, src: { base64?: string; url?: string }) => {
    let url = src.url;
    if (!url && src.base64) {
      url = urls.current.get(src.base64);
      if (!url) {
        const bytes = base64ToBytes(src.base64);
        url = URL.createObjectURL(new Blob([bytes.buffer as ArrayBuffer], { type: "audio/wav" }));
        urls.current.set(src.base64, url);
      }
    }
    if (!url) return;
    audio.current?.pause();
    const a = new Audio(url);
    audio.current = a;
    a.onended = () => {
      setPlaying((p) => (p === id ? null : p));
      ended.current?.(id);
    };
    a.onerror = () => setPlaying((p) => (p === id ? null : p));
    setPlaying(id);
    void a.play().catch(() => setPlaying((p) => (p === id ? null : p)));
  }, []);

  return { playing, play, stop };
}
