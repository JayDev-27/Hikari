import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { makeRandom, shadePetal } from './bloomGeometry';

const TAU = Math.PI * 2;
const LENGTH = 24;

function wall(angle: number, depth: number, inset = 0) {
  const fold = Math.sin(angle * 5 - depth * 3) * .14 + Math.sin(angle * 10 + depth * 12) * .022;
  const swell = 1.48 * (1 - Math.exp(-depth * 17)) + Math.sin(Math.PI * depth) * 1.34;
  const closure = THREE.MathUtils.smoothstep(depth, .78, 1);
  const radius = Math.max(.15, (.21 + swell) * (1 + fold) * (1 - closure * .79) - inset);
  return new THREE.Vector3(
    Math.cos(angle) * radius + Math.sin(depth * 6) * depth * .14,
    Math.sin(angle) * radius + Math.sin(depth * 8) * depth * .18,
    -.17 - depth * LENGTH,
  );
}

function surface(compact: boolean, foldCount: number, material: THREE.MeshPhysicalMaterial) {
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
    const angle = panel * TAU / 5 + Math.floor(panel / 5) * .58;
    const start = panel === 0 ? .019 : random() * .84;
    const run = .10 + random() * .15;
    const bend = (random() - .5) * .77;
    const lift = .12 + random() * .32;
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
        const pleat = .5 + .5 * Math.sin(theta * 5 - depth * 3);
        const sheen = .5 + .5 * Math.cos(theta - depth * 8);
        const rim = isFold ? Math.abs(sideways) ** 2 * .4 : pleat ** 2 * .18;
        shadePetal(color, .42 + .36 * pleat + .19 * depth, rim);
        color.multiplyScalar(.44 + .42 * sheen + .25 * pleat);
        color.r *= 1.14;
        color.b *= .83;
        colors.push(color.r, color.g, color.b);
        uv.push(isFold ? u : u * 5, .23 + depth * .76);
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
  return new THREE.Mesh(geometry, material);
}

function makeFilaments(compact: boolean) {
  const root = new THREE.Group();
  const random = makeRandom(2597);
  const count = compact ? 48 : 85;
  const temporary: THREE.TubeGeometry[] = [];
  const pollen = new THREE.InstancedMesh(
    new THREE.IcosahedronGeometry(1, 1),
    new THREE.MeshStandardMaterial({ color: '#fff8eb', roughness: .61, metalness: .10, emissive: '#8e745a', emissiveIntensity: .27 }),
    count,
  );
  const object = new THREE.Object3D();
  const paleGold = new THREE.Color('#ffe8b4');
  const pearl = new THREE.Color('#e1d7d1');
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

export function createBlossomInterior(compact: boolean, petalMaterial: THREE.MeshPhysicalMaterial) {
  const interior = new THREE.Group();
  interior.add(surface(compact, 0, petalMaterial), surface(compact, compact ? 5 : 10, petalMaterial), makeFilaments(compact));
  return interior;
}
