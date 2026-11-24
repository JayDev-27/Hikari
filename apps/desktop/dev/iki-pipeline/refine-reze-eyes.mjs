// The outer lashes touch the bangs in Reze's painting. Return the attached pieces of
// the strand and the stationary lid crease to their original positions on the head.
import { createRequire } from "node:module";
import { resolve } from "node:path";

const require = createRequire(resolve(process.env.IKI_REPO ?? "../iki", "packages/mcp/package.json"));
const sharp = require("sharp");
const [picture, dir] = process.argv.slice(2);
const { data: source, info } = await sharp(picture).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const planes = new Map();
async function layer(role) {
  if (!planes.has(role)) planes.set(role, await sharp(`${dir}/${role}.png`).ensureAlpha().raw().toBuffer());
  return planes.get(role);
}
function contains(points, x, y) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [a, b] = points[i], [c, d] = points[j];
    if ((b > y) !== (d > y) && x < a + (c - a) * (y - b) / (d - b)) inside = !inside;
  }
  return inside;
}

const face = await layer("face");
const front = await layer("hair_front");
const eyes = {
  R: { box: [425, 312, 494, 356], outline: [[426, 338], [433, 329], [443, 321], [454, 318], [471, 318], [480, 322], [489, 330], [493, 336], [491, 342], [484, 350], [469, 354], [446, 353], [433, 348]] },
  L: { box: [560, 294, 639, 338], outline: [[562, 331], [567, 316], [574, 309], [586, 303], [608, 299], [626, 300], [635, 304], [639, 310], [634, 315], [629, 323], [621, 331], [604, 337], [584, 338], [568, 335]] },
};
for (const [side, { box: [x0, y0, x1, y1], outline }] of Object.entries(eyes)) {
  const lock = await layer(`hair_side_${side}`);
  const parts = await Promise.all([`eye_${side}`, `lash_${side}`, `lash_lower_${side}`, `iris_${side}`].map(layer));
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    if (contains(outline, x + 0.5, y + 0.5)) continue;
    const i = (y * info.width + x) * 4;
    if (!parts.some((part) => part[i + 3])) continue;
    for (const part of parts) part[i + 3] = 0;
    const isHair = source[i] - source[i + 2] < 17 && source[i + 1] < 125;
    const onFringe = side === "R" ? (x > 486 || y < 331) : y < 306;
    source.copy(isHair ? (onFringe ? front : lock) : face, i, i, i + 4);
  }
}
await Promise.all([...planes].map(([role, pixels]) => sharp(pixels, { raw: info }).png().toFile(`${dir}/${role}.png`)));
