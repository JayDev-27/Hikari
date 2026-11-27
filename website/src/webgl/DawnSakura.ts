import * as THREE from 'three';
import { createBlossom, makeRandom } from './bloomGeometry';
import { FluidPass } from './FluidPass';

/**
 * Dawn Sakura: the light-theme hero scene. A periwinkle morning sky with drifting cumulus, one glass-white blossom
 * that opens with the scroll, petals falling through the air, and a finale where the blossom lets go of its petals
 * and the whole sky swirls them past the camera before fading to paper.
 *
 * Driven by two numbers: `progress` (0..1 through the pinned hero) and `after` (0..1 over the rest of the page,
 * which only nudges the clouds and petals).
 */

export interface DawnOptions {
  reducedMotion: boolean;
  compact: boolean;
}

const smooth = THREE.MathUtils.smoothstep;
const mix = THREE.MathUtils.lerp;

const SKY_VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.9999, 1.0); }
`;

const SKY_FRAGMENT = /* glsl */ `
  uniform float uTime;
  uniform float uRise;
  uniform float uWhite;
  uniform float uAspect;
  uniform vec2 uHalo;
  uniform float uHaloSize;
  varying vec2 vUv;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
  }
  float fbm(vec2 p) {
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 6; i++) { v += a * noise(p); p = p * 2.02 + vec2(1.7, 9.2); a *= 0.5; }
    return v;
  }
  float clouds(vec2 p) {
    // Billowy cumulus: domain-warped fbm, thresholded softly.
    vec2 q = vec2(fbm(p + vec2(0.0, uTime * 0.004)), fbm(p + vec2(5.2, 1.3)));
    return fbm(p + 1.6 * q);
  }

  void main() {
    vec2 uv = vUv;
    vec2 p = vec2((uv.x - 0.5) * uAspect, uv.y);

    // Sky gradient in the app icon's colours: periwinkle overhead, lilac-white at the horizon.
    vec3 zenith = vec3(0.600, 0.682, 0.945);
    vec3 mid = vec3(0.808, 0.843, 0.976);
    vec3 horizon = vec3(0.969, 0.949, 0.984);
    float y = uv.y;
    vec3 col = mix(horizon, mid, smoothstep(0.0, 0.55, y));
    col = mix(col, zenith, smoothstep(0.45, 1.1, y));
    // A faint warm breath at the very bottom, like early sun on the horizon.
    col = mix(col, vec3(0.992, 0.93, 0.925), (1.0 - smoothstep(0.0, 0.22, y)) * 0.35);

    // Halo behind the blossom so the white petals separate from the sky.
    vec2 h = vec2((uHalo.x - 0.5) * uAspect, uHalo.y);
    float d = length(p - h) / uHaloSize;
    col = mix(col, vec3(0.70, 0.75, 0.97), exp(-d * d * 1.4) * 0.55);
    col += vec3(1.0) * exp(-d * d * 7.0) * 0.12;

    // Two cloud decks, rising as you scroll (you climb through the sky with the blossom).
    float t = uTime * 0.008;
    vec2 cp = p * vec2(1.25, 2.1) + vec2(t, -uRise * 1.8);
    float c1 = clouds(cp);
    float c2 = clouds(p * vec2(0.8, 1.4) + vec2(t * 0.6 + 3.0, -uRise * 1.1 + 4.0));
    // Keep the middle band clear for type and the flower; clouds gather at the edges and below.
    float edge = smoothstep(0.2, 0.95, abs(uv.x - 0.5) * 2.0) * 0.8 + (1.0 - smoothstep(0.0, 0.42, uv.y)) * 0.9 - smoothstep(0.25, 0.0, abs(uv.x - 0.5)) * smoothstep(0.3, 0.6, uv.y) * 0.5;
    float m1 = smoothstep(0.5 - edge * 0.18, 0.78 - edge * 0.1, c1);
    float m2 = smoothstep(0.52 - edge * 0.2, 0.85, c2) * 0.75;
    // Self-shadowing: sample towards the sun (up-left); denser above means a shaded underside.
    float s1 = clamp(clouds(cp + vec2(-0.05, 0.07)) - c1, -0.2, 0.2) * 2.5;
    vec3 lit = vec3(1.0, 0.995, 1.0);
    vec3 shade = vec3(0.66, 0.70, 0.90);
    vec3 cloud1 = mix(lit, shade, clamp(0.35 + s1, 0.0, 1.0));
    col = mix(col, mix(lit, shade, 0.25), m2 * 0.7);
    col = mix(col, cloud1, m1);

    // Finale: the sky fades to paper.
    col = mix(col, vec3(0.961, 0.965, 0.988), uWhite);

    col += (hash(gl_FragCoord.xy + uTime) - 0.5) / 255.0; // dither against banding
    gl_FragColor = vec4(pow(col, vec3(2.2)), 1.0);
    #include <colorspace_fragment>
  }
