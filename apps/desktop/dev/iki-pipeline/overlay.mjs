// node overlay.mjs <ref-full> <preview> <out> <s> <refChinX> <refChinY> <modelChinX> <modelChinY> <cropTop> <cropH>
import { createRequire } from "node:module";
const req = createRequire((await import("node:path")).resolve(process.env.IKI_REPO ?? "../iki") + "/packages/mcp/package.json");
const sharp = (await import(req.resolve("sharp"))).default;
const [ref, prev, out, s, rx, ry, mx, my, ct, ch] = process.argv.slice(2).map((v, i) => (i < 3 ? v : +v));
const pm = await sharp(prev).metadata();
const rm = await sharp(ref).metadata();
const rw = Math.round(rm.width * s), rh = Math.round(rm.height * s);
const left = Math.round(mx - rx * s), top = Math.round(my - ry * s);
const refScaled = await sharp(ref).resize(rw, rh).png().toBuffer();
// reference placed on a canvas the size of the preview
const canvas = sharp({ create: { width: pm.width, height: pm.height, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } } });
const ex = { left: Math.max(0, -left), top: Math.max(0, -top) };
const cropRef = await sharp(refScaled).extract({ left: ex.left, top: ex.top, width: Math.min(rw - ex.left, pm.width - Math.max(0, left)), height: Math.min(rh - ex.top, pm.height - Math.max(0, top)) }).toBuffer();
const refCanvas = await canvas.composite([{ input: cropRef, left: Math.max(0, left), top: Math.max(0, top) }]).png().toBuffer();
const prevFlat = await sharp(prev).flatten({ background: "#ffffff" }).png().toBuffer();
const half = await sharp(prevFlat).ensureAlpha(0.55).png().toBuffer();
const blend = await sharp(refCanvas).composite([{ input: half }]).png().toBuffer();
const crop = (b) => sharp(b).extract({ left: 0, top: ct, width: pm.width, height: ch }).resize(420).png().toBuffer();
const [a, b, c] = await Promise.all([crop(refCanvas), crop(prevFlat), crop(blend)]);
const h = Math.round(ch * 420 / pm.width);
await sharp({ create: { width: 1280, height: h, channels: 4, background: "#ddd" } }).composite([{ input: a, left: 0, top: 0 }, { input: b, left: 430, top: 0 }, { input: c, left: 860, top: 0 }]).png().toFile(out);
