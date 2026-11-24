import * as THREE from 'three';
import { sharedScrollState } from '../hooks/useSmoothScroll';
import { FluidPass } from './FluidPass';
import {
  createSakuraPrismGeometry,
  createSinglePetalGeometry,
  createStudioEnvironment,
  createSweepingRibbonGeometry,
} from './sakuraGeometry';

const HERO_BG_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.999, 1.0);
  }
`;

// Full-screen atmospheric obsidian-indigo radial studio backdrop for Act I (Hero)
const HERO_BG_FRAG = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform float uOpacity;
  uniform float uTime;
  uniform vec2 uPointer;

  void main() {
    if (uOpacity <= 0.002) discard;

    vec2 p = vUv;
    vec2 lightA = vec2(0.68 + uPointer.x * 0.04 + sin(uTime * 0.25) * 0.03, 0.52 + uPointer.y * 0.04);
    vec2 lightB = vec2(0.26 - uPointer.x * 0.03, 0.78);
    vec2 lightC = vec2(0.84, 0.20);

    float gA = exp(-length((p - lightA) * vec2(1.4, 1.0)) * 2.4);
    float gB = exp(-length((p - lightB) * vec2(1.2, 1.0)) * 2.8);
    float gC = exp(-length((p - lightC) * vec2(1.3, 1.0)) * 2.5);

    vec3 base = vec3(0.035, 0.031, 0.059); // #09080f deep obsidian
    vec3 col = base
      + vec3(0.45, 0.16, 0.85) * gA * 0.34
      + vec3(0.10, 0.18, 0.96) * gB * 0.24
      + vec3(1.00, 0.45, 0.70) * gC * 0.18;

    // Subtle filmic vignette
    float vig = smoothstep(1.35, 0.2, length(p - 0.5));
    col *= 0.86 + 0.14 * vig;

    gl_FragColor = vec4(col, uOpacity);
  }
`;

const PARTICLE_VERT = /* glsl */ `
  uniform float uTime;
  uniform float uSpread;
  attribute float aScale;
  attribute vec3 aColor;
  varying vec3 vColor;
  varying float vAlpha;

  void main() {
    vColor = aColor;
    vec3 pos = position;
    pos.x += sin(uTime * 0.42 + position.z * 0.22) * 0.24 * uSpread;
    pos.y += cos(uTime * 0.36 + position.x * 0.32) * 0.24 * uSpread;

    vec4 mvPos = modelViewMatrix * vec4(pos, 1.0);
    gl_PointSize = clamp((aScale * 95.0) / max(-mvPos.z, 0.5), 1.5, 16.0);
    vAlpha = smoothstep(-58.0, -10.0, mvPos.z) * (1.0 - smoothstep(-1.2, 0.0, mvPos.z));
    gl_Position = projectionMatrix * mvPos;
  }
`;

const PARTICLE_FRAG = /* glsl */ `
  precision highp float;
  varying vec3 vColor;
  varying float vAlpha;
  uniform float uOpacity;

  void main() {
    float dist = length(gl_PointCoord - vec2(0.5));
    float soft = 1.0 - smoothstep(0.12, 0.5, dist);
    if (soft <= 0.01) discard;
    gl_FragColor = vec4(vColor, soft * vAlpha * uOpacity);
  }
`;

export interface HikariStageCallbacks {
  onReady?: () => void;
  onProgress?: (ratio: number) => void;
}

export class HikariStageScene {
  private container: HTMLElement;
  private renderer: THREE.WebGLRenderer;
  private bgScene: THREE.Scene;
  private mainScene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private orthoCam: THREE.OrthographicCamera;
  private fluidPass: FluidPass;
  private envTexture: THREE.Texture;

  private heroBgMat: THREE.ShaderMaterial;
  private heroGroup: THREE.Group;
  private heroCore: THREE.Mesh;
  private heroSakura: THREE.Mesh;
  private heroRings: THREE.Mesh[] = [];
  private floatingPetals: Array<{ mesh: THREE.Mesh; base: THREE.Vector3; speed: number; phase: number }> = [];
  private heroStarsMat: THREE.ShaderMaterial;

