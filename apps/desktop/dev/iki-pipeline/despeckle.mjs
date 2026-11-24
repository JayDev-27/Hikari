// node despeckle.mjs <layer.png> [minPx=80] — drop isolated opaque fragments smaller than minPx (in place).
import { createRequire } from "node:module";
import { renameSync } from "node:fs";
const req = createRequire((await import("node:path")).resolve(process.env.IKI_REPO ?? "../iki") + "/packages/mcp/package.json");
const sharp = (await import(req.resolve("sharp"))).default;
const [f, minS = "80"] = process.argv.slice(2);
const { data, info } = await sharp(f).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const W = info.width, H = info.height, seen = new Uint8Array(W * H);
let removed = 0;
for (let s = 0; s < W * H; s++) {
  if (seen[s] || data[s * 4 + 3] < 8) continue;
  const comp = [s]; seen[s] = 1;
  for (let k = 0; k < comp.length; k++) {
    const p = comp[k], x = p % W, y = (p - x) / W;
    for (const q of [p - 1, p + 1, p - W, p + W]) {
      if (q < 0 || q >= W * H || seen[q] || data[q * 4 + 3] < 8) continue;
      if ((q === p - 1 && x === 0) || (q === p + 1 && x === W - 1)) continue;
      seen[q] = 1; comp.push(q);
    }
  }
  if (comp.length < +minS) { for (const p of comp) data[p * 4 + 3] = 0; removed += comp.length; }
}
await sharp(data, { raw: info }).png().toFile(f + ".tmp.png");
renameSync(f + ".tmp.png", f);
console.log(f, "removed", removed, "px");
