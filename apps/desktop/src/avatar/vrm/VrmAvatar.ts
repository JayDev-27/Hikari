import { Box3, DirectionalLight, Object3D, PerspectiveCamera, Scene, Vector3, WebGLRenderer } from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { VRMLoaderPlugin, VRMUtils, type VRM, type VRMHumanBoneName } from "@pixiv/three-vrm";
import type { Emotion, GestureTag } from "@hikari/protocol";
import type { CharacterPack } from "../characters";
import type { AvatarController, AvatarEvent, AvatarState, Visemes } from "../types";
import { ZERO_VISEMES } from "../types";
import { GESTURES, PoseSpring, envelope, idlePose, resolveGesture, type Gesture } from "./gestures";
import { EMOTION_EXPRESSIONS, REST, VISEME_KEYS, addPoses, clampPose, emotionToVrm, poseToBones, toVrm0Frame, visemeWeights, type Pose } from "./pose";
import { LayerAnimator, type LayerFrame } from "../layers/animator";
import { vrmOffsets } from "../layers/mapping";
import { loadTuning } from "../layers/tuning";

/**
 * Renderer for VRM 0.x and 1.0 models (three.js + @pixiv/three-vrm). Same contract as the Live2D and Iki
 * renderers: transparent canvas, the stage loop calls `update(dt)` (it owns the frame rate tiers, so there is no
 * rAF here), visemes drive the aa/ih/ou/ee/oh expressions, `lookAt` turns eyes and head, and gestures are humanoid
 * bone rotations (gestures.ts / pose.ts) on three-vrm's *normalized* bones, which are the same for VRM 0 and 1.
 *
 * VRM 0.x models face −Z; `VRMUtils.rotateVRM0` turns them to face +Z like VRM 1.0, and three-vrm maps their
 * expression presets (a/i/u/e/o, joy, sorrow, fun, blink_l…) onto the VRM 1.0 names, so nothing else here branches
 * on the version.
 *
 * The four layers (layers/animator.ts): (1) life — idlePose breathing/sway on the animator's breath phase and
 * tempo, its blinks and saccades, weight shift; (2) the state posture (layers/mapping.ts vrmOffsets) added outside
 * the gesture spring; (3) gestures through the spring, ducking the posture; (4) the face — decaying emotion weights
 * on the VRM expressions, visemes, and the gaze (cursor, state gaze, look-aways) on eyes and head.
 */

/** Degrees the eyes/head may turn for a full-scale (±1) look target. */
const LOOK_YAW = 32, LOOK_PITCH = 20;
/** Share of the look the head takes (the eyes do the rest). */
const HEAD_SHARE = 0.38;

export class VrmAvatar implements AvatarController {
  readonly renderer = "vrm" as const;
  readonly layers: LayerAnimator;
  onHitChange?: (hit: string | null) => void;
  onDestroy?: () => void;

  private renderer3!: WebGLRenderer;
  private scene = new Scene();
  private camera = new PerspectiveCamera(22, 1, 0.05, 50);
  private vrm!: VRM;
  /** VRM 0.x: normalized bones keep the model's original −Z-facing frame inside the rotated scene. */
  private vrm0 = false;
  private lookTarget = new Object3D();
  private bones = new Map<string, Object3D>();
  private expressions = new Set<string>();
  /** Model landmarks at rest (world, metres), measured once so gestures never change the framing. */
  private frame0 = { top: 1.6, hips: 0.9, headY: 1.45, headZ: 0, neckY: 1.35, span: 0.3 };
  private camDist = 2;

  private state: AvatarState = "idle";
  private visemes: Visemes = { ...ZERO_VISEMES };
  private look = { x: 0, y: 0 };
  private emotion: Record<string, number> = {};
  private exprNow = new Map<string, number>();
  private gesture: { name: string; g: Gesture; start: number; dur: number; scale: number } | null = null;
  private spring = new PoseSpring(9);
  private lastTarget: Pose = {};
  private clock = 0;
  private pendingHit: { x: number; y: number } | null = null;
  private lastHit: string | null = null;
  private pixel = new Uint8Array(4);
  private destroyed = false;

