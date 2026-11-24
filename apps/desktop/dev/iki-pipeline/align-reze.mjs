import { createRequire } from "node:module";
import { resolve } from "node:path";

const require = createRequire(resolve(process.env.IKI_REPO, "packages/mcp/package.json"));
const sharp = require("sharp");
const dir = process.argv[2];
// Scale the 448×1528 composite by 2.06 and translate by (4, 48).
// The source chin at (265, 220) lands at (550, 501).
const input = await sharp(`${dir}/psd-recomposite.png`)
  .resize(923, 3148, { fit: "fill", kernel: "cubic" }).png().toBuffer();
const { data, info } = await sharp({
  create: { width: 1100, height: 4096, channels: 4, background: "#00000000" },
}).composite([{ input, left: 4, top: 48 }]).raw().toBuffer({ resolveWithObject: true });
// The PSD's nominally opaque paint is about 99% alpha. Iki only builds
// occluded fill behind pixels that are fully opaque. Keep the soft edges.
for (let i = 3; i < data.length; i += 4) {
  if (data[i] >= 250) data[i] = 255;
}
await sharp(data, { raw: info }).png().toFile(`${dir}/picture.png`);

const mouthBox = { left: 504, top: 414, width: 86, height: 35 };
const mouth = await sharp(data, { raw: info }).extract(mouthBox).raw().toBuffer();
for (let y = 0; y < mouthBox.height; y++) for (let x = 0; x < mouthBox.width; x++) {
  const distance = Math.min(x, y, mouthBox.width - 1 - x, mouthBox.height - 1 - y);
  const i = (y * mouthBox.width + x) * 4 + 3;
  mouth[i] = Math.round(mouth[i] * Math.min(1, distance / 4));
}
await sharp(mouth, {raw: {...mouthBox, channels: 4}}).png().toFile(`${dir}/closed-smile.png`);
