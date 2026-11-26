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
import { LayerAnimator, type LayerFrame } from "../layers/animator";
import { cubismOffsets, eyeOpenValue } from "../layers/mapping";
import { loadTuning } from "../layers/tuning";

let pluginAdded = false;


/** Minimal shape of the Cubism core model we touch (string ids → indices once). */
interface CoreModel {
  getModel(): { parameters: { ids: string[] } };
  setParameterValueByIndex(i: number, v: number, weight?: number): void;
  addParameterValueByIndex?(i: number, v: number, weight?: number): void;
  getParameterValueByIndex(i: number): number;
}

/**
 * Live2D renderer (Pixi v8 + untitled-pixi-live2d-engine).
 *
 * The four layers (layers/animator.ts), written in `beforeModelUpdate`, i.e. after motions/expressions:
 *  1. life: our blinks (the engine's auto-blink is switched off so blinks vary and follow gaze shifts), breath,
 *     micro head sway (sums of incommensurate sines) and a slow weight shift;
 *  2. state posture: head/body offsets, lids and brows, cross-faded between states;
 *  3. gestures: tag → motion group via the pack's motionMap (the motion plays under our offsets; the posture
 *     ducks while it runs, and the body settles when it ends);
 *  4. face: the decaying emotion picks the pack's expression and biases MouthForm; visemes →
 *     ParamMouthOpenY/ParamMouthForm, so lip sync always wins; gaze (cursor, state gaze, look-aways, saccades)
 *     through the focus controller, smoothed.
 */
