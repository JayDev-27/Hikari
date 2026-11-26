import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { makeRandom } from './bloomGeometry';

const TAU = Math.PI * 2;
const LENGTH = 24;
const cool = new THREE.Color('#203467');
const soft = new THREE.Color('#7599d7');
const veinLight = new THREE.Color('#c7d9fa');

function wall(angle: number, depth: number, inset = 0) {
  const fold = Math.sin(angle * 5 - depth * 6) * .139 + Math.sin(angle * 11 + depth * 18) * .055;
  const swell = 1.48 * (1 - Math.exp(-depth * 17)) + Math.sin(Math.PI * depth) * 1.34;
  const closure = THREE.MathUtils.smoothstep(depth, .78, 1);
  const radius = Math.max(.15, (.21 + swell) * (1 + fold) * (1 - closure * .79) - inset);
  return new THREE.Vector3(
    Math.cos(angle) * radius + Math.sin(depth * 6) * depth * .14,
    Math.sin(angle) * radius + Math.sin(depth * 8) * depth * .18,
    -.17 - depth * LENGTH,
  );
}

function addTissueDetail(material: THREE.MeshStandardMaterial) {
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = 'varying vec2 vTissue;\n' + shader.vertexShader.replace(
      '#include <begin_vertex>',
      '#include <begin_vertex>\n vTissue = uv;',
    );
    shader.fragmentShader = 'varying vec2 vTissue;\n' + shader.fragmentShader
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec2 q = vTissue;
        float strand = cos(q.x * 234. + sin(q.y * 19. + q.x * 29.) * 1.8);
        float fiber = pow(max(0., strand), 16.);
        float crossGrain = sin(q.y * 1140. + sin(q.x * 190.) * 3.) * sin(q.x * 665.);
        float grain = .92 + crossGrain * .065;
        diffuseColor.rgb *= grain * (.81 + fiber * .27);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(.43,.55,.81), fiber*.11);`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance += vec3(.15, .22, .36) * fiber * .095;`);
  };
}

