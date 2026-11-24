// node armpit-patch.mjs <model.iki> <rest.png> <lifted.png> <x,y,w,h> <yArm> <yTorso> [side=R] [r,g,b]
// Paint the armpit that a lifted upper arm uncovers.
//
// A cut illustration has no torso under the arm. When the upper arm swings out, the background
// between arm and torso climbs up to the shoulder and the arm looks split off the body. rest.png
// and lifted.png are render_poses crops (same crop box, given in canvas px) at rest and at the
// largest lift the character uses. Pixels that the arm covers at rest but are backdrop when lifted
// are filled with the arm's own inner skin tone, getting darker toward the crease. The fill ends in a
// crease line running from the inner arm (canvas y yArm) down to the torso side (canvas y yTorso),
// like the skin fold of a raised arm; below it the open gap between arm and body is natural.
// The result is a part drawn behind the arm and in front of the body. It has no size at rest (the rest
// pose stays exactly the picture), and it fades out with the arm parts when the flower offer replaces them.
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
const req = createRequire((await import("node:path")).resolve(process.env.IKI_REPO ?? "../iki") + "/packages/mcp/package.json");
const sharp = (await import(req.resolve("sharp"))).default;

const [modelFile, restFile, liftFile, boxS, yArmS, yTorsoS, side = "R", clothColor] = process.argv.slice(2);
const [CX, CY, CW] = boxS.split(",").map(Number); const yArm = +yArmS, yTorso = +yTorsoS;
const load = async (f) => { const { data, info } = await sharp(f).ensureAlpha().raw().toBuffer({ resolveWithObject: true }); return { d: data, w: info.width, h: info.height }; };
const rest = await load(restFile), lift = await load(liftFile);
const { w: W, h: H } = lift; const s = W / CW; // render px per canvas px

// Backdrop colour: the most common colour of the lifted render.
const count = new Map(); for (let p = 0; p < W * H; p++) { const k = (lift.d[p * 4] << 16) | (lift.d[p * 4 + 1] << 8) | lift.d[p * 4 + 2]; count.set(k, (count.get(k) ?? 0) + 1); }
const bgK = [...count].sort((a, b) => b[1] - a[1])[0][0]; const bg = [bgK >> 16, (bgK >> 8) & 255, bgK & 255];
const isBg = (img, p) => Math.abs(img.d[p * 4] - bg[0]) + Math.abs(img.d[p * 4 + 1] - bg[1]) + Math.abs(img.d[p * 4 + 2] - bg[2]) < 14;

let M = new Uint8Array(W * H);
for (let p = 0; p < W * H; p++) if (isBg(lift, p) && !isBg(rest, p)) M[p] = 1;
// Keep the largest connected piece (the armpit), drop slivers along moving outlines.
{ const seen = new Int32Array(W * H).fill(-1); let best = -1, bestN = 0, id = 0;
  for (let p0 = 0; p0 < W * H; p0++) { if (!M[p0] || seen[p0] >= 0) continue; const q = [p0]; seen[p0] = id;
    for (let h = 0; h < q.length; h++) { const p = q[h]; for (const n of [p - 1, p + 1, p - W, p + W]) if (n >= 0 && n < W * H && M[n] && seen[n] < 0) { seen[n] = id; q.push(n); } }
    if (q.length > bestN) { bestN = q.length; best = id; } id++; }
  for (let p = 0; p < W * H; p++) M[p] = seen[p] === best ? 1 : 0;
  if (!bestN) { console.log("nothing uncovered: no patch"); process.exit(0); } }
// Grow 2 px so the edges meet the arm and shirt outlines without a seam, but only where the arm
// covers the pixel at rest: the rest pose must not change at all.
for (let k = 0; k < 2; k++) { const N = M.slice(); for (let p = W; p < W * H - W; p++) if (!M[p] && !isBg(rest, p) && (M[p - 1] || M[p + 1] || M[p - W] || M[p + W])) N[p] = 1; M = N; }