`;

/** A soft, bright studio for the physical petals to reflect: periwinkle walls, white softboxes. */
function lightStudio(renderer: THREE.WebGLRenderer) {
  const room = new THREE.Scene();
  room.background = new THREE.Color('#9fb0ea');
  const plane = new THREE.PlaneGeometry(1, 1);
  const boxes: [number[], number[], number[]][] = [
    [[-4, 5, 5], [6, 4], [4.2, 4.3, 4.8]],
    [[4, 1, 3], [3, 5], [2.4, 2.7, 3.6]],
    [[0, -4, 2], [8, 2], [1.6, 1.55, 2.2]],
    [[0, 3, -5], [6, 3], [2.6, 3.0, 4.2]],
  ];
  for (const [pos, scale, c] of boxes) {
    const m = new THREE.Mesh(plane, new THREE.MeshBasicMaterial({ color: new THREE.Color().setRGB(c[0], c[1], c[2]), side: THREE.DoubleSide }));
    m.position.set(pos[0], pos[1], pos[2]);
    m.scale.set(scale[0], scale[1], 1);
    m.lookAt(0, 0, 0);
    room.add(m);
  }
  const pmrem = new THREE.PMREMGenerator(renderer);
  try {
    return pmrem.fromScene(room, 0.04, 0.1, 20);
  } finally {
    plane.dispose();
    room.children.forEach((o) => ((o as THREE.Mesh).material as THREE.Material).dispose());
    pmrem.dispose();
  }
}

/** A single free petal: obovate with the sakura notch, gently cupped. */
function freePetalGeometry() {
  const g = new THREE.PlaneGeometry(1, 1, 8, 10);
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const u = pos.getX(i) * 2; // -1..1 across
    const v = pos.getY(i) + 0.5; // 0..1 base→tip
    const width = 0.34 * Math.pow(Math.sin(Math.PI * Math.min(1, v * 0.86 + 0.06)), 0.8) * (0.45 + 0.55 * smooth(v, 0, 0.5));
    const notch = 0.16 * Math.exp(-((u / 0.18) ** 2)) * smooth(v, 0.7, 1);
    pos.setXYZ(i, u * width, v - notch * v, 0.14 * u * u + 0.08 * v * v);
  }
  g.translate(0, -0.45, 0);
  g.computeVertexNormals();
  return g;
}

const FLUID_LIFETIME = 2.05; // seconds the wake keeps rendering after the last move

interface Drifter {
  x: number; y: number; z: number; speed: number; sway: number; phase: number; size: number;
  axis: THREE.Vector3; spin: number;
}

export class DawnSakura {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private skyScene = new THREE.Scene();
  private fluid: FluidPass | null = null;
  private lastPointer = -Infinity;
  private fluidType: THREE.TextureDataType = THREE.UnsignedByteType;
  private camera = new THREE.PerspectiveCamera(32, 1, 0.1, 80);
  private skyMat: THREE.ShaderMaterial;
  private flower: ReturnType<typeof createBlossom>;
  private petals: THREE.Mesh[] = [];
  private petalHome: { pos: THREE.Vector3; rot: THREE.Euler }[] = [];
  private rest: THREE.Object3D[] = [];
  private drift: THREE.InstancedMesh;
  private drifters: Drifter[] = [];
  private env: THREE.WebGLRenderTarget;
  private progress = 0;
  private after = 0;
  private pointer = new THREE.Vector2();
  private look = new THREE.Vector2();
  private raf = 0;
  private running = false;
  private visible = true;
  private t0 = performance.now();
  private dummy = new THREE.Object3D();
  private width = 1;
  private height = 1;

  constructor(private canvas: HTMLCanvasElement, private opts: DawnOptions) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    // The sky is drawn first, then the blossom over it (or through the pointer wake): clear by hand.
    this.renderer.autoClear = false;
    if (this.renderer.getContext().getExtension('EXT_color_buffer_float')) this.fluidType = THREE.HalfFloatType;

    this.env = lightStudio(this.renderer);
    this.scene.environment = this.env.texture;
    this.scene.environmentIntensity = 0.5;

    // Sky.
    this.skyMat = new THREE.ShaderMaterial({
      vertexShader: SKY_VERTEX,
      fragmentShader: SKY_FRAGMENT,
      uniforms: {
        uTime: { value: 0 }, uRise: { value: 0 }, uWhite: { value: 0 }, uAspect: { value: 1 },
        uHalo: { value: new THREE.Vector2(0.5, 0.5) }, uHaloSize: { value: 0.5 },
      },
      depthWrite: false, depthTest: false, toneMapped: false,
    });
    const sky = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.skyMat);
    sky.frustumCulled = false;
    sky.renderOrder = -1;
    this.skyScene.add(sky);

    // Morning light: warm key from the upper left, cool sky fill, a strong rim from behind.
    const key = new THREE.DirectionalLight('#fff3e6', 2.6);
    key.position.set(-3, 4, 5);
    const fill = new THREE.DirectionalLight('#b8c6ff', 0.9);
    fill.position.set(4, -1, 3);
    const rim = new THREE.DirectionalLight('#dfe6ff', 2.4);
    rim.position.set(1, 2, -4);
    this.scene.add(key, fill, rim, new THREE.HemisphereLight('#eef1ff', '#8f86c4', 0.5));

    // The blossom.
    this.flower = createBlossom(opts.compact);
    this.flower.root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh && mesh.morphTargetInfluences && mesh.parent === this.flower.root) this.petals.push(mesh);
    });
    for (const child of this.flower.root.children) if (!this.petals.includes(child as THREE.Mesh)) this.rest.push(child);
    this.petalHome = this.petals.map((p) => ({ pos: p.position.clone(), rot: p.rotation.clone() }));
    // Lift the petal colour towards the icon: milkier, with periwinkle in the shade.
    const pm = this.flower.petalMaterial;
    pm.color.set('#e4e9ff');
    pm.emissive.set('#5d6fd0');
    pm.emissiveIntensity = 0.07;
    pm.sheenColor.set('#b9c4ff');
    // The calyx, stem and throat were tuned for a night sky; soften them to dusk-periwinkle for the light one.
    for (const r of this.rest) r.traverse((o) => {
      const mat = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
      if (!mat || !('emissive' in mat) || mat === pm) return;
      if (!mat.vertexColors) mat.color.lerp(new THREE.Color('#c4ccf1'), 0.85);
      mat.emissive.set('#a9b5ec');
      mat.emissiveIntensity = mat.vertexColors ? 0.7 : 0.35;
    });
    this.scene.add(this.flower.root);

    // Falling petals.
    const count = opts.compact ? 70 : 170;
    const rand = makeRandom(7731);
    const petalMat = new THREE.MeshStandardMaterial({
      color: '#ffffff', emissive: '#7e8fe6', emissiveIntensity: 0.06, roughness: 0.5, metalness: 0,
      side: THREE.DoubleSide, transparent: true, opacity: 0.95,
    });
    this.drift = new THREE.InstancedMesh(freePetalGeometry(), petalMat, count);
    this.drift.frustumCulled = false;
    for (let i = 0; i < count; i++) {
      this.drifters.push({
        x: (rand() - 0.5) * 22, y: (rand() - 0.5) * 14, z: mix(-14, 5, rand()),
        speed: mix(0.35, 0.8, rand()), sway: mix(0.3, 1.1, rand()), phase: rand() * 6.28, size: mix(0.14, 0.3, rand()),
        axis: new THREE.Vector3(rand() - 0.5, rand() - 0.5, rand() - 0.5).normalize(), spin: mix(0.4, 1.4, rand()),
      });
    }
    const tints = ['#ffffff', '#eef1ff', '#dfe5ff', '#e9e2fb', '#c9d3fb', '#f7eef8'].map((c) => new THREE.Color(c));
    for (let i = 0; i < count; i++) this.drift.setColorAt(i, tints[Math.floor(rand() * tints.length)]);
    this.scene.add(this.drift);

    this.resize();
  }

  setProgress(p: number): void { this.progress = THREE.MathUtils.clamp(p, 0, 1); }
  setAfter(a: number): void { this.after = THREE.MathUtils.clamp(a, 0, 1); }
  setPointer(x: number, y: number): void { this.pointer.set(x, y); }

  /** The pointer wake from the original hero: the scene refracts like water along the cursor's path. */
  movePointer(x01: number, y01: number): void {
    if (this.opts.reducedMotion) return;
    const now = performance.now() / 1000;
    this.fluid ??= new FluidPass(this.width, this.height, this.renderer.getPixelRatio(), this.fluidType, 256, true);
    if (now - this.lastPointer > FLUID_LIFETIME) this.fluid.resetPointer();
    this.fluid.pushPointer(x01, y01);
    this.lastPointer = now;
  }
  setVisible(v: boolean): void {
    this.visible = v;
    if (v && this.running && !this.raf) this.raf = requestAnimationFrame(this.loop);
  }

  resize(): void {
    this.width = this.canvas.clientWidth || window.innerWidth;
    this.height = this.canvas.clientHeight || window.innerHeight;
    const cap = this.opts.compact ? 1.5 : 1.75;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, cap, Math.sqrt(2_600_000 / (this.width * this.height))));
    this.renderer.setSize(this.width, this.height, false);
    this.fluid?.resize(this.width, this.height, this.renderer.getPixelRatio());
    this.camera.aspect = this.width / this.height;
    this.camera.updateProjectionMatrix();
    this.skyMat.uniforms.uAspect.value = this.camera.aspect;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.raf = requestAnimationFrame(this.loop);
  }

  private loop = (now: number) => {
    this.raf = 0;
    if (!this.running || !this.visible) return;
    this.render(now);
    this.raf = requestAnimationFrame(this.loop);
  };

  render(now = performance.now()): void {
    const time = this.opts.reducedMotion ? 4 : (now - this.t0) / 1000;
    const p = this.opts.reducedMotion ? 0.62 : this.progress;
    const narrow = this.camera.aspect < 0.85;

    // Story beats along the pinned hero.
    const settle = smooth(p, 0.04, 0.16);            // intro → centre stage
    const open = smooth(p, 0.12, 0.74);               // bud → full bloom
    const finale = smooth(p, 0.78, 0.98);             // petals let go
    const whiten = smooth(p, 0.86, 1.0);

    this.look.lerp(this.pointer, 0.06);

    // Camera: a slow dolly in while she opens, a step back for the finale.
    const baseZ = narrow ? 19.5 : 14.5;
    this.camera.position.set(this.look.x * 0.35, -this.look.y * 0.25, baseZ - open * 1.6 + finale * 2.5);
    this.camera.lookAt(0, 0, 0);

    // The blossom: starts as a bud in three-quarter profile, turns to face you as it opens.
    const f = this.flower;
    f.open(mix(0.0, 1.0, open), 0);
    const scale = mix(0.62, 1.0, open) * (narrow ? 0.9 : 1);
    f.root.scale.setScalar(scale);
    const introX = narrow ? 0 : 0;
    const introY = narrow ? 1.2 : -0.8;
    const stageY = narrow ? 0.9 : 0.05;
    f.root.position.set(introX, mix(introY, stageY, settle) + Math.sin(time * 0.6) * 0.06, 0);
    f.root.rotation.set(
      -mix(1.05, 0.08, open) + this.look.y * 0.1,
      Math.sin(time * 0.22) * 0.12 + this.look.x * 0.18 + (1 - open) * 0.5,
      -0.2 + open * 0.5 + time * 0.02,
    );

    // Finale: each petal lets go and sails outward, tumbling towards the camera.
    for (let i = 0; i < this.petals.length; i++) {
      const petal = this.petals[i];
      const home = this.petalHome[i];
      const k = smooth(finale, i * 0.06, 0.6 + i * 0.08);
      const a = home.rot.z;
      const out = new THREE.Vector3(-Math.sin(a), Math.cos(a), 0);
      petal.position.copy(home.pos).addScaledVector(out, k * k * 7).add(new THREE.Vector3(0, 0, k * 8.5));
      petal.rotation.set(home.rot.x + k * (2.4 + i * 0.5), home.rot.y + k * 1.7, home.rot.z + k * (i % 2 ? 1.4 : -1.4));
    }
    for (const r of this.rest) r.scale.setScalar(Math.max(0.0001, 1 - smooth(finale, 0.1, 0.55)));
    f.root.visible = finale < 0.999 || this.after < 0.001;

    // Falling petals: a gentle drift, swept into a vortex around the camera during the finale.
    const n = this.drifters.length;
    const settleAfter = smooth(this.after, 0.0, 0.06);
    const swirl = finale * (1 - settleAfter);
    const fallTime = time + this.after * 6;
    for (let i = 0; i < n; i++) {
      const d = this.drifters[i];
      const fall = fallTime * d.speed + d.phase * 3;
      let y = ((d.y - fall + 7) % 14 + 14) % 14 - 7;
      let x = d.x + Math.sin(fallTime * 0.4 * d.sway + d.phase) * 0.9 + fallTime * 0.12;
      x = ((x + 11) % 22 + 22) % 22 - 11;
      let z = d.z;
      if (swirl > 0) {
        const r = Math.hypot(x, y);
        const ang = Math.atan2(y, x) + swirl * swirl * (2.5 + 6 / (1 + r));
        const pull = mix(1, 0.55, swirl);
        x = Math.cos(ang) * r * pull;
        y = Math.sin(ang) * r * pull;
        z = mix(z, 8 + d.phase * 0.6, swirl * swirl);
      }
      this.dummy.position.set(x, y, z);
      this.dummy.quaternion.setFromAxisAngle(d.axis, fallTime * d.spin + d.phase);
      this.dummy.scale.setScalar(d.size * (1 + swirl * 0.6) * mix(1, 0.75, settleAfter));
      this.dummy.updateMatrix();
      this.drift.setMatrixAt(i, this.dummy.matrix);
    }
    this.drift.instanceMatrix.needsUpdate = true;
    (this.drift.material as THREE.MeshStandardMaterial).opacity = mix(0.95, 0.42, settleAfter);

    // Sky.
    const su = this.skyMat.uniforms;
    su.uTime.value = time;
    su.uRise.value = p * 0.9 + this.after * 0.6;
    su.uWhite.value = Math.max(whiten, smooth(this.after, 0.0, 0.08));
    // Halo follows the flower on screen.
    const screen = f.root.position.clone().project(this.camera);
    su.uHalo.value.set(screen.x * 0.5 + 0.5, screen.y * 0.5 + 0.5);
    su.uHaloSize.value = mix(0.32, 0.55, open) * (1 - finale * 0.6);

    const r = this.renderer;
    r.setRenderTarget(null);
    r.setClearColor(0x000000, 1);
    r.clear();
    r.render(this.skyScene, this.camera);
    const wake = this.fluid && (now / 1000 - this.lastPointer < FLUID_LIFETIME) && this.progress < 1;
    if (wake) {
      // Blossom and petals go into the wake's target (transparent), which refracts and tints them over the sky.
      this.fluid!.render(r, (target) => {
        r.setRenderTarget(target);
        r.setClearColor(0x000000, 0);
        r.clear();
        r.render(this.scene, this.camera);
      }, time);
    } else {
      r.render(this.scene, this.camera);
    }
  }

  dispose(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
      else mat?.dispose();
    });
    this.skyScene.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
      (m.material as THREE.Material | undefined)?.dispose();
    });
    this.fluid?.dispose();
    this.env.dispose();
    this.renderer.dispose();
  }
}
