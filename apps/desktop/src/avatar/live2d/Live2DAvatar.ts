import { Application, extensions } from "pixi.js";
import { Live2DModel, Live2DPlugin, MotionPriority } from "untitled-pixi-live2d-engine/cubism";
import type { Emotion } from "@hikari/protocol";
import type { AvatarController, AvatarEvent, AvatarState, Visemes } from "../types";
import { ZERO_VISEMES } from "../types";
import { visemesToLive2D } from "../../lipsync/engine";
import type { CharacterPack } from "../characters";

let pluginAdded = false;

/** Minimal shape of the Cubism core model we touch (string ids → indices once). */
interface CoreModel {
  getModel(): { parameters: { ids: string[] } };
  setParameterValueByIndex(i: number, v: number, weight?: number): void;
  addParameterValueByIndex?(i: number, v: number, weight?: number): void;
  getParameterValueByIndex(i: number): number;
}

const EMOTION_FORM: Partial<Record<Emotion, number>> = { joy: 0.45, fun: 0.35, teasing: 0.3, angry: -0.35, sorrow: -0.25 };

/**
 * Live2D renderer (Pixi v8 + untitled-pixi-live2d-engine).
 *
 * Layering (M0 subset of §2.5):
 *  - life: engine's eye-blink + our breathing and micro head sway (Perlin-ish sums of sines)
 *  - look-at: model.focus() with smoothing
 *  - mouth: visemes → ParamMouthOpenY/ParamMouthForm written in `beforeModelUpdate`,
 *    i.e. after motions/expressions so lip sync always wins; emotion biases MouthForm (smile while talking)
 *  - gestures: tag → motion group via the pack's motionMap, parallel to idle
 */
export class Live2DAvatar implements AvatarController {
  readonly renderer = "live2d" as const;
  private app!: Application;
  private model!: Live2DModel;
  private core!: CoreModel;
  private p: Record<string, number> = {};
  private vis: Visemes = { ...ZERO_VISEMES };
  private emotion: Emotion = "neutral";
  private emotionIntensity = 0;
  private state: AvatarState = "idle";
  private t = 0;
  private look = { x: 0, y: 0, tx: 0, ty: 0 };
  private pendingHit: { x: number; y: number } | null = null;
  private lastHit: string | null = null;
  private pixel = new Uint8Array(4);
  private destroyed = false;
  /** Cleanup hook for things the loader attaches (e.g. ResizeObserver). */
  onDestroy?: () => void;

  private constructor(private pack: CharacterPack) {}

  static async create(host: HTMLElement, pack: CharacterPack): Promise<Live2DAvatar> {
    if (!(window as unknown as { Live2DCubismCore?: unknown }).Live2DCubismCore) {
      throw new Error("Live2D Cubism Core is not installed — run `pnpm fetch:assets` (see docs/LICENSES.md)");
    }
    if (!pluginAdded) {
      extensions.add(Live2DPlugin);
      pluginAdded = true;
    }
    const a = new Live2DAvatar(pack);
    a.app = new Application();
    await a.app.init({
      preference: "webgl",
      backgroundAlpha: 0,
      resizeTo: host,
      autoDensity: true,
      resolution: Math.min(2, devicePixelRatio),
      antialias: true,
      autoStart: false, // the StageRuntime drives frames (one clock for audio + visuals)
    });
    host.prepend(a.app.canvas);

    a.model = await Live2DModel.from(pack.modelUrl, { autoHitTest: false, autoFocus: false, autoUpdate: false });
    a.app.stage.addChild(a.model);
    a.core = (a.model.internalModel as unknown as { coreModel: CoreModel }).coreModel;
    const ids = a.core.getModel().parameters.ids;
    ids.forEach((id, i) => (a.p[id] = i));
    a.model.internalModel.on("beforeModelUpdate", () => a.applyParams());
    a.layout();
    a.idle();
    return a;
  }

  private layout(): void {
    const { width, height } = this.app.screen;
    const m = this.model;
    // Fit by height (characters are tall), with the anchor at her feet.
    const s = (height * 0.92 * (this.pack.scale ?? 1)) / m.internalModel.originalHeight;
    m.scale.set(s);
    m.anchor.set(0.5, 1);
    m.position.set(width / 2, height);
  }

  private param(id: string, v: number, w = 1) {
    const i = this.p[id];
    if (i !== undefined) this.core.setParameterValueByIndex(i, v, w);
  }
  private addParam(id: string, v: number) {
    const i = this.p[id];
    if (i === undefined) return;
    this.core.setParameterValueByIndex(i, this.core.getParameterValueByIndex(i) + v);
  }

