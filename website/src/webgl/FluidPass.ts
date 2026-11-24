import * as THREE from 'three';

const FULLSCREEN_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

// Ping-pong decaying velocity & ripple trail shader (UnsignedByte safe across all GPUs)
const TRAIL_FRAG = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D uPrev;
  uniform vec2 uMouse;
  uniform vec2 uPrevMouse;
  uniform vec2 uVelocity;
  uniform float uSpeed;
  uniform float uAspect;
  uniform float uDecay;

  float segmentDist(vec2 p, vec2 a, vec2 b) {
    vec2 pa = p - a;
    vec2 ba = b - a;
    float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-6), 0.0, 1.0);
    return length(pa - ba * h);
  }

  void main() {
    vec2 uv = vUv;
    vec4 prev = texture2D(uPrev, uv);

    // Subtle curl/fluid advection along stored velocity
    vec2 storedVel = (prev.rg - 0.5) * 2.0;
    vec2 advectedUv = uv - storedVel * 0.0055;
    vec4 advected = texture2D(uPrev, clamp(advectedUv, 0.0, 1.0));

    float prevIntensity = advected.b * uDecay;
    vec2 prevVel = (advected.rg - 0.5) * 2.0 * 0.95;

    // Stamp smooth stroke between previous and current mouse position
    vec2 p = vec2(uv.x * uAspect, uv.y);
    vec2 a = vec2(uPrevMouse.x * uAspect, uPrevMouse.y);
    vec2 b = vec2(uMouse.x * uAspect, uMouse.y);
    float d = segmentDist(p, a, b);

    float radius = 0.042 + min(uSpeed * 0.28, 0.065);
    float stamp = exp(-(d * d) / max(radius * radius, 1e-5)) * clamp(uSpeed * 32.0, 0.0, 1.0);

    float intensity = clamp(max(prevIntensity, stamp), 0.0, 1.0);
    vec2 outVel = clamp(prevVel + uVelocity * stamp * 1.45, -1.0, 1.0);

    gl_FragColor = vec4(outVel * 0.5 + 0.5, intensity, 1.0);
  }
`;

// Final chromatic dispersion + iridescent sakura/cobalt wake composite
const COMPOSITE_FRAG = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D uScene;
  uniform sampler2D uTrail;
  uniform float uEffectStrength;
  uniform float uTime;

  void main() {
    vec4 trail = texture2D(uTrail, vUv);
    float energy = trail.b * uEffectStrength;
    vec2 vel = (trail.rg - 0.5) * 2.0;

    vec2 offset = vel * energy * 0.022;
    vec4 base = texture2D(uScene, vUv);

    if (energy < 0.004) {
      gl_FragColor = base;
      return;
    }

    vec4 rSample = texture2D(uScene, clamp(vUv + offset * 1.35, 0.0, 1.0));
    vec4 gSample = texture2D(uScene, clamp(vUv + offset * 0.25, 0.0, 1.0));
    vec4 bSample = texture2D(uScene, clamp(vUv - offset * 1.25, 0.0, 1.0));

    vec3 refracted = vec3(rSample.r, gSample.g, bSample.b);
    float alpha = max(base.a, max(rSample.a, bSample.a));

    // Iridescent sakura-cobalt wake ribbon across light and dark surfaces
    float edgeGlow = smoothstep(0.06, 0.65, energy) * (1.0 - smoothstep(0.62, 1.0, energy) * 0.35);
    float wave = 0.5 + 0.5 * sin(vUv.x * 11.0 + vUv.y * 8.0 - uTime * 2.4);
    vec3 prismTint = mix(vec3(0.10, 0.18, 0.98), vec3(1.0, 0.49, 0.71), wave);
    vec3 finalRgb = mix(refracted, prismTint, edgeGlow * 0.38);
    float finalAlpha = clamp(alpha + edgeGlow * 0.34, 0.0, 1.0);

    gl_FragColor = vec4(finalRgb, finalAlpha);
  }
`;

export class FluidPass {
  private quadGeo: THREE.PlaneGeometry;
  private orthoCam: THREE.OrthographicCamera;
  private trailScene: THREE.Scene;
  private compositeScene: THREE.Scene;
  private trailMat: THREE.ShaderMaterial;
  private compositeMat: THREE.ShaderMaterial;
  private trailA: THREE.WebGLRenderTarget;
  private trailB: THREE.WebGLRenderTarget;
  readonly sceneTarget: THREE.WebGLRenderTarget;
  private prevMouse = new THREE.Vector2(0.5, 0.5);
  private mouse = new THREE.Vector2(0.5, 0.5);
  private velocity = new THREE.Vector2(0, 0);
  private hasMoved = false;

