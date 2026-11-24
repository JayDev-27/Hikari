// node hair-iou.mjs <render.png> <picture.png> <x> <y> <w> <h> <diff.png> — hair-colour masks of model render vs reference over the same canvas box.
import { createRequire } from "node:module";
const req = createRequire((await import("node:path")).resolve(process.env.IKI_REPO ?? "../iki") + "/packages/mcp/package.json");
const sharp = (await import(req.resolve("sharp"))).default;
const [render, pic, x, y, w, h, out] = process.argv.slice(2);
const W = +w, H = +h;
const a = await sharp(render).resize(W, H).flatten({ background: "#c6d0dd" }).removeAlpha().raw().toBuffer();
const b = await sharp(pic).extract({ left: +x, top: +y, width: W, height: H }).removeAlpha().raw().toBuffer();
// hair: warm red, not skin (skin has high g/b), not shirt; dark outlines on hair counted via neighbourhood is skipped.
const hair = (d, i) => { const r = d[i], g = d[i + 1], bl = d[i + 2]; return r > 120 && r - g > 55 && r - bl > 50 && g < 150; };
const diff = Buffer.alloc(W * H * 3);
let both = 0, onlyRef = 0, onlyModel = 0;
const rowsRef = new Map(), rowsMod = new Map();
for (let p = 0; p < W * H; p++) {
  const i = p * 3, ha = hair(a, i), hb = hair(b, i);
  const g = Math.round((b[i] + b[i + 1] + b[i + 2]) / 3 * 0.35 + 160);
  diff[i] = diff[i + 1] = diff[i + 2] = g;
  if (ha && hb) { both++; diff[i] = 120; diff[i + 1] = 120; diff[i + 2] = 120; }
  else if (hb) { onlyRef++; diff[i] = 230; diff[i + 1] = 20; diff[i + 2] = 20; }
  else if (ha) { onlyModel++; diff[i] = 20; diff[i + 1] = 60; diff[i + 2] = 230; }
}
await sharp(diff, { raw: { width: W, height: H, channels: 3 } }).png().toFile(out);
console.log(JSON.stringify({ refHair: both + onlyRef, modelHair: both + onlyModel, iou: +(both / (both + onlyRef + onlyModel)).toFixed(4), onlyRef, onlyModel }));
