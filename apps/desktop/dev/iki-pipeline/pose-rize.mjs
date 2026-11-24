import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const [file, landmarkFile] = process.argv.slice(2);
const model = JSON.parse(readFileSync(file, "utf8"));
const { glasses, sclera } = JSON.parse(readFileSync(landmarkFile, "utf8"));
const { width, height } = model.canvas;
const require = createRequire(join(process.env.IKI_REPO, "packages/mcp/package.json"));
const sharp = require("sharp");

function paintedPart(id, filename, [x0, y0, x1, y1], deformer, order, columns, rows) {
  const index = model.textures.length;
  const png = readFileSync(join(dirname(file), filename)).toString("base64");
  model.textures.push({ source: `data:image/png;base64,${png}` });
  const vertices = [], uvs = [], indices = [];
  for (let row = 0; row <= rows; row++) {
    for (let column = 0; column <= columns; column++) {
      const u = column / columns, v = row / rows;
      vertices.push(u - 0.5, 0.5 - v);
      uvs.push(u, v);
      if (row < rows && column < columns) {
        const i = row * (columns + 1) + column;
        indices.push(i, i + columns + 1, i + 1, i + 1, i + columns + 1, i + columns + 2);
      }
    }
  }
  const part = {
    id, width: x1 - x0, height: y1 - y0, deformer, order,
    transform: { x: (x0 + x1 - width) / 2, y: (height - y0 - y1) / 2 },
    color: [1, 1, 1, 1], mesh: { vertices, uvs, indices },
    texture: { index, uv: { x: 0, y: 0, width: 1, height: 1 } },
  };
  model.parts.push(part);
  return part;
}

// Read the eye displacement in head space. Extrapolate each lens just past
// its eye, and join the two displacements smoothly across the bridge.
const rightEye = model.deformers.find(({ id }) => id === "eyeWarp_R");
const leftEye = model.deformers.find(({ id }) => id === "eyeWarp_L");
const rightInner = rightEye.grid.points[rightEye.grid.cols * 2];
const leftInner = leftEye.grid.points[0];
const lerp = (a, b, t) => a + (b - a) * t;

function eyeDisplacement({ grid, warp2d }, x, y, frame) {
  const { cols, rows, points } = grid;
  const offsets = warp2d.keyforms2d[frame].offsets;
  const u = cols * (x - points[0]) / (points[cols * 2] - points[0]);
  const v = Math.min(rows, Math.max(0, rows * (y - points[1]) / (points.at(-1) - points[1])));
  const col = Math.min(cols - 1, Math.max(0, Math.floor(u)));
  const row = Math.min(rows - 1, Math.floor(v));
  const i = 2 * (row * (cols + 1) + col);
  const j = i + 2 * (cols + 1);
  return [0, 1].map(axis => lerp(
    lerp(offsets[i + axis], offsets[i + axis + 2], u - col),
    lerp(offsets[j + axis], offsets[j + axis + 2], u - col),
    v - row,
  ));
}

const lashOrder = Math.max(...model.parts.filter(({ id }) => id.startsWith("lash")).map(({ order }) => order));
const columns = 22, rows = 4;
const frame = paintedPart("glasses", "glasses.png", glasses.box, "glassesWarp", lashOrder + 0.25, columns, rows);
const { parameter, parameterY, valuesX, valuesY, keyforms2d } = rightEye.warp2d;
const points = frame.mesh.vertices.map((vertex, index) => index % 2 === 0
  ? frame.transform.x + vertex * frame.width
  : frame.transform.y + vertex * frame.height);
