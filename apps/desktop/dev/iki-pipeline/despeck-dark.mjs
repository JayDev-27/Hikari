// node despeck-dark.mjs <layer.png> <x0,y0,x1,y1> [maxPx=12] — recolour small dark specks that sit on light cloth.
//
// Cutting and splitting leave tiny dark bits on the shirt (hair-strand tips, stray outline fragments). They are
// invisible at rest next to the hair or arm they came from but stay behind when that part moves. Any dark connected
// bit of at most maxPx pixels whose surrounding ring is at least 80 % light cloth takes the ring's average colour.
// Real outlines are long and connected, so they are never touched.
import { createRequire } from "node:module";
const req = createRequire((await import("node:path")).resolve(process.env.IKI_REPO ?? "../iki") + "/packages/mcp/package.json");
const sharp = (await import(req.resolve("sharp"))).default;

const [file, boxS, maxS = "12"] = process.argv.slice(2);
const [X0, Y0, X1, Y1] = boxS.split(",").map(Number); const MAX = +maxS;
const { data: O, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const W = info.width, H = info.height;
const L = (p) => 0.3 * O[p * 4] + 0.59 * O[p * 4 + 1] + 0.11 * O[p * 4 + 2];
const seen = new Uint8Array(W * H); let specks = 0, fixed = 0;
for (let y = Math.max(Y0, 3); y < Math.min(Y1, H - 3); y++) for (let x = Math.max(X0, 3); x < Math.min(X1, W - 3); x++) {
  const p0 = y * W + x; if (seen[p0] || O[p0 * 4 + 3] < 128 || L(p0) >= 110) continue;
  const comp = [p0]; seen[p0] = 1;
  for (let h = 0; h < comp.length && comp.length <= MAX; h++) { const q = comp[h];
    for (const r of [q - 1, q + 1, q - W, q + W, q - W - 1, q - W + 1, q + W - 1, q + W + 1]) { if (seen[r] || O[r * 4 + 3] < 128 || L(r) >= 110) continue; seen[r] = 1; comp.push(r); } }
  if (comp.length > MAX) continue;
  const set = new Set(comp); const ring = [];
  for (const q of comp) for (const r of [q - 2, q + 2, q - 2 * W, q + 2 * W, q - 2 * W - 2, q - 2 * W + 2, q + 2 * W - 2, q + 2 * W + 2]) if (!set.has(r)) ring.push(r);
  const light = ring.filter((r) => O[r * 4 + 3] > 200 && L(r) > 140);
  if (light.length < ring.length * 0.8) continue;
  const avg = [0, 1, 2].map((c) => light.reduce((a, r) => a + O[r * 4 + c], 0) / light.length);
  for (const q of comp) { for (let c = 0; c < 3; c++) O[q * 4 + c] = Math.round(avg[c]); O[q * 4 + 3] = 255; fixed++; }
  specks++;
}
await sharp(O, { raw: { width: W, height: H, channels: 4 } }).png().toFile(`${file}.tmp`);
(await import("node:fs")).renameSync(`${file}.tmp`, file);
console.log(`${file}: ${specks} specks (${fixed} px) recoloured`);
