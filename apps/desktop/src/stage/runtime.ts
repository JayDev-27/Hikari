import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { AvatarController } from "../avatar/types";
import { PlaybackQueue } from "../audio/playback";
import { VoiceInput, type MicMode } from "../audio/voiceInput";
import { CoreClient } from "../core/client";
import { LipSyncEngine, visemesFromSpectrum, visemesToLive2D } from "../lipsync/engine";
import { mockTurn } from "../dev/mockReplay";
import { useStage } from "../state/stage";
import { Subscriptions } from "../util/subscriptions";
import { matchSwitch } from "../avatar/switchIntent";
import { listPacks } from "../avatar/packs";
import type { CharacterPack } from "../avatar/characters";
import { emitTo } from "@tauri-apps/api/event";
import { FrameScheduler, type FrameTier } from "./frameScheduler";
import type { AvatarEmotion, AvatarGesture, Emotion } from "@hikari/protocol";

export const inTauri = "__TAURI_INTERNALS__" in window;

interface PendingGesture extends AvatarGesture {
  receivedAt: number;
}

/**
 * Glue between protocol messages, audio, lip sync and the avatar.
 * One instance per stage window.
 */
export class StageRuntime {
  readonly playback = new PlaybackQueue();
  readonly lipsync = new LipSyncEngine();
  readonly core: CoreClient;
  readonly voice: VoiceInput;
  private avatar?: AvatarController;
  private gestures: PendingGesture[] = [];
  private emotions = new Map<number, AvatarEmotion>();
  private speechEmotion?: Emotion;
  private lastEmotionSeq = -1;
  private speechStreamEnded = false;
  private nextSpeechMotion = 0;
  private speechMotionIndex = 0;
  private nextSignatureMotion = Infinity;
  private signatureMotionIndex = 0;
  private chunkStart = new Map<number, number>();
  private freq: Float32Array<ArrayBuffer>;
  private raf = 0;
  private last = performance.now();
  private frames = 0;
  private fpsAt = performance.now();
  private readonly subs = new Subscriptions();
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
    // VITE_MIC_MODE (dev) overrides the saved mode, e.g. for always-listening tests.
    const mode = (import.meta.env.VITE_MIC_MODE as MicMode | undefined) ?? (loadPref("hikari.micMode", "ptt") as MicMode);
    this.voice = new VoiceInput(this.core, this.playback.ctx, mode);
    this.voice.mic.deviceId = loadPref("hikari.micDevice", "") || undefined;
    this.voice.herSpeaking = () => this.playback.isPlaying;
    this.voice.onLevel = (rms, voiced) => {
      if (useStage.getState().debug) useStage.getState().setMic({ level: Math.min(1, rms * 6), voiced });
    };
    this.voice.onBarge = (a) => {
      if (a === "duck") this.playback.duck(true);
      else if (a === "unduck") this.playback.duck(false);
      else if (a === "cut") this.bargeIn("ui");
    };
    this.voice.onError = (e) => {
      console.error("microphone unavailable:", e);
      useStage.getState().setMic({ open: false, error: e instanceof Error ? e.name : String(e) });
    };
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
  }

  attach(avatar: AvatarController): void {
    if (this.avatar && this.avatar !== avatar) this.avatar.destroy();
    this.avatar = avatar;
    // Fresh per-pixel answer after a render: apply it now. Without this the
    // toggle lagged one cursor event behind — with a resting cursor, she stayed
    // click-through until the mouse moved again (found by the cursor test).
    avatar.onHitChange = (hit) => {
      if (this.cursorInside && inTauri) this.applyHover(hit !== null);
    };
    if (!this.raf) this.loop();
  }

  /** Remove the current avatar (character switch / empty slot). */
  detach(): void {
    this.avatar?.destroy();
    this.avatar = undefined;
  }

  /** Clickable region when there's no avatar (e.g. the empty-slot import prompt). */
  fallbackHit?: (x: number, y: number) => boolean;

  private character?: CharacterPack;

  /** Active character changed: tell the core (persona + memory namespace). */
  setCharacter(pack: CharacterPack): void {
    if (this.character !== undefined && this.character.id !== pack.id) {
      if (this.playback.isPlaying) this.bargeIn("ui");
      else this.resetSpeechAnimation();
      this.speechMotionIndex = 0;
    }
    this.character = pack;
    this.nextSignatureMotion = performance.now() + 18000;
    this.signatureMotionIndex = 0;
    this.sendCharacter();
  }

  private sendCharacter(): void {
    const p = this.character;
    if (!p || !this.core.connected) return;
    this.core.send("character.select", {
      id: p.id,
      displayName: p.displayName,
      persona: p.personaText,
      ...(p.defaultLanguage ? { defaultLanguage: p.defaultLanguage } : {}),
      ...(p.voice ? { voice: p.voice } : {}),
    });
  }

  start(): void {
    this.core.onStatus = (ok) => {
      useStage.getState().setCore(ok);
      if (ok) this.sendCharacter();
    };
    this.core.connect();
    if (inTauri) this.wireTauri();
    // Always-listening mode opens the mic at start (macOS asks for permission the first time).
    if (this.voice.state.mode === "open") void this.voice.setMode("open").then(() => this.syncMic());
    this.syncMic();
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
    c.on("avatar.emotion", (p) => {
      if (p.seq === undefined) this.applyEmotion(p);
      else if (p.seq >= this.lastEmotionSeq) this.emotions.set(p.seq, p);
    });
    c.on("avatar.gesture", (p) => this.gestures.push({ ...p, receivedAt: performance.now() }));
    c.on("state", (p) => {
      if (p.state === "idle" && this.playback.isPlaying) return;
      this.avatar?.setState(p.state);
      useStage.getState().setState(p.state);
    });
    c.on("latency.mark", (p) => useStage.getState().mark(p.stage, p.ms));
    // Transcript for the chat window (one core connection; the chat talks via the stage).
    c.on("stt.final", (p, env) => this.chat({ kind: "user", text: p.text, turnId: env.turnId, via: "voice" }));
    c.on("llm.token", (p, env) => this.chat({ kind: "her", text: p.delta, turnId: env.turnId, append: true }));
    c.on("tts.end", (_p, env) => {
      this.speechStreamEnded = true;
      this.chat({ kind: "end", text: "", turnId: env.turnId });
    });
    c.on("error", (p, env) => this.chat({ kind: "system", text: `${p.code}: ${p.message}`, turnId: env.turnId }));
    c.on("barge_in", () => this.bargeIn("core"));
  }

  private newTurn(): void {
    this.playback.reset();
    this.lipsync.clear();
    this.resetSpeechAnimation();
    this.turnStartAt = performance.now();
    this.firstAudioMarked = false;
  }

  private resetSpeechAnimation(): void {
    this.speechStreamEnded = false;
    this.gestures = [];
    this.emotions.clear();
    this.chunkStart.clear();
    this.speechEmotion = undefined;
    this.lastEmotionSeq = -1;
    this.nextSpeechMotion = 0;
    this.captionSeq = -1;
    this.avatar?.setExpression("neutral", 0);
  }

  private applyEmotion(emotion: AvatarEmotion): void {
    this.speechEmotion = emotion.name;
    this.avatar?.setExpression(emotion.name, emotion.intensity);
  }

  /** Stop speaking immediately (user started talking / panic). */
  bargeIn(source: "ui" | "core" = "ui"): void {
    const where = this.playback.stop();
    this.lipsync.clear();
    this.resetSpeechAnimation();
    this.avatar?.setVisemes({ aa: 0, ih: 0, ou: 0, ee: 0, oh: 0 });
    if (useStage.getState().state === "speaking") {
      this.avatar?.setState("idle");
      useStage.getState().setState("idle");
    }
    if (source === "ui") this.core.send("barge_in", { source, ...where });
  }

  private chatLog: ChatEvent[] = [];

  /** Record + forward a transcript event to the chat window (keeps the last 200). */
  chat(e: ChatEvent): void {
    this.chatLog.push(e);
    if (this.chatLog.length > 200) this.chatLog.shift();
    if (inTauri) void emitTo("chat", "chat://event", e);
  }

  /** Text typed in the chat window. */
  /** Set by the stage: switch to a character (chat "switch to …"). */
  onSwitchCharacter?: (id: string) => void;

  async sendText(text: string): Promise<void> {
    const t = text.trim();
    if (!t) return;
    if (this.playback.isPlaying) this.bargeIn("ui");
    this.chat({ kind: "user", text: t, via: "text" });
    // Mid-session persona switch (§3): handled locally, not sent to the core.
    const target = matchSwitch(t, await listPacks().catch(() => []));
    if (target && this.onSwitchCharacter) {
      const pack = (await listPacks()).find((p) => p.id === target.id);
      this.chat({
        kind: "system",
        text: pack?.modelUrl
          ? `Switching to ${target.displayName}…`
          : `${target.displayName} needs a model first: import one in Character Studio (opened for you).`,
      });
      this.onSwitchCharacter(target.id);
      return;
    }
    if (this.core.connected) this.core.send("text.in", { text: t });
    else this.chat({ kind: "system", text: "Hikari's core isn't running — start it (dev: pnpm -F desktop fake-core)." });
  }

  /** Push mic state into the store (overlay). */
  syncMic(): void {
    const v = this.voice.state;
    useStage.getState().setMic({ mode: v.mode, muted: v.muted, open: v.open, label: v.label, error: v.open ? "" : useStage.getState().mic.error });
  }

  async setMicMode(mode: MicMode): Promise<void> {
    savePref("hikari.micMode", mode);
    await this.voice.setMode(mode);
    this.syncMic();
  }

  async setMicDevice(deviceId: string): Promise<void> {
    savePref("hikari.micDevice", deviceId);
    await this.voice.mic.setDevice(deviceId);
    this.syncMic();
  }

  /** Play the built-in mock turn (no core needed). */
  playMock(): void {
    this.newTurn();
    for (const m of mockTurn()) this.core.inject(m);
  }

  private wireTauri(): void {
      this.subs.add(listen<{ x: number; y: number; inside: boolean; gx: number; gy: number }>("stage://cursor", (e) => {
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
        const hit = this.avatar ? (this.avatar.hitTest(x, y) ?? null) !== null : (this.fallbackHit?.(x, y) ?? false);
        this.applyHover(inside && hit);
        // Eyes follow the cursor anywhere on screen: x/y are window-relative
        // (can be far outside), normalised by half the screen size around her face.
        const dx = (x - window.innerWidth / 2) / (screen.width / 2);
        const dy = (y - window.innerHeight * 0.3) / (screen.height / 2);
        this.avatar?.lookAt(clamp(dx * 2, -1, 1), clamp(-dy * 2, -1, 1));
      }));
      this.subs.add(listen<{ pressed: boolean }>("hotkey://ptt", (e) => {
        if (e.payload.pressed) {
          if (this.playback.isPlaying) this.bargeIn("ui");
          void this.voice.pttDown().then(() => this.syncMic());
        } else {
          this.voice.pttUp();
          this.syncMic();
        }
        this.avatar?.setState(e.payload.pressed ? "listening" : "thinking");
        useStage.getState().setState(e.payload.pressed ? "listening" : "thinking");
        if (!e.payload.pressed && !this.core.connected) {
          // Dev: with no core running, releasing PTT plays the mock turn.
          setTimeout(() => this.playMock(), 300);
        }
      }));
      this.subs.add(listen<boolean>("hotkey://mute", (e) => void this.voice.setMuted(e.payload).then(() => this.syncMic())));
      this.subs.add(listen<boolean>("stage://visible", (e) => this.setVisible(e.payload)));
      this.subs.add(listen<{ text: string }>("chat://send", (e) => void this.sendText(e.payload.text)));
      this.subs.add(listen("chat://hello", () => void emitTo("chat", "chat://history", this.chatLog)));
      this.subs.add(listen("hotkey://panic", () => {
        this.bargeIn("ui");
        this.core.send("tool.confirm", { callId: "*", approved: false, via: "click" });
      }));
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
      a.setState("speaking");
      useStage.getState().setState("speaking");
    } else if (this.speechStreamEnded && this.captionSeq >= 0 && !this.playback.isPlaying && t >= (this.playback.scheduled.at(-1)?.ctxEnd ?? t)) {
      this.resetSpeechAnimation();
      if (useStage.getState().state === "speaking") {
        a.setState("idle");
        useStage.getState().setState("idle");
      }
      setTimeout(() => !this.playback.isPlaying && useStage.getState().setCaption(""), 2500);
    }
    // Loudness of what is heard at t (latency-aligned), for jaw scaling.
    const rms = playing ? this.playback.energyAt(t) : 0;
    let fallback;
    if (playing && !this.lipsync.hasPending) {
      this.playback.analyser.getFloatFrequencyData(this.freq);
      fallback = visemesFromSpectrum(this.freq, this.playback.ctx.sampleRate, rms);
    }
    const vis = this.lipsync.sample(t, dt, Math.min(1, rms * 5), fallback);
    a.setVisemes(vis);
    this.onFrame?.(now, visemesToLive2D(vis).open);
    if (this.frames % 6 === 0 && useStage.getState().debug) {
      useStage.getState().setAudio({ ctx: this.playback.ctx.state, mouth: Math.round(visemesToLive2D(vis).open * 100) / 100 });
    }

    this.animateSpeech(a, playing?.seq, playing?.ctxEnd, t, now);
    const signatures = this.character?.signatureMotions;
    if (signatures?.length && now >= this.nextSignatureMotion && !playing && !this.playback.isPlaying &&
        useStage.getState().state === "idle" && !a.isBusy?.()) {
      a.playMotion(signatures[this.signatureMotionIndex++ % signatures.length]);
      this.nextSignatureMotion = now + 35000;
    }
    a.update(dt);
  };

  private animateSpeech(avatar: AvatarController, seq: number | undefined, chunkEnd: number | undefined, time: number, now: number): void {
    const speech = this.character?.speech;
    if (seq !== undefined) {
      // Chunks arrive ahead of playback. Apply only the most recent cue for audio we can hear.
      let latest: AvatarEmotion | undefined;
      for (const [key, emotion] of this.emotions) {
        if (key > seq) continue;
        if (key >= this.lastEmotionSeq) {
          this.lastEmotionSeq = key;
          latest = emotion;
        }
        this.emotions.delete(key);
      }
      if (latest) {
        this.applyEmotion(latest);
      } else if (!this.speechEmotion && speech) {
        this.applyEmotion({ name: speech.defaultEmotion, intensity: 0.65 });
      }
    }

    let explicitSoon = false;
    this.gestures = this.gestures.filter((gesture) => {
      const start = gesture.seq === undefined ? undefined : this.chunkStart.get(gesture.seq);
      const remaining = gesture.seq === undefined ? (gesture.receivedAt + gesture.atMs - now) / 1000
        : start === undefined ? Infinity : start + gesture.atMs / 1000 - time;
      if (remaining <= 0) {
        avatar.playMotion(gesture.tag, { interrupt: true });
        this.nextSpeechMotion = time + (speech?.intervalMs ?? 0) / 1000;
      }
      if (remaining <= 0.4) explicitSoon = true;
      return remaining > 0;
    });

    if (!speech || seq === undefined || !chunkEnd || chunkEnd - time < 0.2 ||
        explicitSoon || time < this.nextSpeechMotion || avatar.isBusy?.()) return;
    const motions = speech.emotionMotions[this.speechEmotion ?? speech.defaultEmotion] ?? speech.motions;
    if (!motions.length) return;
    avatar.playMotion(motions[this.speechMotionIndex++ % motions.length]);
    this.nextSpeechMotion = time + speech.intervalMs / 1000;
  }

  tap(x: number, y: number): void {
    const area = this.avatar?.hitTest(x, y);
    if (area) this.avatar?.react({ kind: "click", area });
  }

  async startDrag(): Promise<void> {
    if (inTauri) await getCurrentWindow().startDragging();
  }

  destroy(): void {
    this.voice.destroy();
    cancelAnimationFrame(this.raf);
    this.subs.dispose();
    this.core.close();
    this.avatar?.destroy();
  }
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Tiny persisted prefs (per-viewer conveniences; Settings UI arrives in M4). */
function loadPref(key: string, fallback: string): string {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}
function savePref(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage unavailable: setting lasts for this session only */
  }
}

/** Transcript line for the chat window. `append`: streamed token to add to her current line. */
export interface ChatEvent {
  kind: "user" | "her" | "system" | "end";
  text: string;
  turnId?: string;
  via?: "voice" | "text";
  append?: boolean;
}