let x0 = W, y0 = H, x1 = 0, y1 = 0;
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (M[y * W + x]) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
// The crease: a line from the arm side (outer x of the patch) at yArm to the torso side at yTorso.
const armX = side === "R" ? x0 : x1, torsoX = side === "R" ? x1 : x0;
const creaseY = (x) => ((yArm + (yTorso - yArm) * (x - armX) / (torsoX - armX || 1)) - CY) * s;
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (y > creaseY(x)) M[y * W + x] = 0;
x0 = W; y0 = H; x1 = 0; y1 = 0;
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (M[y * W + x]) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
// Skin tone: median of the lifted arm's skin right beside the patch (light, warm, not shirt-white).
const skin = [];
for (let y = y0; y <= y1; y++) for (let x = Math.max(0, x0 - 40); x <= x1; x++) { const i = (y * W + x) * 4, p = y * W + x;
  if (M[p] || isBg(lift, p)) continue; const [r, g, b] = [lift.d[i], lift.d[i + 1], lift.d[i + 2]]; if (r - b > 25 && r > 150) skin.push([r, g, b]); }
const med = (k) => skin.map((c) => c[k]).sort((a, b) => a - b)[skin.length >> 1] ?? [236, 196, 180][k];
const base = clothColor ? clothColor.split(",").map(Number) : [med(0), med(1), med(2)];
const pw = x1 - x0 + 1, ph = y1 - y0 + 1, out = Buffer.alloc(pw * ph * 4);
const line = 1.6 * s; // outline width of the art, ~1.6 canvas px
for (let y = 0; y < ph; y++) for (let x = 0; x < pw; x++) { const p = (y + y0) * W + x + x0; if (!M[p]) continue;
  const toCrease = creaseY(x + x0) - (y + y0); // render px above the crease line
  const shade = 1 - 0.16 * Math.max(0, 1 - toCrease / (12 * s)); // shadow gathers at the fold
  const ink = Math.max(0, Math.min(1, (line - toCrease) / 1.2)); // antialiased crease line
  const o = (y * pw + x) * 4;
  for (let c = 0; c < 3; c++) out[o + c] = Math.round(base[c] * shade * (1 - ink) + base[c] * 0.5 * ink);
  out[o + 3] = 255; }
const png = await sharp(out, { raw: { width: pw, height: ph, channels: 4 } }).png().toBuffer();

const model = JSON.parse(readFileSync(modelFile, "utf8"));
const id = `armpit_${side}`;
model.parts = model.parts.filter((p) => p.id !== id); // rerunnable
const cw = pw / s, ch = ph / s, cxm = CX + (x0 + x1 + 1) / 2 / s, cym = CY + (y0 + y1 + 1) / 2 / s;
const index = model.textures.length; model.textures.push({ source: `data:image/png;base64,${png.toString("base64")}` });
const elbowOrder = model.parts.find((p) => p.id === `elbow_${side}`)?.order ?? 5;
const upperArmOrder = model.parts.find((p) => p.id === `arm_${side}`)?.order ?? elbowOrder;
const order = Math.min(elbowOrder, upperArmOrder) - 0.5;
model.parts.push({
  id, width: cw, height: ch, transform: { x: cxm - model.canvas.width / 2, y: model.canvas.height / 2 - cym }, deformer: "bodyWarp", order,
  color: [1, 1, 1, 1], texture: { index, uv: { x: 0, y: 0, width: 1, height: 1 } },
  mesh: { vertices: [-0.5, 0.5, 0.5, 0.5, -0.5, -0.5, 0.5, -0.5], uvs: [0, 0, 1, 0, 0, 1, 1, 1], indices: [0, 2, 1, 1, 2, 3] },
  // At rest (lift ≤ 1°) the patch collapses to a point at its top arm-side corner and draws nothing, so the
  // rest pose is exactly the picture; it grows to full size by 5° (keyforms clamp at both ends).
  warps: [{ parameter: `ParamArm${side}`, keyforms: [
    { value: 1, offsets: (() => { const ax = side === "R" ? -0.5 : 0.5, v = [-0.5, 0.5, 0.5, 0.5, -0.5, -0.5, 0.5, -0.5], o = [];
      for (let i = 0; i < v.length; i += 2) o.push(ax - v[i], 0.5 - v[i + 1]); return o; })() },
    { value: 5, offsets: [0, 0, 0, 0, 0, 0, 0, 0] },
  ] }],
  ...(model.parameters.some((p) => p.id === "ParamOfferFlower") && side === "R" ? { bindings: [{ parameter: "ParamOfferFlower", channel: "opacity", from: 1, to: 0 }] } : {}),
});
writeFileSync(modelFile, JSON.stringify(model));
console.log(`${id}: ${cw.toFixed(1)}×${ch.toFixed(1)} canvas px at (${cxm.toFixed(1)}, ${cym.toFixed(1)}), color ${base}, ${[...M].filter(Boolean).length} render px, order ${order}`);
