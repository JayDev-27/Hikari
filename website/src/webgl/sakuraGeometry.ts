import * as THREE from 'three';

function buildSakuraShape(scale = 1): THREE.Shape {
  const shape = new THREE.Shape();
  const petals = 5;
  const outerR = 1.05 * scale;
  const innerR = 0.22 * scale;
  const notchR = 0.86 * scale;

  for (let i = 0; i < petals; i++) {
    const baseAngle = (i / petals) * Math.PI * 2 - Math.PI / 2;
    const halfSpan = (Math.PI / petals) * 0.86;
    const leftAngle = baseAngle - halfSpan;
    const rightAngle = baseAngle + halfSpan;
    const midLeft = baseAngle - halfSpan * 0.26;
    const midRight = baseAngle + halfSpan * 0.26;

    const startX = Math.cos(leftAngle) * innerR;
    const startY = Math.sin(leftAngle) * innerR;

    if (i === 0) shape.moveTo(startX, startY);
    else shape.lineTo(startX, startY);

    shape.bezierCurveTo(
      Math.cos(leftAngle - 0.08) * outerR * 0.72,
      Math.sin(leftAngle - 0.08) * outerR * 0.72,
      Math.cos(midLeft - 0.06) * outerR * 1.1,
      Math.sin(midLeft - 0.06) * outerR * 1.1,
      Math.cos(baseAngle - 0.09) * outerR,
      Math.sin(baseAngle - 0.09) * outerR
    );

    shape.lineTo(Math.cos(baseAngle) * notchR, Math.sin(baseAngle) * notchR);
    shape.lineTo(Math.cos(baseAngle + 0.09) * outerR, Math.sin(baseAngle + 0.09) * outerR);

    shape.bezierCurveTo(
      Math.cos(midRight + 0.06) * outerR * 1.1,
      Math.sin(midRight + 0.06) * outerR * 1.1,
      Math.cos(rightAngle + 0.08) * outerR * 0.72,
      Math.sin(rightAngle + 0.08) * outerR * 0.72,
      Math.cos(rightAngle) * innerR,
      Math.sin(rightAngle) * innerR
    );
  }
  shape.closePath();

  const hole = new THREE.Path();
  const hR = 0.14 * scale;
  hole.moveTo(0, hR);
  hole.lineTo(hR * 0.85, 0);
  hole.lineTo(0, -hR);
  hole.lineTo(-hR * 0.85, 0);
  hole.closePath();
  shape.holes.push(hole);

  return shape;
}

/**
 * Refined thin-profile sculptural 5-petal sakura crystal with sleek chamfered edges.
 */
export function createSakuraPrismGeometry(scale = 1, depth = 0.09): THREE.ExtrudeGeometry {
  const shape = buildSakuraShape(scale);
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelThickness: 0.045 * scale,
    bevelSize: 0.03 * scale,
    bevelSegments: 6,
    curveSegments: 32,
  });
  geo.center();
  geo.computeVertexNormals();
  return geo;
}

/**
 * Single delicate sakura petal geometry for ambient 3D particle drift.
 */
export function createSinglePetalGeometry(scale = 0.16): THREE.ExtrudeGeometry {
  const s = new THREE.Shape();
  s.moveTo(0, 0);
  s.bezierCurveTo(-0.55 * scale, 0.35 * scale, -0.65 * scale, 1.15 * scale, -0.14 * scale, 1.4 * scale);
  s.lineTo(0, 1.22 * scale);
  s.lineTo(0.14 * scale, 1.4 * scale);
  s.bezierCurveTo(0.65 * scale, 1.15 * scale, 0.55 * scale, 0.35 * scale, 0, 0);

  const geo = new THREE.ExtrudeGeometry(s, {
    depth: 0.014 * scale,
    bevelEnabled: true,
    bevelThickness: 0.01 * scale,
    bevelSize: 0.01 * scale,
    bevelSegments: 2,
    curveSegments: 16,
  });
  geo.center();
  geo.computeVertexNormals();
  return geo;
}

/**
 * Builds a sweeping S-curve 3D ribbon inspired by Lusion's cobalt showreel tube.
 */
export function createSweepingRibbonGeometry(): THREE.TubeGeometry {
  const curve = new THREE.CatmullRomCurve3(
    [
      new THREE.Vector3(7.5, 4.4, -3.5),
      new THREE.Vector3(4.2, 2.5, -1.2),
      new THREE.Vector3(2.8, 0.2, 0.6),
      new THREE.Vector3(-1.4, -1.6, 1.2),
      new THREE.Vector3(-4.8, -0.4, -0.4),
      new THREE.Vector3(-3.2, -3.4, -1.8),
      new THREE.Vector3(2.4, -4.6, -2.5),
      new THREE.Vector3(7.2, -5.8, -4.0),
    ],
    false,
    'catmullrom',
    0.55
  );

  return new THREE.TubeGeometry(curve, 160, 0.34, 28, false);
}

/**
 * Generates a balanced studio specular environment map without external HDR downloads.
 */
export function createStudioEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture {
  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();

  const envScene = new THREE.Scene();
  envScene.background = new THREE.Color('#090812');

  const panelGeo = new THREE.PlaneGeometry(10, 10);

  const topSoftbox = new THREE.Mesh(
    panelGeo,
    new THREE.MeshBasicMaterial({ color: new THREE.Color(1.8, 1.85, 2.2), side: THREE.DoubleSide })
  );
  topSoftbox.position.set(0, 7, 3);
  topSoftbox.lookAt(0, 0, 0);
  envScene.add(topSoftbox);

  const sakuraRim = new THREE.Mesh(
    panelGeo,
    new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 0.85, 1.65), side: THREE.DoubleSide })
  );
  sakuraRim.position.set(-7, 2, 4);
  sakuraRim.lookAt(0, 0, 0);
  envScene.add(sakuraRim);

  const cobaltRim = new THREE.Mesh(
    panelGeo,
    new THREE.MeshBasicMaterial({ color: new THREE.Color(0.45, 0.75, 2.6), side: THREE.DoubleSide })
  );
  cobaltRim.position.set(7, -2, 4);
  cobaltRim.lookAt(0, 0, 0);
  envScene.add(cobaltRim);

  const target = pmrem.fromScene(envScene, 0.04);
  panelGeo.dispose();
  (topSoftbox.material as THREE.Material).dispose();
  (sakuraRim.material as THREE.Material).dispose();
  (cobaltRim.material as THREE.Material).dispose();
  pmrem.dispose();

  return target.texture;
}