  private constructor(private host: HTMLElement, private pack: CharacterPack) {
    this.layers = new LayerAnimator({ tuning: loadTuning(pack.id), ownBlink: true });
  }

  static async create(host: HTMLElement, pack: CharacterPack): Promise<VrmAvatar> {
    const a = new VrmAvatar(host, pack);
    const r = new WebGLRenderer({ alpha: true, antialias: true, premultipliedAlpha: true, powerPreference: "low-power" });
    a.renderer3 = r;
    r.setClearColor(0x000000, 0);
    r.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    r.domElement.style.cssText = "position:absolute;inset:0;width:100%;height:100%;display:block";
    r.domElement.setAttribute("aria-label", pack.displayName);
    host.prepend(r.domElement);
    try {
      const loader = new GLTFLoader();
      loader.register((parser) => new VRMLoaderPlugin(parser));
      const gltf = await loader.loadAsync(pack.modelUrl!);
      const vrm = gltf.userData.vrm as VRM | undefined;
      if (!vrm) throw new Error("not a VRM file (no VRM / VRMC_vrm extension)");
      if (a.destroyed) {
        VRMUtils.deepDispose(gltf.scene);
        throw new Error("avatar destroyed while loading");
      }
      VRMUtils.removeUnnecessaryVertices(gltf.scene);
      VRMUtils.combineSkeletons(gltf.scene);
      VRMUtils.rotateVRM0(vrm);
      // Skinned meshes keep their bind-pose bounds; a raised arm must not be culled.
      vrm.scene.traverse((o) => { o.frustumCulled = false; });
      a.vrm0 = vrm.meta?.metaVersion === "0";
      a.vrm = vrm;
      a.setup();
      a.resize();
      return a;
    } catch (error) {
      r.dispose();
      r.forceContextLoss();
      r.domElement.remove();
      throw error;
    }
  }

  private setup(): void {
    const vrm = this.vrm;
    const light = new DirectionalLight(0xffffff, Math.PI);
    light.position.set(0.6, 1.2, 1.6).normalize();
    this.scene.add(light, vrm.scene, this.lookTarget);
    for (const name of [
      "spine", "chest", "neck", "head", "leftShoulder", "rightShoulder", "leftUpperArm", "rightUpperArm",
      "leftLowerArm", "rightLowerArm", "leftHand", "rightHand",
      ...["left", "right"].flatMap((s) => ["Index", "Middle", "Ring", "Little"].flatMap((f) =>
        ["Proximal", "Intermediate", "Distal"].map((j) => `${s}${f}${j}`))),
    ]) {
      const node = vrm.humanoid.getNormalizedBoneNode(name as VRMHumanBoneName);
      if (node) this.bones.set(name, node);
    }
    for (const name of Object.keys(vrm.expressionManager?.expressionMap ?? {})) this.expressions.add(name);
    if (vrm.lookAt) vrm.lookAt.target = this.lookTarget;
    // Measure at rest (arms down), then settle spring bones (hair, skirt) there instead of in the T-pose.
    this.applyPose(REST);
    vrm.update(0);
    vrm.scene.updateMatrixWorld(true);
    const at = (b: VRMHumanBoneName) => vrm.humanoid.getNormalizedBoneNode(b)?.getWorldPosition(new Vector3());
    const head = at("head") ?? new Vector3(0, 1.4, 0);
    const neck = at("neck") ?? head.clone().setY(head.y - 0.08);
    const hips = at("hips") ?? new Vector3(0, head.y * 0.6, 0);
    const l = at("leftUpperArm"), rr = at("rightUpperArm");
    const box = new Box3().setFromObject(vrm.scene);
    const headSize = Math.max(0.12, head.y - neck.y) * 3.2;
    this.frame0 = {
      top: Math.min(box.max.y, head.y + headSize),
      hips: hips.y,
      headY: head.y,
      headZ: head.z,
      neckY: neck.y,
      span: l && rr ? l.distanceTo(rr) : 0.3,
    };
    vrm.springBoneManager?.reset();
  }

