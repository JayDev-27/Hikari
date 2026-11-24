// node strip-backdrop.mjs <layer.png>… — drop light bluish backdrop pixels a cut kept inside hair (gaps between strands).
// Pixels clearly bluer than red and light (lum > 130) become transparent; dark blue-grey outline pixels stay.
import { createRequire } from "node:module";
const req = createRequire((await import("node:path")).resolve(process.env.IKI_REPO ?? "../iki") + "/packages/mcp/package.json");
const sharp = (await import(req.resolve("sharp"))).default;
for (const file of process.argv.slice(2)) {
  const { data: O, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true }); let n = 0;
  for (let i = 0; i < O.length; i += 4) { if (!O[i + 3]) continue; const r = O[i], g = O[i + 1], b = O[i + 2];
    if (b > r + 8 && b >= g && 0.3 * r + 0.59 * g + 0.11 * b > 130) { O[i + 3] = 0; n++; } }
  await sharp(O, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toFile(`${file}.tmp`);
  (await import("node:fs")).renameSync(`${file}.tmp`, file);
  console.log(`${file}: ${n} backdrop px dropped`);
}
