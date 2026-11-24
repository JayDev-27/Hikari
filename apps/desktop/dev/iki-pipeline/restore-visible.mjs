// node restore-visible.mjs <finalDir> <picture.png> <x0,y0,x1,y1> — make the body match the picture wherever the
// picture shows it (inside the box, outside the hair drawn in front of the body).
//
// Cutting, arm splitting and cleanup passes leave the body slightly wrong right beside the locks (outline notches,
// missing cloth, cloth over the braid). There the picture is the ground truth:
//   - cloth, skin and outline pixels are copied;
//   - backdrop pixels become transparent;
//   - hair pixels (the braid, drawn behind the body) become transparent so the hair layer behind shows;
//   - mixed outline/backdrop edge pixels are unmixed against the outline colour (no light halo).
// Pixels under or within 3 px of hair_side_L/R or hair_front are left alone (repaint-under-hair.mjs handles them).
import { createRequire } from "node:module";
const req = createRequire((await import("node:path")).resolve(process.env.IKI_REPO ?? "../iki") + "/packages/mcp/package.json");
const sharp = (await import(req.resolve("sharp"))).default;

const [dir, pic, boxS, originalBody] = process.argv.slice(2);
const [X0, Y0, X1, Y1] = boxS.split(",").map(Number);
const load = async (f) => { const { data, info } = await sharp(f).ensureAlpha().raw().toBuffer({ resolveWithObject: true }); return { d: data, w: info.width, h: info.height }; };
const body = await load(`${dir}/body.png`), P = (await load(pic)).d; const { w: W, h: H } = body; const B = body.d;
const front = await Promise.all(["hair_side_L", "hair_side_R", "hair_front"].map((n) => load(`${dir}/${n}.png`)));

let M = new Uint8Array(W * H);
for (let y = Y0; y < Y1; y++) for (let x = X0; x < X1; x++) { const p = y * W + x; if (front.some((l) => l.d[p * 4 + 3] > 10)) M[p] = 1; }
for (let k = 0; k < 3; k++) { const N = M.slice(); for (let y = Y0; y < Y1; y++) for (let x = X0; x < X1; x++) { const p = y * W + x; if (!M[p] && (M[p - 1] || M[p + 1] || M[p - W] || M[p + W])) N[p] = 1; } M = N; }

if (originalBody) {
  // A transparent illustration already has clean edge coverage. Use the cutter's
  // original body assignment to distinguish visible cloth from back hair and face.
  const cut = (await load(originalBody)).d;
  for (let y = Y0; y < Y1; y++) for (let x = X0; x < X1; x++) {
    const p = y * W + x, i = 4 * p;
    if (!M[p] && cut[i + 3] && cut[i] === P[i] && cut[i + 1] === P[i + 1] && cut[i + 2] === P[i + 2]) {
      P.copy(B, i, i, i + 4);
    }
  }
  await sharp(B, { raw: { width: W, height: H, channels: 4 } }).png().toFile(`${dir}/body.png`);
} else {
  // Backdrop colour: median of the picture's top-left 40×40 corner.
  const corner = []; for (let y = 0; y < 40; y++) for (let x = 0; x < 40; x++) { const i = (y * W + x) * 4; corner.push([P[i], P[i + 1], P[i + 2]]); }
  const med = (k) => corner.map((c) => c[k]).sort((a, b) => a - b)[corner.length >> 1]; const bg = [med(0), med(1), med(2)];
  const dist = (i, c) => Math.hypot(P[i] - c[0], P[i + 1] - c[1], P[i + 2] - c[2]);
  const lum = (i) => 0.3 * P[i] + 0.59 * P[i + 1] + 0.11 * P[i + 2];
  const bgLike = (p) => dist(p * 4, bg) < 28;
  // Backdrop = backdrop-coloured pixels connected to the box border (light cloth highlights inside the shirt are not).
  const BG = new Uint8Array(W * H);
  {
    const q = [];
    for (let x = X0; x < X1; x++) for (const y of [Y0, Y1 - 1]) { const p = y * W + x; if (bgLike(p)) { BG[p] = 1; q.push(p); } }
    for (let y = Y0; y < Y1; y++) for (const x of [X0, X1 - 1]) { const p = y * W + x; if (bgLike(p) && !BG[p]) { BG[p] = 1; q.push(p); } }
    for (let h = 0; h < q.length; h++) { const p = q[h]; for (const n of [p - 1, p + 1, p - W, p + W]) { const x = n % W, y = (n / W) | 0; if (x < X0 || x >= X1 || y < Y0 || y >= Y1 || BG[n] || !bgLike(n)) continue; BG[n] = 1; q.push(n); } }
  }
  const isBg = (p) => BG[p] === 1;
  const isHair = (i) => (P[i] - P[i + 1] > 70 && P[i] - P[i + 2] > 60) || (P[i] > 50 && P[i] > 1.6 * P[i + 1] && P[i] > 1.5 * P[i + 2]); // red hair, incl. its dark shadow
  const ink = [50, 46, 46];

  let copied = 0, cleared = 0, unmixed = 0;
  for (let y = Y0; y < Y1; y++) for (let x = X0; x < X1; x++) {
    const p = y * W + x, i = p * 4; if (M[p]) continue;
    if (isBg(p) || isHair(i)) { if (B[i + 3]) cleared++; B[i + 3] = 0; continue; }
    // Hair outline (dark, touching hair, no cloth nearby) belongs to the hair layer, not the body.
    if (lum(i) < 90) {
      let hairN = false, clothN = false;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { const j = ((y + dy) * W + x + dx) * 4; if (isHair(j)) hairN = true; else if (lum(j) > 150 && !BG[(y + dy) * W + x + dx]) clothN = true; }
      if (hairN && !clothN) { if (B[i + 3]) cleared++; B[i + 3] = 0; continue; }
    }
    const nearBg = [p - 1, p + 1, p - W, p + W, p - 2, p + 2, p - 2 * W, p + 2 * W].some(isBg);
    if (nearBg && lum(i) > 60) {
      // Edge pixel: picture = a·ink + (1−a)·backdrop.
      const a = Math.max(0, Math.min(1, (dist(i, bg)) / Math.hypot(ink[0] - bg[0], ink[1] - bg[1], ink[2] - bg[2])));
      B[i] = ink[0]; B[i + 1] = ink[1]; B[i + 2] = ink[2]; B[i + 3] = Math.round(a * 255); unmixed++; continue;
    }
    B[i] = P[i]; B[i + 1] = P[i + 1]; B[i + 2] = P[i + 2]; B[i + 3] = 255; copied++;
  }
  await sharp(B, { raw: { width: W, height: H, channels: 4 } }).png().toFile(`${dir}/body.png.tmp`);
  (await import("node:fs")).renameSync(`${dir}/body.png.tmp`, `${dir}/body.png`);
  console.log(`restored ${copied} px from the picture, cleared ${cleared}, unmixed ${unmixed} edge px (backdrop ${bg})`);
}
