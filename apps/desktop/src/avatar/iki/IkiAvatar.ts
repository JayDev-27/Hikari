import { IkiMotion, IkiPlayer } from "@ikijs/engine";
import { loadIkiModel, StandardParameter, type IkiModel } from "@ikijs/format";
import type { Emotion, GestureTag } from "@hikari/protocol";
import type { CharacterPack } from "../characters";
import type { AvatarController, AvatarEvent, AvatarState, Visemes } from "../types";
import { visemesToLive2D } from "../../lipsync/engine";
import { LayerAnimator, type LayerFrame } from "../layers/animator";
import { cubismOffsets, eyeOpenValue } from "../layers/mapping";
import { loadTuning } from "../layers/tuning";
import { GESTURES, SpringSet, addPoses, applyOffsets, idlePose, limitArmLift, resolveGesture, restoreBases, smoother, type Pose } from "./gestures";

/**
 * Renderer for Iki models (`.iki`, https://github.com/zeikar/iki): rigs made by Iki's
 * auto-rigger from role-separated layers (separate eyes, irises, lashes, brows, nose,
 * folding mouth, front/back/side hair, body and two-joint arms). The engine draws with
 * WebGL2 on its own canvas; Iki's IkiMotion supplies idle life (blink, breath, gaze,
 * hair physics) and plays the model's declared expressions and motions.
 *
 * The stage owns the frame rate (render tiers), so the player's own rAF loop is never
 * started: `update()` advances motion and draws one frame.
 *
 * The four layers (layers/animator.ts) on Iki: (1) base life is IkiMotion's idle (its own blinks, breath, gaze
 * jumps, head drift, hair physics) plus our idle arm life, weight shift, look-aways and blinks on gaze shifts;
 * (2) the state posture adds head/body offsets, a state gaze (via setGazeTarget, so the head follows the eyes),
 * lids, brows and breath tempo; (3) gestures (gestures.ts) go on top through springs, ducking the posture;
 * (4) the face: the decaying emotion picks the rig's expression each frame (a gesture's own expression wins while
 * it plays), plus smile/brow extras, lip sync and the cursor look.
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

// These channels already have authored timing. Spring lag or random
// amplitude can put a prop and the hand at different points in the gesture.
const TIMED_PARAMETERS = new Set([
  "ParamOfferFlower", "ParamOfferReach", "ParamGlassesReach", "ParamGlassesPush", "ParamRizeGhoul", "ParamRizeBook",
  "ParamChengClap", "ParamChengClapDepth",
]);

export class IkiAvatar implements AvatarController {
  readonly renderer = "iki" as const;
  readonly layers: LayerAnimator;
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
  private busyUntil = 0;
  /** A gesture's own expression, shown while it plays (it wins over the emotion's). */
  private gestureExpr: { id: string; until: number } | null = null;
  /** Expression currently asked of IkiMotion (null = none). */
  private expr: string | null = null;
  private gazeHeld = false;
  private gesture: { name: string; pose: (t: number) => Pose; start: number; dur: number; scale: number; timed: boolean } | null = null;
  /** Values our offsets were added to last frame, restored before IkiMotion runs (see gestures.ts). */
  private bases = new Map<string, number>();
  // Elbows follow faster than the shoulder and torso.
  private springs: SpringSet;
  private pendingHit: { x: number; y: number } | null = null;
  private lastHit: string | null = null;
  private pixel = new Uint8Array(4);
  private destroyed = false;

  private constructor(private pack: CharacterPack) {
    // IkiMotion blinks on its own; the animator adds only event blinks (gaze shifts, waking).
    this.layers = new LayerAnimator({ tuning: loadTuning(pack.id), ownBlink: false });
    this.springs = new SpringSet(8.5, { ParamElbowL: 20, ParamElbowR: 20 }, Math.max(0.65, Math.min(1, pack.springDamping ?? 1)));
  }

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

  /** The emotion goes to the face layer, which holds it, decays it and picks the expression each frame. */
  setExpression(emotion: Emotion, intensity: number): void {
    this.layers.setEmotion(emotion, intensity);
  }

  private emotionExpression(emotion: Emotion): string | undefined {
    return (this.pack.expressionMap?.[emotion] as string | undefined) ?? EMOTION_TO_EXPRESSION[emotion];
  }

  /** The expression the face should show now: a playing gesture's own, else the (decaying) emotion's. */
  private updateExpression(f: LayerFrame, now: number): void {
    let want: string | null = null;
    if (this.gestureExpr && now < this.gestureExpr.until) want = this.gestureExpr.id;
    else {
      this.gestureExpr = null;
      const th = this.layers.tuning.emotion.threshold;
      const id = this.emotionExpression(f.emotion.name) ?? null;
      // Hysteresis: an expression already showing stays until the emotion has faded a bit further.
      const keep = id !== null && id === this.expr ? th * 0.7 : th;
      if (id && f.emotion.weight >= keep) want = id;
    }
    if (want === this.expr) return;
    if (want && this.motion.playExpression(want)) this.expr = want;
    else {
      if (this.expr) this.motion.stopExpression();
      this.expr = null;
    }
  }

  playMotion(name: GestureTag | string, opts?: { interrupt?: boolean }): void {
    void opts;
    const now = performance.now();
    // Give the signature time to return its arm, props and expression to rest.
    if (this.gesture?.name.startsWith("signature-") && now - this.gesture.start < this.gesture.dur * 0.9) return;
    const mapped = this.pack.motionMap?.[name];
    if (mapped && this.motion.playMotion(mapped.group, mapped.index ?? 0)) {
      this.busyUntil = performance.now() + 2500;
      return;
    }
    const range = (id: string) => this.model.parameters.find((p) => p.id === id);
    const tag = mapped && this.pack.signatureMotions?.includes(mapped.group) ? mapped.group : name;
    const resolved = resolveGesture(tag, range("ParamArmR")?.max ?? 0, range("ParamElbowR")?.min ?? 0, range("ParamElbowR")?.max ?? 0, (id) => this.params.has(id));
    // The generic clap leaves the forearms low, so on a rig without its own clap the hands only cross at the hips;
    // a delighted laugh says the same thing without the broken-looking clap.
    const gname = resolved === "clap" ? "laugh" : resolved;
    const g = GESTURES[gname];
    if (g) {
      // A gesture already in progress is not restarted by a repeat request (a burst of identical cues).
      if (this.gesture?.name === gname && now - this.gesture.start < this.gesture.dur) return;
      // A little variation each time, so repeats never look canned. The tuner's speed scales the whole timeline
      // (timed gestures stay in sync); its intensity scales only the free (non-timed) offsets.
      const tg = this.layers.tuning.gesture;
      const dur = g.dur * 1000 * (0.92 + Math.random() * 0.16) / Math.max(0.2, tg.speed);
      this.gesture = { name: gname, pose: g.pose, start: now, dur, scale: (0.9 + Math.random() * 0.15) * tg.intensity, timed: g.timed ?? false };
      this.busyUntil = now + dur;
      const exprId = g.expression ?? GESTURE_TO_EXPRESSION[name as GestureTag];
      if (exprId) this.gestureExpr = { id: exprId, until: now + dur };
      return;
    }
    const expr = GESTURE_TO_EXPRESSION[name as GestureTag];
    if (expr) {
      this.busyUntil = now + 1800;
      this.gestureExpr = { id: expr, until: now + 1800 };
    }
  }

  lookAt(x: number, y: number): void {
    const k = this.pack.gazeScale ?? 1;
    this.layers.lookAt(x * k, y * k);
  }

  setVisemes(weights: Visemes): void {
    this.mouth = visemesToLive2D(weights);
  }

  /** The posture cross-fades in the layer animator; a gesture in progress keeps playing over it. */
  setState(state: AvatarState): void {
    this.state = state;
    this.layers.setState(state);
  }

  idle(): void {
    this.layers.setEmotion("neutral", 0);
    this.layers.releaseLook();
  }

  react(event: AvatarEvent): void {
    if (event.kind !== "click" && event.kind !== "poke") return;
    // A tap never cuts a running gesture short (a flower offer snapping into a wave looks broken).
    if (this.gesture && performance.now() - this.gesture.start < this.gesture.dur) return;
    const tag = event.area === "head" ? (this.pack.motionMap?.tap_head ? "tap_head" : "nod") : this.pack.motionMap?.tap_body ? "tap_body" : "wave";
    if (event.area === "head") this.layers.blink();
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
    const gesturing = !!this.gesture || now < this.busyUntil || this.motion.activeMotion() !== null;
    const f = this.layers.update(dt, { gesturing });
    // Layer 4 look-at: the cursor, blended with the state's gaze and look-aways. Through IkiMotion's gaze target, so
    // the head follows the eyes; with nothing to hold, IkiMotion's own idle gaze runs.
    if (f.gaze.active) {
      this.motion.setGazeTarget(f.gaze.x, f.gaze.y);
      this.gazeHeld = true;
    } else if (this.gazeHeld) {
      this.motion.clearGazeTarget();
      this.gazeHeld = false;
    }
    this.updateExpression(f, now);
    this.motion.update(now);
    const idleTempo = Math.max(0.25, this.pack.idleTempo ?? 1);
    const idleAmplitude = Math.max(0, Math.min(1, this.pack.idleAmplitude ?? 1));
    // What the app drives goes after the motion update, so it wins.
    let target: Pose = {};
    const timed: Pose = {};
    if (this.gesture) {
      const t = (now - this.gesture.start) / this.gesture.dur;
      if (t >= 1) this.gesture = null;
      else for (const [id, v] of Object.entries(this.gesture.pose(t))) {
        // Keep the raised wave's forearm on its authored arc. Spring lag
        // and amplitude variation can leave that hand out to the side.
        const waveElbow = this.gesture.name === "wave-raised" && id === "ParamElbowR";
        if (waveElbow || this.gesture.timed || TIMED_PARAMETERS.has(id)) timed[id] = v;
        else target[id] = v * this.gesture.scale;
      }
      limitArmLift(target, this.pack.armLiftMax);
    }
    target = this.springs.step(target, dt);
    // Layer 1 weight shift (ParamLegShift, a Hikari addition to the model), faded out as a signature takes weight
    // onto one leg, so the sum stays within the leg warp's range, even on the same side.
    const gestureLeg = target.ParamLegShift ?? 0;
    const idleLeg = this.params.has("ParamLegShift") ? f.weightShift * idleAmplitude * (1 - Math.abs(gestureLeg)) : 0;
    const speaking = this.state === "speaking";
    const life = idlePose(now / 1000 * idleTempo, idleLeg + gestureLeg, speaking, Math.min(1, this.mouth.open * 1.4));
    for (const id of Object.keys(life)) life[id] *= idleAmplitude * Math.min(1.2, f.sway);
    // A timed gesture places the arms exactly (palms that must meet), so idle arm sway fades out under it.
    const clapArms = 1 - smoother(Math.abs(timed.ParamElbowL ?? 0) / 40);
    const guidedRightArm = Math.max(timed.ParamGlassesReach ?? 0, timed.ParamLuStudy ?? 0,
      timed.ParamLuThought ?? 0, timed.ParamLuFoldR ?? 0);
    const rightArmIdle = clapArms * (1 - guidedRightArm);
    const leftArmIdle = clapArms * (1 - (timed.ParamLuFoldL ?? 0));
    life.ParamArmR *= rightArmIdle;
    life.ParamElbowR *= rightArmIdle;
    life.ParamArmL *= leftArmIdle;
    life.ParamElbowL *= leftArmIdle;
    const open = Math.min(1, this.mouth.open * this.layers.tuning.face.mouthGain);
    if (open > 0.01 || speaking) {
      this.player.setParameter(StandardParameter.MouthOpen, Math.min(1, open * 1.1));
      if (this.params.has(StandardParameter.MouthForm)) this.player.setParameter(StandardParameter.MouthForm, this.mouth.form);
    }
    // Layer 2 posture (+ the settle after a gesture) and layer 4 smile, as offsets under the gesture's.
    const posture = cubismOffsets(f);
    posture.ParamMouthForm = 0.35 * f.face.smile;
    applyOffsets(access, addPoses(life, posture, target, timed, { ParamLegShift: idleLeg }), this.bases);
    // Lids: blinks on gaze shifts, state (sleeping shut, working lowered) and emotion, over IkiMotion's own blink.
    if (f.eyeClose > 0.001 || f.eyeWiden > 0.001) {
      for (const id of [StandardParameter.EyeOpenLeft, StandardParameter.EyeOpenRight]) {
        if (this.params.has(id)) this.player.setParameter(id, eyeOpenValue(this.player.getParameter(id), f, 1.2));
      }
    }
    // Slow sleeping breath: IkiMotion breathes at its own tempo, so the posture's breath takes over as it departs.
    const breathK = Math.min(1, Math.abs(f.posture.breathRate - 1) * 3);
    if (breathK > 0.01 && this.params.has(StandardParameter.Breath)) {
      const own = this.player.getParameter(StandardParameter.Breath);
      this.player.setParameter(StandardParameter.Breath, own + (Math.min(1, f.breath * f.breathDepth) - own) * breathK);
    }
    // A state's gesture tendency (thinking: hand to chin) plays only into a pause.
    if (f.cue && !gesturing) this.playMotion(f.cue);
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