  /** Waist-up framing, face near the top third; fits height or width, whichever is tighter. */
  private applyView(): void {
    const { top, hips, headZ, span } = this.frame0;
    const W = Math.max(1, this.host.clientWidth), H = Math.max(1, this.host.clientHeight);
    const aspect = W / H;
    const bottom = hips - (top - hips) * 0.06;
    const h = (top - bottom) * 1.06;
    // Room for a wave or a shrug beside the body.
    const w = Math.max(span * 2.8, h * 0.5);
    const zoom = 1 / Math.min(1, this.pack.scale ?? 1);
    const tan = Math.tan((this.camera.fov * Math.PI) / 360);
    this.camDist = Math.max(h / 2 / tan, w / 2 / (tan * aspect)) * zoom;
    const visH = 2 * tan * this.camDist;
    // Head toward the top margin: centre so `top` sits 3 % under the edge.
    const cy = top + visH * 0.03 - visH / 2 + (top - bottom) * 0.03;
    this.camera.aspect = aspect;
    this.camera.position.set(0, cy + 0.03, headZ + this.camDist);
    this.camera.lookAt(0, cy, headZ);
    this.camera.updateProjectionMatrix();
  }

  private applyPose(pose: Pose): void {
    for (const [name, q] of poseToBones(pose, (b) => this.bones.has(b))) {
      if (this.vrm0) toVrm0Frame(q);
      this.bones.get(name)?.quaternion.copy(q);
    }
  }

  /** The emotion goes to the face layer, which holds it and decays it; expression weights follow each frame. */
  setExpression(emotion: Emotion, intensity: number): void {
    this.layers.setEmotion(emotion, intensity);
  }

  /** Expression weights for every emotion still showing (a cross-fade blends both). */
  private emotionWeights(): Record<string, number> {
    const out: Record<string, number> = {};
    const th = this.layers.tuning.emotion.threshold * 0.5;
    for (const [name, level] of this.layers.emotion.levels) {
      if (level < th) continue;
      const w = emotionToVrm(name, level, (n) => this.expressions.has(n), this.pack.expressionMap?.[name]);
      for (const [k, v] of Object.entries(w)) out[k] = Math.min(1, (out[k] ?? 0) + v);
    }
    return out;
  }

  playMotion(name: GestureTag | string, opts?: { interrupt?: boolean }): void {
    void opts;
    const resolved = resolveGesture(name, this.pack.motionMap);
    if (!resolved) return;
    const now = this.clock;
    // A burst of identical cues doesn't restart a gesture already in progress.
    if (this.gesture?.name === resolved && now - this.gesture.start < this.gesture.dur) return;
    const g = GESTURES[resolved];
    // A little variation each time, so repeats never look canned (timed gestures keep exact reach). The tuner's
    // speed scales the whole timeline, its intensity the free gestures' amplitude.
    const tg = this.layers.tuning.gesture;
    const dur = g.dur * (0.93 + Math.random() * 0.14) / Math.max(0.2, tg.speed);
    this.gesture = { name: resolved, g, start: now, dur, scale: g.timed ? 1 : (0.92 + Math.random() * 0.12) * tg.intensity };
  }

  lookAt(x: number, y: number): void {
    const k = this.pack.gazeScale ?? 1;
    this.layers.lookAt(x * k, y * k);
  }

  setVisemes(weights: Visemes): void {
    this.visemes = weights;
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
    if (this.gesture && this.clock - this.gesture.start < this.gesture.dur) return;
    if (event.area === "head") this.layers.blink();
    this.playMotion(event.area === "head" ? "head_pat_react" : "wave");
  }

