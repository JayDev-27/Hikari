// Preserve Iki's complete face mesh and trim only the hidden backing paint in
// its atlas. Cutting the bridge before meshing can clip the visible cheek and ear.
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";

const require = createRequire(resolve(process.env.IKI_REPO, "packages/mcp/package.json"));
const sharp = require("sharp");
const [picture, file] = process.argv.slice(2);
const model = JSON.parse(readFileSync(file, "utf8"));
const {data: source, info: sourceInfo} = await sharp(picture).ensureAlpha().raw().toBuffer({resolveWithObject: true});
const longLock = await sharp(join(dirname(picture), "final/hair_side_R.png")).ensureAlpha().raw().toBuffer();
const texture = model.textures[0];
const png = Buffer.from(texture.source.split(",")[1], "base64");
const {data, info} = await sharp(png).ensureAlpha().raw().toBuffer({resolveWithObject: true});

for (const role of ["face", "hair_back"]) {
  const part = model.parts.find(({ id }) => id === role);
  const { x: u, y: v } = part.texture.uv;
  const atlasX = Math.floor(u * info.width), atlasY = Math.floor(v * info.height);
  const canvasX = Math.round(model.canvas.width / 2 + part.transform.x - part.width / 2);
  const canvasY = Math.round(model.canvas.height / 2 - part.transform.y - part.height / 2);
  for (let py = 0; py < part.height; py++) for (let px = 0; px < part.width; px++) {
    const x = canvasX + px, y = canvasY + py;
    if (y < 180 || y >= 545) continue;
    const p = (y * sourceInfo.width + x) * 4;
    const i = ((atlasY + py) * info.width + atlasX + px) * 4;
    if (!data[i + 3]) continue;
    // The lock owns these strands. Remove the older backing under their
    // opaque paint so it cannot break into flecks as the lock tilts.
    if (role === "hair_back" && y >= 350 && x < (y >= 426 ? 438 : 380) && longLock[p + 3] >= 250) {
      data[i + 3] = 0;
      continue;
    }
    const changed = Math.abs(data[i] - source[p]) + Math.abs(data[i + 1] - source[p + 1]) + Math.abs(data[i + 2] - source[p + 2]);
    if (changed < 6 && source[p + 3] > 24) continue;
    if (role === "face") {
      const outerCheek = 651 - Math.max(0, y - 337) * 0.21;
      if ((x < 422 && y < 336) || (x > outerCheek && x < 675 && y >= 310 && y < 430)) data[i + 3] = 0;
    } else if (y > 350 && x < 390 + (y - 350) * 0.34) {
      data[i + 3] = 0;
    }
  }
}
const result = await sharp(data, {raw: info}).png().toBuffer();
texture.source = `data:image/png;base64,${result.toString("base64")}`;
writeFileSync(file, JSON.stringify(model));
