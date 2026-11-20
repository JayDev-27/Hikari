import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { AvatarController } from "../avatar/types";
import { PlaybackQueue } from "../audio/playback";
import { CoreClient } from "../core/client";
import { LipSyncEngine, visemesFromSpectrum } from "../lipsync/engine";
import { mockTurn } from "../dev/mockReplay";
import { useStage } from "../state/stage";

export const inTauri = "__TAURI_INTERNALS__" in window;

interface PendingGesture {
  seq: number;
  atMs: number;
  tag: string;
}

/**
 * Glue between protocol messages, audio, lip sync and the avatar.
 * One instance per stage window.
 */
export class StageRuntime {
  readonly playback = new PlaybackQueue();
  readonly lipsync = new LipSyncEngine();
  readonly core: CoreClient;
  private avatar?: AvatarController;
  private gestures: PendingGesture[] = [];
  private chunkStart = new Map<number, number>();
  private freq: Float32Array<ArrayBuffer>;
  private raf = 0;
  private last = performance.now();
  private unlisten: Array<() => void> = [];
  private hovering = false;
  private turnStartAt = 0;
  private firstAudioMarked = false;

  constructor(coreUrl = "ws://127.0.0.1:8765/ws") {
    this.core = new CoreClient(coreUrl);
    this.freq = new Float32Array(this.playback.analyser.frequencyBinCount);
    this.wireProtocol();
    this.playback.onChunkScheduled = (sc) => {
      this.chunkStart.set(sc.seq, sc.ctxStart);
      this.lipsync.addChunk(sc.ctxStart, sc.chunk.phonemes ?? []);
      useStage.getState().setCaption(sc.text);
      if (!this.firstAudioMarked) {
        this.firstAudioMarked = true;
        const lead = (sc.ctxStart - this.playback.audibleTime()) * 1000;
        useStage.getState().mark("audio_first_play", performance.now() - this.turnStartAt + lead);
      }
    };
    this.playback.onDrained = () => {
      this.avatar?.setState("idle");
      useStage.getState().setState("idle");
      setTimeout(() => !this.playback.isPlaying && useStage.getState().setCaption(""), 2500);
    };
  }

  attach(avatar: AvatarController): void {
    this.avatar = avatar;
    if (!this.raf) this.loop();
  }

  start(): void {
    this.core.onStatus = (ok) => useStage.getState().setCore(ok);
    this.core.connect();
    if (inTauri) void this.wireTauri();
  }

  private wireProtocol(): void {
    const c = this.core;
    c.on("tts.chunk", (p) => this.playback.enqueue(p));
    c.on("turn.start", () => this.newTurn());
    c.on("avatar.emotion", (p) => this.avatar?.setExpression(p.name, p.intensity));
    c.on("avatar.gesture", (p) => this.gestures.push({ seq: p.seq ?? -1, atMs: p.atMs, tag: p.tag }));
    c.on("state", (p) => {
      this.avatar?.setState(p.state);
      useStage.getState().setState(p.state);
    });
    c.on("latency.mark", (p) => useStage.getState().mark(p.stage, p.ms));
    c.on("barge_in", () => this.bargeIn("core"));
  }

  private newTurn(): void {
    this.playback.reset();
    this.lipsync.clear();
    this.gestures = [];
    this.chunkStart.clear();
    this.turnStartAt = performance.now();
    this.firstAudioMarked = false;
  }

  /** Stop speaking immediately (user started talking / panic). */
  bargeIn(source: "ui" | "core" = "ui"): void {
    const where = this.playback.stop();
    this.lipsync.clear();
    this.gestures = [];
    this.avatar?.setVisemes({ aa: 0, ih: 0, ou: 0, ee: 0, oh: 0 });
    if (source === "ui") this.core.send("barge_in", { source, ...where });
  }

  /** Play the built-in mock turn (no core needed). */
  playMock(): void {
    this.newTurn();
    for (const m of mockTurn()) this.core.inject(m);
  }

  private async wireTauri(): Promise<void> {
    this.unlisten.push(
      await listen<{ x: number; y: number; inside: boolean; gx: number; gy: number }>("stage://cursor", (e) => {
        const { x, y, inside } = e.payload;
        // Click-through: interactive only while over a visible part of her.
        const hit = inside ? this.avatar?.hitTest(x, y) ?? null : null;
        const over = hit !== null;
        if (over !== this.hovering) {
          this.hovering = over;
          void invoke("set_click_through", { ignore: !over });
        }
        // Eyes follow the cursor anywhere on screen: x/y are window-relative
        // (can be far outside), normalised by half the screen size around her face.
        const dx = (x - window.innerWidth / 2) / (screen.width / 2);
        const dy = (y - window.innerHeight * 0.3) / (screen.height / 2);
        this.avatar?.lookAt(clamp(dx * 2, -1, 1), clamp(-dy * 2, -1, 1));
      }),
      await listen<{ pressed: boolean }>("hotkey://ptt", (e) => {
        if (e.payload.pressed && this.playback.isPlaying) this.bargeIn("ui");
        this.avatar?.setState(e.payload.pressed ? "listening" : "thinking");
        useStage.getState().setState(e.payload.pressed ? "listening" : "thinking");
        if (!e.payload.pressed && !this.core.connected) {
          // Dev: with no core running, releasing PTT plays the mock turn.
          setTimeout(() => this.playMock(), 300);
        }
      }),
      await listen("hotkey://panic", () => {
        this.bargeIn("ui");
        this.core.send("tool.confirm", { callId: "*", approved: false, via: "click" });
      }),
    );
  }

  private loop = (): void => {
    this.raf = requestAnimationFrame(this.loop);
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    const a = this.avatar;
    if (!a) return;

    const t = this.playback.audibleTime();
    const rms = this.playback.isPlaying ? this.playback.rms() : 0;
    let fallback;
    if (this.playback.isPlaying && !this.lipsync.hasPending) {
      this.playback.analyser.getFloatFrequencyData(this.freq);
      fallback = visemesFromSpectrum(this.freq, this.playback.ctx.sampleRate, rms);
    }
    a.setVisemes(this.lipsync.sample(t, dt, Math.min(1, rms * 5), fallback));

    // Fire gestures whose time has come (on the audio clock).
    if (this.gestures.length) {
      this.gestures = this.gestures.filter((g) => {
        const start = this.chunkStart.get(g.seq);
        if (start === undefined) return true;
        if (t >= start + g.atMs / 1000) {
          a.playMotion(g.tag);
          return false;
        }
        return true;
      });
    }
    a.update(dt);
  };

  async startDrag(): Promise<void> {
    if (inTauri) await getCurrentWindow().startDragging();
  }

  destroy(): void {
    cancelAnimationFrame(this.raf);
    this.unlisten.forEach((u) => u());
    this.core.close();
    this.avatar?.destroy();
  }
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