  private ribbonMesh: THREE.Mesh;
  private ribbonMat: THREE.MeshPhysicalMaterial;

  private tunnelGroup: THREE.Group;
  private tunnelRings: THREE.Mesh[] = [];
  private tunnelMats: THREE.MeshPhysicalMaterial[] = [];
  private waveSplines: THREE.Line[] = [];
  private particleMat: THREE.ShaderMaterial;

  private disposables: Array<{ dispose: () => void }> = [];
  private pointerTarget = new THREE.Vector2(0, 0);
  private pointerSmooth = new THREE.Vector2(0, 0);
  private rafId = 0;
  private startTime = performance.now();
  private reducedMotion = false;
  private width = 1;
  private height = 1;
  private dpr = 1;
  private resizeObserver: ResizeObserver;
  private heroEl: HTMLElement | null = null;
  private showreelEl: HTMLElement | null = null;
  private tunnelEl: HTMLElement | null = null;

  constructor(container: HTMLElement, callbacks?: HikariStageCallbacks) {
    this.container = container;
    this.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.width = Math.max(1, container.clientWidth || window.innerWidth);
    this.height = Math.max(1, container.clientHeight || window.innerHeight);
    this.dpr = Math.min(window.devicePixelRatio || 1, 1.5);

    callbacks?.onProgress?.(0.25);

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(this.dpr);
    this.renderer.setSize(this.width, this.height);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    container.appendChild(this.renderer.domElement);

    this.bgScene = new THREE.Scene();
    this.mainScene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(42, this.width / this.height, 0.1, 120);
    this.camera.position.set(0, 0, 9.5);
    this.orthoCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    this.envTexture = createStudioEnvironment(this.renderer);
    this.mainScene.environment = this.envTexture;
    this.disposables.push(this.envTexture);

    this.fluidPass = new FluidPass(this.width, this.height, this.dpr);

    callbacks?.onProgress?.(0.5);

    // Lighting
    const ambient = new THREE.AmbientLight(0xffffff, 0.55);
    const keyLight = new THREE.DirectionalLight(0xffffff, 1.9);
    keyLight.position.set(5, 7, 8);
    const sakuraLight = new THREE.PointLight(0xff7eb6, 20, 32);
    sakuraLight.position.set(-4, 2, 5);
    const cobaltLight = new THREE.PointLight(0x1a2ffb, 24, 34);
    cobaltLight.position.set(6, -3, 5);
    this.mainScene.add(ambient, keyLight, sakuraLight, cobaltLight);

    // 1. Full-screen Hero Backdrop (starts from y=0, fades smoothly as user scrolls into Showreel)
    const bgGeo = new THREE.PlaneGeometry(2, 2);
    this.heroBgMat = new THREE.ShaderMaterial({
      vertexShader: HERO_BG_VERT,
      fragmentShader: HERO_BG_FRAG,
      uniforms: {
        uOpacity: { value: 1.0 },
        uTime: { value: 0 },
        uPointer: { value: new THREE.Vector2(0, 0) },
      },
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    const bgQuad = new THREE.Mesh(bgGeo, this.heroBgMat);
    bgQuad.frustumCulled = false;
    this.bgScene.add(bgQuad);
    this.disposables.push(bgGeo, this.heroBgMat);

    // 2. Act I: Full-Viewport Sculptural Crystal Sakura Core & Orbital Rings
    this.heroGroup = new THREE.Group();
    this.mainScene.add(this.heroGroup);

    const sakuraGeo = createSakuraPrismGeometry(1.75, 0.1);
    const knotGeo = new THREE.TorusKnotGeometry(0.68, 0.15, 160, 26);
    const petalGeo = createSinglePetalGeometry(0.24);
    this.disposables.push(sakuraGeo, knotGeo, petalGeo);

    const glassSakuraMat = new THREE.MeshPhysicalMaterial({
      color: 0xd9dcf5,
      roughness: 0.18,
      metalness: 0.1,
      clearcoat: 1.0,
      clearcoatRoughness: 0.05,
      iridescence: 1.0,
      iridescenceIOR: 1.48,
      transparent: true,
      opacity: 1,
    });

    const obsidianCoreMat = new THREE.MeshPhysicalMaterial({
      color: 0x100e1c,
      emissive: 0x1a0b2e,
      emissiveIntensity: 0.4,
      roughness: 0.12,
      metalness: 0.3,
      clearcoat: 1.0,
      iridescence: 0.85,
      transparent: true,
      opacity: 1,
    });

    const ringSpecs = [
      { radius: 2.35, tube: 0.028, color: 0xff7eb6, emissive: 0x45122b, rot: [0.65, 0.4, 0.1] },
      { radius: 2.95, tube: 0.024, color: 0x1a2ffb, emissive: 0x0b165e, rot: [-0.45, 0.75, 0.3] },
      { radius: 3.55, tube: 0.02, color: 0x8832f7, emissive: 0x2a0f57, rot: [0.3, -0.6, 0.5] },
    ];
    this.disposables.push(glassSakuraMat, obsidianCoreMat);

    this.heroSakura = new THREE.Mesh(sakuraGeo, glassSakuraMat);
    this.heroSakura.rotation.set(0.18, -0.25, 0.12);
    this.heroGroup.add(this.heroSakura);

    this.heroCore = new THREE.Mesh(knotGeo, obsidianCoreMat);
    this.heroCore.position.set(0, 0, 0.55);
    this.heroGroup.add(this.heroCore);

    ringSpecs.forEach((spec) => {
      const geo = new THREE.TorusGeometry(spec.radius, spec.tube, 18, 120);
      const mat = new THREE.MeshPhysicalMaterial({
        color: spec.color,
        emissive: spec.emissive,
        emissiveIntensity: 0.55,
        roughness: 0.14,
        metalness: 0.2,
        clearcoat: 1.0,
        transparent: true,
        opacity: 0.9,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.rotation.set(spec.rot[0], spec.rot[1], spec.rot[2]);
      this.heroGroup.add(mesh);
      this.heroRings.push(mesh);
      this.disposables.push(geo, mat);
    });

    // Floating crystalline sakura petals scattered across the 100vh stage
    const petalMat = new THREE.MeshPhysicalMaterial({
      color: 0xff97c7,
      emissive: 0x360d26,
      emissiveIntensity: 0.35,
      roughness: 0.2,
      metalness: 0.1,
      clearcoat: 1.0,
      transparent: true,
      opacity: 0.85,
    });
    this.disposables.push(petalMat);

    for (let i = 0; i < 18; i++) {
      const petal = new THREE.Mesh(petalGeo, petalMat);
      const px = (Math.random() - 0.45) * 12;
      const py = (Math.random() - 0.5) * 6.5;
      const pz = (Math.random() - 0.5) * 4.5 - 0.5;
      petal.position.set(px, py, pz);
      petal.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
      petal.scale.setScalar(0.75 + Math.random() * 0.95);
      this.heroGroup.add(petal);
      this.floatingPetals.push({
        mesh: petal,
        base: new THREE.Vector3(px, py, pz),
        speed: 0.35 + Math.random() * 0.45,
        phase: Math.random() * Math.PI * 2,
      });
    }

    // Subtle full-screen Hero ambient starlight/sakura motes
    const starCount = 450;
    const sPos = new Float32Array(starCount * 3);
    const sCol = new Float32Array(starCount * 3);
    const sScale = new Float32Array(starCount);
    const sc1 = new THREE.Color('#ff7eb6');
    const sc2 = new THREE.Color('#6f85ff');
    const sc3 = new THREE.Color('#ffffff');
    const tmp = new THREE.Color();

    for (let i = 0; i < starCount; i++) {
      sPos[i * 3] = (Math.random() - 0.5) * 16;
      sPos[i * 3 + 1] = (Math.random() - 0.5) * 9.5;
      sPos[i * 3 + 2] = -Math.random() * 14 - 0.5;
      sScale[i] = 0.45 + Math.random() * 1.1;
      const pick = Math.random();
      if (pick < 0.4) tmp.copy(sc1);
      else if (pick < 0.78) tmp.copy(sc2);
      else tmp.copy(sc3);
      sCol[i * 3] = tmp.r;
      sCol[i * 3 + 1] = tmp.g;
      sCol[i * 3 + 2] = tmp.b;
    }

    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.Float32BufferAttribute(sPos, 3));
    starGeo.setAttribute('aColor', new THREE.Float32BufferAttribute(sCol, 3));
    starGeo.setAttribute('aScale', new THREE.Float32BufferAttribute(sScale, 1));

    this.heroStarsMat = new THREE.ShaderMaterial({
      vertexShader: PARTICLE_VERT,
      fragmentShader: PARTICLE_FRAG,
      uniforms: {
        uTime: { value: 0 },
        uSpread: { value: 0.75 },
        uOpacity: { value: 0.75 },
      },
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const heroStars = new THREE.Points(starGeo, this.heroStarsMat);
    this.heroGroup.add(heroStars);
    this.disposables.push(starGeo, this.heroStarsMat);

    callbacks?.onProgress?.(0.75);

    // 3. Act II: Sweeping Iridescent 3D Showreel Ribbon
    const ribbonGeo = createSweepingRibbonGeometry();
    this.ribbonMat = new THREE.MeshPhysicalMaterial({
      color: 0x1a2ffb,
      emissive: 0x110a38,
      emissiveIntensity: 0.4,
      roughness: 0.2,
      metalness: 0.15,
      clearcoat: 1.0,
      iridescence: 1.0,
      iridescenceIOR: 1.5,
      transparent: true,
      opacity: 0,
    });
    this.ribbonMesh = new THREE.Mesh(ribbonGeo, this.ribbonMat);
    this.mainScene.add(this.ribbonMesh);
    this.disposables.push(ribbonGeo, this.ribbonMat);

    // 4. Act IV: Neural-Acoustic Tunnel Rings, Viseme Waveforms & Particles
    this.tunnelGroup = new THREE.Group();
    this.tunnelGroup.visible = false;
    this.mainScene.add(this.tunnelGroup);

    const ringGeo = new THREE.TorusGeometry(3.6, 0.055, 14, 72);
    this.disposables.push(ringGeo);

    for (let m = 0; m < 4; m++) {
      const t = m / 3;
      const mat = new THREE.MeshPhysicalMaterial({
        color: new THREE.Color().lerpColors(
          new THREE.Color('#1a2ffb'),
          new THREE.Color('#ff7eb6'),
          t
        ),
        emissive: new THREE.Color().lerpColors(
          new THREE.Color('#160e3a'),
          new THREE.Color('#4f1747'),
          t
        ),
        roughness: 0.15,
        clearcoat: 1.0,
        transparent: true,
        opacity: 0,
      });
      this.tunnelMats.push(mat);
      this.disposables.push(mat);
    }

    for (let i = 0; i < 18; i++) {
      const ringMat = this.tunnelMats[Math.floor((i / 18) * 4)];
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.position.z = -i * 3.1 - 3.0;
      ring.rotation.z = i * 0.34;
      this.tunnelGroup.add(ring);
      this.tunnelRings.push(ring);
    }

    for (let w = 0; w < 2; w++) {
      const pts: THREE.Vector3[] = [];
      for (let s = 0; s <= 90; s++) {
        const z = -s * 0.65;
        const angle = s * 0.28 + w * Math.PI;
        pts.push(new THREE.Vector3(Math.cos(angle) * 2.2, Math.sin(angle) * 2.2, z));
      }
      const lineGeo = new THREE.BufferGeometry().setFromPoints(pts);
      const lineMat = new THREE.LineBasicMaterial({
        color: w === 0 ? 0xff7eb6 : 0x5c73ff,
        transparent: true,
        opacity: 0,
      });
      const line = new THREE.Line(lineGeo, lineMat);
      this.tunnelGroup.add(line);
      this.waveSplines.push(line);
      this.disposables.push(lineGeo, lineMat);
    }

    const count = 1200;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const scales = new Float32Array(count);
    const c1 = new THREE.Color('#ff7eb6');
    const c2 = new THREE.Color('#8832f7');
    const c3 = new THREE.Color('#1a2ffb');
    const tmpColor = new THREE.Color();

    for (let i = 0; i < count; i++) {
      const radius = 1.6 + Math.random() * 5.8;
      const theta = Math.random() * Math.PI * 2;
      positions[i * 3] = Math.cos(theta) * radius;
      positions[i * 3 + 1] = Math.sin(theta) * radius;
      positions[i * 3 + 2] = -Math.random() * 56;
      scales[i] = 0.5 + Math.random() * 1.4;

      const mixPick = Math.random();
      if (mixPick < 0.38) tmpColor.copy(c1);
      else if (mixPick < 0.72) tmpColor.copy(c2);
      else tmpColor.copy(c3);

      colors[i * 3] = tmpColor.r;
      colors[i * 3 + 1] = tmpColor.g;
      colors[i * 3 + 2] = tmpColor.b;
    }

    const particleGeo = new THREE.BufferGeometry();
    particleGeo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    particleGeo.setAttribute('aColor', new THREE.Float32BufferAttribute(colors, 3));
    particleGeo.setAttribute('aScale', new THREE.Float32BufferAttribute(scales, 1));

    this.particleMat = new THREE.ShaderMaterial({
      vertexShader: PARTICLE_VERT,
      fragmentShader: PARTICLE_FRAG,
      uniforms: {
        uTime: { value: 0 },
        uSpread: { value: 1.0 },
        uOpacity: { value: 0.0 },
      },
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const particlePoints = new THREE.Points(particleGeo, this.particleMat);
    this.tunnelGroup.add(particlePoints);
    this.disposables.push(particleGeo, this.particleMat);

    window.addEventListener('pointermove', this.onPointerMove, { passive: true });
    this.resizeObserver = new ResizeObserver(() => this.handleResize());
    this.resizeObserver.observe(container);

    callbacks?.onProgress?.(1);
    callbacks?.onReady?.();

    this.rafId = requestAnimationFrame(this.animate);
  }

  private onPointerMove = (e: PointerEvent) => {
    const uvX = e.clientX / Math.max(1, window.innerWidth);
    const uvY = 1.0 - e.clientY / Math.max(1, window.innerHeight);
    this.pointerTarget.set(uvX * 2 - 1, uvY * 2 - 1);
    if (!this.reducedMotion) {
      this.fluidPass.pushPointer(uvX, uvY);
    }
  };

  private handleResize() {
    this.width = Math.max(1, this.container.clientWidth || window.innerWidth);
    this.height = Math.max(1, this.container.clientHeight || window.innerHeight);
    this.dpr = Math.min(window.devicePixelRatio || 1, 1.5);

    this.camera.aspect = this.width / this.height;
    this.camera.updateProjectionMatrix();

    this.renderer.setPixelRatio(this.dpr);
    this.renderer.setSize(this.width, this.height);
    this.fluidPass.resize(this.width, this.height, this.dpr);
  }

  private renderComposite = (target: THREE.WebGLRenderTarget | null) => {
    const prevAutoClear = this.renderer.autoClear;
    this.renderer.autoClear = false;
    this.renderer.setRenderTarget(target);
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.clear();

    if (this.heroBgMat.uniforms.uOpacity.value > 0.002) {
      this.renderer.render(this.bgScene, this.orthoCam);
    }

    this.renderer.clearDepth();
    this.renderer.render(this.mainScene, this.camera);
    this.renderer.autoClear = prevAutoClear;
  };

  private animate = (now: number) => {
    this.rafId = requestAnimationFrame(this.animate);
    const elapsed = this.reducedMotion ? 0 : (now - this.startTime) * 0.001;
    const p = sharedScrollState.progress;

    this.pointerSmooth.lerp(this.pointerTarget, this.reducedMotion ? 1 : 0.055);

    // 1. Full-screen Hero Stage (synced strictly to #hero DOM exit so Showreel stays crisp #f0f1fa)
    if (!this.heroEl) {
      this.heroEl = document.getElementById('hero');
    }
    const heroRect = this.heroEl?.getBoundingClientRect();
    const heroFade = heroRect
      ? THREE.MathUtils.smoothstep(heroRect.bottom / Math.max(1, this.height), 0.35, 0.96)
      : 1 - THREE.MathUtils.smoothstep(p, 0.02, 0.08);

    this.heroBgMat.uniforms.uOpacity.value = heroFade;
    this.heroBgMat.uniforms.uTime.value = elapsed;
    this.heroBgMat.uniforms.uPointer.value.copy(this.pointerSmooth);

    this.heroGroup.visible = heroFade > 0.01;
    if (this.heroGroup.visible) {
      const isMobile = this.width < 768;
      // Place centerpiece offset cleanly to the right on desktop so left typography breathes
      const targetX = isMobile ? 0.95 : 1.95;
      const targetY = isMobile ? 1.55 : -0.05;
      const baseZ = isMobile ? -1.8 : 0;
      const scrollZoom = 1 + (1 - heroFade) * 1.15;

      this.heroGroup.position.set(
        targetX + this.pointerSmooth.x * 0.25,
        targetY + this.pointerSmooth.y * 0.18 + (1 - heroFade) * 1.1,
        baseZ + (1 - heroFade) * 2.2
      );
      this.heroGroup.scale.setScalar((isMobile ? 0.56 : 1.0) * scrollZoom);

      this.heroSakura.rotation.y = -0.25 + this.pointerSmooth.x * 0.28 + Math.sin(elapsed * 0.35) * 0.12;
      this.heroSakura.rotation.x = 0.18 - this.pointerSmooth.y * 0.2 + Math.cos(elapsed * 0.28) * 0.08;
      this.heroSakura.rotation.z = 0.12 + elapsed * 0.08;

      this.heroCore.rotation.x = elapsed * 0.24 - this.pointerSmooth.y * 0.25;
      this.heroCore.rotation.y = elapsed * 0.32 + this.pointerSmooth.x * 0.25;

      this.heroRings.forEach((ring, idx) => {
        ring.rotation.z += this.reducedMotion ? 0 : (idx % 2 === 0 ? 0.0028 : -0.0024) * (idx + 1);
        ring.rotation.x += this.reducedMotion ? 0 : 0.0012;
        (ring.material as THREE.MeshPhysicalMaterial).opacity = heroFade * 0.88;
      });

      (this.heroSakura.material as THREE.MeshPhysicalMaterial).opacity = heroFade * (isMobile ? 0.72 : 0.94);
      (this.heroCore.material as THREE.MeshPhysicalMaterial).opacity = heroFade * (isMobile ? 0.78 : 0.96);

      this.floatingPetals.forEach((item) => {
        item.mesh.position.y = item.base.y + Math.sin(elapsed * item.speed + item.phase) * 0.35;
        item.mesh.position.x = item.base.x + Math.cos(elapsed * item.speed * 0.7 + item.phase) * 0.25;
        item.mesh.rotation.x += this.reducedMotion ? 0 : 0.006 * item.speed;
        item.mesh.rotation.y += this.reducedMotion ? 0 : 0.008 * item.speed;
        (item.mesh.material as THREE.MeshPhysicalMaterial).opacity = heroFade * 0.82;
      });

      this.heroStarsMat.uniforms.uTime.value = elapsed;
      this.heroStarsMat.uniforms.uOpacity.value = heroFade * 0.78;
    }

    // 2. Showreel Sweeping 3D Ribbon (synced directly to #showreel viewport progress)
    if (!this.showreelEl) {
      this.showreelEl = document.getElementById('showreel');
    }
    const showreelRect = this.showreelEl?.getBoundingClientRect();
    let ribbonVisibility = 0;
    let localRibbonT = 0;
    if (showreelRect) {
      const enterRibbon = 1 - THREE.MathUtils.smoothstep(showreelRect.top, this.height * 0.15, this.height * 0.88);
      const exitRibbon = THREE.MathUtils.smoothstep(showreelRect.bottom, 0, this.height * 0.65);
      ribbonVisibility = enterRibbon * exitRibbon;
      localRibbonT = THREE.MathUtils.clamp(
        (this.height - showreelRect.top) / Math.max(1, showreelRect.height + this.height),
        0,
        1
      );
    }

    this.ribbonMesh.visible = ribbonVisibility > 0.01;
    this.ribbonMat.opacity = ribbonVisibility * 0.94;
    if (this.ribbonMesh.visible) {
      this.ribbonMesh.position.set(
        THREE.MathUtils.lerp(2.6, -2.2, localRibbonT) + this.pointerSmooth.x * 0.4,
        THREE.MathUtils.lerp(1.4, -0.9, localRibbonT) + Math.sin(elapsed * 0.6) * 0.15,
        0
      );
      this.ribbonMesh.rotation.set(
        localRibbonT * 0.8 + this.pointerSmooth.y * 0.15,
        localRibbonT * 1.15,
        -0.25 + localRibbonT * 0.5
      );
    }

    // 3. Neural-Acoustic Tunnel Flythrough
    if (!this.tunnelEl) {
      this.tunnelEl = document.getElementById('architecture-tunnel');
    }
    let tunnelAlpha = 0;
    if (this.tunnelEl) {
      const rect = this.tunnelEl.getBoundingClientRect();
      const enter = THREE.MathUtils.clamp(
        (this.height - rect.top) / Math.max(1, this.height * 0.8),
        0,
        1
      );
      const exit = THREE.MathUtils.clamp(
        rect.bottom / Math.max(1, this.height * 0.8),
        0,
        1
      );
      tunnelAlpha = enter * exit;
    }

    if (tunnelAlpha > 0.01 && !this.reducedMotion) {
      this.tunnelGroup.visible = true;
      const tp = sharedScrollState.tunnelProgress;

      this.tunnelGroup.position.z = tp * 42.0;
      this.tunnelGroup.rotation.z = tp * 0.65 + this.pointerSmooth.x * 0.08;
      this.tunnelGroup.position.x = -this.pointerSmooth.x * 0.35;
      this.tunnelGroup.position.y = -this.pointerSmooth.y * 0.25;

      this.tunnelMats.forEach((mat) => {
        mat.opacity = tunnelAlpha * 0.68;
      });
      this.tunnelRings.forEach((ring, idx) => {
        ring.rotation.z = idx * 0.34 + elapsed * 0.12 + tp * 1.4;
        const pulse = 1 + Math.sin(elapsed * 1.4 + idx * 0.4) * 0.04;
        ring.scale.setScalar(pulse);
      });

      this.waveSplines.forEach((line, idx) => {
        const mat = line.material as THREE.LineBasicMaterial;
        mat.opacity = tunnelAlpha * 0.55;
        line.rotation.z = elapsed * (idx === 0 ? 0.25 : -0.22) + tp * 2.2;
      });

      this.particleMat.uniforms.uTime.value = elapsed;
      this.particleMat.uniforms.uOpacity.value = tunnelAlpha * 0.85;
      this.particleMat.uniforms.uSpread.value = 1 + Math.abs(sharedScrollState.velocity) * 0.03;

      this.container.style.backgroundColor = `rgba(9, 8, 15, ${(tunnelAlpha * 0.96).toFixed(3)})`;
    } else {
      this.tunnelGroup.visible = false;
      this.container.style.backgroundColor = 'transparent';
    }

    const useFluidPass = !this.reducedMotion && window.innerWidth >= 768;
    this.fluidPass.render(this.renderer, this.renderComposite, elapsed, useFluidPass);
  };

  dispose() {
    cancelAnimationFrame(this.rafId);
    window.removeEventListener('pointermove', this.onPointerMove);
    this.resizeObserver.disconnect();
    this.fluidPass.dispose();
    this.disposables.forEach((d) => d.dispose());
    this.renderer.dispose();
    if (this.renderer.domElement.parentNode === this.container) {
      this.container.removeChild(this.renderer.domElement);
    }
  }
}