  isBusy(): boolean {
    const gesturing = !!this.gesture && this.clock - this.gesture.start < this.gesture.dur;
    const goal = this.layers.frame?.gaze ?? this.look;
    const eyes = Math.abs(this.look.x - goal.x) + Math.abs(this.look.y - goal.y) > 0.02;
    return gesturing || eyes || !this.spring.settled(this.lastTarget);
  }

  hitTest(x: number, y: number): string | null {
    this.pendingHit = { x, y };
    return this.lastHit;
  }

  update(dt: number): void {
    if (this.destroyed) return;
    dt = Math.max(0, Math.min(0.1, dt));
    this.clock += dt;
    const t = this.clock;
    const gesturing = !!this.gesture && t - this.gesture.start < this.gesture.dur;
    const f = this.layers.update(dt, { gesturing });
    this.emotion = this.emotionWeights();

    // Gaze (cursor, state gaze, look-aways, saccades): eyes lead (fast), the head follows part of the way (slower).
    const lookRate = 1 - Math.exp(-dt / (this.state === "sleeping" ? 0.6 : 0.1));
    this.look.x += (f.gaze.x - this.look.x) * lookRate;
    this.look.y += (f.gaze.y - this.look.y) * lookRate;

    // Gesture.
    let gesturePose: Pose = {};
    const gestureExpr: Record<string, number> = {};
    let face: { aa?: number; eyes?: number } = {};
    let timed = false;
    if (this.gesture) {
      const u = (t - this.gesture.start) / this.gesture.dur;
      if (u >= 1) this.gesture = null;
      else {
        const { g, scale } = this.gesture;
        timed = !!g.timed;
        gesturePose = g.pose(u);
        if (scale !== 1) for (const k of Object.keys(gesturePose)) gesturePose[k] *= scale;
        const e = envelope(u, 0.18, 0.25);
        for (const [n, w] of Object.entries(g.expression ?? {})) gestureExpr[n] = w * e;
        face = g.face?.(u) ?? {};
      }
    }

    const headLook: Pose = { headY: this.look.x * LOOK_YAW * HEAD_SHARE, headX: -this.look.y * LOOK_PITCH * HEAD_SHARE };
    // The gesture goes through the spring, so a cut-short gesture eases into the next one. The state posture is
    // already smooth (it cross-fades on springs in the animator) and ducks under a gesture.
    const target = gesturePose;
    this.lastTarget = target;
    const body = this.spring.step(target, dt, timed ? 26 : 9);
    const mouth = Math.min(1, this.visemes.aa + this.visemes.oh * 0.8 + this.visemes.ee * 0.5 + this.visemes.ih * 0.4 + this.visemes.ou * 0.4);
    const talk = this.state === "speaking" ? 0.5 + 0.5 * mouth : 0;
    const life = idlePose(f.lifeTime, talk, { breath: 2 * f.breath - 1, depth: f.breathDepth, sway: f.sway });
    const posture = vrmOffsets(f);
    posture.spineZ += 1.6 * f.weightShift;
    posture.chestZ = -0.7 * f.weightShift;
    const pose = clampPose(addPoses(REST, life, posture, headLook, body));
    this.applyPose(pose);

    // Eyes: the look target sits in front of the face at the camera's distance, so (0, 0) is eye contact.
    const d = this.camDist;
    const head = this.bones.get("head");
    const origin = head ? head.getWorldPosition(new Vector3()) : new Vector3(0, this.frame0.headY, 0);
    this.lookTarget.position.set(
      origin.x + Math.tan((this.look.x * LOOK_YAW * Math.PI) / 180) * d,
      origin.y + Math.tan((this.look.y * LOOK_PITCH * Math.PI) / 180) * d + (this.camera.position.y - origin.y),
      origin.z + d,
    );

    this.updateExpressions(dt, gestureExpr, face, f);
    this.vrm.update(dt);
    this.renderer3.render(this.scene, this.camera);
    if (this.pendingHit) this.readHit();
  }

