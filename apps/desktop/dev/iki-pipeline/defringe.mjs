// node defringe.mjs <picture.png> <layer.png>... — remove the neighbouring colour from each layer's edge pixels (in place).
// An edge pixel in the picture is c = a*F + (1-a)*B, where F is the layer's own colour a few px inside and B is what the
// PICTURE shows just outside the layer there (backdrop, or the braid behind the collar, or the shirt beside the hair).
// Solve for a, keep F (or the pixel's own colour when it is the drawing's darker outline).
import { createRequire } from "node:module";
import { renameSync } from "node:fs";
const req = createRequire((await import("node:path")).resolve(process.env.IKI_REPO ?? "../iki") + "/packages/mcp/package.json");
const sharp = (await import(req.resolve("sharp"))).default;
const [picF, ...files] = process.argv.slice(2);
const P = await sharp(picF).removeAlpha().raw().toBuffer({ resolveWithObject: true });
const lum = (v) => v[0] * 0.3 + v[1] * 0.59 + v[2] * 0.11;
for (const f of files) {
  const { data, info } = await sharp(f).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const W = info.width, H = info.height, N = W * H, PW = P.info.width, PH = P.info.height;
  const d = new Uint8Array(N).fill(255); const q = [];
  for (let p = 0; p < N; p++) if (data[p * 4 + 3] < 8) { d[p] = 0; q.push(p); }
  for (let k = 0; k < q.length; k++) { const p = q[k]; if (d[p] >= 6) continue; const x = p % W;
    for (const n of [p - 1, p + 1, p - W, p + W]) { if (n < 0 || n >= N || (n === p - 1 && x === 0) || (n === p + 1 && x === W - 1)) continue; if (d[n] > d[p] + 1) { d[n] = d[p] + 1; q.push(n); } } }
  let fixed = 0, cleared = 0;
  const out = Buffer.from(data);
  for (let p = 0; p < N; p++) {
    if (d[p] === 0 || d[p] > 3) continue;
    const x = p % W, y = (p - x) / W;
    let fr = 0, fg = 0, fb = 0, fn = 0, br = 0, bg = 0, bb = 0, bn = 0;
    for (let dy = -5; dy <= 5; dy++) for (let dx = -5; dx <= 5; dx++) {
      const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue; const qn = yy * W + xx;
      if (d[qn] >= 5 && data[qn * 4 + 3] > 200) { fr += data[qn * 4]; fg += data[qn * 4 + 1]; fb += data[qn * 4 + 2]; fn++; }
      else if (d[qn] === 0 && Math.abs(dx) <= 3 && Math.abs(dy) <= 3 && yy < PH && xx < PW) { const j = (yy * PW + xx) * 3; br += P.data[j]; bg += P.data[j + 1]; bb += P.data[j + 2]; bn++; }
    }
    if (!fn || !bn) continue;
    const F = [fr / fn, fg / fn, fb / fn], B = [br / bn, bg / bn, bb / bn], c = [data[p * 4], data[p * 4 + 1], data[p * 4 + 2]];
    const fbv = F.map((v, i) => v - B[i]), cbv = c.map((v, i) => v - B[i]);
    const den = fbv[0] ** 2 + fbv[1] ** 2 + fbv[2] ** 2; if (den < 900) continue;      // layer and neighbour too alike to separate
    // a dark outline pixel belongs to the drawing whatever lies outside: keep it
    if (lum(c) < Math.min(lum(F), lum(B)) - 12) continue;
    const a = Math.max(0, Math.min(1, (cbv[0] * fbv[0] + cbv[1] * fbv[1] + cbv[2] * fbv[2]) / den));
    if (a > 0.96) continue;
    if (a < 0.08) { out[p * 4 + 3] = 0; cleared++; continue; }
    out[p * 4] = Math.round(F[0]); out[p * 4 + 1] = Math.round(F[1]); out[p * 4 + 2] = Math.round(F[2]);
    out[p * 4 + 3] = Math.round(data[p * 4 + 3] * a); fixed++;
  }
  await sharp(out, { raw: info }).png().toFile(f + ".tmp.png"); renameSync(f + ".tmp.png", f);
  console.log(f, "edge px unmixed", fixed, "cleared", cleared);
}
