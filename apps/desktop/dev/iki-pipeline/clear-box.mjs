// node clear-box.mjs <layer.png> <x0,y0,x1,y1> — make a rectangle of a layer transparent (fill that sticks out past
// a hidden outline, e.g. Makima's neck beside her right lock, which shows as a pale wedge when the head tilts).
import { createRequire } from "node:module";
const req = createRequire((await import("node:path")).resolve(process.env.IKI_REPO ?? "../iki") + "/packages/mcp/package.json");
const sharp = (await import(req.resolve("sharp"))).default;
const [file, boxS] = process.argv.slice(2); const [X0, Y0, X1, Y1] = boxS.split(",").map(Number);
const { data: O, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
let n = 0; for (let y = Y0; y < Y1; y++) for (let x = X0; x < X1; x++) { const i = (y * info.width + x) * 4; if (O[i + 3]) { O[i + 3] = 0; n++; } }
await sharp(O, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toFile(`${file}.tmp`);
(await import("node:fs")).renameSync(`${file}.tmp`, file);
console.log(`${file}: cleared ${n} px`);
