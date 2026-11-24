import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const file = process.argv[2];
const model = JSON.parse(readFileSync(file, "utf8"));
const assets = dirname(file);

// Keep the elbow's degrees-to-rotation mapping for the close raised-hand wave.
const elbow = model.parameters.find(({ id }) => id === "ParamElbowR");
const forearm = model.deformers.find(({ id }) => id === "forearmDeformer_R");
const rotation = forearm.bindings.find(({ channel }) => channel === "rotate");
const slope = (rotation.to - rotation.from) / (elbow.max - elbow.min);
rotation.to += (170 - elbow.max) * slope;
elbow.max = 170;

// In the lean, the lower arms disappear only where the torso covers them.
const parameter = "ParamHandsBehind";
model.parameters.push({ id: parameter, name: "Hands behind back", min: 0, max: 1, default: 0 });
for (const part of model.parts.filter(({ id }) => /^(elbow|forearm)_[LR]$/.test(id))) {
  part.occlusion = {
    by: ["body"], parameter, stops: [{ value: 0, amount: 0 }, { value: 1, amount: 1 }],
  };
}

function paintedPart(id, asset, width, height, transform, deformer, order) {
  const index = model.textures.length;
  const png = readFileSync(join(assets, asset)).toString("base64");
  model.textures.push({ source: `data:image/png;base64,${png}` });
  const part = {
    id, width, height, transform, deformer, order, color: [1, 1, 1, 1],
    texture: { index, uv: { x: 0, y: 0, width: 1, height: 1 } },
  };
  model.parts.push(part);
  return part;
}

function mesh(columns, rows) {
  const vertices = [], uvs = [], indices = [];
  for (let y = 0; y <= rows; y++) for (let x = 0; x <= columns; x++) {
    const u = x / columns, v = y / rows;
    vertices.push(u - 0.5, 0.5 - v);
    uvs.push(u, v);
    if (x === columns || y === rows) continue;
    const i = y * (columns + 1) + x;
    indices.push(i, i + columns + 1, i + 1, i + 1, i + columns + 1, i + columns + 2);
  }
  return { vertices, uvs, indices };
}

function warpOffsets(part, displacement) {
  const offsets = [];
  const { vertices } = part.mesh;
  for (let i = 0; i < vertices.length; i += 2) {
    const [x, y] = displacement(vertices[i], vertices[i + 1]);
    offsets.push(x / part.width, y / part.height);
  }
  return offsets;
}

const opening = "ParamMouthOpenY";
const occlusion = (closed, open) => ({
  by: ["face"], parameter: opening, stops: [{value: 0, amount: closed}, {value: 0.18, amount: open}],
});
for (const part of model.parts.filter(({ id }) => id.startsWith("lip_"))) {
  part.occlusion = occlusion(1, 0);
}
const smile = paintedPart("closed_smile", "closed-smile.png", 86, 35,
  {x: -3, y: 1616.5}, "mouthWarp", 14.5);
smile.mesh = mesh(6, 3);
smile.warps = [{ parameter: "ParamMouthForm", keyforms: [-1, 0, 1].map(value => ({
  value, offsets: warpOffsets(smile, (x) => [value * 4.4 * x, value * 14 * x * x]),
})) }];
smile.occlusion = occlusion(0, 1);

const flowerParameter = "ParamOfferFlower";
const liftParameter = "ParamOfferLift";
const reachParameter = "ParamOfferReach";
model.parameters.push({ id: flowerParameter, name: "Offer flower", min: 0, max: 1, default: 0 });
model.parameters.push({ id: liftParameter, name: "Lift offering hand", min: 0, max: 1, default: 0 });
model.parameters.push({ id: reachParameter, name: "Extend flower toward viewer", min: 0, max: 1, default: 0 });

// The attached illustration supplies the foreshortened arm, clenched fingers
// and flower in one piece. Let the hand advance while the shoulder stays put.
const offer = paintedPart("offer_arm_R", "offer.png", 310, 360,
  { x: -181, y: 1287 }, "bodyWarp", 7.5);
offer.mesh = mesh(6, 8);
offer.bindings = [{ parameter: flowerParameter, channel: "opacity", from: 0, to: 1 }];
offer.warps = [{
  parameter: reachParameter,
  keyforms: [
    { value: 0, offsets: warpOffsets(offer, (x, y) => {
      const towardHand = Math.min(1, Math.max(0, (0.38 - y) / 0.63));
      return [(-27 - 57 * x) * towardHand, -99 * towardHand];
    }) },
    { value: 1, offsets: warpOffsets(offer, () => [0, 0]) },
  ],
}];
for (const part of model.parts.filter(({ id }) => /^(arm|elbow|forearm)_R$/.test(id))) {
  part.bindings = [...(part.bindings ?? []), { parameter: flowerParameter, channel: "opacity", from: 1, to: 0 }];
}
const upperArm = model.deformers.find(({ id }) => id === "armDeformer_R");
upperArm.bindings.push({ parameter: liftParameter, channel: "scaleY", from: 0, to: -0.69 });
writeFileSync(file, JSON.stringify(model));