function surface(compact: boolean, foldCount: number) {
  const segments = compact ? 68 : 110;
  const around = foldCount ? 14 : compact ? 80 : 120;
  const columns = around + 1;
  const positions: number[] = [];
  const colors: number[] = [];
  const uv: number[] = [];
  const indices: number[] = [];
  const random = makeRandom(8814);
  const color = new THREE.Color();
  for (let panel = 0; panel < Math.max(1, foldCount); panel++) {
    const isFold = foldCount > 0;
    const base = positions.length / 3;
    const angle = panel * 2.399963;
    const start = panel === 0 ? .019 : random() * .84;
    const run = .064 + random() * .12;
    const bend = (random() - .5) * .77;
    const lift = .14 + random() * .48;
    const rows = isFold ? 25 : segments;
    for (let r = 0; r <= rows; r++) {
      const t = r / rows;
      const taper = Math.sin(t * Math.PI) ** .7;
      for (let c = 0; c <= around; c++) {
        const u = c / around;
        const sideways = 2 * u - 1;
        const theta = isFold ? angle + (bend * t + sideways * .31 * taper) : u * TAU;
        const depth = isFold ? start + t * run : t;
        const inner = isFold ? .014 + taper * lift * (1 - sideways ** 2 * .61) : 0;
        const point = wall(theta, depth, inner);
        positions.push(point.x, point.y, point.z);
        const marbling = .5 + .5 * Math.sin(theta * 8 + depth * 41 + panel) * Math.cos(theta * 3 - depth * 20);
        color.copy(cool).lerp(soft, isFold ? .36 + .32 * marbling + Math.abs(sideways) * .22 : .15 + marbling * .52);
        if (isFold) color.lerp(veinLight, Math.sin(t * Math.PI) * .13);
        colors.push(color.r, color.g, color.b);
        uv.push(isFold ? u * .34 + panel * .012 : u, depth);
        if (r < rows && c < around) {
          const index = base + r * columns + c;
          indices.push(index, index + columns, index + 1, index + 1, index + columns, index + columns + 1);
        }
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const material = new THREE.MeshStandardMaterial({
    vertexColors: true, side: THREE.DoubleSide, roughness: .55, metalness: .14,
    emissive: '#233d77', emissiveIntensity: foldCount === 0 ? .15 : .25,
  });
  addTissueDetail(material);
  return new THREE.Mesh(geometry, material);
}

function traceVeins(compact: boolean) {
  const pos: number[] = [];
  const colors: number[] = [];
  const random = makeRandom(7245);
  const tint = new THREE.Color();
  const ribs = compact ? 34 : 48;
  const steps = compact ? 68 : 103;
  const dark = new THREE.Color('#3b578d');
  const bright = new THREE.Color('#afc8f5');

  function segment(a: THREE.Vector3, b: THREE.Vector3, brightness: number) {
    pos.push(a.x, a.y, a.z, b.x, b.y, b.z);
    tint.copy(dark).lerp(bright, brightness);
    colors.push(tint.r, tint.g, tint.b, tint.r, tint.g, tint.b);
  }

  for (let rib = 0; rib < ribs; rib++) {
    const azimuth = (rib + random() * .6) / ribs * TAU;
    function path(t: number) {
      return azimuth + .13 * Math.sin(12 * t + rib * .42) + .046 * Math.cos(31 * t + rib);
    }
    for (let row = 0; row < steps; row++) {
      const t = row / steps;
      const next = (row + 1) / steps;
      const intensity = .46 + Math.sin(11 * t + rib) * .39;
      segment(wall(path(t), t, .023), wall(path(next), next, .023), intensity);
      if (row < 2 || row > steps - 7 || (row + rib) % 5 !== 0) continue;
      for (const sign of [-1, 1]) {
        const span = (.027 + random() * .039) * sign;
        const reach = .025 + random() * .028;
        let last = wall(path(t), t, .025);
        for (let branch = 1; branch <= 7; branch++) {
          const p = branch / 7;
          const depth = t + reach * p;
          const tip = wall(path(depth) + span * Math.sin(p * Math.PI / 2), depth, .025);
          segment(last, tip, intensity * (1 - p * .74));
          last = tip;
        }
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  return new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({
    vertexColors: true, transparent: true, opacity: .26, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
}

function makeFilaments(compact: boolean) {
  const root = new THREE.Group();
  const random = makeRandom(2597);
  const count = compact ? 75 : 148;
  const temporary: THREE.TubeGeometry[] = [];
  const pollen = new THREE.InstancedMesh(
    new THREE.IcosahedronGeometry(1, 1),
    new THREE.MeshStandardMaterial({ color: '#fff8eb', roughness: .61, metalness: .10, emissive: '#8e745a', emissiveIntensity: .27 }),
    count,
  );
  const object = new THREE.Object3D();
  const paleGold = new THREE.Color('#ffe8b4');
  const pearl = new THREE.Color('#aebeed');
  for (let i = 0; i < count; i++) {
    const angle = i * 2.399963 + random() * .43;
    const depth = .025 + random() ** 1.35 * .91;
    const reach = Math.min(.19 + random() * .60, .20 + depth * 1.48);
    const root = wall(angle, depth, .014);
    const center = wall(angle + .06, depth - .012, reach * .42);
    const tip = wall(angle + (random() - .3) * .22, depth - .006 - random() * .02, reach);
    const path = new THREE.QuadraticBezierCurve3(root, center, tip);
    const thickness = .004 + random() * .0056;
    temporary.push(new THREE.TubeGeometry(path, 9, thickness, 4, false));
    const radius = .008 + random() * .015;
    object.position.copy(tip);
    object.scale.set(radius, radius * 1.4, radius);
    object.rotation.set(angle, depth * 21, angle * .41);
    object.updateMatrix();
    pollen.setMatrixAt(i, object.matrix);
    pollen.setColorAt(i, i % 4 === 0 ? pearl : paleGold);
  }
  const fibers = mergeGeometries(temporary);
  temporary.forEach((geometry) => geometry.dispose());
  root.add(
    new THREE.Mesh(fibers, new THREE.MeshStandardMaterial({
      color: '#a9bacf', roughness: .61, emissive: '#8498ba', emissiveIntensity: .22,
    })),
    pollen,
  );
  return root;
}

export function createBlossomInterior(compact: boolean) {
  const interior = new THREE.Group();
  interior.add(surface(compact, 0), surface(compact, compact ? 13 : 22), traceVeins(compact), makeFilaments(compact));
  const lights = [
    { x: -.06, y: .20, z: -.8, color: '#cbdcff', strength: 5.4, distance: 4.1 },
    { x: .64, y: .22, z: -4.7, color: '#99baff', strength: 13, distance: 7.1 },
    { x: -.41, y: -.37, z: -9.3, color: '#bbd6ff', strength: 13, distance: 7.2 },
    { x: .55, y: .28, z: -14.8, color: '#9bb6ff', strength: 14, distance: 7.6 },
    { x: -.18, y: .11, z: -21.5, color: '#c6d6ff', strength: 11, distance: 6.6 },
  ];
  for (const light of lights) {
    const lamp = new THREE.PointLight(light.color, light.strength, light.distance, 2);
    lamp.position.set(light.x, light.y, light.z);
    interior.add(lamp);
  }
  return interior;
}
