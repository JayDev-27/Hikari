// node crop.mjs <src> <out> <left> <top> <w> <h> [outW]
import { createRequire } from "node:module";
const req = createRequire((await import("node:path")).resolve(process.env.IKI_REPO ?? "../iki") + "/packages/mcp/package.json");
const sharp = (await import(req.resolve("sharp"))).default;
const [src, out, l, t, w, h, ow] = process.argv.slice(2);
let img = sharp(src).extract({ left: +l, top: +t, width: +w, height: +h });
if (ow) img = img.resize(+ow);
await img.png().toFile(out);
