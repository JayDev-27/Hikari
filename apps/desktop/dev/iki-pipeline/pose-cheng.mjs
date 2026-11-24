import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const file = process.argv[2];
const model = JSON.parse(readFileSync(file, "utf8"));
const { width, height } = model.canvas;
const clap = "ParamChengClap";
const depth = "ParamChengClapDepth";
model.parameters.push({ id: clap, name: "Photo-dive clap", min: 0, max: 1, default: 0 });
model.parameters.push({ id: depth, name: "Clap forearm perspective", min: 0, max: 1, default: 0 });

const toCanvas = ({ x, y }) => [x + width / 2, height / 2 - y];
const subtract = ([ax, ay], [bx, by]) => [ax - bx, ay - by];
const direction = ([x, y]) => Math.atan2(y, x);
const degrees = radians => ((radians * 180 / Math.PI + 540) % 360) - 180;
const smooth = value => {
  const t = Math.min(1, Math.max(0, value));
  return t * t * (3 - 2 * t);
};

// The reattached jaw outline ends in a narrow mesh strip. Give it the
// neighboring chin's displacement so a deep nod cannot fold that strip.
const face = model.parts.find(({ id }) => id === "face");
const facePoints = [];
for (let i = 0; i < face.mesh.vertices.length; i += 2) {
  facePoints.push([
    width / 2 + face.transform.x + face.mesh.vertices[i] * face.width,
    height / 2 - face.transform.y - face.mesh.vertices[i + 1] * face.height,
  ]);
}
const chin = facePoints.map(([x, y], index) => ({ index, distance: (x - 550) ** 2 + (y - 433) ** 2 }))
  .sort((a, b) => a.distance - b.distance).slice(0, 4);
for (const { keyforms } of face.warps) {
  for (const { offsets } of keyforms) {
    const fixed = [0, 1].map(axis => chin.reduce((sum, { index }) => sum + offsets[2 * index + axis], 0) / chin.length);
    for (const [index, [, y]] of facePoints.entries()) {
      const weight = smooth((y - 376) / 52);
      for (const axis of [0, 1]) {
        const i = 2 * index + axis;
        offsets[i] = (1 - weight) * offsets[i] + weight * fixed[axis];
      }
    }
  }
}

