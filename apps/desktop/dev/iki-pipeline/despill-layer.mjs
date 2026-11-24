// node despill-layer.mjs <layer.png>... — remove any green cast from final (already keyed) layers in place.
import { createRequire } from "node:module";
import { renameSync } from "node:fs";
const req = createRequire((await import("node:path")).resolve(process.env.IKI_REPO ?? "../iki") + "/packages/mcp/package.json");
const sharp = (await import(req.resolve("sharp"))).default;
for (const f of process.argv.slice(2)) {
  const { data, info } = await sharp(f).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let n = 0;
  for (let i = 0; i < data.length; i += 4) {
    const m = Math.max(data[i], data[i + 2]);
    if (data[i + 3] > 0 && data[i + 1] > m + 4) { data[i + 1] = m; n++; }
  }
  await sharp(data, { raw: info }).png().toFile(f + ".tmp.png");
  renameSync(f + ".tmp.png", f);
  console.log(f, "despilled", n);
}
