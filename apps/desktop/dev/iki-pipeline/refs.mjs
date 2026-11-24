// node refs.mjs <src.png> <out.png> <top> <height> [aspect=1]  → crop full-width band, pad to aspect (w/h), flatten on grey-blue, 1024 wide
import { createRequire } from "node:module";
const req = createRequire((await import("node:path")).resolve(process.env.IKI_REPO ?? "../iki") + "/packages/mcp/package.json");
const sharp = (await import(req.resolve("sharp"))).default;
const [src, out, top, height, aspect = "1"] = process.argv.slice(2);
const bg = { r: 201, g: 211, b: 224, alpha: 1 };
const meta = await sharp(src).metadata();
const h = Math.min(Number(height), meta.height - Number(top));
const crop = await sharp(src).extract({ left: 0, top: Number(top), width: meta.width, height: h }).toBuffer();
const W = Math.round(h * Number(aspect)), pad = Math.max(0, W - meta.width);
await sharp(crop).extend({ left: Math.floor(pad / 2), right: Math.ceil(pad / 2), top: 0, bottom: 0, background: bg }).flatten({ background: bg })
  .resize(1024, Math.round(1024 / Number(aspect)), { kernel: "lanczos3", fit: "fill" }).png().toFile(out);
console.log("wrote", out, W, "x", h);
