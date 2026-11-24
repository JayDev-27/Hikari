// CSP-safe Pixi: the app's CSP forbids eval/new Function, which Pixi v8 otherwise uses
// to generate shader/uniform sync code. Production builds enforce the CSP (dev didn't).
import "pixi.js/unsafe-eval";
import { Application, Assets, extensions, loadTextures } from "pixi.js";
import { Live2DModel, Live2DPlugin, MotionPriority } from "untitled-pixi-live2d-engine/cubism";
import type { Emotion } from "@hikari/protocol";
import type { AvatarController, AvatarEvent, AvatarState, Visemes } from "../types";
import { ZERO_VISEMES } from "../types";
import { visemesToLive2D } from "../../lipsync/engine";
import type { CharacterPack } from "../characters";

import { installPoseRig, type DrawableModel } from "./poseRig";
import { lipSyncIds } from "./lipSyncIds";

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
  /** Parameters the model declares for lip sync (its `LipSync` group); the official Mao uses ParamA. */
  private lipIds: string[] = [];
  private vis: Visemes = { ...ZERO_VISEMES };
  private emotion: Emotion = "neutral";
  private emotionIntensity = 0;
  private expressionWeight = 1;
  private state: AvatarState = "idle";
  private t = 0;
  private look = { x: 0, y: 0, tx: 0, ty: 0 };
  private pendingHit: { x: number; y: number } | null = null;
  private lastHit: string | null = null;
  private pixel = new Uint8Array(4);
  private destroyed = false;
  /** Cleanup hook for things the loader attaches (e.g. ResizeObserver). */
  onDestroy?: () => void;
  onHitChange?: (hit: string | null) => void;

  private constructor(private pack: CharacterPack) {}

  static async create(host: HTMLElement, pack: CharacterPack): Promise<Live2DAvatar> {
    if (!(window as unknown as { Live2DCubismCore?: unknown }).Live2DCubismCore) {
      throw new Error("Live2D Cubism Core is not installed — run `pnpm fetch:assets` (see docs/LICENSES.md)");
    }
    if (!pluginAdded) {
      extensions.add(Live2DPlugin);
      // Pixi decodes textures in a blob: Worker by default; the production CSP
      // blocks blob workers, so texture loading would hang forever (dev has no CSP).
      // Decode on the main thread instead — a one-off cost at model load.
      if (loadTextures.config) loadTextures.config.preferWorkers = false;
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
    try {
      a.model = await Live2DModel.from(pack.modelUrl!, { autoHitTest: false, autoFocus: false, autoUpdate: false });
      a.app.stage.addChild(a.model);
      a.core = (a.model.internalModel as unknown as { coreModel: CoreModel }).coreModel;
      const ids = a.core.getModel().parameters.ids;
      ids.forEach((id, i) => (a.p[id] = i));
      a.lipIds = lipSyncIds(a.model.internalModel, a.p);
      a.model.internalModel.on("beforeModelUpdate", () => a.applyParams());
      if (pack.poseRig) {
        let textureIndex = -1;
        if (pack.poseRig.grip) {
          const modelUrl = new URL(pack.modelUrl!, window.location.href);
          const texture = await Assets.load({
            src: new URL(pack.poseRig.grip.file, modelUrl).href,
            parser: "texture",
            data: { autoGenerateMipmaps: true },
          });
          textureIndex = a.model.textures.push(texture) - 1;
        }
        const updatePose = installPoseRig(a.core as unknown as DrawableModel, pack.poseRig, textureIndex);
        a.model.internalModel.on("beforeModelUpdate", updatePose);
      }
      a.layout();
      a.idle();
      a.app.canvas.setAttribute("aria-label", pack.displayName);
      host.prepend(a.app.canvas);
      return a;
    } catch (error) {
      a.app.destroy(true, { children: true });
      throw error;
    }
  }

  /** Visible artwork bounds in model-local units (cached; see contentBounds). */
  private bounds?: { x: number; y: number; w: number; h: number };

  /**
   * Bounds of what's actually drawn, in model-local units: the union of every
   * drawable mesh with any opacity, mapped through the model's layout transform.
   * Model canvases aren't centred on the character (Rice is drawn right of
   * centre in a wide canvas), so fitting the canvas clipped her off the window.
   */
  private contentBounds(): { x: number; y: number; w: number; h: number } | null {
    const im = this.model.internalModel as unknown as {
      getDrawableIDs(): string[];
      getDrawableVertices(i: number): Float32Array;
      localTransform: { apply(p: { x: number; y: number }, out?: { x: number; y: number }): { x: number; y: number } };
    };
    const opacity = (this.core as unknown as { getDrawableOpacity?(i: number): number }).getDrawableOpacity;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const pt = { x: 0, y: 0 };
    const n = im.getDrawableIDs().length;
    for (let i = 0; i < n; i++) {
      if (opacity && opacity.call(this.core, i) <= 0.01) continue;
      const v = im.getDrawableVertices(i);
      for (let k = 0; k < v.length; k += 2) {
        im.localTransform.apply({ x: v[k], y: v[k + 1] }, pt);
        if (pt.x < minX) minX = pt.x;
        if (pt.x > maxX) maxX = pt.x;
        if (pt.y < minY) minY = pt.y;
        if (pt.y > maxY) maxY = pt.y;
      }
    }
    if (!isFinite(minX) || maxX - minX < 1 || maxY - minY < 1) return null;
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  }

  /**
   * Fit the visible artwork into the window in both dimensions (margins leave
   * room for idle sway/gestures), centre it horizontally and stand her feet on
   * the bottom edge. Falls back to the canvas size if bounds can't be measured.
   */
  private layout(): void {
    const { width, height } = this.app.screen;
    const m = this.model;
    this.bounds ??= this.contentBounds() ?? {
      x: 0,
      y: 0,
      w: m.internalModel.originalWidth,
      h: m.internalModel.originalHeight,
    };
    const b = this.bounds;
    const marginX = 0.06; // each side
    const marginTop = 0.04;
    const marginBottom = 0.01;
    const s =
      Math.min((width * (1 - 2 * marginX)) / b.w, (height * (1 - marginTop - marginBottom)) / b.h) *
      Math.min(1, this.pack.scale ?? 1);
    m.anchor.set(0, 0);
    m.scale.set(s);
    m.position.set(width / 2 - (b.x + b.w / 2) * s, height * (1 - marginBottom) - (b.y + b.h) * s);
  }

  private param(id: string, v: number, w = 1) {
    const i = this.p[id];
    if (i !== undefined) this.core.setParameterValueByIndex(i, v, w);
  }
  /** Set a parameter from a 0..1 amount, mapped through its own min…max range. */
  private paramNorm(id: string, t: number) {
    const i = this.p[id];
    if (i === undefined) return;
    const raw = this.core.getModel().parameters as unknown as { minimumValues: Float32Array; maximumValues: Float32Array };
    const lo = raw.minimumValues[i], hi = raw.maximumValues[i];
    this.core.setParameterValueByIndex(i, lo + t * (hi - lo));
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
    // Drive whatever the model declares for lip sync, mapped through that parameter's own range.
    for (const id of this.lipIds) this.paramNorm(id, Math.min(1, open * openK));
    // Preserve authored mouth shape on the speech rigs, including between words.
    const authoredForm = this.pack.speech && this.p.ParamMouthForm !== undefined
      ? this.core.getParameterValueByIndex(this.p.ParamMouthForm) * this.expressionWeight
      : bias;
    this.param("ParamMouthForm", Math.max(-1, Math.min(1, form * 0.62 + authoredForm)));
  }

  setExpression(emotion: Emotion, intensity: number): void {
    this.emotion = emotion;
    this.emotionIntensity = intensity;
    this.expressionWeight = Math.max(0, Math.min(1, intensity));
    const name = this.pack.expressionMap?.[emotion];
    if (name !== undefined) void this.model.expression(name);
    else if (emotion === "neutral") this.model.internalModel.motionManager.expressionManager?.resetExpression();
  }

  playMotion(name: string, { interrupt = false } = {}): void {
    const m = this.pack.motionMap?.[name];
    if (!m) return;
    void this.model.motion(m.group, m.index, interrupt ? MotionPriority.FORCE : MotionPriority.NORMAL);
  }

  lookAt(x: number, y: number): void {
    this.look.tx = Math.max(-1, Math.min(1, x));
    this.look.ty = Math.max(-1, Math.min(1, y));
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
  isBusy(): boolean {
    const mm = this.model.internalModel.motionManager as unknown as { state: { currentPriority: number } };
    // Eye-follow is not "busy": the stage decides its rate from cursor proximity,
    // so a far-away moving cursor doesn't force 60 fps while you work elsewhere.
    return mm.state.currentPriority > MotionPriority.IDLE;
  }

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
    // Live2DModel.focus converts positions to a unit direction, which throws away distance
    // and drives full-strength turns even for tiny cursor changes close to the centre.
    const gaze = this.pack.gazeScale ?? 1;
    this.model.internalModel.focusController.focus(this.look.x * gaze, this.look.y * gaze, true);
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
      this.setHit(null);
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
      this.setHit(null);
      return;
    }
    const areas = this.model.hitTest(x, y);
    this.setHit(areas[0] ?? "body");
  }
  private setHit(hit: string | null): void {
    if (hit === this.lastHit) return;
    this.lastHit = hit;
    this.onHitChange?.(hit);
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
