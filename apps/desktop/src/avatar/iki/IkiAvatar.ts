import { IkiMotion, IkiPlayer } from "@ikijs/engine";
import { loadIkiModel, StandardParameter, type IkiModel } from "@ikijs/format";
import type { Emotion, GestureTag } from "@hikari/protocol";
import type { CharacterPack } from "../characters";
import type { AvatarController, AvatarEvent, AvatarState, Visemes } from "../types";
import { visemesToLive2D } from "../../lipsync/engine";
import { GESTURES, SpringSet, addPoses, applyOffsets, idlePose, limitArmLift, resolveGesture, restoreBases, type Pose } from "./gestures";

/**
 * Renderer for Iki models (`.iki`, https://github.com/zeikar/iki): rigs made by Iki's
 * auto-rigger from role-separated layers (separate eyes, irises, lashes, brows, nose,
 * folding mouth, front/back/side hair, body and two-joint arms). The engine draws with
 * WebGL2 on its own canvas; Iki's IkiMotion supplies idle life (blink, breath, gaze,
 * hair physics) and plays the model's declared expressions and motions.
 *
 * The stage owns the frame rate (render tiers), so the player's own rAF loop is never
 * started: `update()` advances motion and draws one frame.
 */

/** Hikari emotion → the default expressions Iki's rig declares. */
const EMOTION_TO_EXPRESSION: Partial<Record<Emotion, string>> = {
  joy: "smile",
  fun: "laugh",
  teasing: "smile",
  angry: "angry",
  sorrow: "sad",
  surprised: "surprised",
  shy: "shy",
};

/** Gesture tags with no Iki motion of their own play an expression instead. */
const GESTURE_TO_EXPRESSION: Partial<Record<GestureTag, string>> = {
  laugh: "laugh",
  shy_look_away: "shy",
  pout: "angry",
  facepalm: "sad",
  head_pat_react: "shy",
  clap: "laugh",
};

export class IkiAvatar implements AvatarController {
  readonly renderer = "iki" as const;
  onHitChange?: (hit: string | null) => void;
  onDestroy?: () => void;

  private canvas!: HTMLCanvasElement;
  private gl!: WebGL2RenderingContext;
  private player!: IkiPlayer;
  private motion!: IkiMotion;
  private model!: IkiModel;
  private params = new Set<string>();
  private state: AvatarState = "idle";
  private mouth = { open: 0, form: 0 };
  private look = { x: 0, y: 0, active: false };
  private busyUntil = 0;
  private gesture: { name: string; pose: (t: number) => Pose; start: number; dur: number; scale: number } | null = null;
  /** Values our offsets were added to last frame, restored before IkiMotion runs (see gestures.ts). */
  private bases = new Map<string, number>();
  // Elbows follow faster: the wave's forearm flicks past horizontal instead of hanging out at her side.
  private springs = new SpringSet(8.5, { ParamElbowL: 20, ParamElbowR: 20 });
  /** Idle weight shift between the legs (ParamLegShift, a Hikari addition to the model): current and target. */
  private leg = { v: 0, target: 0.6, next: 0 };
  private pendingHit: { x: number; y: number } | null = null;
  private lastHit: string | null = null;
  private pixel = new Uint8Array(4);
  private destroyed = false;

  private constructor(private pack: CharacterPack) {}

  static async create(host: HTMLElement, pack: CharacterPack): Promise<IkiAvatar> {
    const a = new IkiAvatar(pack);
    a.canvas = document.createElement("canvas");
    a.canvas.style.cssText = "position:absolute;inset:0;width:100%;height:100%;display:block";
    a.canvas.setAttribute("aria-label", pack.displayName);
    host.prepend(a.canvas);
    try {
      const text = await (await fetch(pack.modelUrl!)).text();
      a.model = loadIkiModel(text);
      a.player = new IkiPlayer(a.canvas);
      const result = await a.player.load(a.model);
      if (result.failedTextures.length) console.warn(`[iki] ${pack.id}: ${result.failedTextures.length} texture(s) failed to load`);
      // Grab the context the player created (same canvas) for hit-test readback.
      a.gl = a.canvas.getContext("webgl2")!;
      for (const p of a.model.parameters) a.params.add(p.id);
      a.motion = new IkiMotion(a.model, (id) => a.player.getParameter(id), (id, v) => a.player.setParameter(id, v));
      a.frame();
      return a;
    } catch (error) {
      a.canvas.remove();
      throw error;
    }
  }

  /** Fit the drawn figure (not the model's whole canvas) into the window, like the Live2D stage. */
  /** Drawn figure at rest, in model units (measured once: a gesture in progress must not change the framing). */
  private bounds?: { x0: number; x1: number; y0: number; y1: number };

