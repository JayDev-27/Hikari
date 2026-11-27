import * as THREE from 'three';

const TAU = Math.PI * 2;
const mix = THREE.MathUtils.lerp;
const petalBase = new THREE.Color('#ab739c');
const petalMid = new THREE.Color('#c5cdec');
const petalRim = new THREE.Color('#edf4ff');

export function shadePetal(color: THREE.Color, body: number, rim: number) {
  return color.copy(petalBase).lerp(petalMid, body).lerp(petalRim, rim);
}

export function makeRandom(seed: number) {
  return () => {
    seed = (Math.imul(1664525, seed) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

function petalGeometry(seed: number, length: number, width: number, segments: number) {
  const across = Math.ceil(segments * .68);
  const shape = new THREE.BufferGeometry();
  const open: number[] = [];
  const folded: number[] = [];
  const colors: number[] = [];
  const uv: number[] = [];
  const order: number[] = [];
  const tint = new THREE.Color();
  for (let row = 0; row <= segments; row++) {
    const t = row / segments;
    const taper = .49 + .51 * THREE.MathUtils.smoothstep(t, 0, .55);
    const span = .017 + width * Math.pow(Math.sin(Math.PI * t * .79), .74) * taper;
    for (let column = 0; column <= across; column++) {
      const s = 2 * column / across - 1;
      const edge = Math.abs(s);
      const notch = .24 * Math.exp(-((s * 4.6) ** 2));
      const roundedTip = .34 * (1 - Math.sqrt(Math.max(0, 1 - edge ** 2)));
      const radial = length * t - (notch + roundedTip) * t ** 2.8;
      const curl = edge ** 2 * .30 * Math.sin(Math.PI * t * .92);
      const ripple = Math.sin(s * 13 + seed + t * 12) * .025 * (edge ** 3 + t ** 3) * t;
      const twist = .10 * Math.sin(seed) * s * t ** 1.7;
      const x = s * span + .084 * t * t * Math.sin(seed);
      const y = .13 + radial;
      const pleat = .016 * Math.cos(s * 17 + t * 2 + seed) * Math.sin(Math.PI * t) * (1 - edge * .5);
      const z = pleat + .10 + .63 * t ** 3 - .42 * t + curl + ripple + twist;
      open.push(x, y, z);
      const bend = 1.12 + .24 * t;
      folded.push(x * (.46 - .13 * t), .14 + radial * Math.cos(bend) - .07 * s * s * t,
        .04 + radial * Math.sin(bend) + curl * .66 + twist);
      shadePetal(tint, THREE.MathUtils.smoothstep(t, 0, .54), Math.min(.9, .66 * edge ** 3.4 + .42 * t ** 2.9));
      tint.multiplyScalar(.92 + .10 * Math.sin(t * 6 + s * 3 + seed));
      colors.push(tint.r, tint.g, tint.b);
      uv.push(column / across, t);
      if (row < segments && column < across) {
        const here = row * (across + 1) + column;
        const above = here + across + 1;
        order.push(here, here + 1, above, here + 1, above + 1, above);
      }
    }
  }
  shape.setIndex(order);
  shape.setAttribute('position', new THREE.Float32BufferAttribute(open, 3));
  shape.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  shape.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  shape.computeVertexNormals();
  const closed = shape.clone();
  closed.setAttribute('position', new THREE.Float32BufferAttribute(folded, 3));
  closed.computeVertexNormals();
  shape.morphAttributes.position = [closed.getAttribute('position')];
  shape.morphAttributes.normal = [closed.getAttribute('normal')];
  closed.dispose();
  return shape;
}

function petalTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 512;
  const ctx = canvas.getContext('2d')!;
  const size = canvas.width;
  const random = makeRandom(4821);
  const grain = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const offset = (y * size + x) * 4;
      const value = 154 + random() * 14 + Math.sin(x * .79 + y * .09) * 3.5;
      grain.data.set([value, value, value, 255], offset);
    }
  }
  ctx.putImageData(grain, 0, 0);
  ctx.lineCap = 'round';
  for (let v = -11; v <= 11; v++) {
    const spread = v / 11;
    const tip = size / 2 + spread * 252;
    const start = size / 2 + spread * 68;
    ctx.strokeStyle = v === 0 ? 'rgba(248,248,248,.56)' : 'rgba(236,236,236,.31)';
    ctx.lineWidth = v % 4 === 0 ? 2.4 : .92;
    ctx.beginPath();
    ctx.moveTo(start, 512);
    ctx.bezierCurveTo(start + spread * 10, 388, tip - spread * 6, 175, tip, 10 + Math.abs(v) * 11);
    ctx.stroke();
    for (let branch = 1; branch <= 7; branch++) {
      const y = 85 + branch * 55 + random() * 23;
      const x = mix(tip, start, y / 512);
      const side = branch % 2 === 0 ? 1 : -1;
      const reach = 7 + random() * 11;
      ctx.strokeStyle = 'rgba(230,230,230,.24)';
      ctx.lineWidth = .64;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.quadraticCurveTo(x + side * reach * .46, y - 21, x + side * reach, y - 32 - random() * 10);
      ctx.stroke();
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.anisotropy = 4;
  texture.wrapS = THREE.RepeatWrapping;
  return texture;
}

function makeStamens(compact: boolean) {
  const random = makeRandom(819);
  const group = new THREE.Group();
  const count = compact ? 30 : 44;
  const thread = new THREE.MeshStandardMaterial({ color: '#e1d7d1', roughness: .38, metalness: .08 });
  const points = new THREE.SphereGeometry(1, 8, 6);
  const amber = new THREE.MeshStandardMaterial({
    color: '#f5c885', roughness: .38, metalness: .18,
    emissive: '#cf9865', emissiveIntensity: .15,
  });
  const anthers = new THREE.InstancedMesh(points, amber, count);
  const matrices = new THREE.Object3D();
  const coordinates: number[] = [];
  const indices: number[] = [];
  const tangent = new THREE.Vector3();
  const side = new THREE.Vector3();
  const cross = new THREE.Vector3();
  const vertex = new THREE.Vector3();
  const axis = new THREE.Vector3(0, 0, 1);
  for (let i = 0; i < count; i++) {
    const turn = i * 2.399963;
    const ring = Math.sqrt((i + .35) / count);
    const x = Math.cos(turn);
    const y = Math.sin(turn);
    const h = .22 + random() * .54;
    const extent = .25 + ring * .57 + (random() - .5) * .13;
    const bow = Math.sin(i * 1.7) * .42;
    const tipAngle = turn + bow * .65;
    const path = new THREE.QuadraticBezierCurve3(
      new THREE.Vector3(x * (.135 + ring * .06), y * (.135 + ring * .06), .035),
      new THREE.Vector3(Math.cos(turn + bow) * extent * .61, Math.sin(turn + bow) * extent * .61, h + .20),
      new THREE.Vector3(Math.cos(tipAngle) * extent, Math.sin(tipAngle) * extent, h),
    );
    const start = coordinates.length / 3;
    for (let row = 0; row <= 10; row++) {
      const t = row / 10;
      const center = path.getPoint(t);
      tangent.copy(path.getTangent(t));
      side.crossVectors(tangent, axis).normalize();
      cross.crossVectors(tangent, side).normalize();
      for (let c = 0; c < 5; c++) {
        const a = c / 5 * TAU;
        const radius = mix(.009, .0027, t);
        vertex.copy(center).addScaledVector(side, Math.cos(a) * radius).addScaledVector(cross, Math.sin(a) * radius);
        coordinates.push(vertex.x, vertex.y, vertex.z);
        if (row < 10) {
          const current = start + row * 5 + c;
          const next = start + row * 5 + (c + 1) % 5;
          indices.push(current, next, current + 5, next, next + 5, current + 5);
        }
      }
    }
    matrices.position.copy(path.v2);
    matrices.scale.set(.014 + random() * .013, .013, .021 + random() * .014);
    matrices.quaternion.setFromUnitVectors(axis, path.getTangent(1));
    matrices.updateMatrix();
    anthers.setMatrixAt(i, matrices.matrix);
  }
  const stems = new THREE.BufferGeometry();
  stems.setAttribute('position', new THREE.Float32BufferAttribute(coordinates, 3));
  stems.setIndex(indices);
  stems.computeVertexNormals();
  group.add(new THREE.Mesh(stems, thread), anthers);
  return group;
}

function makeThroat() {
  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const rows = 9;
  const around = 70;
  const deep = new THREE.Color('#182953');
  const edge = new THREE.Color('#718fc9');
  const tint = new THREE.Color();
  for (let row = 0; row <= rows; row++) {
    const u = row / rows;
    for (let ring = 0; ring <= around; ring++) {
      const a = ring / around * TAU;
      const lobe = Math.sin(a * 5 + u * 2.2);
      const radius = mix(.105, .328, u) * (1 + lobe * .114 * (1 - u * .59));
      const height = -.026 + u * .115 + (lobe * .018 + Math.sin(a * 12) * .006) * u;
      positions.push(Math.cos(a) * radius, Math.sin(a) * radius, height);
      tint.copy(deep).lerp(edge, u * .89 + (.5 + .5 * lobe) * .09);
      colors.push(tint.r, tint.g, tint.b);
      if (row < rows && ring < around) {
        const start = row * (around + 1) + ring;
        const above = start + around + 1;
        indices.push(start, above, start + 1, start + 1, above, above + 1);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({
    side: THREE.DoubleSide, vertexColors: true, roughness: .61,
    emissive: '#344e8c', emissiveIntensity: .10,
  }));
}

export function createBlossom(compact: boolean) {
  const root = new THREE.Group();
  const anatomy = new THREE.Group();
  const petalMeshes: THREE.Mesh[] = [];
  const droplets: { mesh: THREE.Mesh; petal: THREE.Mesh; from: THREE.Vector3; to: THREE.Vector3 }[] = [];
  const dropletGeometry = new THREE.SphereGeometry(1, 16, 10);
  const dropletMaterial = new THREE.MeshPhysicalMaterial({
    color: '#c5ddff', roughness: .1, metalness: .34, clearcoat: 1, clearcoatRoughness: .09,
    transparent: true, opacity: .83, depthWrite: false,
  });
  const texture = petalTexture();
  const material = new THREE.MeshPhysicalMaterial({
    vertexColors: true, color: '#dce8ff', side: THREE.DoubleSide,
    metalness: .015, roughness: .54, clearcoat: .16, clearcoatRoughness: .24,
    iridescence: compact ? 0 : .06, iridescenceIOR: 1.28, iridescenceThicknessRange: [255, 424],
    sheen: .54, sheenColor: new THREE.Color('#9daaf3'), sheenRoughness: .52,
    emissive: '#526cb1', emissiveIntensity: .16, bumpMap: texture, bumpScale: .047,
  });
  material.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <color_fragment>', `#include <color_fragment>
        float fiber = texture2D(bumpMap, vBumpMapUv).r;
        float vein = smoothstep(.61, .84, fiber);
        float across = abs(fract(vBumpMapUv.x) * 2.0 - 1.0);
        diffuseColor.rgb *= .88 + .27 * vein;
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(.9, .81, .94), vein * .32);`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        float edge = smoothstep(.72, 1., across);
        float tip = smoothstep(.86, 1., vBumpMapUv.y);
        totalEmissiveRadiance += vec3(.26, .40, .75) * (vein*.10 + (edge+tip)*.19);`);
  };
  const petals = [
    [2.81, 1.13], [2.65, 1.20], [2.88, 1.15], [2.72, 1.19], [2.82, 1.15],
  ];
  for (let p = 0; p < petals.length; p++) {
    const [length, width] = petals[p];
    const petal = new THREE.Mesh(petalGeometry(p * 2.31, length, width * 1.12, compact ? 42 : 62), material);
    petal.rotation.z = p / 5 * TAU + .035 * Math.cos(p * 3);
    petalMeshes.push(petal);
    const dew = p === 2 ? [[.61, .82, .061], [.68, .74, .027], [.56, .90, .023]]
      : p === 4 && !compact ? [[.44, .79, .043], [.30, .84, .021]] : [];
    for (const [u, v, radius] of dew) {
      const uv = petal.geometry.getAttribute('uv');
      let index = 0;
      let min = Infinity;
      for (let i = 0; i < uv.count; i++) {
        const distance = (uv.getX(i) - u) ** 2 + (uv.getY(i) - v) ** 2;
        if (distance < min) { index = i; min = distance; }
      }
      const from = new THREE.Vector3().fromBufferAttribute(petal.geometry.getAttribute('position'), index);
      const to = new THREE.Vector3().fromBufferAttribute(petal.geometry.morphAttributes.position[0], index);
      from.z += radius * .32;
      to.z += radius * .32;
      const mesh = new THREE.Mesh(dropletGeometry, dropletMaterial);
      mesh.scale.set(radius, radius * .89, radius * .60);
      droplets.push({ mesh, petal, from, to });
      petal.add(mesh);
    }
    root.add(petal);
  }
  const calyxMaterial = new THREE.MeshStandardMaterial({
    color: '#465a78', roughness: .49, metalness: .23, vertexColors: true, side: THREE.DoubleSide,
  });
  for (let i = 0; i < 5; i++) {
    const sepal = new THREE.Mesh(petalGeometry(i * 2.31, .93, .27, 15), calyxMaterial);
    sepal.rotation.set(.42, 0, (i + .5) / 5 * TAU);
    sepal.position.z = -.47;
    anatomy.add(sepal);
  }
  const base = new THREE.Mesh(new THREE.SphereGeometry(.26, 26, 16), calyxMaterial.clone());
  base.material.vertexColors = false;
  base.position.z = -.33;
  base.material.color.set('#182642');
  base.material.roughness = .66;
  base.scale.z = .95;
  anatomy.add(base);
  const stalk = new THREE.CubicBezierCurve3(
    new THREE.Vector3(.02, -.035, -.39), new THREE.Vector3(-.13, -.22, -.74),
    new THREE.Vector3(-.34, -.87, -.95), new THREE.Vector3(-.44, -1.55, -1.35),
  );
  anatomy.add(new THREE.Mesh(
    new THREE.TubeGeometry(stalk, 24, .082, 8, false),
    new THREE.MeshStandardMaterial({ color: '#3e4b56', roughness: .53 }),
  ));
  const stamens = makeStamens(compact);
  root.add(anatomy, stamens);
  const throat = makeThroat();
  root.add(throat);
  return {
    root,
    petalMaterial: material,
    open(amount: number, pass: number) {
      for (let i = 0; i < petalMeshes.length; i++) {
        const stagger = .037 * Math.sin(i * 1.77);
        petalMeshes[i].morphTargetInfluences![0] = 1 - THREE.MathUtils.clamp(amount + stagger, 0, 1);
      }
      for (const { mesh, petal, from, to } of droplets) {
        mesh.position.lerpVectors(from, to, petal.morphTargetInfluences![0]);
      }
      const spread = mix(.74, 1, amount) + pass * .22;
      stamens.scale.set(spread, spread, mix(.78, 1, amount));
      throat.scale.setScalar(1 + pass * .71);
      throat.material.emissiveIntensity = .12 + pass * .42;
      anatomy.visible = pass < .40;
      stamens.visible = pass < .93;
    },
  };
}
