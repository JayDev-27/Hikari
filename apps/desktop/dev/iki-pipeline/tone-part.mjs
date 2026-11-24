// node tone-part.mjs <model.iki> <partId> <gR,gG,gB> — scale the skin of one painted part to match the body.
//
// A part painted from another picture (Reze's flower offer arm, from the offer reference) can carry
// a slightly different skin tone from the arm it replaces, so the swap shows a colour jump. Only its
// skin-like pixels (red over 120, red at least 20 over blue) are multiplied by the per-channel gains;
// outlines, the white flower and its green stem keep their colour, and so does the shading's contrast.
// The gains are the ratio of the two arms' median skin colour, measured with render_poses.
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
const req = createRequire((await import("node:path")).resolve(process.env.IKI_REPO ?? "../iki") + "/packages/mcp/package.json");
const sharp = (await import(req.resolve("sharp"))).default;

const [file, partId, gainS] = process.argv.slice(2);
const gain = gainS.split(",").map(Number);
const model = JSON.parse(readFileSync(file, "utf8"));
const part = model.parts.find((p) => p.id === partId);
if (!part) throw new Error(`no part ${partId}`);
if (model.parts.some((p) => p !== part && p.texture.index === part.texture.index)) throw new Error(`${partId} shares its texture; tone it in its own file`);
const tex = model.textures[part.texture.index];
const { data: d, info } = await sharp(Buffer.from(tex.source.split(",")[1], "base64")).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
let n = 0;
for (let i = 0; i < d.length; i += 4) {
  if (d[i + 3] === 0 || d[i] <= 120 || d[i] - d[i + 2] < 20) continue;
  for (let c = 0; c < 3; c++) d[i + c] = Math.min(255, Math.round(d[i + c] * gain[c]));
  n++;
}
tex.source = `data:image/png;base64,${(await sharp(d, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer()).toString("base64")}`;
writeFileSync(file, JSON.stringify(model));
console.log(`${partId}: ${n} skin px scaled by ${gain}`);
