import * as THREE from 'three';
import { FluidPass } from './FluidPass';
import { createBlossomInterior } from './blossomInterior';
import { createBlossom, makeRandom } from './bloomGeometry';

export const easedRange = (value: number, from: number, to: number) =>
  THREE.MathUtils.smoothstep(value, from, to);

const mix = THREE.MathUtils.lerp;

function reflections(renderer: THREE.WebGLRenderer) {
  const surround = new THREE.Scene();
  surround.background = new THREE.Color('#22304e');
  const geometry = new THREE.PlaneGeometry(1, 1);
  const cards = [
    { position: [-4, 5, 5], scale: [5, 3], color: [3.6, 4.1, 5.5] },
    { position: [4, -1, 2], scale: [2, 5], color: [.8, 1.6, 4.9] },
    { position: [-3, -3, 1], scale: [3, 2], color: [1.45, 1.16, 2.84] },
    { position: [0, 3, -5], scale: [5, 2], color: [2.38, 3.5, 6.3] },
  ];
  for (const card of cards) {
    const panel = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({
      color: new THREE.Color().setRGB(card.color[0], card.color[1], card.color[2]),
      side: THREE.DoubleSide,
    }));
    panel.position.set(card.position[0], card.position[1], card.position[2]);
    panel.scale.set(card.scale[0], card.scale[1], 1);
    panel.lookAt(0, 0, 0);
    surround.add(panel);
  }
  const pmrem = new THREE.PMREMGenerator(renderer);
  try {
    return pmrem.fromScene(surround, .036, .1, 18);
  } finally {
    geometry.dispose();
    surround.children.forEach((object) => (object as THREE.Mesh<THREE.PlaneGeometry, THREE.Material>).material.dispose());
    pmrem.dispose();
  }
}