  private frame(): void {
    if (this.bounds) return this.applyView();
    this.player.setView();
    this.draw();
    const { width: W, height: H } = this.canvas;
    const px = new Uint8Array(W * H * 4);
    this.gl.readPixels(0, 0, W, H, this.gl.RGBA, this.gl.UNSIGNED_BYTE, px);
    let x0 = W, y0 = H, x1 = -1, y1 = -1;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (px[(y * W + x) * 4 + 3] > 16) {
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
        }
      }
    }
    if (x1 < 0) return;
    // Pixel → model units under the default view (model box fitted, centred; GL rows bottom-up).
    const mw = this.model.canvas.width, mh = this.model.canvas.height;
    const fit = Math.min(W / mw, H / mh);
    const toX = (x: number) => (x - W / 2) / fit, toY = (y: number) => (y - H / 2) / fit;
    this.bounds = { x0: toX(x0), x1: toX(x1 + 1), y0: toY(y0), y1: toY(y1 + 1) };
    this.applyView();
  }

  private applyView(): void {
    const { x0: bx0, x1: bx1, y0: by0, y1: by1 } = this.bounds!;
    const w = bx1 - bx0, h = by1 - by0;
    const scale = 1 / Math.min(1, this.pack.scale ?? 1);
    // Margins as in Live2DAvatar.layout: 6 % per side, 4 % top, 1 % bottom (feet near the window's bottom).
    const vw = (w / (1 - 0.12)) * scale, vh = (h / (1 - 0.05)) * scale;
    this.player.setView({ x: (bx0 + bx1) / 2, y: by0 - vh * 0.01 + vh / 2, width: vw, height: vh });
  }

  private draw(): void {
    (this.player as unknown as { renderFrame(): void }).renderFrame();
  }

  setExpression(emotion: Emotion, intensity: number): void {
    const id = (this.pack.expressionMap?.[emotion] as string | undefined) ?? EMOTION_TO_EXPRESSION[emotion];
    if (!id || intensity < 0.15) {
      this.motion.stopExpression();
      return;
    }
    this.motion.playExpression(id);
  }

  playMotion(name: GestureTag | string, opts?: { interrupt?: boolean }): void {
    void opts;
    const mapped = this.pack.motionMap?.[name];
    if (mapped && this.motion.playMotion(mapped.group, mapped.index ?? 0)) {
      this.busyUntil = performance.now() + 2500;
      return;
    }
    const range = (id: string) => this.model.parameters.find((p) => p.id === id);
    const gname = resolveGesture(name, range("ParamArmR")?.max ?? 0, range("ParamElbowR")?.min ?? 0);
    const g = GESTURES[gname];
    if (g) {
      // A gesture already in progress is not restarted by a repeat request (a burst of identical cues).
      const now = performance.now();
      if (this.gesture?.name === gname && now - this.gesture.start < this.gesture.dur) return;
      // A little variation each time, so repeats never look canned.
      const dur = g.dur * 1000 * (0.92 + Math.random() * 0.16);
      this.gesture = { name: gname, pose: g.pose, start: now, dur, scale: 0.9 + Math.random() * 0.15 };
      this.busyUntil = now + dur;
      const exprId = g.expression ?? GESTURE_TO_EXPRESSION[name as GestureTag];
      if (exprId && this.motion.playExpression(exprId)) window.setTimeout(() => !this.destroyed && this.motion.stopExpression(), g.dur * 1000);
      return;
    }
    const expr = GESTURE_TO_EXPRESSION[name as GestureTag];
    if (expr && this.motion.playExpression(expr)) {
      this.busyUntil = performance.now() + 1800;
      window.setTimeout(() => !this.destroyed && this.motion.stopExpression(), 1800);
    }
  }

  lookAt(x: number, y: number): void {
    const k = this.pack.gazeScale ?? 1;
    this.look = { x: Math.max(-1, Math.min(1, x * k)), y: Math.max(-1, Math.min(1, y * k)), active: true };
    this.motion.setGazeTarget(this.look.x, this.look.y);
  }

  setVisemes(weights: Visemes): void {
    this.mouth = visemesToLive2D(weights);
  }

  setState(state: AvatarState): void {
    this.state = state;
    if (state === "thinking") this.motion.setGazeTarget(0.35, 0.6);
    else if (this.look.active) this.motion.setGazeTarget(this.look.x, this.look.y);
    else this.motion.clearGazeTarget();
  }

  idle(): void {
    this.motion.stopExpression();
    this.motion.clearGazeTarget();
    this.look.active = false;
  }

  react(event: AvatarEvent): void {
    if (event.kind !== "click" && event.kind !== "poke") return;
    // A tap never cuts a running gesture short (a flower offer snapping into a wave looks broken).
    if (this.gesture && performance.now() - this.gesture.start < this.gesture.dur) return;
    const tag = event.area === "head" ? (this.pack.motionMap?.tap_head ? "tap_head" : "nod") : this.pack.motionMap?.tap_body ? "tap_body" : "wave";
    this.playMotion(tag, { interrupt: true });
  }

  isBusy(): boolean {
    return performance.now() < this.busyUntil || this.motion.activeMotion() !== null;
  }

  hitTest(x: number, y: number): string | null {
    this.pendingHit = { x, y };
    return this.lastHit;
  }

  update(dt: number): void {
    if (this.destroyed) return;
    const now = performance.now();
    const access = { get: (id: string) => this.player.getParameter(id), set: (id: string, v: number) => this.player.setParameter(id, v), has: (id: string) => this.params.has(id) };
    restoreBases(access, this.bases);
    this.motion.update(now);
    // What the app drives goes after the motion update, so it wins.
    if (this.params.has("ParamLegShift")) {
      // Shift the weight from one leg to the other every 7–12 s, easing over ~2 s.
      if (now >= this.leg.next) {
        this.leg.target = -Math.sign(this.leg.target || 1) * (0.45 + Math.random() * 0.45);
        this.leg.next = now + 7000 + Math.random() * 5000;
      }
      this.leg.v += (this.leg.target - this.leg.v) * (1 - Math.exp(-dt / 0.9));
    }
    let target: Pose = {};
    if (this.gesture) {
      const t = (now - this.gesture.start) / this.gesture.dur;
      if (t >= 1) this.gesture = null;
      else for (const [id, v] of Object.entries(this.gesture.pose(t))) {
        // The painted offer must fully cover the hanging arm at its peak.
        const varies = id !== "ParamOfferFlower" && id !== "ParamOfferLift" && id !== "ParamOfferReach";
        target[id] = varies ? v * this.gesture.scale : v;
      }
      limitArmLift(target, this.pack.armLiftMax);
    }
    // The gesture already eases the short exchange of the two painted arms.
    const offer = target.ParamOfferFlower;
    delete target.ParamOfferFlower;
    target = this.springs.step(target, dt);
    if (offer !== undefined) target.ParamOfferFlower = offer;
    // Fade out the idle weight shift as a signature takes weight onto one leg.
    // The sum then stays within the leg warp's range, even on the same side.
    const gestureLeg = target.ParamLegShift ?? 0;
    const idleLeg = this.leg.v * (1 - Math.abs(gestureLeg));
    const life = idlePose(now / 1000, idleLeg + gestureLeg, this.state === "speaking", Math.min(1, this.mouth.open * 1.4));
    applyOffsets(access, addPoses(life, target, { ParamLegShift: idleLeg }), this.bases);
    if (this.mouth.open > 0.01 || this.state === "speaking") {
      this.player.setParameter(StandardParameter.MouthOpen, Math.min(1, this.mouth.open * 1.1));
      if (this.params.has(StandardParameter.MouthForm)) this.player.setParameter(StandardParameter.MouthForm, this.mouth.form);
    }
    if (this.state === "sleeping") {
      this.player.setParameter(StandardParameter.EyeOpenLeft, 0.15);
      this.player.setParameter(StandardParameter.EyeOpenRight, 0.15);
    }
    this.draw();
    if (this.pendingHit) this.readHit();
  }

  private readHit(): void {
    const { x, y } = this.pendingHit!;
    this.pendingHit = null;
    const dpr = window.devicePixelRatio || 1;
    const px = Math.floor(x * dpr), py = Math.floor(this.canvas.height - y * dpr);
    let hit = false;
    for (const [dx, dy] of [[0, 0], [3, 0], [-3, 0], [0, 3], [0, -3]]) {
      const sx = px + dx, sy = py + dy;
      if (sx < 0 || sy < 0 || sx >= this.canvas.width || sy >= this.canvas.height) continue;
      this.gl.readPixels(sx, sy, 1, 1, this.gl.RGBA, this.gl.UNSIGNED_BYTE, this.pixel);
      if (this.pixel[3] > 24) {
        hit = true;
        break;
      }
    }
    // Upper fifth of the drawn figure counts as the head (Iki models carry no hit areas).
    const area = hit ? (y < this.canvas.clientHeight * 0.22 ? "head" : "body") : null;
    if (area !== this.lastHit) {
      this.lastHit = area;
      this.onHitChange?.(area);
    }
  }

  resize(): void {
    if (this.destroyed || !this.player) return;
    this.frame();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.onDestroy?.();
    this.player.destroy();
    this.canvas.remove();
  }
}
