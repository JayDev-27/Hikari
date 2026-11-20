import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { AvatarController } from "../avatar/types";
import { PlaybackQueue } from "../audio/playback";
import { CoreClient } from "../core/client";
import { LipSyncEngine, visemesFromSpectrum, visemesToLive2D } from "../lipsync/engine";
import { mockTurn } from "../dev/mockReplay";
import { useStage } from "../state/stage";
import { FrameScheduler, type FrameTier } from "./frameScheduler";

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
  private frames = 0;
  private fpsAt = performance.now();
  private unlisten: Array<() => void> = [];
  private hovering = false;
  private leaveTimer?: ReturnType<typeof setTimeout>;
  private cursorInside = false;
  private turnStartAt = 0;
  private firstAudioMarked = false;
  private captionSeq = -1;
  private readonly scheduler = new FrameScheduler();
  /** Dev/measurement hook: called per rendered frame with mouth opening (0..1). */
  onFrame?: (t: number, open: number) => void;
  /** Smoothed render→display interval (s), for lip-sync lead. */
  private frameIntervalS = 1 / 60;
  private visible = true;

  constructor(coreUrl = "ws://127.0.0.1:8765/ws") {
    this.core = new CoreClient(coreUrl);
    this.freq = new Float32Array(this.playback.analyser.frequencyBinCount);
    this.wireProtocol();
    this.playback.onChunkScheduled = (sc) => {
      this.chunkStart.set(sc.seq, sc.ctxStart);
      this.lipsync.addChunk(sc.ctxStart, sc.chunk.phonemes ?? []);
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
    // Fresh per-pixel answer after a render: apply it now. Without this the
    // toggle lagged one cursor event behind — with a resting cursor, she stayed
    // click-through until the mouse moved again (found by the cursor test).
    avatar.onHitChange = (hit) => {
      if (this.cursorInside && inTauri) this.applyHover(hit !== null);
    };
    if (!this.raf) this.loop();
  }

  start(): void {
    this.core.onStatus = (ok) => useStage.getState().setCore(ok);
    this.core.connect();
    if (inTauri) void this.wireTauri();
    // Note: no document.visibilitychange pause — WebKit reports this floating,
    // mostly transparent panel as "hidden" while it is on screen (observed in
    // release builds). Only the tray's explicit hide pauses rendering.
  }

  /** Stage hidden (tray / visibility): stop requestAnimationFrame entirely. */
  setVisible(v: boolean): void {
    if (v === this.visible) return;
    this.visible = v;
    if (!v) {
      cancelAnimationFrame(this.raf);
      this.raf = 0;
    } else if (this.avatar && !this.raf) {
      this.scheduler.reset();
      this.last = performance.now();
      this.raf = requestAnimationFrame(this.loop);
    }
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
    this.captionSeq = -1;
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
        // Cursor near her → 60 fps (hover, eye contact). Far away → eyes still
        // follow at the smooth 30 fps idle rate instead of forcing 60 while you work.
        const NEAR = 160;
        if (x > -NEAR && y > -NEAR && x < window.innerWidth + NEAR && y < window.innerHeight + NEAR) {
          this.scheduler.poke(performance.now());
        }
        // Click-through: interactive only while over a visible part of her.
        // hitTest answers from the last pixel readback; the fresh answer arrives
        // via avatar.onHitChange right after the next render (see attach()).
        this.cursorInside = inside;
        this.applyHover(inside ? (this.avatar?.hitTest(x, y) ?? null) !== null : false);
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
      await listen<boolean>("stage://visible", (e) => this.setVisible(e.payload)),
      await listen("hotkey://panic", () => {
        this.bargeIn("ui");
        this.core.send("tool.confirm", { callId: "*", approved: false, via: "click" });
      }),
    );
  }

  /**
   * Become interactive immediately; go back to click-through only after 60 ms
   * off-model (hysteresis — rapid toggling is known to crash AppKit).
   */
  private applyHover(over: boolean): void {
    if (over) {
      clearTimeout(this.leaveTimer);
      this.leaveTimer = undefined;
      if (!this.hovering) {
        this.hovering = true;
        void invoke("set_click_through", { ignore: false });
      }
    } else if (this.hovering && this.leaveTimer === undefined) {
      this.leaveTimer = setTimeout(() => {
        this.leaveTimer = undefined;
        this.hovering = false;
        void invoke("set_click_through", { ignore: true });
      }, 60);
    }
  }

  /** Anything moving that deserves the 60 fps tier. */
  private isBusy(): boolean {
    const st = useStage.getState().state;
    return (
      this.playback.isPlaying ||
      this.lipsync.hasPending ||
      this.gestures.length > 0 ||
      this.hovering ||
      (st !== "idle" && st !== "sleeping") ||
      (this.avatar?.isBusy?.() ?? false)
    );
  }

  private loop = (now: number = performance.now()): void => {
    if (!this.visible) {
      this.raf = 0;
      return;
    }
    this.raf = requestAnimationFrame(this.loop);
    // VITE_FORCE_TIER (measurement builds only): pin the render tier.
    const tier = (import.meta.env.VITE_FORCE_TIER as FrameTier | undefined) ?? this.scheduler.tier(now, this.visible, this.isBusy());
    if (!this.scheduler.shouldRender(now, tier)) return;
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    this.frames++;
    if (now - this.fpsAt >= 1000) {
      useStage.getState().setFps(Math.round((this.frames * 1000) / (now - this.fpsAt)), tier);
      this.frames = 0;
      this.fpsAt = now;
    }
    const a = this.avatar;
    if (!a) return;

    // Sample for when this frame is *displayed*, not rendered: a frame drawn now
    // reaches the screen about one frame interval later (next vsync). Measured
    // with the A/V sync probe: without this, lips trailed audio by one frame
    // (+33 ms at 30 Hz). Interval tracked live (30/60/120 Hz, Low Power Mode).
    this.frameIntervalS += (Math.min(0.05, Math.max(0.004, dt)) - this.frameIntervalS) * 0.1;
    const t = this.playback.audibleTime() + this.frameIntervalS;
    // Caption follows what is audible now (chunks are scheduled well ahead of playback).
    const playing = this.playback.scheduled.find((c) => t >= c.ctxStart && t < c.ctxEnd);
    if (playing && playing.seq !== this.captionSeq) {
      this.captionSeq = playing.seq;
      useStage.getState().setCaption(playing.text);
    }
    // Loudness of what is heard at t (latency-aligned), for jaw scaling.
    const rms = this.playback.isPlaying ? this.playback.energyAt(t) : 0;
    let fallback;
    if (this.playback.isPlaying && !this.lipsync.hasPending) {
      this.playback.analyser.getFloatFrequencyData(this.freq);
      fallback = visemesFromSpectrum(this.freq, this.playback.ctx.sampleRate, rms);
    }
    const vis = this.lipsync.sample(t, dt, Math.min(1, rms * 5), fallback);
    a.setVisemes(vis);
    this.onFrame?.(now, visemesToLive2D(vis).open);
    if (this.frames % 6 === 0 && useStage.getState().debug) {
      useStage.getState().setAudio({ ctx: this.playback.ctx.state, mouth: Math.round(visemesToLive2D(vis).open * 100) / 100 });
    }

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
