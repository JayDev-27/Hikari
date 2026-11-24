// node fill-under-hair.mjs <final-dir> <x0,y0,x1,y1> [reach=24] — where a layer drawn IN FRONT of the body (side locks, bangs, face) covers the body at rest and the body has no
// paint (the picture had hair there), grow the body's own colours under the hair, up to `reach` px from its paint,
// so a moving head reveals collar and neck instead of holes.
import { createRequire } from "node:module";
import { renameSync } from "node:fs";
const req = createRequire((await import("node:path")).resolve(process.env.IKI_REPO ?? "../iki") + "/packages/mcp/package.json");
const sharp = (await import(req.resolve("sharp"))).default;
const [dir, boxS, reachS = "24"] = process.argv.slice(2);
const [X0, Y0, X1, Y1] = boxS.split(",").map(Number), reach = +reachS;
const load = async (f) => { const { data, info } = await sharp(f).ensureAlpha().raw().toBuffer({ resolveWithObject: true }); return { data, W: info.width, H: info.height }; };
const B = await load(`${dir}/body.png`);
const hairs = await Promise.all(["hair_side_L", "hair_side_R", "hair_front", "face"].map((h) => load(`${dir}/${h}.png`)));
const W = B.W, covered = (x, y) => hairs.some((h) => h.data[(y * W + x) * 4 + 3] > 64);
let grown = 0;
for (let ring = 0; ring < reach; ring++) {
  const add = [];
  for (let y = Y0; y < Y1; y++) for (let x = X0; x < X1; x++) {
    const i = (y * W + x) * 4; if (B.data[i + 3] > 200 || !covered(x, y)) continue;
    let r = 0, g = 0, b = 0, n = 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
      const j = ((y + dy) * W + (x + dx)) * 4; if (B.data[j + 3] > 200) { r += B.data[j]; g += B.data[j + 1]; b += B.data[j + 2]; n++; }
    }
    if (n >= 2) add.push([i, r / n, g / n, b / n]);
  }
  if (!add.length) break;
  for (const [i, r, g, b] of add) { B.data[i] = r; B.data[i + 1] = g; B.data[i + 2] = b; B.data[i + 3] = 255; grown++; }
}
await sharp(B.data, { raw: { width: W, height: B.H, channels: 4 } }).png().toFile(`${dir}/body.png.tmp.png`);
renameSync(`${dir}/body.png.tmp.png`, `${dir}/body.png`);
console.log("body grown under hair", grown);