export class Live2DAvatar implements AvatarController {
  readonly renderer = "live2d" as const;
  layers!: LayerAnimator;
  private f?: LayerFrame;
  /** Expression currently applied from the emotion (undefined = none / reset). */
  private expr: string | number | undefined;
  private app!: Application;
  private model!: Live2DModel;
  private core!: CoreModel;
  private p: Record<string, number> = {};
  /** Parameters the model declares for lip sync (its `LipSync` group); the official Mao uses ParamA. */
  private lipIds: string[] = [];
  private vis: Visemes = { ...ZERO_VISEMES };
  private state: AvatarState = "idle";
  private look = { x: 0, y: 0 };
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
      // Blinks come from the life layer when the model has the standard lids (varied timing, blinks on gaze shifts).
      const ownBlink = a.p.ParamEyeLOpen !== undefined && a.p.ParamEyeROpen !== undefined;
      if (ownBlink) (a.model.internalModel as unknown as { eyeBlink?: unknown }).eyeBlink = undefined;
      a.layers = new LayerAnimator({ tuning: loadTuning(pack.id), ownBlink });
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
    if (i === undefined || !Number.isFinite(v)) return;
    this.core.setParameterValueByIndex(i, this.core.getParameterValueByIndex(i) + v);
  }

  private paramMax(id: string): number {
    const i = this.p[id];
    const raw = this.core.getModel().parameters as unknown as { maximumValues: Float32Array };
    return i === undefined ? 1 : raw.maximumValues[i];
  }

  /** Runs after motions/expressions each frame, so procedural layers and mouth win. */
  private applyParams(): void {
    const f = this.f;
    if (!f) return;
    const t = f.lifeTime;
    // Layer 1: breath (slower and deeper asleep, from the posture), micro head sway on top of the motion.
    this.param("ParamBreath", Math.min(1, f.breath * f.breathDepth));
    const sway = f.sway;
    this.addParam("ParamAngleX", sway * (2.2 * Math.sin(t * 0.61) + 1.1 * Math.sin(t * 1.37)));
    this.addParam("ParamAngleY", sway * (1.4 * Math.sin(t * 0.43 + 1) + 0.6 * Math.sin(t * 1.9)));
    this.addParam("ParamAngleZ", sway * 1.3 * Math.sin(t * 0.29 + 2));
    this.addParam("ParamBodyAngleX", sway * 1.2 * Math.sin(t * 0.37 + 0.5) + 1.2 * f.weightShift);
    this.addParam("ParamBodyAngleZ", 2.4 * f.weightShift);
    // Layer 2 posture + settle (and the brows the face layer shares).
    for (const [id, v] of Object.entries(cubismOffsets(f))) this.addParam(id, v);
    // Lids: blink ∪ state ∪ emotion, over whatever the motion wrote.
    for (const id of ["ParamEyeLOpen", "ParamEyeROpen"]) {
      const i = this.p[id];
      if (i !== undefined) this.core.setParameterValueByIndex(i, eyeOpenValue(this.core.getParameterValueByIndex(i), f, this.paramMax(id)));
    }
    // Layer 4 mouth from visemes (+ emotion: smile while talking when happy, tighter when angry).
    const { open, form } = visemesToLive2D(this.vis);
    const angry = this.layers.emotion.levels.get("angry") ?? 0;
    const openK = (1 - 0.15 * angry) * this.layers.tuning.face.mouthGain;
    // Drive whatever the model declares for lip sync, mapped through that parameter's own range.
    for (const id of this.lipIds) this.paramNorm(id, Math.min(1, open * openK));
    // Preserve authored mouth shape on the speech rigs, including between words.
    const authoredForm = this.pack.speech && this.p.ParamMouthForm !== undefined
      ? this.core.getParameterValueByIndex(this.p.ParamMouthForm) * Math.max(0, Math.min(1, f.emotion.weight))
      : f.face.smile * 0.9;
    this.param("ParamMouthForm", Math.max(-1, Math.min(1, form * 0.62 + authoredForm)));
  }

  /** The emotion goes to the face layer, which holds it, decays it and picks the expression each frame. */
  setExpression(emotion: Emotion, intensity: number): void {
    this.layers.setEmotion(emotion, intensity);
  }

  private updateExpression(f: LayerFrame): void {
    const map = this.pack.expressionMap ?? {};
    const th = this.layers.tuning.emotion.threshold;
    const named = map[f.emotion.name];
    const keep = named !== undefined && named === this.expr ? th * 0.7 : th;
    const want = f.emotion.weight >= keep && named !== undefined ? named : map.neutral;
    if (want === this.expr) return;
    this.expr = want;
    if (want !== undefined) void this.model.expression(want);
    else this.model.internalModel.motionManager.expressionManager?.resetExpression();
  }

  playMotion(name: string, { interrupt = false } = {}): void {
    const m = this.pack.motionMap?.[name];
    if (!m) return;
    // A gesture plays once. The sample models mark every motion `Loop: true` (they double as idle loops), which
    // would keep a gesture repeating at its priority forever, so the idle never comes back.
    void this.model.motion(m.group, m.index, interrupt ? MotionPriority.FORCE : MotionPriority.NORMAL, { loop: false });
  }

  lookAt(x: number, y: number): void {
    this.layers.lookAt(x, y);
  }

  setVisemes(w: Visemes): void {
    this.vis = w;
  }

  /** The posture cross-fades in the layer animator; a motion in progress keeps playing over it. */
  setState(state: AvatarState): void {
    this.state = state;
    this.layers.setState(state);
  }

  idle(): void {
    const g = this.pack.motionMap?.idle?.group ?? "Idle";
    void this.model.motion(g, undefined, MotionPriority.IDLE);
  }

  react(event: AvatarEvent): void {
    if (event.kind === "click" || event.kind === "poke") {
      const m = this.pack.motionMap?.[`tap_${event.area.toLowerCase()}`] ?? this.pack.motionMap?.tap;
      if (event.area.toLowerCase() === "head") this.layers.blink();
      if (m) void this.model.motion(m.group, m.index, MotionPriority.NORMAL, { loop: false });
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
    const f = this.f = this.layers.update(dt, { gesturing: this.isBusy() });
    this.updateExpression(f);
    if (f.cue && !this.isBusy()) this.playMotion(f.cue);
    // Smooth look-at toward the face layer's gaze (cursor, state gaze, look-aways, saccades), slower when sleepy.
    const k = 1 - Math.exp(-dt / (this.state === "sleeping" ? 0.8 : 0.12));
    this.look.x += (f.gaze.x - this.look.x) * k;
    this.look.y += (f.gaze.y - this.look.y) * k;
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
