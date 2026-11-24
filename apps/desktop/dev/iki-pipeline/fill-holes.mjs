// node fill-holes.mjs <body.png> <x0,y0,x1,y1> [rings=40] — close holes and notches inside the body's silhouette (where the
// picture's hair lay over the shirt): a transparent pixel with >= 5 opaque neighbours of 8 takes their average, ring by ring.
import { createRequire } from "node:module";
import { renameSync } from "node:fs";
const req = createRequire((await import("node:path")).resolve(process.env.IKI_REPO ?? "../iki") + "/packages/mcp/package.json");
const sharp = (await import(req.resolve("sharp"))).default;
const [f, boxS, ringsS = "40"] = process.argv.slice(2);
const [X0, Y0, X1, Y1] = boxS.split(",").map(Number);
const { data, info } = await sharp(f).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const W = info.width; let filled = 0;
for (let ring = 0; ring < +ringsS; ring++) {
  const add = [];
  for (let y = Y0; y < Y1; y++) for (let x = X0; x < X1; x++) {
    const i = (y * W + x) * 4; if (data[i + 3] > 200) continue;
    let r = 0, g = 0, b = 0, n = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { if (!dx && !dy) continue; const j = ((y + dy) * W + (x + dx)) * 4; if (data[j + 3] > 200) { r += data[j]; g += data[j + 1]; b += data[j + 2]; n++; } }
    if (n >= 5) add.push([i, r / n, g / n, b / n]);
  }
  if (!add.length) break;
  for (const [i, r, g, b] of add) { data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255; filled++; }
}
await sharp(data, { raw: info }).png().toFile(f + ".tmp.png"); renameSync(f + ".tmp.png", f);
console.log(f, "holes filled", filled);
