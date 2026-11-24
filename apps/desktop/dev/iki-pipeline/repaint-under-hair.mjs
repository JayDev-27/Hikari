// node repaint-under-hair.mjs <finalDir> <x0,y0,x1,y1> [dilate=3] ["x1,y1,x2,y2;…"] — repaint the body where hair hides it.
//
// A head tilt moves the locks and the braid and uncovers body pixels the cut never saw. Earlier passes left smears and
// stray strokes there. This pass treats every body pixel under the hair (within the box, dilated) as unknown and:
//   1. fills colour and coverage harmonically from the visible body around it (dark outline pixels are not used as
//      sources, so lines don't bleed into the cloth; visible backdrop pulls coverage to 0, which keeps the shoulder edge);
//   2. thresholds coverage into a clean silhouette and inks its outer edge where it borders transparency;
//   3. drops small separate islands of body left in the box by earlier passes;
//   4. inks outlines the hair hides completely, given as segments between their visible ends (measured on the picture),
//      2 px wide, on repainted cloth only (a segment written "!x1,y1,x2,y2" is a silhouette edge with air above it);
//   5. recolours dark specks of 12 px or less that sit on light cloth.
import { createRequire } from "node:module";
const req = createRequire((await import("node:path")).resolve(process.env.IKI_REPO ?? "../iki") + "/packages/mcp/package.json");
const sharp = (await import(req.resolve("sharp"))).default;

const [dir, boxS, dilS = "3", linesS = ""] = process.argv.slice(2);
const [X0, Y0, X1, Y1] = boxS.split(",").map(Number); const DIL = +dilS;
const load = async (n) => { const { data, info } = await sharp(`${dir}/${n}.png`).ensureAlpha().raw().toBuffer({ resolveWithObject: true }); return { d: data, w: info.width, h: info.height }; };
const body = await load("body"); const { w: W, h: H } = body; const B = body.d;
const hair = await Promise.all(["hair_side_L", "hair_side_R", "hair_front"].map(load)); // only layers drawn in front of the body (hair_back is drawn behind it)

const inBox = (x, y) => x >= X0 && x < X1 && y >= Y0 && y < Y1;
const lum = (i) => 0.3 * B[i] + 0.59 * B[i + 1] + 0.11 * B[i + 2];
const INK = 95;

// Hidden mask: any hair layer covers it (alpha > 40), dilated.
let M = new Uint8Array(W * H);
for (let y = Y0; y < Y1; y++) for (let x = X0; x < X1; x++) { const p = y * W + x; if (hair.some((l) => l.d[p * 4 + 3] > 10)) M[p] = 1; }
for (let k = 0; k < DIL; k++) { const N = M.slice(); for (let y = Y0 + 1; y < Y1 - 1; y++) for (let x = X0 + 1; x < X1 - 1; x++) { const p = y * W + x; if (!M[p] && (M[p - 1] || M[p + 1] || M[p - W] || M[p + W])) N[p] = 1; } M = N; }
// Only where the body could be: keep hidden pixels that are body now or that border visible body within 40 px below
// the face line (hair over open backdrop far from the body stays untouched).
// Pinholes: small transparent or see-through bits enclosed by body (left by earlier passes) are unknown too, not backdrop.
{
  const seen = new Uint8Array(W * H);
  for (let y = Y0 + 1; y < Y1 - 1; y++) for (let x = X0 + 1; x < X1 - 1; x++) {
    const p0 = y * W + x; if (seen[p0] || B[p0 * 4 + 3] >= 240 || M[p0]) continue;
    const comp = [p0]; seen[p0] = 1; let open = false;
    for (let h = 0; h < comp.length && comp.length <= 60; h++) { const p = comp[h];
      for (const q of [p - 1, p + 1, p - W, p + W]) { const qx = q % W, qy = (q / W) | 0;
        if (!inBox(qx, qy)) { open = true; continue; } if (seen[q] || B[q * 4 + 3] >= 240) continue; seen[q] = 1; comp.push(q); } }
    if (!open && comp.length <= 60) for (const p of comp) M[p] = 1;
  }
}
let unknown = 0; for (let p = 0; p < W * H; p++) unknown += M[p];

