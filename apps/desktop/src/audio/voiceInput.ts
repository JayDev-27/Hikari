import type { CoreClient } from "../core/client";
import { MicCapture, type MicFrame } from "./capture";
import { LocalVad, type BargeAction } from "./localVad";
import { int16ToBase64 } from "./resample";

export type MicMode = "ptt" | "open";

const PREROLL_FRAMES = 10; // 200 ms kept while the mic is warm, so the first syllable survives
const WARM_MS = 10_000; // PTT: keep the mic open this long after release, then release it

/**
 * Voice input policy on top of MicCapture:
 *  - ptt  (default): stream only while ⌥Space is held; on release send
 *         `turn.end {reason: "push_to_talk"}` (end of user input). The mic opens on
 *         the first press and closes 10 s after the last release.
 *  - open: mic always on and streaming; the core's VAD decides turns. Local VAD
 *         ducks/cuts Hikari when the user talks over her (barge-in).
 *  - muted: mic closed, nothing sent.
 */
export class VoiceInput {
  readonly mic: MicCapture;
  readonly vad = new LocalVad();
  private mode: MicMode;
  private muted = false;
  private streaming = false;
  private seq = 0;
  private preroll: MicFrame[] = [];
  private warmTimer?: ReturnType<typeof setTimeout>;
  sentFrames = 0;
  onLevel?: (rms: number, voiced: boolean) => void;
  onBarge?: (a: BargeAction) => void;
  onError?: (e: unknown) => void;
  /** Is Hikari's audio playing right now? (barge-in only matters then) */
  herSpeaking: () => boolean = () => false;

  constructor(private readonly core: CoreClient, ctx: AudioContext, mode: MicMode = "ptt") {
    this.mic = new MicCapture(ctx);
    this.mode = mode;
    this.mic.onFrame = (f) => this.onFrame(f);
  }

  get state() {
    return { mode: this.mode, muted: this.muted, open: this.mic.isOpen, streaming: this.streaming, label: this.mic.activeLabel };
  }

  async setMode(mode: MicMode): Promise<void> {
    this.mode = mode;
    this.streaming = false;
    if (mode === "open" && !this.muted) await this.safeOpen();
    else this.scheduleClose();
  }

  async setMuted(muted: boolean): Promise<void> {
    this.muted = muted;
    if (muted) {
      this.streaming = false;
      clearTimeout(this.warmTimer);
      this.mic.close();
    } else if (this.mode === "open") {
      await this.safeOpen();
    }
  }

  /** ⌥Space pressed. */
  async pttDown(): Promise<void> {
    if (this.muted || this.mode !== "ptt") return;
    clearTimeout(this.warmTimer);
    this.seq = 0;
    this.streaming = true;
    // Mic already warm: send the last 200 ms so speech that began with the key press isn't clipped.
    for (const f of this.preroll) this.send(f);
    this.preroll = [];
    await this.safeOpen();
  }

  /** ⌥Space released. Returns true if any audio was sent this turn. */
  pttUp(): boolean {
    if (this.mode !== "ptt" || !this.streaming) return false;
    this.streaming = false;
    const sent = this.seq > 0;
    if (sent) this.core.send("turn.end", { reason: "push_to_talk" });
    this.scheduleClose();
    return sent;
  }

  private onFrame(f: MicFrame): void {
    const action = this.vad.push(f.rms, this.mode === "open" && this.herSpeaking());
    this.onLevel?.(f.rms, this.vad.voiced);
    if (action !== "none") this.onBarge?.(action);
    if (this.muted) return;
    if (this.mode === "open" || this.streaming) {
      this.send(f);
    } else {
      this.preroll.push(f);
      if (this.preroll.length > PREROLL_FRAMES) this.preroll.shift();
    }
  }

  private send(f: MicFrame): void {
    this.core.send("audio.in.chunk", {
      seq: this.seq++,
      sampleRate: 16000,
      encoding: "pcm_s16le",
      data: int16ToBase64(f.pcm),
      pushToTalk: this.mode === "ptt",
    });
    this.sentFrames++;
  }

  private scheduleClose(): void {
    clearTimeout(this.warmTimer);
    if (this.mode !== "ptt") return;
    this.warmTimer = setTimeout(() => {
      if (!this.streaming) {
        this.mic.close();
        this.preroll = [];
      }
    }, WARM_MS);
  }

  private async safeOpen(): Promise<void> {
    try {
      await this.mic.open();
    } catch (e) {
      this.streaming = false;
      this.onError?.(e);
    }
  }

  destroy(): void {
    clearTimeout(this.warmTimer);
    this.mic.close();
  }
}
