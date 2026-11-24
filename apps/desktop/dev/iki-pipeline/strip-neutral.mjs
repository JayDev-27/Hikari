// node strip-neutral.mjs <layer.png> <minY> — drop neutral (grey/white/black-grey) paint from a hair layer below minY:
// the picture's collar strokes and shirt flecks the cut assigned to hair. Hair, lines included, is warm (red clearly above g/b).
import { createRequire } from "node:module";
import { renameSync } from "node:fs";
const req = createRequire((await import("node:path")).resolve(process.env.IKI_REPO ?? "../iki") + "/packages/mcp/package.json");
const sharp = (await import(req.resolve("sharp"))).default;
const [f, minYS, bodyF, profile] = process.argv.slice(2);
const body = bodyF ? await sharp(bodyF).ensureAlpha().raw().toBuffer({ resolveWithObject: true }) : null;
let moved = 0;
const { data, info } = await sharp(f).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
let n = 0;
for (let y = +minYS; y < info.height; y++) for (let x = 0; x < info.width; x++) {
  const i = (y * info.width + x) * 4; if (!data[i + 3]) continue;
  const r = data[i], g = data[i + 1], b = data[i + 2];
  const warm = r - Math.max(g, b), lum = 0.3 * r + 0.59 * g + 0.11 * b;
  if (profile === "plum" && b - g > 7 && r - b > -24 && r - g > 3) continue;
  if ((lum > 120 && warm < 14) || (lum <= 120 && warm < 4)) {
    // collar/shirt paint the cut read as hair: hand it to the body where the body has none, instead of leaving a hole
    // only the collar's DARK strokes that touch the shirt go to the body; pale backdrop slivers and detached bits are dropped
    let touches = false;
    if (body && lum <= 120) for (let dy = -2; dy <= 2 && !touches; dy++) for (let dx = -2; dx <= 2; dx++) { const j = ((y + dy) * info.width + (x + dx)) * 4; if (body.data[j + 3] > 200) { touches = true; break; } }
    if (body && touches && body.data[i + 3] < 128) { body.data[i] = r; body.data[i + 1] = g; body.data[i + 2] = b; body.data[i + 3] = data[i + 3]; moved++; }
    data[i + 3] = 0; n++;
  }
}
await sharp(data, { raw: info }).png().toFile(f + ".tmp.png"); renameSync(f + ".tmp.png", f);
if (body) { await sharp(body.data, { raw: body.info }).png().toFile(bodyF + ".tmp.png"); renameSync(bodyF + ".tmp.png", bodyF); }
console.log(f, "neutral px removed", n, "moved to body", moved);