  constructor(width: number, height: number, dpr: number) {
    this.quadGeo = new THREE.PlaneGeometry(2, 2);
    this.orthoCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    const trailOpts: THREE.RenderTargetOptions = {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
      type: THREE.UnsignedByteType,
      depthBuffer: false,
      stencilBuffer: false,
    };

    this.trailA = new THREE.WebGLRenderTarget(256, 256, trailOpts);
    this.trailB = new THREE.WebGLRenderTarget(256, 256, trailOpts);

    this.sceneTarget = new THREE.WebGLRenderTarget(
      Math.max(1, Math.floor(width * dpr)),
      Math.max(1, Math.floor(height * dpr)),
      {
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        format: THREE.RGBAFormat,
        type: THREE.UnsignedByteType,
        depthBuffer: true,
      }
    );

    this.trailMat = new THREE.ShaderMaterial({
      vertexShader: FULLSCREEN_VERT,
      fragmentShader: TRAIL_FRAG,
      uniforms: {
        uPrev: { value: this.trailA.texture },
        uMouse: { value: this.mouse },
        uPrevMouse: { value: this.prevMouse },
        uVelocity: { value: this.velocity },
        uSpeed: { value: 0 },
        uAspect: { value: width / Math.max(1, height) },
        uDecay: { value: 0.962 },
      },
      depthTest: false,
      depthWrite: false,
    });

    this.compositeMat = new THREE.ShaderMaterial({
      vertexShader: FULLSCREEN_VERT,
      fragmentShader: COMPOSITE_FRAG,
      uniforms: {
        uScene: { value: this.sceneTarget.texture },
        uTrail: { value: this.trailB.texture },
        uEffectStrength: { value: 1.0 },
        uTime: { value: 0 },
      },
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });

    this.trailScene = new THREE.Scene();
    this.trailScene.add(new THREE.Mesh(this.quadGeo, this.trailMat));

    this.compositeScene = new THREE.Scene();
    this.compositeScene.add(new THREE.Mesh(this.quadGeo, this.compositeMat));
  }

  pushPointer(uvX: number, uvY: number) {
    if (!this.hasMoved) {
      this.prevMouse.set(uvX, uvY);
      this.mouse.set(uvX, uvY);
      this.hasMoved = true;
      return;
    }
    this.mouse.set(uvX, uvY);
  }

  resize(width: number, height: number, dpr: number) {
    this.sceneTarget.setSize(
      Math.max(1, Math.floor(width * dpr)),
      Math.max(1, Math.floor(height * dpr))
    );
    this.trailMat.uniforms.uAspect.value = width / Math.max(1, height);
  }

  render(
    renderer: THREE.WebGLRenderer,
    renderIntoTarget: (target: THREE.WebGLRenderTarget | null) => void,
    elapsed: number,
    enabled: boolean
  ) {
    if (!enabled) {
      renderIntoTarget(null);
      return;
    }

    const dx = this.mouse.x - this.prevMouse.x;
    const dy = this.mouse.y - this.prevMouse.y;
    const speed = Math.hypot(dx, dy);
    this.velocity.lerp(new THREE.Vector2(dx * 22, dy * 22), 0.45);

    this.trailMat.uniforms.uPrev.value = this.trailA.texture;
    this.trailMat.uniforms.uSpeed.value = speed;

    // 1. Update fluid wake target
    renderer.setRenderTarget(this.trailB);
    renderer.render(this.trailScene, this.orthoCam);

    const tmp = this.trailA;
    this.trailA = this.trailB;
    this.trailB = tmp;
    this.prevMouse.copy(this.mouse);

    // 2. Render main scene into offscreen target
    renderIntoTarget(this.sceneTarget);

    // 3. Composite chromatic refraction onto screen
    this.compositeMat.uniforms.uScene.value = this.sceneTarget.texture;
    this.compositeMat.uniforms.uTrail.value = this.trailA.texture;
    this.compositeMat.uniforms.uTime.value = elapsed;

    renderer.setRenderTarget(null);
    renderer.setClearColor(0x000000, 0);
    renderer.clear();
    renderer.render(this.compositeScene, this.orthoCam);
  }

  dispose() {
    this.quadGeo.dispose();
    this.trailMat.dispose();
    this.compositeMat.dispose();
    this.trailA.dispose();
    this.trailB.dispose();
    this.sceneTarget.dispose();
  }
}