// Harmonic fill of premultiplied colour + alpha.
const R = new Float32Array(W * H), G = new Float32Array(W * H), Bl = new Float32Array(W * H), A = new Float32Array(W * H);
const src = new Uint8Array(W * H); // 1 = usable known source
for (let p = 0; p < W * H; p++) {
  const i = p * 4, a = B[i + 3] / 255;
  R[p] = B[i] * a; G[p] = B[i + 1] * a; Bl[p] = B[i + 2] * a; A[p] = a;
  if (!M[p] && !(a > 0.5 && lum(i) < INK)) src[p] = 1;
}
// Seed unknowns with the nearest source (BFS) so the relaxation converges fast.
{
  const q = []; const seen = new Uint8Array(W * H);
  for (let y = Y0; y < Y1; y++) for (let x = X0; x < X1; x++) { const p = y * W + x; if (M[p]) continue; if (src[p]) { q.push(p); seen[p] = 1; } }
  for (let h = 0; h < q.length; h++) { const p = q[h]; for (const n of [p - 1, p + 1, p - W, p + W]) { const x = n % W, y = (n / W) | 0; if (!inBox(x, y) || seen[n] || !M[n]) continue; seen[n] = 1; R[n] = R[p]; G[n] = G[p]; Bl[n] = Bl[p]; A[n] = A[p]; q.push(n); } }
}
const ids = []; for (let y = Y0; y < Y1; y++) for (let x = X0; x < X1; x++) if (M[y * W + x]) ids.push(y * W + x);
for (let it = 0; it < 800; it++) {
  for (const p of ids) {
    let r = 0, g = 0, b = 0, a = 0, n = 0;
    for (const q of [p - 1, p + 1, p - W, p + W]) { if (!M[q] && !src[q]) continue; r += R[q]; g += G[q]; b += Bl[q]; a += A[q]; n++; }
    if (n) { R[p] = r / n; G[p] = g / n; Bl[p] = b / n; A[p] = a / n; }
  }
}
// Silhouette: the cut's own body outline under the hair is kept (it already continues the shoulders); repainting may
// only round it by 2 px, so coverage never spreads into the air beside the neck.
const near = new Uint8Array(W * H);
for (const p of ids) { const x = p % W, y = (p / W) | 0; outer: for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if (B[((y + dy) * W + x + dx) * 4 + 3] > 128) { near[p] = 1; break outer; } }
const O = Buffer.from(B);
for (const p of ids) {
  const a = near[p] ? A[p] : 0, i = p * 4; // interpolated coverage, clipped to the cut outline
  const cov = near[p] ? Math.max(0, Math.min(1, (a - 0.5) * 10 + 0.5)) : 0;
  if (cov <= 0.02) { O[i + 3] = 0; continue; }
  const aa = Math.max(A[p], 1e-3); O[i] = Math.min(255, R[p] / aa); O[i + 1] = Math.min(255, G[p] / aa); O[i + 2] = Math.min(255, Bl[p] / aa); O[i + 3] = Math.round(cov * 255);
}
// Small enclosed holes in the repainted cloth are filled (they would otherwise get an inked ring).
{
  const seen = new Uint8Array(W * H);
  for (const p0 of ids) {
    if (seen[p0] || O[p0 * 4 + 3] >= 128) continue;
    const comp = [p0]; seen[p0] = 1; let open = false;
    for (let h = 0; h < comp.length && comp.length <= 80; h++) { const p = comp[h];
      for (const q of [p - 1, p + 1, p - W, p + W]) { const qx = q % W, qy = (q / W) | 0;
        if (!inBox(qx, qy)) { open = true; continue; } if (seen[q] || O[q * 4 + 3] >= 128) continue;
        if (!M[q]) open = true; seen[q] = 1; comp.push(q); } }
    if (!open && comp.length <= 80) for (const p of comp) { const i = p * 4, aa = Math.max(A[p], 1e-3); O[i] = Math.min(255, R[p] / aa); O[i + 1] = Math.min(255, G[p] / aa); O[i + 2] = Math.min(255, Bl[p] / aa); O[i + 3] = 255; }
  }
}
// Ink colour: median of visible outline pixels in the box.
const inks = []; for (let y = Y0; y < Y1; y++) for (let x = X0; x < X1; x++) { const p = y * W + x, i = p * 4; if (!M[p] && B[i + 3] > 200 && lum(i) < 70) inks.push([B[i], B[i + 1], B[i + 2]]); }
inks.sort((a, b) => a[0] + a[1] + a[2] - b[0] - b[1] - b[2]); const ink = inks[inks.length >> 1] ?? [45, 38, 38];
const putInk = (p, k = 1) => { const i = p * 4; if (O[i + 3] < 128) return; for (let c = 0; c < 3; c++) O[i + c] = Math.round(O[i + c] * (1 - k) + ink[c] * k); };
// 2. Silhouette edge inside the repainted area.
for (const p of ids) { if (O[p * 4 + 3] < 128) continue; if ([p - 1, p + 1, p - W, p + W].some((q) => O[q * 4 + 3] < 128)) putInk(p, 0.9); }
// 3. Drop islands: small separate bits of body in the box (left-overs of earlier smears beside the hidden area).
let dropped = 0;
{
  const seen = new Uint8Array(W * H);
  for (let y = Y0; y < Y1; y++) for (let x = X0; x < X1; x++) {
    const p0 = y * W + x; if (seen[p0] || O[p0 * 4 + 3] < 64) continue;
    const comp = [p0]; seen[p0] = 1; let touchesEdge = false;
    for (let h = 0; h < comp.length && comp.length <= 400; h++) { const p = comp[h], px = p % W, py = (p / W) | 0;
      if (px <= X0 || px >= X1 - 1 || py <= Y0 || py >= Y1 - 1) touchesEdge = true;
      for (const q of [p - 1, p + 1, p - W, p + W]) { const qx = q % W, qy = (q / W) | 0; if (!inBox(qx, qy) || seen[q] || O[q * 4 + 3] < 64) continue; seen[q] = 1; comp.push(q); } }
    if (comp.length < 400 && !touchesEdge) for (const p of comp) { O[p * 4 + 3] = 0; dropped++; }
  }
}
const extended = 0; // automatic outline continuation dropped: it inked shading streaks; hidden outlines are given (step 5)
// 5. Hidden outlines given by hand (segments between the visible ends of a line the hair crosses).
let drawn = 0;
for (const seg0 of linesS.split(";").filter(Boolean)) {
  // "!x1,y1,x2,y2" is a silhouette edge (a shoulder line): repainted cloth above it, up to 40 px, is air.
  const edge = seg0.startsWith("!"), seg = edge ? seg0.slice(1) : seg0;
  const [ax, ay, bx, by] = seg.split(",").map(Number); const len = Math.hypot(bx - ax, by - ay);
  if (edge) for (let x = Math.min(ax, bx); x <= Math.max(ax, bx); x++) {
    const ly = ay + (by - ay) * (x - ax) / (bx - ax);
    for (let y = Math.floor(ly) - 1; y > ly - 40; y--) { const r = y * W + x; if (inBox(x, y) && M[r]) O[r * 4 + 3] = 0; }
  }
  const nx = -(by - ay) / len, ny = (bx - ax) / len;
  for (let t = 0; t <= len; t += 0.5) for (const o of [-0.5, 0.5]) {
    const x = Math.round(ax + (bx - ax) * t / len + nx * o), y = Math.round(ay + (by - ay) * t / len + ny * o), r = y * W + x;
    if (!inBox(x, y) || !M[r] || O[r * 4 + 3] < 128) continue; putInk(r, 0.9); drawn++;
  }
}
// 6. Dark specks on cloth (hair-strand tips copied from the picture beside the locks, stray dots): any dark bit of
//    12 px or less ringed by light cloth takes the ring's colour, so nothing is left behind when a lock moves.
let specks = 0;
{
  const L = (p) => 0.3 * O[p * 4] + 0.59 * O[p * 4 + 1] + 0.11 * O[p * 4 + 2];
  const seen = new Uint8Array(W * H);
  for (let y = Y0 + 3; y < Y1 - 3; y++) for (let x = X0 + 3; x < X1 - 3; x++) {
    const p0 = y * W + x; if (seen[p0] || O[p0 * 4 + 3] < 128 || L(p0) >= 110) continue;
    const comp = [p0]; seen[p0] = 1;
    for (let h = 0; h < comp.length && comp.length <= 12; h++) { const q = comp[h];
      for (const r of [q - 1, q + 1, q - W, q + W, q - W - 1, q - W + 1, q + W - 1, q + W + 1]) { if (seen[r] || O[r * 4 + 3] < 128 || L(r) >= 110) continue; seen[r] = 1; comp.push(r); } }
    if (comp.length > 12) continue;
    const set = new Set(comp); const ring = [];
    for (const q of comp) for (const r of [q - 2, q + 2, q - 2 * W, q + 2 * W, q - 2 * W - 2, q - 2 * W + 2, q + 2 * W - 2, q + 2 * W + 2]) if (!set.has(r)) ring.push(r);
    const light = ring.filter((r) => O[r * 4 + 3] > 200 && L(r) > 140);
    if (light.length < ring.length * 0.8) continue;
    const avg = [0, 1, 2].map((c) => light.reduce((a, r) => a + O[r * 4 + c], 0) / light.length);
    for (const q of comp) { for (let c = 0; c < 3; c++) O[q * 4 + c] = Math.round(avg[c]); O[q * 4 + 3] = 255; specks++; }
  }
}
await sharp(O, { raw: { width: W, height: H, channels: 4 } }).png().toFile(`${dir}/body.png.tmp`);
(await import("node:fs")).renameSync(`${dir}/body.png.tmp`, `${dir}/body.png`);
console.log(`repainted ${unknown} px under hair, dropped ${dropped} px of islands, ${extended} outline px continued, ${drawn} px of given outlines, ${specks} speck px removed, ink ${ink}`);
