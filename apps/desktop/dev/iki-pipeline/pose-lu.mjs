import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const file = process.argv[2];
const model = JSON.parse(readFileSync(file, "utf8"));
const { width, height } = model.canvas;
const clamp = value => Math.max(0, Math.min(1, value));
const ease = value => {
  const t = clamp(value);
  return t * t * t * (t * (6 * t - 15) + 10);
};
const canvas = ({ x, y }) => [x + width / 2, height / 2 - y];
const delta = ([x, y], [sx, sy]) => [x - sx, y - sy];
const angle = ([x, y]) => Math.atan2(y, x);
const degrees = value => ((value * 180 / Math.PI + 540) % 360) - 180;
const bind = (parameter, channel, to) => ({ parameter, channel, from: 0, to });

// The sleeves are cut on their painted curved seam. Move the rotation
// centers up to that seam's top, close to the outer edge of each shoulder.
for (const [side, x] of [["R", 224.5], ["L", 874.5]]) {
  const joint = model.deformers.find(({ id }) => id === `armDeformer_${side}`);
  joint.pivot = { x: x - width / 2, y: height / 2 - 733 };
}

// The auto-rigger uses two triangles per sleeve. Subdivide the same
// rectangle so we can project the fabric while keeping the cuff rigid.
function subdivide(part, columns, rows) {
  const previous = part.mesh;
  const [x0, y0, , , , y1] = previous.vertices;
  const xRight = previous.vertices[2];
  const [u0, v0, u1, , , v1] = previous.uvs;
  const vertices = [], uvs = [], indices = [];
  for (let row = 0; row <= rows; row++) {
    for (let col = 0; col <= columns; col++) {
      const u = col / columns, v = row / rows;
      vertices.push(x0 + (xRight - x0) * u, y0 + (y1 - y0) * v);
      uvs.push(u0 + (u1 - u0) * u, v0 + (v1 - v0) * v);
      if (row < rows && col < columns) {
        const top = row * (columns + 1) + col;
        const bottom = top + columns + 1;
        indices.push(bottom, bottom + 1, top, top, bottom + 1, top + 1);
      }
    }
  }
  part.mesh = { vertices, uvs, indices };
}

function warp(part, parameter, deform) {
  const offsets = [];
  for (let i = 0; i < part.mesh.vertices.length; i += 2) {
    const [x, y] = canvas({
      x: part.transform.x + part.mesh.vertices[i] * part.width,
      y: part.transform.y + part.mesh.vertices[i + 1] * part.height,
    });
    const [dx, dy] = deform(x, y);
    offsets.push(dx / part.width, -dy / part.height);
  }
  (part.warps ??= []).push({ parameter, keyforms: [
    { value: 0, offsets: offsets.map(() => 0) }, { value: 1, offsets },
  ] });
}

