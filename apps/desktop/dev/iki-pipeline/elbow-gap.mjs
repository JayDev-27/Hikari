// node elbow-gap.mjs <model.iki> <side L|R> <x,y,w,h> <yMin,yMax> <rest.png> <folded.png…>
// Close the see-through sliver inside a folded elbow.
//
// A cut illustration draws the upper arm and the torso as separate pieces with a sliver of backdrop between
// them. With the arm hanging, that sliver reads as the natural gap under the arm. When the forearm folds up
// across the chest (a clap, a hand to the chin) it closes the sliver from below, and what's left shows as a
// white wedge between torso, upper arm and forearm: the elbow looks broken off the body.
// rest.png and folded.png… are render_poses crops (same crop box, in canvas px) at rest and at the elbow folds
// the character uses. Every backdrop pixel that, in some folded pose, lies between the torso and an arm piece
// on the same row (a short run, on `side`'s half of the body, between canvas y `yMin` and `yMax`) is painted with the
// torso's own edge colour a little in shadow: the jacket seen behind the arm. The patch sits on the body,
// behind the arm pieces, and opens with the elbow (collapsed below 45°, full from 75°), so the rest pose and
// the hanging-arm gestures keep the picture exactly; on a rig with a fold-clap forearm-perspective parameter
// (`…ClapDepth`) it also stays hidden while the forearms point at the viewer. Rerunnable: replaces its own part.
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
const req = createRequire((await import("node:path")).resolve(process.env.IKI_REPO ?? "../iki") + "/packages/mcp/package.json");
const sharp = (await import(req.resolve("sharp"))).default;

const [modelFile, side, boxS, ySpan, restF, ...foldedF] = process.argv.slice(2);
const [CX, CY, CW] = boxS.split(",").map(Number);
const load = async (f) => { const { data, info } = await sharp(f).ensureAlpha().raw().toBuffer({ resolveWithObject: true }); return { d: data, w: info.width, h: info.height }; };
const rest = await load(restF), folded = await Promise.all(foldedF.map(load));
const { w: W, h: H } = rest; const s = W / CW; // render px per canvas px
const model = JSON.parse(readFileSync(modelFile, "utf8"));
const [yMinC, yMaxC] = ySpan.split(",").map(Number);
const mid = (model.canvas.width / 2 - CX) * s, yMin = Math.max(0, (yMinC - CY) * s), yMax = (yMaxC - CY) * s, maxRun = Math.round(75 * s);
const onSide = (x) => (side === "L" ? x > mid : x < mid);
const opaque = (img, p) => img.d[p * 4 + 3] > 128, clear = (img, p) => img.d[p * 4 + 3] < 40;

// Backdrop runs bounded by artwork on both sides of the row, short enough to be the sliver.
const M = new Uint8Array(W * H);
for (const img of folded) for (let y = Math.round(yMin); y < Math.min(H, yMax); y++) {
  let x = 0;
  while (x < W) {
    if (!clear(img, y * W + x)) { x++; continue; }
    let e = x; while (e < W && !opaque(img, y * W + e)) e++;
    if (x > 0 && e < W && e - x <= maxRun && onSide(x) && onSide(e)) for (let k = x; k < e; k++) M[y * W + k] = 1;
    x = e + 1;
  }
}
for (let y = 0; y < H; y++) { let a = -1, b = -1; for (let x = 0; x < W; x++) if (M[y * W + x]) { if (a < 0) a = x; b = x; }
  if (a >= 0 && b - a <= maxRun) for (let x = a; x <= b; x++) M[y * W + x] = 1; }
