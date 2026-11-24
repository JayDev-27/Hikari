// node hair-tol.mjs <render> <picture> x y w h — mismatches with a counterpart within 2 px, largest mismatch blob (eyes excluded).
import { createRequire } from "node:module";
const req = createRequire((await import("node:path")).resolve(process.env.IKI_REPO ?? "../iki") + "/packages/mcp/package.json");
const sharp = (await import(req.resolve("sharp"))).default;
const [render, pic, X, Y, w, h, profile, diff] = process.argv.slice(2); const W = +w, H = +h;
const reze = profile === "reze";
const rize = profile === "rize";
const cheng = profile === "cheng";
const lu = profile === "lu";
const model = sharp(render).resize(W, H);
const reference = sharp(pic).extract({ left: +X, top: +Y, width: W, height: H });
const alpha = reze || rize || cheng || lu;
const a = await (alpha ? model.ensureAlpha() : model.flatten({ background: "#c6d0dd" }).removeAlpha()).raw().toBuffer();
const b = await (alpha ? reference.ensureAlpha() : reference.removeAlpha()).raw().toBuffer();
const hair = (d, p) => { const i = p * 3, r = d[i], g = d[i + 1], bl = d[i + 2]; return r > 120 && r - g > 55 && r - bl > 50 && g < 150; };
const eye = (x, y) => { const cx = x + +X, cy = y + +Y; return (cy > 405 && cy < 470 && ((cx > 400 && cx < 520) || (cx > 580 && cx < 700))) || (cx > 500 && cx < 610 && cy > 548 && cy < 595); };
const A = new Uint8Array(W * H), B = new Uint8Array(W * H);
// In the purple hair palette, the blue channel exceeds green and the
// red-blue difference stays low. The choker crosses the crop below the jaw.
const purple = (d, p) => {
  const x = p % W + +X, y = Math.floor(p / W) + +Y;
  const i = p * 4, r = d[i], g = d[i + 1], bl = d[i + 2];
  return d[i + 3] >= 100 && g < 124 && r - bl < 17 && bl >= g - 1 &&
    (y < 505 || (y <= 551 && (x < 461 || x > 619)));
};
const plum = (d, p) => {
  const y = Math.floor(p / W) + +Y;
  const i = p * 4, r = d[i], g = d[i + 1], bl = d[i + 2];
  return y <= 1050 && d[i + 3] >= 100 && bl - g >= 7 && r - g >= 8 && bl - r <= 29 && r - bl <= 35;
};
const rizeIris = (x, y) => {
  const cx = x + +X, cy = y + +Y;
  return cy >= 344 && cy <= 376 && ((cx >= 449 && cx <= 500) || (cx >= 594 && cx <= 645));
};
const chengHair = (d, p) => {
  const x = p % W + +X, y = Math.floor(p / W) + +Y;
  const i = p * 4, r = d[i], g = d[i + 1], bl = d[i + 2];
  if (d[i + 3] < 100 || y >= 455 || (y >= 375 && x >= 485 && x <= 615)) return false;
  const dark = r < 118 && Math.abs(r - g) < 24 && Math.abs(bl - g) < 15;
  const rim = r >= 120 && r - g >= 30 && g - bl >= 15 &&
    (x >= 612 && y < 310 || x >= 658 && y < 440 || x >= 600 && y < 156);
  return dark || rim;
};
const chengEye = (x, y) => {
  const cx = x + +X, cy = y + +Y;
  return cy >= 285 && cy <= 341 && ((cx >= 474 && cx <= 524) || (cx >= 574 && cx <= 627));
};
const luHair = (d, p) => {
  const x = p % W + +X, y = Math.floor(p / W) + +Y;
  const i = p * 4, r = d[i], g = d[i + 1], bl = d[i + 2];
  if (d[i + 3] < 100 || y >= 376) return false;
  if (y < 275) return true;
  if (y >= 320 && y <= 348 && ((x >= 460 && x <= 522) || (x >= 570 && x <= 637))) return false;
  return r > 116 && r - bl < 19 && bl >= g - 6;
};
const inHair = lu ? luHair : cheng ? chengHair : rize ? plum : reze ? purple : hair;
for (let p = 0; p < W * H; p++) { A[p] = inHair(a, p); B[p] = inHair(b, p); }
const near = (M, x, y, r = 2) => { for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) { const xx = x + dx, yy = y + dy; if (xx >= 0 && yy >= 0 && xx < W && yy < H && M[yy * W + xx]) return true; } return false; };
let mism = 0, tol = 0; const bad = new Uint8Array(W * H);
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const p = y * W + x;
  if (rize && rizeIris(x, y) || cheng && chengEye(x, y)) A[p] = B[p] = 0;
  if (A[p] === B[p] || (!alpha && eye(x, y))) continue;
  mism++;
  if (A[p] ? near(B, x, y) : near(A, x, y)) tol++; else bad[p] = 1;
}
let big = 0, bigAt = null; const seen = new Uint8Array(W * H);
for (let s = 0; s < W * H; s++) { if (!bad[s] || seen[s]) continue; const st = [s]; seen[s] = 1; let n = 0;
  while (st.length) { const p = st.pop(); n++; const x = p % W; for (const q of [p - 1, p + 1, p - W, p + W]) { if (q < 0 || q >= W * H || seen[q] || !bad[q]) continue; if ((q === p - 1 && x === 0) || (q === p + 1 && x === W - 1)) continue; seen[q] = 1; st.push(q); } }
  if (n > big) { big = n; bigAt = [s % W + +X, Math.floor(s / W) + +Y]; } }
const refHair = B.reduce((s, v) => s + v, 0);
const intersection = A.reduce((sum, value, p) => sum + (value & B[p]), 0);
const union = A.reduce((sum, value, p) => sum + (value | B[p]), 0);
if (diff) {
  const pixels = Buffer.alloc(W * H * 3);
  for (let p = 0; p < bad.length; p++) if (bad[p]) pixels[p * 3 + (B[p] ? 0 : 2)] = 255;
  await sharp(pixels, { raw: {width: W, height: H, channels: 3} }).png().toFile(diff);
}
console.log(JSON.stringify({ refHair, iou: intersection / union, mismatched: mism, within2px: tol, beyond2px: mism - tol, beyondPct: +(100 * (mism - tol) / refHair).toFixed(3), largestBlobPx: big, at: bigAt }));
