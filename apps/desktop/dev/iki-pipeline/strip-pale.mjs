// node strip-pale.mjs <layer.png>... — remove shirt/backdrop-coloured paint (light, unsaturated) from hair layers in place;
// pink hair highlights (green and blue well below red) are kept.
import { createRequire } from "node:module";
import { renameSync } from "node:fs";
const req = createRequire((await import("node:path")).resolve(process.env.IKI_REPO ?? "../iki") + "/packages/mcp/package.json");
const sharp = (await import(req.resolve("sharp"))).default;
for (const f of process.argv.slice(2)) {
  const { data, info } = await sharp(f).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let n = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (!data[i + 3]) continue;
    const r = data[i], g = data[i + 1], b = data[i + 2];
    if (r > 175 && g > 165 && b > 150 && r - b < 45 && r - g < 22) { data[i + 3] = 0; n++; }
  }
  await sharp(data, { raw: info }).png().toFile(f + ".tmp.png"); renameSync(f + ".tmp.png", f);
  console.log(f, "stripped", n);
}