const warp2d = { parameter, parameterY, valuesX, valuesY, keyforms2d: keyforms2d.map((_, key) => {
  const offsets = [];
  for (let i = 0; i < points.length; i += 2) {
    const x = points[i], y = points[i + 1];
    const mix = Math.min(1, Math.max(0, (x - rightInner) / (leftInner - rightInner)));
    const right = eyeDisplacement(rightEye, Math.min(x, rightInner), y, key);
    const left = eyeDisplacement(leftEye, Math.max(x, leftInner), y, key);
    offsets.push(lerp(right[0], left[0], mix), lerp(right[1], left[1], mix));
  }
  return { offsets };
}) };
model.deformers.push({ kind: "warp", id: "glassesWarp", parent: "headDeformer", grid: { cols: columns, rows, points }, warp2d });

const push = "ParamGlassesPush";
model.parameters.push({ id: push, name: "Push glasses up", min: 0, max: 1, default: 0 });
frame.bindings = [{ parameter: push, channel: "translateY", from: 0, to: 7 }];

// The roots follow the head. Below the shoulders the long curls hang against
// the dress, so the tips lag a turn instead of swinging through the bodice.
const head = model.deformers.find(({ id }) => id === "headDeformer");
const tilt = head.bindings.find(({ parameter }) => parameter === "ParamAngleZ");
const smooth = value => {
  const t = Math.min(1, Math.max(0, value));
  return t * t * (3 - 2 * t);
};
for (const part of model.parts.filter(({ id }) => id === "hair_back" || id.startsWith("hair_side_"))) {
  for (const warp of part.warps) {
    if (!/^(ParamAngle[XYZ]|ParamHair.*Sway)/.test(warp.parameter)) continue;
    for (const key of warp.keyforms) {
      if (key.value === 0) continue;
      const a = (warp.parameter === tilt.parameter ? lerp(tilt.from, tilt.to, (key.value + 30) / 60) : 0) * Math.PI / 180;
      for (let i = 0; i < part.mesh.vertices.length; i += 2) {
        const x = part.transform.x + part.mesh.vertices[i] * part.width - head.pivot.x;
        const y = part.transform.y + part.mesh.vertices[i + 1] * part.height - head.pivot.y;
        const canvasY = height / 2 - y - head.pivot.y;
        const hanging = 0.84 * smooth((canvasY - 484) / 255);
        const counterX = x * (Math.cos(a) - 1) + y * Math.sin(a);
        const counterY = -x * Math.sin(a) + y * (Math.cos(a) - 1);
        key.offsets[i] = key.offsets[i] * (1 - hanging) + hanging * counterX / part.width;
        key.offsets[i + 1] = key.offsets[i + 1] * (1 - hanging) + hanging * counterY / part.height;
      }
    }
  }
}

const reach = "ParamGlassesReach";
model.parameters.push({ id: reach, name: "Hand to glasses", min: 0, max: 1, default: 0 });
const upperArm = model.deformers.find(({ id }) => id === "armDeformer_R");
const forearm = model.deformers.find(({ id }) => id === "forearmDeformer_R");
const toCanvas = ({ x, y }) => [x + width / 2, height / 2 - y];
const subtract = ([ax, ay], [bx, by]) => [ax - bx, ay - by];
const direction = ([x, y]) => Math.atan2(y, x);
const angle = radians => ((radians * 180 / Math.PI + 540) % 360) - 180;
const shoulder = toCanvas(upperArm.pivot);
const elbow = toCanvas(forearm.pivot);
const fingertip = [55, 1875];
const upperVector = subtract(elbow, shoulder);
const lowerVector = subtract(fingertip, elbow);

function reachBridge(target) {
  const [x, y] = subtract(target, shoulder);
  const upperLength = Math.hypot(...upperVector), lowerLength = Math.hypot(...lowerVector);
  const distance = Math.hypot(x, y);
  const along = (upperLength ** 2 - lowerLength ** 2 + distance ** 2) / (2 * distance);
  const across = Math.sqrt(upperLength ** 2 - along ** 2);
  // In the front view the elbow sits across the bodice, below the bridge.
  const upper = [(x * along - y * across) / distance, (y * along + x * across) / distance];
  const lower = subtract([x, y], upper);
  const armTurn = direction(upperVector) - direction(upper);
  return [angle(armTurn), angle(direction(lowerVector) - direction(lower) - armTurn)];
}

