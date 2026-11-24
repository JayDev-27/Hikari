// node split-arms.mjs <cut-body.png> <arms.json> <out-dir> — split the picture's painted arms off its body into arm_R / arm_L
// layers (each a whole hanging arm, shoulder at the top, as the rig expects) and fill the torso's side the sleeves covered.
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
const req = createRequire((await import("node:path")).resolve(process.env.IKI_REPO ?? "../iki") + "/packages/mcp/package.json");
const sharp = (await import(req.resolve("sharp"))).default;
const [bodyF, armsF, out] = process.argv.slice(2);
const arms = JSON.parse(readFileSync(armsF, "utf8"));
const { data, info } = await sharp(bodyF).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const W = info.width, H = info.height;
const inPoly = (poly, x, y) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, yi] = poly[i], [xj, yj] = poly[j]; if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c; } return c; };
const torso = Buffer.from(data);
const side = arms.torsoSides ?? { R: [[250, 645], [335, 1150]], L: [[850, 645], [765, 1150]] };
const [top, bottom] = arms.rows ?? [620, 1945];
const [fillTop, fillBottom] = arms.fillRows ?? [645, 1150];
const fillTorso = arms.fillTorso !== false;
const lineX = ([[x0, y0], [x1, y1]], y) => x0 + ((x1 - x0) * (y - y0)) / (y1 - y0);
// The gap between each arm and the torso/trousers, top to bottom: body paint outside it is arm.
const bound = arms.bounds ?? { R: [[262, 620], [330, 1150], [300, 1250], [250, 1500], [240, 1945]], L: [[838, 620], [770, 1150], [800, 1250], [850, 1500], [860, 1945]] };
const boundX = (pts, y) => { for (let i = 0; i < pts.length - 1; i++) { const [x0, y0] = pts[i], [x1, y1] = pts[i + 1]; if (y >= y0 && y <= y1) return x0 + ((x1 - x0) * (y - y0)) / (y1 - y0); } return null; };
for (const key of ["R", "L"]) {
  const poly = arms[key], arm = Buffer.alloc(W * H * 4);
  const removed = [];
  for (let y = Math.max(0, top); y <= Math.min(H - 1, bottom); y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4; if (!data[i + 3]) continue;
    const bx = boundX(bound[key], y);
    const outside = bx !== null && (key === "R" ? x < bx : x > bx);
    if (!outside && !inPoly(poly, x + 0.5, y + 0.5)) continue;
    data.copy(arm, i, i, i + 4); torso[i + 3] = 0; removed.push([x, y]);
  }
  // fill the torso under the sleeve: removed pixels inside the torso's side line take the nearest torso pixel in their row
  let filled = 0;
  for (const [x, y] of removed) {
    if (!fillTorso || y < fillTop || y > fillBottom) continue;
    const lx = lineX(side[key], y);
    const inside = key === "R" ? x > lx : x < lx; if (!inside) continue;
    const step = key === "R" ? 1 : -1;
    // nearest LIGHT shirt pixel inward (skip outline strokes and shadows), so the fill is flat cloth, not streaks
    for (let xx = x + step, k = 0; xx >= 0 && xx < W && k < 90; xx += step, k++) {
      const j = (y * W + xx) * 4;
      if (torso[j + 3] > 200 && (torso[j] + torso[j + 1] + torso[j + 2]) / 3 > 170) { torso.copy(torso, (y * W + x) * 4, j, j + 4); torso[(y * W + x) * 4 + 3] = 255; filled++; break; }
    }
  }
  await sharp(arm, { raw: { width: W, height: H, channels: 4 } }).png().toFile(`${out}/arm_${key}.png`);
  console.log(`arm_${key}: ${removed.length} px, torso filled ${filled}`);
}
// Clean up the torso side the sleeves hid: smooth the filled cloth vertically, cut a clean antialiased silhouette
// along the side line, and ink it with the drawing's outline colour, so a bent arm reveals a drawn contour, not streaks.
const LINE = [58, 52, 50];
for (const key of fillTorso ? ["R", "L"] : []) {
  const filledMask = new Uint8Array(W * H);
  for (let y = fillTop; y <= fillBottom; y++) {
    const lx = lineX(side[key], y);
    for (let k = 0; k < 70; k++) {
      const x = key === "R" ? Math.floor(lx) + k : Math.ceil(lx) - k; if (x < 0 || x >= W) continue;
      const i = (y * W + x) * 4; if (!torso[i + 3]) continue;
      if (data[i + 3] && !(torso[i] === data[i] && torso[i + 1] === data[i + 1] && torso[i + 2] === data[i + 2])) filledMask[y * W + x] = 1;
    }
  }
  const src = Buffer.from(torso);
  for (let y = fillTop; y <= fillBottom; y++) for (let x = 0; x < W; x++) {
    if (!filledMask[y * W + x]) continue; let r = 0, g = 0, b = 0, n = 0;
    for (let dy = -14; dy <= 14; dy++) { const yy = y + dy; if (yy < fillTop || yy > fillBottom) continue; const j = (yy * W + x) * 4; if (src[j + 3] > 200 && (src[j] + src[j + 1] + src[j + 2]) / 3 > 170) { r += src[j]; g += src[j + 1]; b += src[j + 2]; n++; } }
    if (n) { const i = (y * W + x) * 4; torso[i] = r / n; torso[i + 1] = g / n; torso[i + 2] = b / n; }
  }
  for (let y = fillTop; y <= fillBottom; y++) {
    const lx = lineX(side[key], y);
    for (let k = -6; k <= 6; k++) {
      const x = Math.round(lx) + k; if (x < 0 || x >= W) continue; const i = (y * W + x) * 4;
      const outward = key === "R" ? lx - (x + 0.5) : (x + 0.5) - lx;      // > 0 = outside the torso
      if (outward > 0.5) { torso[i + 3] = 0; continue; }                  // clean silhouette
      const ink = Math.max(0, 1 - Math.abs(outward + 1.2) / 1.4);          // ~2.5 px line just inside the edge
      if (ink > 0 && torso[i + 3]) for (let c = 0; c < 3; c++) torso[i + c] = Math.round(torso[i + c] * (1 - ink) + LINE[c] * ink);
      if (outward > -0.5) torso[i + 3] = Math.round(255 * (0.5 - outward));  // antialiased edge pixel
    }
  }
}
await sharp(torso, { raw: { width: W, height: H, channels: 4 } }).png().toFile(`${out}/body.png`);
