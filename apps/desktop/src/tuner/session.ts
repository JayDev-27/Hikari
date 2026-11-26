import { loadAvatar } from "../avatar/loader";
import type { CharacterPack } from "../avatar/characters";
import { ZERO_VISEMES, type AvatarController, type AvatarState, type Visemes } from "../avatar/types";
import type { LayerFrame } from "../avatar/layers/animator";
import { cloneTuning, saveTuning, type Tuning } from "../avatar/layers/tuning";
import { LipSyncEngine } from "../lipsync/engine";
import { PHRASES, phraseToPhonemes } from "./phrases";

/**
 * The tuner's imperative side (kept out of React render): one avatar, its frame loop, a lip-sync engine on a local
 * clock (test phrases need no audio) and the live tuning it edits. Frames run on rAF, with a timer fallback when
 * rAF is throttled (hidden pane, background tab).
 */
export class TunerSession {
  avatar?: AvatarController;
  readonly lipsync = new LipSyncEngine();
  manual: { on: boolean; v: Visemes } = { on: false, v: { ...ZERO_VISEMES } };
  /** Told when a test phrase ends and the state goes back. */
  onState?: (s: AvatarState) => void;
  private clock = 0;
  private speakingUntil = -1;
  private prevState: AvatarState = "idle";
  private state: AvatarState = "idle";
  private raf = 0;
  private timer = 0;
  private last = 0;
  private lastTick = 0;
  private live = true;

  constructor(private readonly pack: CharacterPack) {}

  get tuning(): Tuning | undefined {
    return this.avatar?.layers?.tuning;
  }

  get frame(): LayerFrame | undefined {
    const f = this.avatar?.layers?.frame;
    return f ? { ...f } : undefined;
  }

  async start(host: HTMLElement): Promise<void> {
    const a = await loadAvatar(host, this.pack);
    if (!this.live) {
      a.destroy();
      return;
    }
    this.avatar = a;
    this.syncLipsync();
    this.last = performance.now();
    const loop = () => {
      this.raf = requestAnimationFrame(loop);
      this.tick();
    };
    this.raf = requestAnimationFrame(loop);
    this.timer = window.setInterval(() => { if (performance.now() - this.lastTick > 60) this.tick(); }, 33);
  }

  private tick(): void {
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    this.lastTick = now;
    this.clock += dt;
    const a = this.avatar;
    if (!a) return;
    const vis = this.manual.on ? this.manual.v : this.lipsync.sample(this.clock, dt, 0.8);
    if (this.speakingUntil > 0 && this.clock > this.speakingUntil) {
      this.speakingUntil = -1;
      this.setState(this.prevState);
      this.onState?.(this.prevState);
    }
    a.setVisemes(vis);
    a.update(dt);
  }

  /** Hold visemes by hand instead of the lip-sync engine. */
  setManual(on: boolean, v: Visemes): void {
    this.manual = { on, v };
  }

  setState(s: AvatarState): void {
    this.state = s;
    this.avatar?.setState(s);
  }

  /** User picked a state: a running test phrase no longer restores the old one. */
  chooseState(s: AvatarState): void {
    this.speakingUntil = -1;
    this.setState(s);
  }

  speak(id: string): void {
    const ph = PHRASES.find((p) => p.id === id);
    if (!ph || !this.avatar) return;
    this.manual.on = false;
    const phonemes = phraseToPhonemes(ph.ipa);
    this.lipsync.clear();
    const start = this.clock + 0.05;
    this.lipsync.addChunk(start, phonemes, ph.language);
    if (this.speakingUntil < 0) this.prevState = this.state;
    this.speakingUntil = start + phonemes.at(-1)!.end / 1000;
    this.setState("speaking");
  }

  /** Set one tuning number by path ("blink.mean", "postures.thinking.headPitch") and persist the overrides. */
  edit(path: string, value: number): void {
    const t = this.tuning;
    if (!t || !Number.isFinite(value)) return;
    const keys = path.split(".");
    let o = t as unknown as Record<string, unknown>;
    for (const k of keys.slice(0, -1)) o = o[k] as Record<string, unknown>;
    o[keys.at(-1)!] = value;
    if (keys[0] === "lipsync") this.syncLipsync();
    saveTuning(this.pack.id, t);
  }

  reset(): void {
    const layers = this.avatar?.layers;
    if (!layers) return;
    layers.tuning = cloneTuning();
    this.syncLipsync();
    saveTuning(this.pack.id, layers.tuning);
  }

  private syncLipsync(): void {
    const t = this.tuning;
    if (!t) return;
    this.lipsync.attack = t.lipsync.attack;
    this.lipsync.release = t.lipsync.release;
  }

  destroy(): void {
    this.live = false;
    cancelAnimationFrame(this.raf);
    clearInterval(this.timer);
    this.avatar?.destroy();
    this.avatar = undefined;
  }
}
