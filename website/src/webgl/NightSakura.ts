import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  CatmullRomCurve3,
  Color,
  DoubleSide,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Points,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  TubeGeometry,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * The night-sakura scene behind the page: one detailed cherry blossom that opens as the hero scrolls, petals falling
 * on a wind field across the dark sections, bokeh and a soft sky. Everything is procedural (no textures, no model
 * files). The petal is a parametric surface: obovate outline with the notched tip of a real sakura petal, cupped
 * across, bowed along its length and lightly ruffled at the rim. Its shader paints the blush at the base, faint
 * radiating veins, periwinkle at the rim (the app icon's blue sakura), light passing through from behind and a paper-fine grain.
 */

export interface SakuraOptions {
  reducedMotion: boolean;
  mobile: boolean;
}

const PETAL_LENGTH = 1;

/** One petal pointing up +Y, facing +Z. u ∈ [-1, 1] across, v ∈ [0, 1] from base to tip. */
function petalGeometry(segU: number, segV: number): BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const W = 0.78;
  for (let j = 0; j <= segV; j++) {
    const v = j / segV;
    // Narrow claw at the base, widest about two-thirds up, still broad at the top so the two lobes stay round.
    const w = W * (0.16 + 0.84 * Math.pow(Math.sin(Math.PI * Math.min(1, v * 0.78 + 0.08)), 0.85));
    for (let i = 0; i <= segU; i++) {
      const u = (i / segU) * 2 - 1;
      // Outline at the top: rounded shoulders and the shallow V notch in the middle.
      const top = PETAL_LENGTH * (1 - 0.34 * Math.pow(Math.abs(u), 3.2) - 0.075 * Math.exp(-Math.pow(u / 0.11, 2)));
      const y = v * top;
      const x = u * w * 0.5;
      // Cupped across, bowed forward along the length, ruffled near the rim.
      const cup = 0.2 * u * u * w;
      const bow = 0.16 * v * v - 0.05 * v;
      const ruffle = 0.007 * Math.sin(u * 6 + v * 3) * Math.pow(Math.abs(u), 2) * v * v;
      pos.push(x, y, cup + bow + ruffle);
      uv.push((u + 1) / 2, v);
    }
  }
  const row = segU + 1;
  for (let j = 0; j < segV; j++) {
    for (let i = 0; i < segU; i++) {
      const a = j * row + i, b = a + 1, c = a + row, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('uv', new BufferAttribute(new Float32Array(uv), 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

const PETAL_VERTEX = /* glsl */ `
  uniform float uTime;
  uniform float uFall;          // 1 for the falling petals: animate on the GPU
  attribute vec4 aSeed;         // falling: x, z start, speed, phase
  attribute vec4 aSpin;         // falling: spin axis xyz, scale
  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vView;
  varying float vFade;

  mat3 axisAngle(vec3 a, float r) {
    a = normalize(a);
    float s = sin(r), c = cos(r), oc = 1.0 - c;
    return mat3(oc*a.x*a.x + c,     oc*a.x*a.y + a.z*s, oc*a.z*a.x - a.y*s,
                oc*a.x*a.y - a.z*s, oc*a.y*a.y + c,     oc*a.y*a.z + a.x*s,
                oc*a.z*a.x + a.y*s, oc*a.y*a.z - a.x*s, oc*a.z*a.z + c);
  }

  void main() {
    vUv = uv;
    vec3 p = position;
    vec3 n = normal;
    vFade = 1.0;
    if (uFall > 0.5) {
      float t = uTime * aSeed.z + aSeed.w * 20.0;
      float range = 9.0;
      // Fall, wrap, drift on a slow wind, flutter around a tumbling axis.
      float y = 4.5 - mod(t * 0.55, range);
      float x = aSeed.x + sin(t * 0.45 + aSeed.w * 6.28) * 0.7 + mod(t * 0.18, 9.0) - 4.5;
      x = mod(x + 4.5, 9.0) - 4.5;
      float z = aSeed.y + cos(t * 0.31 + aSeed.w * 3.1) * 0.35;
      mat3 r = axisAngle(aSpin.xyz, t * 1.7 + aSeed.w * 6.28) * axisAngle(vec3(0.0, 0.0, 1.0), sin(t * 2.3) * 0.6);
      p = r * (p * aSpin.w) + vec3(x, y, z);
      n = r * n;
      vFade = smoothstep(4.6, 3.2, abs(y)) * smoothstep(4.6, 3.6, abs(x));
    }
    mat4 inst = mat4(1.0);
    #ifdef USE_INSTANCING
      inst = instanceMatrix;
    #endif
    vec4 world = modelMatrix * (inst * vec4(p, 1.0));
    vNormal = normalize(mat3(modelMatrix) * mat3(inst) * n);
    vView = normalize(cameraPosition - world.xyz);
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const PETAL_FRAGMENT = /* glsl */ `
  uniform vec3 uLight;
  uniform vec3 uBlush;
  uniform vec3 uBody;
  uniform vec3 uRim;
  uniform float uOpacity;
  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vView;
  varying float vFade;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

  void main() {
    float u = vUv.x * 2.0 - 1.0;
    float v = vUv.y;
    vec3 N = normalize(vNormal) * (gl_FrontFacing ? 1.0 : -1.0);
    vec3 V = normalize(vView);
    vec3 L = normalize(uLight);

    // Colour: blush at the base, porcelain body, lavender drifting in at the rim and the tip.
    vec3 col = mix(uBlush, uBody, smoothstep(0.0, 0.38, v));
    float rim = smoothstep(0.6, 1.0, abs(u)) * smoothstep(0.3, 0.75, v) * 0.55 + smoothstep(0.84, 1.0, v) * 0.3;
    col = mix(col, uRim, rim * 0.5);

    // Veins: fine lines fanning out from the claw, fading toward the tip.
    float fan = u / (0.18 + v * 0.95);
    float vein = 1.0 - smoothstep(0.0, 0.07, abs(fract(fan * 6.0) - 0.5));
    col *= 1.0 - vein * 0.07 * (1.0 - smoothstep(0.35, 0.95, v));

    // Paper-fine grain.
    col *= 0.985 + 0.03 * hash(floor(vUv * vec2(260.0, 380.0)));

    // Wrapped diffuse, light through the petal from behind, and a soft rim sheen.
    float diff = clamp((dot(N, L) + 0.55) / 1.55, 0.0, 1.0);
    float through = pow(clamp(dot(-N, L), 0.0, 1.0), 1.4) * 0.55;
    float fres = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 3.0);
    vec3 lit = col * (0.2 + 0.58 * diff) + uBlush * through * 0.42 + uRim * fres * 0.3;
    // Frosted-glass gloss, like the app icon's petals.
    vec3 H = normalize(L + V);
    lit += vec3(0.85, 0.9, 1.0) * pow(clamp(dot(N, H), 0.0, 1.0), 38.0) * 0.32;
    // A quiet sky bounce on the shadow side keeps it from going grey.
    lit += vec3(0.05, 0.06, 0.16) * (1.0 - diff) * 0.6;

    gl_FragColor = vec4(lit, uOpacity * vFade);
    #include <colorspace_fragment>
  }
`;

const SKY_VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.9999, 1.0); }
`;
const SKY_FRAGMENT = /* glsl */ `
  uniform float uTime;
  uniform float uGlow;
  uniform vec2 uAspect;
  varying vec2 vUv;
  void main() {
    vec2 p = (vUv - 0.5) * uAspect;
    vec3 deep = vec3(0.0012, 0.002, 0.008);
    vec3 indigo = vec3(0.007, 0.01, 0.032);
    float r = length(p - vec2(0.12, 0.04));
    vec3 col = mix(indigo, deep, smoothstep(0.0, 1.05, r));
    // Moonlit glow behind the blossom.
    col += vec3(0.010, 0.014, 0.046) * exp(-r * r * 4.0) * uGlow;
    // A slow aurora band of lavender near the top.
    float band = exp(-pow((vUv.y - 0.82 - sin(vUv.x * 3.0 + uTime * 0.05) * 0.04) * 6.0, 2.0));
    col += vec3(0.03, 0.025, 0.08) * band * 0.2;
    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }
`;

const BOKEH_VERTEX = /* glsl */ `
  uniform float uTime;
  uniform float uPixel;
  attribute float aSize;
  attribute float aPhase;
  varying float vAlpha;
  void main() {
    vec3 p = position;
    p.y += sin(uTime * 0.12 + aPhase) * 0.15;
    p.x += cos(uTime * 0.09 + aPhase * 1.7) * 0.12;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_PointSize = aSize * uPixel / -mv.z;
    vAlpha = 0.25 + 0.35 * (0.5 + 0.5 * sin(uTime * 0.6 + aPhase * 3.0));
    gl_Position = projectionMatrix * mv;
  }
`;
const BOKEH_FRAGMENT = /* glsl */ `
  uniform float uOpacity;
  varying float vAlpha;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    float a = smoothstep(0.5, 0.18, d) * vAlpha * uOpacity;
    gl_FragColor = vec4(vec3(0.5, 0.56, 0.95), a * 0.6);
  }
`;

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export class NightSakura {
  private renderer: WebGLRenderer;
  private composer: EffectComposer;
  private scene = new Scene();
  private camera = new PerspectiveCamera(32, 1, 0.1, 60);
  private blossom = new Group();
  private petals: Group[] = [];
  private heart = new Group();
  private petalMat: ShaderMaterial;
  private fallMat: ShaderMaterial;
  private skyMat: ShaderMaterial;
  private bokehMat: ShaderMaterial;
  private fall: InstancedMesh;
  private raf = 0;
  private t0 = performance.now();
  private progress = 0;
  private petalDensity = 1;
  private pointer = new Vector2();
  private pointerSmooth = new Vector2();
  private disposed = false;
  private visible = true;

  constructor(private canvas: HTMLCanvasElement, private opts: SakuraOptions) {
    this.renderer = new WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, opts.mobile ? 1.4 : 1.75));
    this.camera.position.set(0, 0, 5.2);

    // Sky.
    this.skyMat = new ShaderMaterial({
      vertexShader: SKY_VERTEX,
      fragmentShader: SKY_FRAGMENT,
      uniforms: { uTime: { value: 0 }, uGlow: { value: 1 }, uAspect: { value: new Vector2(1, 1) } },
      depthWrite: false,
      depthTest: false,
    });
    const sky = new Mesh(new PlaneGeometry(2, 2), this.skyMat);
    sky.frustumCulled = false;
    sky.renderOrder = -10;
    this.scene.add(sky);

    // Petal materials.
    const light = new Vector3(-0.35, 0.55, 0.9);
    const colors = {
      uBlush: { value: new Color('#7f93ee') },
      uBody: { value: new Color('#e2e9ff') },
      uRim: { value: new Color('#8ea3ff') },
    };
    const mat = (fall: boolean) =>
      new ShaderMaterial({
        vertexShader: PETAL_VERTEX,
        fragmentShader: PETAL_FRAGMENT,
        uniforms: { uTime: { value: 0 }, uFall: { value: fall ? 1 : 0 }, uLight: { value: light }, uOpacity: { value: 1 }, ...colors },
        side: DoubleSide,
        transparent: fall,
        depthWrite: !fall,
      });
    this.petalMat = mat(false);
    this.fallMat = mat(true);

    this.buildBlossom();
    this.fall = this.buildFall(opts.mobile ? 60 : 140);
    if (opts.reducedMotion) this.fall.visible = false;

    // Bokeh.
    const n = opts.mobile ? 50 : 110;
    const bp = new Float32Array(n * 3), bs = new Float32Array(n), bph = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      bp[i * 3] = (Math.random() - 0.5) * 12;
      bp[i * 3 + 1] = (Math.random() - 0.5) * 8;
      bp[i * 3 + 2] = -2 - Math.random() * 8;
      bs[i] = 0.4 + Math.random() * 1.6;
      bph[i] = Math.random() * 6.28;
    }
    const bg = new BufferGeometry();
    bg.setAttribute('position', new BufferAttribute(bp, 3));
    bg.setAttribute('aSize', new BufferAttribute(bs, 1));
    bg.setAttribute('aPhase', new BufferAttribute(bph, 1));
    this.bokehMat = new ShaderMaterial({
      vertexShader: BOKEH_VERTEX,
      fragmentShader: BOKEH_FRAGMENT,
      uniforms: { uTime: { value: 0 }, uPixel: { value: 300 }, uOpacity: { value: 1 } },
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
    });
    this.scene.add(new Points(bg, this.bokehMat));

    // Post: a gentle bloom on the brightest petal edges.
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.composer.addPass(new UnrealBloomPass(new Vector2(256, 256), 0.16, 0.5, 0.86));
    this.composer.addPass(new OutputPass());

    this.resize();
  }

  /** The blossom: calyx, five petals, stamens with anthers, and the pistil. */
  private buildBlossom(): void {
    const geo = petalGeometry(this.opts.mobile ? 22 : 34, this.opts.mobile ? 30 : 46);
    for (let k = 0; k < 5; k++) {
      const pivot = new Group();
      pivot.rotation.z = (k / 5) * Math.PI * 2 + 0.18;
      const fold = new Group();
      const petal = new Mesh(geo, this.petalMat);
      petal.position.y = 0.04;
      // Each petal a touch different, as on a real blossom.
      petal.scale.setScalar(0.96 + ((k * 37) % 9) / 100);
      petal.rotation.y = (((k * 53) % 7) - 3) * 0.02;
      fold.add(petal);
      pivot.add(fold);
      this.blossom.add(pivot);
      this.petals.push(fold);
    }
    // Calyx: five small dark sepals behind.
    const sepalGeo = petalGeometry(8, 10);
    const sepalMat = new MeshBasicMaterial({ color: new Color('#6576cf'), side: DoubleSide });
    for (let k = 0; k < 5; k++) {
      const s = new Mesh(sepalGeo, sepalMat);
      s.scale.set(0.22, 0.24, 0.22);
      s.rotation.z = (k / 5) * Math.PI * 2 + 0.81;
      s.position.z = -0.1;
      this.blossom.add(s);
    }
    // Stamens: curved filaments fanning forward, each tipped with an anther.
    const filaments: BufferGeometry[] = [];
    const tips: Vector3[] = [];
    const count = this.opts.mobile ? 26 : 38;
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + Math.sin(i * 7.3) * 0.2;
      const lean = 0.42 + ((i * 13) % 10) / 22;
      const len = 0.3 + ((i * 29) % 11) / 55;
      const dir = new Vector3(Math.cos(a) * Math.sin(lean), Math.sin(a) * Math.sin(lean), Math.cos(lean));
      const mid = dir.clone().multiplyScalar(len * 0.55).add(new Vector3(0, 0, 0.04));
      const end = dir.clone().multiplyScalar(len);
      end.z += 0.02;
      const curve = new CatmullRomCurve3([new Vector3(0, 0, 0.02), mid, end]);
      filaments.push(new TubeGeometry(curve, 10, 0.0055, 5, false));
      tips.push(end);
    }
    const filMat = new MeshBasicMaterial({ color: new Color('#dfe6ff') });
    this.heart.add(new Mesh(mergeGeometries(filaments), filMat));
    const antherGeo = new SphereGeometry(0.018, 10, 8);
    antherGeo.scale(1, 1.35, 1);
    const anthers = new InstancedMesh(antherGeo, new MeshBasicMaterial({ color: new Color('#f2f5ff') }), tips.length);
    const m = new Matrix4();
    tips.forEach((t, i) => anthers.setMatrixAt(i, m.makeTranslation(t.x, t.y, t.z)));
    this.heart.add(anthers);
    // Pistil.
    const pistil = new TubeGeometry(new CatmullRomCurve3([new Vector3(0, 0, 0), new Vector3(0.01, 0.02, 0.22), new Vector3(0, 0.03, 0.42)]), 12, 0.009, 6);
    this.heart.add(new Mesh(pistil, new MeshBasicMaterial({ color: new Color('#c9d4ff') })));
    // A soft blush disc at the heart.
    const heart = new Mesh(new SphereGeometry(0.07, 16, 12), new MeshBasicMaterial({ color: new Color('#5d6fd8') }));
    heart.scale.z = 0.4;
    this.heart.add(heart);
    this.blossom.add(this.heart);

    this.blossom.position.set(0.78, 0.05, 0);
    this.scene.add(this.blossom);
  }

  /** Falling petals: every one animated in the vertex shader from its seed. */
  private buildFall(count: number): InstancedMesh {
    const geo = petalGeometry(10, 14);
    const seeds = new Float32Array(count * 4), spins = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) {
      seeds.set([(Math.random() - 0.5) * 9, -1.6 - Math.random() * 6, 0.5 + Math.random() * 0.6, Math.random()], i * 4);
      const ax = new Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
      spins.set([ax.x, ax.y, ax.z, 0.06 + Math.random() * 0.06], i * 4);
    }
    geo.setAttribute('aSeed', new InstancedBufferAttribute(seeds, 4));
    geo.setAttribute('aSpin', new InstancedBufferAttribute(spins, 4));
    const mesh = new InstancedMesh(geo, this.fallMat, count);
    const id = new Matrix4();
    for (let i = 0; i < count; i++) mesh.setMatrixAt(i, id);
    mesh.frustumCulled = false;
    this.scene.add(mesh);
    return mesh;
  }

  /** Hero scroll progress: 0 = bud at rest, 1 = fully open and close; past 1 the blossom drifts up and away. */
  setProgress(p: number): void {
    this.progress = p;
  }
  /** How many falling petals show (0..1), e.g. lower over busy content. */
  setPetalDensity(d: number): void {
    this.petalDensity = d;
  }
  setPointer(x: number, y: number): void {
    this.pointer.set(x, y);
  }
  setVisible(v: boolean): void {
    this.visible = v;
    if (v && !this.raf && !this.disposed) this.raf = requestAnimationFrame(this.loop);
  }

  resize(): void {
    const w = this.canvas.clientWidth || window.innerWidth, h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    // Narrow screens: pull back so the whole blossom stays in view, centred higher.
    this.camera.fov = w / h < 0.8 ? 46 : 32;
    this.camera.updateProjectionMatrix();
    this.skyMat.uniforms.uAspect.value.set(Math.max(1, w / h), Math.max(1, h / w));
    this.bokehMat.uniforms.uPixel.value = h * this.renderer.getPixelRatio() * 0.06;
  }

  start(): void {
    if (!this.raf) this.raf = requestAnimationFrame(this.loop);
  }

  private loop = (now: number) => {
    this.raf = 0;
    if (this.disposed || !this.visible || document.hidden) return;
    this.raf = requestAnimationFrame(this.loop);
    this.render(now);
  };

  /** One frame (also used once for the reduced-motion still). */
  render(now = performance.now()): void {
    const t = (now - this.t0) / 1000;
    const p = this.progress;
    const narrow = this.camera.aspect < 0.8;

    // Bloom: bud → open over the first 60 % of the hero.
    const open = this.opts.reducedMotion ? 1 : smooth(0.0, 0.6, p);
    const breathe = this.opts.reducedMotion ? 0 : Math.sin(t * 0.8) * 0.025;
    this.petals.forEach((fold, k) => {
      const lag = smooth(k * 0.05, 0.6 + k * 0.05, p);
      const o = this.opts.reducedMotion ? 1 : lag;
      fold.rotation.x = -(1.42 * (1 - o) + 0.22) + breathe + Math.sin(t * 0.6 + k) * 0.012;
    });

    // Camera and blossom: a slow dolly in while it opens, then the blossom drifts up and away with the page.
    this.pointerSmooth.lerp(this.pointer, 0.05);
    const away = smooth(1.0, 1.6, p);
    const dolly = smooth(0.2, 1.0, p);
    this.camera.position.z = (narrow ? 6.4 : 5.2) - dolly * 1.15;
    this.blossom.position.x = narrow ? 0 : 0.78 - dolly * 0.25;
    this.blossom.position.y = (narrow ? 1.25 - open * 0.55 : 0.05) + away * 3.2;
    this.blossom.rotation.z = t * (this.opts.reducedMotion ? 0 : 0.035) + open * 0.4;
    this.blossom.rotation.x = -0.18 - (1 - open) * 1.05 + this.pointerSmooth.y * 0.14 + dolly * 0.12;
    this.heart.scale.setScalar(0.25 + open * 0.75);
    this.blossom.rotation.y = 0.22 + this.pointerSmooth.x * 0.2 - dolly * 0.1;
    this.blossom.scale.setScalar(0.62 + open * 0.38);
    this.blossom.visible = away < 0.999;

    // Time-driven materials.
    this.fallMat.uniforms.uTime.value = t;
    this.fallMat.uniforms.uOpacity.value = 0.92 * this.petalDensity * smooth(0.0, 0.35, p + 0.2);
    this.skyMat.uniforms.uTime.value = t;
    this.skyMat.uniforms.uGlow.value = 1 - away * 0.6;
    this.bokehMat.uniforms.uTime.value = t;

    this.composer.render();
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.scene.traverse((o) => {
      const mesh = o as Mesh;
      mesh.geometry?.dispose();
      const m = mesh.material as ShaderMaterial | ShaderMaterial[] | undefined;
      if (Array.isArray(m)) m.forEach((x) => x.dispose());
      else m?.dispose();
    });
    this.composer.dispose();
    this.renderer.dispose();
  }
}
