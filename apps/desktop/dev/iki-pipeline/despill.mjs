// node despill.mjs <in.png> <out.png> — keep the flat #00FF00 key, remove green tint from every other pixel
// (anti-aliased edges between the key and the lip line), so no green survives the composer's key.
import { createRequire } from "node:module";
const req = createRequire((await import("node:path")).resolve(process.env.IKI_REPO ?? "../iki") + "/packages/mcp/package.json");
const sharp = (await import(req.resolve("sharp"))).default;
const [src, out] = process.argv.slice(2);
const { data, info } = await sharp(src).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
let key = 0, fixed = 0;
for (let i = 0; i < data.length; i += 4) {
  const r = data[i], g = data[i + 1], b = data[i + 2];
  // The composer keys g > max(r,b)+40; only the weaker tint below that survives as a green fringe.
  if (g > Math.max(r, b) + 40) { key++; continue; }
  const m = Math.max(r, b);
  if (g > m + 6) { data[i + 1] = m; fixed++; }
}
await sharp(data, { raw: info }).png().toFile(out);
console.log({ key, fixed });
