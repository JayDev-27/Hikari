// Keep painted contacts together while the free hair and arms can move.
import { readFileSync, writeFileSync } from "node:fs";

const file = process.argv[2];
const model = JSON.parse(readFileSync(file, "utf8"));
const face = model.parts.find(({ id }) => id === "face");
const { width, height } = model.canvas;

function canvasVertices(part) {
  const { vertices } = part.mesh;
  return Array.from({ length: vertices.length / 2 }, (_, index) => ({
    x: width / 2 + part.transform.x + vertices[2 * index] * part.width,
    y: height / 2 - part.transform.y - vertices[2 * index + 1] * part.height,
  }));
}

function smoothstep(start, end, value) {
  const t = Math.min(1, Math.max(0, (value - start) / (end - start)));
  return t * t * (3 - 2 * t);
}

const faceVertices = canvasVertices(face);
function sampleFace(x, y) {
  const { indices } = face.mesh;
  for (let k = 0; k < indices.length; k += 3) {
    const [i, j, l] = indices.slice(k, k + 3);
    const a = faceVertices[i], b = faceVertices[j], c = faceVertices[l];
    const denominator = (b.y - c.y) * (a.x - c.x) + (c.x - b.x) * (a.y - c.y);
    if (denominator === 0) continue;
    const s = ((b.y - c.y) * (x - c.x) + (c.x - b.x) * (y - c.y)) / denominator;
    const t = ((c.y - a.y) * (x - c.x) + (a.x - c.x) * (y - c.y)) / denominator;
    if (s >= -1e-7 && t >= -1e-7 && s + t <= 1 + 1e-7) return [[i, s], [j, t], [l, 1 - s - t]];
  }
  // Outside the painted face mesh, extend the warp from nearby vertices.
  const nearest = faceVertices.map((v, index) => ({ index, distance: (x - v.x) ** 2 + (y - v.y) ** 2 }))
    .sort((a, b) => a.distance - b.distance).slice(0, 3);
  const total = nearest.reduce((sum, { distance }) => sum + 1 / (1 + distance), 0);
  return nearest.map(({ index, distance }) => [index, 1 / ((1 + distance) * total)]);
}

const contact = {
  hair_side_L: (x, y) => smoothstep(220, 280, y) * (1 - smoothstep(407, 473, y)) * (1 - smoothstep(658, 701, x)),
  hair_side_R: (x, y) => smoothstep(225, 290, y) * (1 - smoothstep(404, 473, y)) * smoothstep(374, 412, x),
  hair_front: (_x, y) => smoothstep(195, 276, y) * (1 - 0.3 * smoothstep(393, 455, y)),
};
const parameters = new Set(["ParamAngleX", "ParamAngleY", "ParamAngleZ", "ParamHairSwayX", "ParamHairSwayZ"]);
for (const part of model.parts.filter(({ id }) => id in contact)) {
  const vertices = canvasVertices(part).map(({ x, y }) => ({
    weight: contact[part.id](x, y),
    neighbors: sampleFace(x, y),
  }));
  const scale = [face.width / part.width, face.height / part.height];
  for (const warp of part.warps.filter(({ parameter }) => parameters.has(parameter))) {
    const faceWarp = face.warps.find(({ parameter }) => parameter === warp.parameter);
    for (const frame of warp.keyforms.filter(({ value }) => value !== 0)) {
      const target = faceWarp?.keyforms.find(({ value }) => value === frame.value);
      for (const [index, { weight, neighbors }] of vertices.entries()) {
        for (let axis = 0; axis < 2; axis++) {
          const position = 2 * index + axis;
          const faceOffset = target ? neighbors.reduce((sum, [i, w]) => sum + target.offsets[2 * i + axis] * w, 0) : 0;
          frame.offsets[position] = Number((frame.offsets[position] * (1 - weight) + faceOffset * scale[axis] * weight).toFixed(6));
        }
      }
    }
  }
}

// Keep the underside of the tied hair tucked behind the neck when the
// positive tilt lifts the drawn ends along the opposite edge of the collar.
const tiedHair = model.parts.find(({ id }) => id === "hair_back");
const extremeTilt = tiedHair.warps.find(({ parameter }) => parameter === "ParamAngleZ")
  .keyforms.find(({ value }) => value === 30);
for (const [index, { x, y }] of canvasVertices(tiedHair).entries()) {
  const weight = smoothstep(539, 590, x) * (1 - smoothstep(648, 698, x)) * smoothstep(420, 471, y);
  extremeTilt.offsets[2 * index] -= 33 * weight / tiedHair.width;
}

// Counter part of the arm rotation where each shoulder meets the shirt.
// Unweight that correction down the upper arm and outside the stage poses.
for (const side of ["R", "L"]) {
  const part = model.parts.find(({ id }) => id === `arm_${side}`);
  const parameter = `ParamArm${side}`;
  const { pivot } = model.deformers.find(({ id }) => id === `armDeformer_${side}`);
  const vertices = canvasVertices(part).map(({ x, y }) => {
    const across = side === "R" ? smoothstep(300, 347, x) : 1 - smoothstep(749, 802, x);
    return {
      x: x - width / 2 - pivot.x,
      y: height / 2 - y - pivot.y,
      weight: across * (1 - smoothstep(645, 752, y)),
    };
  });
  const keyforms = [-8, 0, 4, 10, 20, 30, 45, 70, 150].map(value => {
    const angle = (side === "R" ? value : -value) * Math.PI / 180;
    const cos = Math.cos(angle), sin = Math.sin(angle);
    const amount = 1 - smoothstep(32, 65, Math.abs(value));
    const offsets = vertices.flatMap(({ x, y, weight }) => [
      Number((weight * amount * (x * (cos - 1) - y * sin) / part.width).toFixed(6)),
      Number((weight * amount * (x * sin + y * (cos - 1)) / part.height).toFixed(6)),
    ]);
    return { value, offsets };
  });
  part.warps = [...(part.warps ?? []), { parameter, keyforms }];
}
writeFileSync(file, JSON.stringify(model));