// An elbow coming toward the viewer projects a shorter upper sleeve.
// Place the palm with the two joint rotations and shorten the lower sleeve
// only above the wrist. The original curved fingers keep their shape.
const armPoses = {
  R: [
    { id: "ParamLuStudy", name: "Raise hand to eye level", palm: [382, 427], hinge: [339, 817] },
    { id: "ParamLuThought", name: "Hand at chin", palm: [522, 555], hinge: [376, 889] },
    { id: "ParamLuFoldR", name: "Fold right arm", palm: [652, 1010], hinge: [279, 1117] },
  ],
  L: [{ id: "ParamLuFoldL", name: "Fold left arm", palm: [447, 1057], hinge: [816, 1118] }],
};
for (const [side, poses] of Object.entries(armPoses)) {
  const shoulder = model.deformers.find(({ id }) => id === `armDeformer_${side}`);
  const elbow = model.deformers.find(({ id }) => id === `forearmDeformer_${side}`);
  const sleeve = model.parts.find(({ id }) => id === `arm_${side}`);
  const forearm = model.parts.find(({ id }) => id === `forearm_${side}`);
  subdivide(sleeve, 12, 16);
  subdivide(forearm, 8, 14);
  const shoulderAt = canvas(shoulder.pivot), elbowAt = canvas(elbow.pivot);
  const palmAt = side === "R" ? [101, 1549] : [1002, 1549];
  const upper = delta(elbowAt, shoulderAt), lower = delta(palmAt, elbowAt);
  const upperLength = Math.hypot(...upper), lowerLength = Math.hypot(...lower);
  for (const { id, name, palm, hinge } of poses) {
    model.parameters.push({ id, name, min: 0, max: 1, default: 0 });
    const posedUpper = delta(hinge, shoulderAt), posedLower = delta(palm, hinge);
    const shoulderAngle = angle(upper) - angle(posedUpper);
    const elbowAngle = angle(lower) - angle(posedLower) - shoulderAngle;
    const upperScale = Math.hypot(...posedUpper) / upperLength;
    const lowerScale = Math.hypot(...posedLower) / lowerLength;
    const shift = upper.map(value => value * (upperScale - 1));
    shoulder.bindings.push(bind(id, "rotate", degrees(shoulderAngle)));
    elbow.bindings.push(bind(id, "rotate", degrees(elbowAngle)), bind(id, "translateX", shift[0]),
      bind(id, "translateY", -shift[1]));

    warp(sleeve, id, (x, y) => {
      const [localX, localY] = delta([x, y], shoulderAt);
      const along = (localX * upper[0] + localY * upper[1]) / upperLength ** 2;
      return [shift[0] * along, shift[1] * along];
    });
    warp(forearm, id, (x, y) => {
      const [localX, localY] = delta([x, y], elbowAt);
      const along = (localX * lower[0] + localY * lower[1]) / lowerLength ** 2;
      const projection = (lowerScale - 1) * Math.min(along, 0.71) / 0.71;
      return [lower[0] * projection, lower[1] * projection];
    });
  }
}

// Keep the drawn resting lips. The keyed mouth supplies visible speech.
const opening = "ParamMouthOpenY";
const occlude = (closed, open) => ({
  by: ["face"], parameter: opening, stops: [{ value: 0, amount: closed }, { value: 0.13, amount: open }],
});
const lips = model.parts.filter(({ id }) => id.startsWith("lip_"));
for (const lip of lips) lip.occlusion = occlude(1, 0);
const mouth = {
  id: "closed_mouth", width: 61, height: 39, transform: { x: 0.5, y: height / 2 - 421.5 },
  deformer: "mouthWarp", order: Math.max(...lips.map(({ order }) => order)) + 0.25,
  color: [1, 1, 1, 1], texture: { index: model.textures.length, uv: { x: 0, y: 0, width: 1, height: 1 } },
  mesh: { vertices: [-0.5, 0.5, 0.5, 0.5, -0.5, -0.5, 0.5, -0.5],
    uvs: [0, 0, 1, 0, 0, 1, 1, 1], indices: [2, 3, 0, 0, 3, 1] },
  occlusion: occlude(0, 1),
};
subdivide(mouth, 6, 4);
mouth.warps = [{
  parameter: "ParamMouthForm",
  keyforms: [-1, 0, 1].map(value => ({ value, offsets: mouth.mesh.vertices.map((_, i) =>
    i % 2 === 0 ? 0 : value * 0.42 * mouth.mesh.vertices[i - 1] ** 2) })),
}];
model.textures.push({ source: `data:image/png;base64,${readFileSync(join(dirname(file), "closed-mouth.png")).toString("base64")}` });
model.parts.push(mouth);

// Quiet acknowledgements replace the auto-rigger's large default nod/tilt.
for (const [group, peak, duration] of [["Nod", -7, 2.6], ["Tilt", 8, 3.2]]) {
  const motion = model.motions[group][0];
  motion.duration = duration;
  motion.curves[0].keys = Array.from({ length: 33 }, (_, i) => {
    const t = i / 32;
    return [duration * t, peak * Math.min(ease(t / 0.36), ease((1 - t) / 0.39))];
  });
}
for (const expression of model.expressions) {
  for (const parameter of expression.parameters) {
    parameter.value = parameter.blend === "multiply" ? 1 + (parameter.value - 1) * 0.36 : parameter.value * 0.36;
  }
}
writeFileSync(file, JSON.stringify(model));