// Place each painted palm at the contact using the rig's actual joint pivots.
// Pick the outward elbow solution on both sides to leave space between the arms.
for (const { side, palm, contact, outward } of [
  { side: "R", palm: [147, 1541], contact: [502, 803], outward: 1 },
  { side: "L", palm: [958, 1541], contact: [598, 803], outward: -1 },
]) {
  const shoulderJoint = model.deformers.find(({ id }) => id === `armDeformer_${side}`);
  const elbowJoint = model.deformers.find(({ id }) => id === `forearmDeformer_${side}`);
  const shoulder = toCanvas(shoulderJoint.pivot), elbow = toCanvas(elbowJoint.pivot);
  const upper = subtract(elbow, shoulder), lower = subtract(palm, elbow);
  const [x, y] = subtract(contact, shoulder);
  const distance = Math.hypot(x, y), u = Math.hypot(...upper), l = Math.hypot(...lower);
  if (distance > u + l || distance < Math.abs(u - l)) throw new Error(`The ${side} palm cannot reach the clap`);
  const along = (u ** 2 - l ** 2 + distance ** 2) / (2 * distance);
  const across = outward * Math.sqrt(u ** 2 - along ** 2);
  const targetUpper = [(x * along - y * across) / distance, (y * along + x * across) / distance];
  const targetLower = subtract([x, y], targetUpper);
  const shoulderTurn = direction(upper) - direction(targetUpper);
  const elbowTurn = direction(lower) - direction(targetLower) - shoulderTurn;
  shoulderJoint.bindings.push({ parameter: clap, channel: "rotate", from: 0, to: degrees(shoulderTurn) });
  elbowJoint.bindings.push({ parameter: clap, channel: "rotate", from: 0, to: degrees(elbowTurn) });

  // The raglan sleeve leaves the torso at an angle. Hold its top where
  // the seam meets the jacket while allowing the fabric below it to lift.
  const sleeve = model.parts.find(({ id }) => id === `arm_${side}`);
  const sleeveWarp = (parameter, rotations) => ({ parameter, keyforms: rotations.map(([value, rotation]) => {
    const angle = rotation * Math.PI / 180;
    const cos = Math.cos(angle), sin = Math.sin(angle);
    const strength = 1 - smooth((Math.abs(rotation) - 28) / 35);
    const offsets = [];
    for (let i = 0; i < sleeve.mesh.vertices.length; i += 2) {
      const x = sleeve.transform.x + sleeve.mesh.vertices[i] * sleeve.width - shoulderJoint.pivot.x;
      const y = sleeve.transform.y + sleeve.mesh.vertices[i + 1] * sleeve.height - shoulderJoint.pivot.y;
      const canvasY = shoulder[1] - y;
      const inside = smooth((outward * x + 34) / 52);
      const contactWeight = inside * strength * (1 - smooth((canvasY - 616) / 108));
      offsets.push(contactWeight * (x * (cos - 1) + y * sin) / sleeve.width,
        contactWeight * (-x * sin + y * (cos - 1)) / sleeve.height);
    }
    return { value, offsets };
  }) });
  const liftStops = [-8, 0, 4, 10, 18, 24, 32, 45, 63, 150];
  sleeve.warps = [...(sleeve.warps ?? []),
    sleeveWarp(`ParamArm${side}`, liftStops.map(value => [value, -outward * value])),
    sleeveWarp(clap, [[0, 0], [1, degrees(shoulderTurn)]]),
  ];

  // Foreshorten the sleeve as the forearm points forward. Keep cuff and hand
  // at their original proportions by translating their vertices together.
  const part = model.parts.find(({ id }) => id === `forearm_${side}`);
  const offsets = part.mesh.vertices.map((vertex, i) => {
    if (i % 2 === 0) return 0;
    const canvasY = height / 2 - part.transform.y - vertex * part.height;
    const amount = Math.max(0, Math.min(1, (canvasY - elbow[1]) / (1390 - elbow[1])));
    return 157 * amount / part.height;
  });
  part.warps = [...(part.warps ?? []), { parameter: depth, keyforms: [
    { value: 0, offsets: offsets.map(() => 0) }, { value: 1, offsets },
  ] }];
}

const opening = "ParamMouthOpenY";
const occlude = (closed, open) => ({ by: ["face"], parameter: opening,
  stops: [{ value: 0, amount: closed }, { value: 0.14, amount: open }],
});
const lips = model.parts.filter(({ id }) => id.startsWith("lip_"));
for (const part of lips) part.occlusion = occlude(1, 0);
const vertices = [], uvs = [], indices = [];
const columns = 6, rows = 4;
for (let row = 0; row <= rows; row++) {
  for (let col = 0; col <= columns; col++) {
    const u = col / columns, v = row / rows;
    vertices.push(u - 0.5, 0.5 - v);
    uvs.push(u, v);
    if (row < rows && col < columns) {
      const i = row * (columns + 1) + col;
      indices.push(i, i + columns + 1, i + 1, i + 1, i + columns + 1, i + columns + 2);
    }
  }
}
const texture = model.textures.length;
const png = readFileSync(join(dirname(file), "closed-mouth.png")).toString("base64");
model.textures.push({ source: `data:image/png;base64,${png}` });
model.parts.push({
  id: "closed_smile", width: 60, height: 28, transform: { x: 550 - width / 2, y: height / 2 - 412 },
  deformer: "mouthWarp", order: Math.max(...lips.map(({ order }) => order)) + 0.25,
  color: [1, 1, 1, 1], texture: { index: texture, uv: { x: 0, y: 0, width: 1, height: 1 } },
  mesh: { vertices, uvs, indices }, occlusion: occlude(0, 1),
  warps: [{ parameter: "ParamMouthForm", keyforms: [-1, 0, 1].map(value => ({
    value, offsets: vertices.map((vertex, index) => index % 2 === 0
      ? value * 5 * vertex / 60
      : value * 34 * vertices[index - 1] ** 2 / 28),
  })) }],
});
writeFileSync(file, JSON.stringify(model));