function makeDust(compact: boolean) {
  const random = makeRandom(49276);
  const positions: number[] = [];
  const sizes: number[] = [];
  const light: number[] = [];
  const count = compact ? 155 : 340;
  for (let i = 0; i < count; i++) {
    positions.push((random() - .5) * 27, (random() - .5) * 16, mix(3.4, -29, random()));
    sizes.push(mix(3.3, i % 8 === 0 ? 22 : 7, random() ** 2));
    light.push(mix(.07, i % 8 === 0 ? .26 : .88, random()));
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('aSize', new THREE.Float32BufferAttribute(sizes, 1));
  geometry.setAttribute('aLight', new THREE.Float32BufferAttribute(light, 1));
  const material = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uDpr: { value: 1 } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `
      uniform float uTime;
      uniform float uDpr;
      attribute float aSize;
      attribute float aLight;
      varying float vLight;
      varying float vSoft;
      void main() {
        vec3 pos = position;
        pos.x += sin(uTime * .17 + position.y) * .18;
        pos.y += cos(uTime * .12 + position.x) * .19;
        vec4 view = modelViewMatrix * vec4(pos, 1.);
        vSoft = smoothstep(6., 18., aSize);
        vLight = aLight * smoothstep(.45, 2.4, -view.z) * (1. - smoothstep(17., 34., -view.z));
        gl_Position = projectionMatrix * view;
        gl_PointSize = clamp(aSize * uDpr * 5.5 / max(1., -view.z), 1., 34.);
      }`,
    fragmentShader: `
      varying float vLight;
      varying float vSoft;
      void main() {
        float r = length(gl_PointCoord - .5) * 2.;
        float a = exp(-r*r*mix(9., 3.8, vSoft)) * (1. - smoothstep(.66, 1., r));
        gl_FragColor = vec4(mix(vec3(.62,.72,1.),vec3(.34,.57,1.),vSoft), a*vLight);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const dust = new THREE.Points(geometry, material);
  dust.frustumCulled = false;
  return dust;
}

function createFloatingPetals(compact: boolean) {
  const layer = new THREE.Group();
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const context = canvas.getContext('2d')!;
  context.translate(64, 64);
  context.rotate(-.28);
  context.scale(1, .53);
  const falloff = context.createRadialGradient(0, 0, 8, 0, 0, 57);
  falloff.addColorStop(0, 'rgba(199,216,255,.81)');
  falloff.addColorStop(.46, 'rgba(145,175,249,.54)');
  falloff.addColorStop(1, 'rgba(91,125,226,0)');
  context.fillStyle = falloff;
  context.fillRect(-64, -90, 128, 180);
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  const origins = [
    [3.66, 2.83, .31, 1.25], [-3.9, 1.72, -1.89, 1.12],
    [3.96, -2.45, .51, 1.40], [-3.38, -2.56, .84, .99],
    [3.57, .71, -3.15, .71], [-2.7, 2.66, -4.41, .65],
  ];
  const petals = origins.slice(0, compact ? 3 : origins.length).map(([x, y, z, size]) => {
    const petal = new THREE.Sprite(new THREE.SpriteMaterial({ map, depthWrite: false, transparent: true }));
    petal.scale.setScalar(size);
    layer.add(petal);
    return { petal, x, y, z };
  });
  return {
    layer,
    draw(time: number, fade: number) {
      petals.forEach(({ petal, x, y, z }, index) => {
        petal.position.set(x + Math.sin(time * .29 + index) * .35, y + Math.cos(time * .24 + index) * .26, z);
        petal.material.rotation = Math.sin(time * .33 + index * 2) * .76;
        petal.material.opacity = fade * (index % 2 === 0 ? .42 : .25);
      });
    },
  };
}

function glow() {
  const material = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { intensity: { value: 0 } },
    vertexShader: 'varying vec2 vUv; void main(){vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
    fragmentShader: `
      uniform float intensity;
      varying vec2 vUv;
      void main(){
        float r = length((vUv-.5)*2.);
        float glow = exp(-r*r*7.0) * (1. - smoothstep(.65,1.,r));
        float core = exp(-r*r*32.);
        gl_FragColor = vec4(mix(vec3(.60,.48,.78),vec3(1.,.89,.84),core), glow*intensity);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  return new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
}

export function createSakuraExperience(container: HTMLElement) {
  const canvas = document.createElement('canvas');
  const compact = matchMedia('(max-width: 720px)').matches;
  const context = canvas.getContext('webgl2', { alpha: true, antialias: true, powerPreference: 'high-performance' });
  if (!context) throw new Error('WebGL 2 is unavailable');
  const renderer = new THREE.WebGLRenderer({ canvas, context, alpha: true, antialias: true });
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor(0x000000, 0);
  const scene = new THREE.Scene();
  const environment = reflections(renderer);
  scene.environment = environment.texture;
  scene.environmentIntensity = .58;

  const key = new THREE.SpotLight('#ffe4ca', 145, 14, .57, .85, 2);
  key.position.set(-2.8, 3.7, 3.4);
  key.target.position.set(-.6, .65, 0);
  scene.add(key.target);
  const fill = new THREE.DirectionalLight('#9caeff', .62);
  fill.position.set(5, -.8, 2.2);
  const back = new THREE.DirectionalLight('#93b8ff', 2.14);
  back.position.set(1, 2, -3);
  const lower = new THREE.DirectionalLight('#eab5ce', .30);
  lower.position.set(-2.5, -3, 1);
  const exteriorAmbient = new THREE.Color('#becfff');
  const interiorAmbient = new THREE.Color('#f3dbee');
  const ambient = new THREE.AmbientLight(exteriorAmbient, .20);
  scene.add(key, fill, back, lower, ambient);

  const flower = createBlossom(compact);
  const dust = makeDust(compact);
  const floating = createFloatingPetals(compact);
  const tunnel = createBlossomInterior(compact, flower.petalMaterial);
  scene.add(tunnel);
  const horizon = glow();
  horizon.position.z = -24.02;
  horizon.scale.setScalar(3.7);
  const threshold = glow();
  threshold.scale.setScalar(1.82);
  threshold.position.z = -.36;
  scene.add(horizon, flower.root, floating.layer, dust, threshold);
  const camera = new THREE.PerspectiveCamera(35, 1, .035, 72);
  // Warm the interior shaders before the camera reaches the throat.
  void renderer.compileAsync(scene, camera).catch(() => {});
  tunnel.visible = false;
  let width = 1;
  let height = 1;
  let dpr = 1;
  let lastPointer = -Infinity;
  let fluid: FluidPass | null = null;
  const pointer = new THREE.Vector2();
  const rotation = new THREE.Vector2();
  const fluidType = context.getExtension('EXT_color_buffer_float') ? THREE.HalfFloatType : THREE.UnsignedByteType;
  const cursorLifetime = 2.05;

  function movePointer(x: number, y: number, time: number) {
    pointer.set(x * 2 - 1, y * 2 - 1);
    fluid ??= new FluidPass(width, height, dpr, fluidType);
    if (time - lastPointer > cursorLifetime) fluid.resetPointer();
    fluid.pushPointer(x, y);
    lastPointer = time;
  }
  container.append(canvas);

  function resize() {
    width = Math.max(1, container.clientWidth);
    height = Math.max(1, container.clientHeight);
    dpr = Math.min(devicePixelRatio || 1, width < 800 ? 1.15 : 1.4, Math.sqrt(1600000 / (width * height)));
    renderer.setPixelRatio(dpr);
    renderer.setSize(width, height, false);
    dust.material.uniforms.uDpr.value = dpr;
    fluid?.resize(width, height, dpr);
  }

  function draw(progress: number, time: number, yaw: number, pitch: number, inspect: boolean) {
    const narrow = width < 720;
    const bloom = easedRange(progress, .035, .43);
    const approach = easedRange(progress, .41, .667);
    const pass = easedRange(progress, .617, .763);
    const travel = easedRange(progress, .702, 1);
    const thresholdPass = easedRange(progress, .515, .714);
    const interiorLight = inspect ? 0 : easedRange(progress, .60, .81);
    fill.intensity = mix(.62, .36, interiorLight);
    back.intensity = mix(2.14, 1.25, interiorLight);
    ambient.intensity = mix(.20, .59, interiorLight);
    ambient.color.lerpColors(exteriorAmbient, interiorAmbient, interiorLight);
    flower.open(inspect ? 1 : mix(.86, 1, bloom), inspect ? 0 : thresholdPass);
    const cursorActive = time > 0 && !inspect;
    if (cursorActive) rotation.lerp(pointer, .11);
    else rotation.set(0, 0);
    flower.root.rotation.set(-.032 - rotation.y * .09 * (1 - approach),
      Math.sin(time * .26) * .032 + rotation.x * .13 * (1 - approach), -.19 + .12 * bloom);
    const outsideDepth = Math.max(narrow ? 13.2 : 12.4, (narrow ? 8.2 : 10.2) * height / width) + bloom * .7;
    if (inspect) {
      const radius = narrow ? 15.1 : 10.6;
      const horizontal = Math.cos(pitch) * radius;
      camera.position.set(Math.sin(yaw) * horizontal, Math.sin(pitch) * radius, Math.cos(yaw) * horizontal);
      camera.lookAt(0, 0, 0);
      camera.fov = narrow ? 46 : 37;
      camera.setViewOffset(width, height, 0, narrow ? height * .085 : 0, width, height);
    } else {
      const z = mix(outsideDepth, 1.18, approach) - pass * 4.55 - travel * 21.6;
      const x = mix(2.71, .25, bloom) * (1 - approach) + Math.sin(travel * 6) * travel * .14;
      const y = mix(.95, .18, bloom) * (1 - approach) + Math.sin(travel * 8) * travel * .18;
      camera.position.set(x, y, z);
      camera.lookAt(travel * .14, travel * -.08, Math.min(-.25, z - 2.15));
      camera.rotateZ(travel * .115 - Math.sin(approach * Math.PI) * .048);
      camera.fov = narrow ? mix(42, 59, pass) : mix(35, 57, pass);
      camera.setViewOffset(width, height, 0, height * (width < 900 && height > 580 ? (narrow ? -.20 : -.14) : .055) * (1 - approach), width, height);
    }
    camera.updateProjectionMatrix();
    const insideVisible = !inspect && progress > .48;
    tunnel.visible = insideVisible;
    flower.root.visible = pass < .99;
    dust.material.uniforms.uTime.value = time;
    floating.draw(time, 1 - easedRange(approach, .1, .6));
    threshold.visible = !inspect && pass < .47;
    threshold.material.uniforms.intensity.value = (1 - pass) * (.06 + .13 * bloom + .55 * thresholdPass);
    horizon.visible = insideVisible;
    horizon.material.uniforms.intensity.value = (.31 + .66 * travel) * easedRange(pass, .08, .77);
    if (fluid && cursorActive && time - lastPointer < cursorLifetime) {
      fluid.render(renderer, (target) => {
        renderer.setRenderTarget(target);
        renderer.render(scene, camera);
      }, time);
    } else {
      renderer.setRenderTarget(null);
      renderer.render(scene, camera);
    }
  }

  function dispose() {
    const objects = new Set<THREE.BufferGeometry | THREE.Material | THREE.Texture | THREE.InstancedMesh>();
    scene.traverse((object) => {
      if (object instanceof THREE.InstancedMesh) objects.add(object);
      if (object instanceof THREE.Mesh || object instanceof THREE.Points || object instanceof THREE.LineSegments || object instanceof THREE.Sprite) {
        if (!(object instanceof THREE.Sprite)) objects.add(object.geometry);
        const material = object.material as THREE.Material;
        objects.add(material);
        for (const value of Object.values(material)) if (value instanceof THREE.Texture) objects.add(value);
      }
    });
    objects.forEach((object) => object.dispose());
    fluid?.dispose();
    environment.dispose();
    renderer.dispose();
    canvas.remove();
  }

  return { canvas, draw, resize, dispose, movePointer };
}
