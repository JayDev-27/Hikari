// node strip-pale.mjs [--plum | --below y] <layer.png>... — remove shirt/backdrop-coloured paint from hair layers in place;
// pink hair highlights (green and blue well below red) are kept.
import { createRequire } from "node:module";
import { renameSync } from "node:fs";
const req = createRequire((await import("node:path")).resolve(process.env.IKI_REPO ?? "../iki") + "/packages/mcp/package.json");
const sharp = (await import(req.resolve("sharp"))).default;
const files = process.argv.slice(2);
const plum = files[0] === "--plum";
if (plum) files.shift();
const minRow = files[0] === "--below" ? Number(files.splice(0, 2)[1]) : 0;
if (!Number.isInteger(minRow) || minRow < 0) throw new Error("--below requires a non-negative canvas row");
for (const f of files) {
  const { data, info } = await sharp(f).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let n = 0;
  for (let i = minRow * info.width * 4; i < data.length; i += 4) {
    if (!data[i + 3]) continue;
    const r = data[i], g = data[i + 1], b = data[i + 2];
    if (plum && b - g > 13 && r > b) continue;
    if (r > 175 && g > 165 && b > 150 && r - b < 45 && r - g < 22) { data[i + 3] = 0; n++; }
  }
  await sharp(data, { raw: info }).png().toFile(f + ".tmp.png"); renameSync(f + ".tmp.png", f);
  console.log(f, "stripped", n);
}