  /** Runs after motions/expressions each frame, so procedural layers and mouth win. */
  private applyParams(): void {
    const t = this.t;
    // Breathing (slower + deeper when sleepy).
    const sleepy = this.state === "sleeping";
    this.param("ParamBreath", 0.5 + 0.5 * Math.sin(t * (sleepy ? 1.4 : 2.2)));
    // Micro head sway: sum of incommensurate sines ≈ smooth noise. Added on top of motion.
    const sway = sleepy ? 0.4 : 1;
    this.addParam("ParamAngleX", sway * (2.2 * Math.sin(t * 0.61) + 1.1 * Math.sin(t * 1.37)));
    this.addParam("ParamAngleY", sway * (1.4 * Math.sin(t * 0.43 + 1) + 0.6 * Math.sin(t * 1.9)));
    this.addParam("ParamAngleZ", sway * 1.3 * Math.sin(t * 0.29 + 2) + (this.state === "listening" ? 4 : 0));
    this.addParam("ParamBodyAngleX", 1.2 * Math.sin(t * 0.37 + 0.5));
    if (this.state === "thinking") {
      // Gaze aversion while thinking (up-left).
      this.param("ParamEyeBallX", -0.6, 0.7);
      this.param("ParamEyeBallY", 0.5, 0.7);
    }
    // Mouth from visemes (+ emotion: smile while talking when happy, tighter when angry).
    const { open, form } = visemesToLive2D(this.vis);
    const bias = (EMOTION_FORM[this.emotion] ?? 0) * this.emotionIntensity;
    const openK = this.emotion === "angry" ? 0.85 : 1;
    this.param("ParamMouthOpenY", Math.min(1, open * openK));
    this.param("ParamMouthForm", Math.max(-1, Math.min(1, form * 0.7 + bias)));
  }

  setExpression(emotion: Emotion, intensity: number): void {
    this.emotion = emotion;
    this.emotionIntensity = intensity;
    const name = this.pack.expressionMap?.[emotion];
    if (name !== undefined) void this.model.expression(name);
    else if (emotion === "neutral") void this.model.expression();
  }

  playMotion(name: string): void {
    const m = this.pack.motionMap?.[name];
    if (!m) return;
    void this.model.motion(m.group, m.index, MotionPriority.NORMAL);
  }

  lookAt(x: number, y: number): void {
    this.look.tx = x;
    this.look.ty = y;
  }

  setVisemes(w: Visemes): void {
    this.vis = w;
  }

  setState(state: AvatarState): void {
    this.state = state;
  }

  idle(): void {
    const g = this.pack.motionMap?.idle?.group ?? "Idle";
    void this.model.motion(g, undefined, MotionPriority.IDLE);
  }

  react(event: AvatarEvent): void {
    if (event.kind === "click" || event.kind === "poke") {
      const m = this.pack.motionMap?.[`tap_${event.area.toLowerCase()}`] ?? this.pack.motionMap?.tap;
      if (m) void this.model.motion(m.group, m.index, MotionPriority.NORMAL);
    }
  }

  /**
   * Click-through hit test. Registers the point and returns the result of the
   * previous readback (one frame of lag at 30 Hz polling is imperceptible).
   * Exact per-pixel: reads the alpha of the rendered framebuffer right after render.
   */
  hitTest(x: number, y: number): string | null {
    this.pendingHit = { x, y };
    return this.lastHit;
  }

  update(dt: number): void {
    if (this.destroyed) return;
    this.t += dt;
    // Smooth look-at (critically-damped-ish), slower when sleepy.
    const k = 1 - Math.exp(-dt / (this.state === "sleeping" ? 0.8 : 0.18));
    this.look.x += (this.look.tx - this.look.x) * k;
    this.look.y += (this.look.ty - this.look.y) * k;
    const { width, height } = this.app.screen;
    this.model.focus(width / 2 + this.look.x * width, height * 0.3 - this.look.y * height, true);
    this.model.update(dt * 1000);
    this.app.render();
    if (this.pendingHit) this.readHit();
  }

  private readHit(): void {
    const { x, y } = this.pendingHit!;
    this.pendingHit = null;
    const r = this.app.renderer as unknown as { gl?: WebGL2RenderingContext; resolution: number };
    const gl = r.gl;
    if (!gl) return;
    const px = Math.floor(x * r.resolution);
    const py = Math.floor(gl.drawingBufferHeight - y * r.resolution);
    if (px < 0 || py < 0 || px >= gl.drawingBufferWidth || py >= gl.drawingBufferHeight) {
      this.lastHit = null;
      return;
    }
    // Sample a small cross so 1-px gaps (hair strands) don't flicker.
    let hit = false;
    for (const [dx, dy] of [[0, 0], [3, 0], [-3, 0], [0, 3], [0, -3]]) {
      gl.readPixels(px + dx, py + dy, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, this.pixel);
      if (this.pixel[3] > 24) {
        hit = true;
        break;
      }
    }
    if (!hit) {
      this.lastHit = null;
      return;
    }
    const areas = this.model.hitTest(x, y);
    this.lastHit = areas[0] ?? "body";
  }

  /** Pixi's resizeTo already resizes the canvas; we only re-fit the model. */
  resize(): void {
    if (this.destroyed) return;
    this.layout();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.onDestroy?.();
    this.app.destroy(true, { children: true });
  }
}