  private updateExpressions(dt: number, gestureExpr: Record<string, number>, face: { aa?: number; eyes?: number }, f: LayerFrame): void {
    const em = this.vrm.expressionManager;
    if (!em) return;
    const rate = 1 - Math.exp(-dt / 0.15);
    const has = (n: string) => this.expressions.has(n);
    for (const name of EMOTION_EXPRESSIONS) {
      if (!has(name)) continue;
      const goal = Math.min(1, Math.max(this.emotion[name] ?? 0, gestureExpr[name] ?? 0));
      const cur = this.exprNow.get(name) ?? 0;
      const next = cur + (goal - cur) * rate;
      this.exprNow.set(name, next);
      em.setValue(name, next < 0.002 ? 0 : next);
    }
    // A custom expression named by the pack's expressionMap.
    for (const [name, w] of Object.entries(this.emotion)) {
      if ((EMOTION_EXPRESSIONS as readonly string[]).includes(name) || VISEME_KEYS.includes(name as never)) continue;
      if (has(name)) em.setValue(name, w);
    }

    // Lip sync (+ the open mouth of a laugh). A smile morph adds to the mouth shapes, so they are scaled down under it.
    const smile = Math.max(this.exprNow.get("happy") ?? 0, this.exprNow.get("relaxed") ?? 0);
    const gain = this.layers.tuning.face.mouthGain;
    const vis = gain === 1 ? this.visemes : { aa: this.visemes.aa * gain, ih: this.visemes.ih * gain, ou: this.visemes.ou * gain, ee: this.visemes.ee * gain, oh: this.visemes.oh * gain };
    const v = visemeWeights(vis, face.aa ?? 0, smile, this.emotion.oh ?? 0);
    for (const k of VISEME_KEYS) if (has(k)) em.setValue(k, v[k]);

    // Lids: the life layer's blinks (varied, double, on gaze shifts) ∪ state (asleep) ∪ emotion ∪ the gesture's.
    const eyes = Math.max(f.eyeClose, Math.min(1, face.eyes ?? 0));
    if (has("blink")) em.setValue("blink", Math.min(1, eyes));
  }

  private readHit(): void {
    const { x, y } = this.pendingHit!;
    this.pendingHit = null;
    const canvas = this.renderer3.domElement;
    const gl = this.renderer3.getContext();
    const rect = canvas.getBoundingClientRect();
    const sx0 = (x - rect.left) * (canvas.width / Math.max(1, rect.width));
    const sy0 = canvas.height - (y - rect.top) * (canvas.height / Math.max(1, rect.height));
    let hit = false;
    for (const [dx, dy] of [[0, 0], [3, 0], [-3, 0], [0, 3], [0, -3]]) {
      const sx = Math.floor(sx0 + dx), sy = Math.floor(sy0 + dy);
      if (sx < 0 || sy < 0 || sx >= canvas.width || sy >= canvas.height) continue;
      gl.readPixels(sx, sy, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, this.pixel);
      if (this.pixel[3] > 24) { hit = true; break; }
    }
    let area: string | null = null;
    if (hit) {
      // Above the neck (projected) counts as the head.
      const neck = new Vector3(0, this.frame0.neckY, this.frame0.headZ).project(this.camera);
      const neckY = rect.top + (1 - (neck.y + 1) / 2) * rect.height;
      area = y < neckY ? "head" : "body";
    }
    if (area !== this.lastHit) {
      this.lastHit = area;
      this.onHitChange?.(area);
    }
  }

  resize(): void {
    if (this.destroyed || !this.vrm) return;
    const W = Math.max(1, this.host.clientWidth), H = Math.max(1, this.host.clientHeight);
    this.renderer3.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer3.setSize(W, H, false);
    this.applyView();
    this.renderer3.render(this.scene, this.camera);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.onDestroy?.();
    if (this.vrm) {
      this.scene.remove(this.vrm.scene);
      VRMUtils.deepDispose(this.vrm.scene);
    }
    this.renderer3.renderLists.dispose();
    this.renderer3.dispose();
    this.renderer3.forceContextLoss();
    this.renderer3.domElement.remove();
  }
}