const contact = reachBridge([549, 371]);
const raised = reachBridge([549, 364]);
for (const [index, deformer] of [upperArm, forearm].entries()) {
  deformer.bindings.push(
    { parameter: reach, channel: "rotate", from: 0, to: contact[index] },
    { parameter: push, channel: "rotate", from: 0, to: raised[index] - contact[index] },
  );
}
for (const part of model.parts.filter(({ id }) => id === "elbow_R" || id === "forearm_R")) {
  part.order = frame.order + (part.id === "elbow_R" ? 0.25 : 0.5);
}

// Both states use the same PSD eye art, mesh, blink, gaze, and sclera mask.
// The transformed paint is tinted at render time over the original eye.
const ghoul = "ParamRizeGhoul";
model.parameters.push({ id: ghoul, name: "Ghoul eyes", min: 0, max: 1, default: 0 });
for (const eye of model.parts.filter(({ id }) => /^(eye|iris)_[LR]$/.test(id))) {
  const iris = eye.id.startsWith("iris");
  let variant = eye;
  if (!iris) {
    // The cutter keeps a margin for closing the lid. Tint only the opening,
    // leaving that surrounding skin in its original palette.
    const left = Math.round(width / 2 + eye.transform.x - eye.width / 2);
    const top = Math.round(height / 2 - eye.transform.y - eye.height / 2);
    const points = sclera[eye.id.at(-1)].map(([x, y]) => `${x - left},${y - top}`).join(" ");
    const mask = Buffer.from(`<svg width="${eye.width}" height="${eye.height}"><polygon points="${points}"/></svg>`);
    const png = await sharp(join(dirname(file), "final", `${eye.id}.png`))
      .extract({ left, top, width: eye.width, height: eye.height })
      .composite([{ input: mask, blend: "dest-in" }]).png().toBuffer();
    const index = model.textures.length;
    model.textures.push({ source: `data:image/png;base64,${png.toString("base64")}` });
    const uvs = eye.mesh.vertices.map((vertex, i) => i % 2 === 0 ? vertex + 0.5 : 0.5 - vertex);
    variant = {
      ...eye,
      mesh: { ...eye.mesh, uvs },
      texture: { index, uv: { x: 0, y: 0, width: 1, height: 1 } },
      warps: undefined,
      clip: { masks: [eye.id] },
    };
  }
  model.parts.push({
    ...variant,
    id: `ghoul_${eye.id}`,
    order: eye.order + 0.25,
    color: iris ? [1, 0.10, 0.12, 1] : [0.10, 0.09, 0.15, 1],
    bindings: [...(eye.bindings ?? []), { parameter: ghoul, channel: "opacity", from: 0, to: 1 }],
  });
}

const opening = "ParamMouthOpenY";
const occlusion = (closed, open) => ({
  by: ["face"], parameter: opening, stops: [{ value: 0, amount: closed }, { value: 0.17, amount: open }],
});
for (const part of model.parts.filter(({ id }) => id.startsWith("lip_"))) {
  part.occlusion = occlusion(1, 0);
}
const lipOrder = Math.max(...model.parts.filter(({ id }) => id.startsWith("lip_")).map(({ order }) => order));
const smile = paintedPart("closed_smile", "closed-smile.png", [502, 463, 598, 502], "mouthWarp", lipOrder + 0.25, 8, 4);
smile.occlusion = occlusion(0, 1);
smile.warps = [{ parameter: "ParamMouthForm", keyforms: [-1, 0, 1].map(value => ({
  value,
  offsets: smile.mesh.vertices.map((vertex, index, vertices) => index % 2 === 0
    ? value * 5 * vertex / smile.width
    : value * 18 * vertices[index - 1] ** 2 / smile.height),
})) }];

model.expressions = model.expressions.filter(({ id }) => ["smile", "laugh", "surprised"].includes(id));
writeFileSync(file, JSON.stringify(model));
