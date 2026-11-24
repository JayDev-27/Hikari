// node trim-shoulders.mjs <body.png> "x1,y1,x2,y2;…" — clip the torso above each shoulder outline segment and ink it.
//
// split-arms leaves a corner of torso where the sleeve meets the shoulder. At rest the sleeve covers it; when the arm
// lifts it sticks up as a pale "ear" above the shoulder line. Each segment continues the shoulder's top outline
// (measured on the picture) past that corner: body pixels above it (up to 20 px) are cleared and the segment is
// inked where body remains below it.
import { createRequire } from "node:module";
const req = createRequire((await import("node:path")).resolve(process.env.IKI_REPO ?? "../iki") + "/packages/mcp/package.json");
const sharp = (await import(req.resolve("sharp"))).default;
const [file, segS] = process.argv.slice(2);
const { data: O, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const W = info.width; const ink = [50, 46, 46]; let cleared = 0, inked = 0;
for (const seg of segS.split(";").filter(Boolean)) {
  const [ax, ay, bx, by] = seg.split(",").map(Number);
  for (let x = Math.min(ax, bx); x <= Math.max(ax, bx); x++) {
    const ly = ay + (by - ay) * (x - ax) / (bx - ax);
    for (let y = Math.floor(ly) - 1; y > ly - 20; y--) { const i = (y * W + x) * 4; if (O[i + 3]) { O[i + 3] = 0; cleared++; } }
    for (const y of [Math.floor(ly), Math.floor(ly) + 1]) { const i = (y * W + x) * 4; if (O[i + 3] > 128) { O[i] = ink[0]; O[i + 1] = ink[1]; O[i + 2] = ink[2]; O[i + 3] = 255; inked++; } }
  }
}
await sharp(O, { raw: { width: W, height: info.height, channels: 4 } }).png().toFile(`${file}.tmp`);
(await import("node:fs")).renameSync(`${file}.tmp`, file);
console.log(`trimmed ${cleared} px above the shoulders, inked ${inked} px of outline`);