for (let k = 0; k < Math.round(2 * s); k++) { const N = M.slice(); for (let p = W; p < W * H - W; p++) if (!M[p] && clear(rest, p) && (M[p - 1] || M[p + 1] || M[p - W] || M[p + W])) N[p] = 1; M.set(N); }
let n = 0, x0 = W, y0 = H, x1 = -1, y1 = -1;
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (M[y * W + x]) { n++; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
const id = `elbow_gap_${side}`;
model.parts = model.parts.filter((p) => p.id !== id);
if (!n) { writeFileSync(modelFile, JSON.stringify(model)); console.log(`${id}: no gap`); process.exit(0); }

// The torso's colour beside the gap, row by row: step from the gap toward the body (inward), past its outline.
const inward = side === "L" ? -1 : 1;
const rowColor = [];
for (let y = y0; y <= y1; y++) {
  let gx = -1; for (let x = x0; x <= x1; x++) if (M[y * W + x]) { gx = side === "L" ? x : (gx < 0 || x > gx ? x : gx); if (side === "L") break; }
  let c = null;
  if (gx >= 0) {
    let x = gx; while (x >= 0 && x < W && !opaque(rest, y * W + x)) x += inward;
    x += inward * Math.round(4 * s); const acc = [0, 0, 0]; let k = 0;
    for (let j = 0; j < Math.round(8 * s); j++, x += inward) if (x >= 0 && x < W && opaque(rest, y * W + x)) { const i = (y * W + x) * 4; acc[0] += rest.d[i]; acc[1] += rest.d[i + 1]; acc[2] += rest.d[i + 2]; k++; }
    if (k) c = acc.map((v) => v / k);
  }
  rowColor.push(c);
}
for (let i = 0; i < rowColor.length; i++) rowColor[i] ??= rowColor[i - 1] ?? rowColor.find(Boolean);
const smooth = rowColor.map((_, i) => { const acc = [0, 0, 0]; let k = 0; for (let j = Math.max(0, i - 10); j <= Math.min(rowColor.length - 1, i + 10); j++) { for (let c = 0; c < 3; c++) acc[c] += rowColor[j][c]; k++; } return acc.map((v) => v / k); });

const pw = x1 - x0 + 1, ph = y1 - y0 + 1, out = Buffer.alloc(pw * ph * 4);
for (let y = 0; y < ph; y++) for (let x = 0; x < pw; x++) {
  if (!M[(y + y0) * W + x + x0]) continue;
  const o = (y * pw + x) * 4;
  for (let c = 0; c < 3; c++) out[o + c] = Math.round(smooth[y][c] * 0.9); // a touch of the arm's shadow
  out[o + 3] = 255;
}
const png = await sharp(out, { raw: { width: pw, height: ph, channels: 4 } }).png().toBuffer();
const cw = pw / s, ch = ph / s, cxm = CX + (x0 + x1 + 1) / 2 / s, cym = CY + (y0 + y1 + 1) / 2 / s;
const depthParam = model.parameters.find((p) => /ClapDepth$/.test(p.id))?.id;
const index = model.textures.length; model.textures.push({ source: `data:image/png;base64,${png.toString("base64")}` });
const order = Math.min(...["elbow", "forearm", "arm"].map((k) => model.parts.find((p) => p.id === `${k}_${side}`)?.order ?? 99)) - 0.6;
const v = [-0.5, 0.5, 0.5, 0.5, -0.5, -0.5, 0.5, -0.5];
model.parts.push({
  id, width: cw, height: ch, transform: { x: cxm - model.canvas.width / 2, y: model.canvas.height / 2 - cym }, deformer: "bodyWarp", order,
  color: [1, 1, 1, 1], texture: { index, uv: { x: 0, y: 0, width: 1, height: 1 } },
  mesh: { vertices: v, uvs: [0, 0, 1, 0, 0, 1, 1, 1], indices: [0, 2, 1, 1, 2, 3] },
  warps: [{ parameter: `ParamElbow${side}`, keyforms: [{ value: 45, offsets: v.map((c) => -c) }, { value: 75, offsets: v.map(() => 0) }] }],
  // While a fold-clap rises the upper arm swings out past the patch and the forearm points at the viewer
  // (ParamChengClapDepth 1): hide it then; it is fully there from depth 0.3 (hands open at the top) down.
  ...(depthParam ? { bindings: [{ parameter: depthParam, channel: "opacity", from: 1 / 0.7, to: 0 }] } : {}),
});
writeFileSync(modelFile, JSON.stringify(model));
console.log(`${id}: ${cw.toFixed(1)}×${ch.toFixed(1)} canvas px at (${cxm.toFixed(1)}, ${cym.toFixed(1)}), ${n} render px, order ${order}`);
