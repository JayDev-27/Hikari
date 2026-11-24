// node fill-under.mjs <model.iki> <target> <coverRegex> [grow=3] — paint clean paint under covering parts.
// e.g. node fill-under.mjs m.iki face '^(eye|iris|lash|lash_lower)_[LR]$|^glasses$' 6   (the eye sockets)
//      node fill-under.mjs m.iki body '^face$' 0                                  (the neck under the jaw)
//
// Cutting leaves the face layer's eye sockets with whatever the cut filled them with: a pale fill,
// faint outlines of removed glasses, specks, smeared streaks. At rest the eye parts cover it; when
// the eyes close (every blink) or the glasses shift on a head turn, it shows. This finds every face
// pixel that the eye, iris, lash, lower-lash and glasses parts cover at rest (their alpha, mapped through their transforms,
// grown by `grow` px) and refills it with a smooth harmonic fill of the face's own paint around
// it. The rest pose is unchanged (those pixels are covered); closed lids show skin. Rerunnable.
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
const req = createRequire((await import("node:path")).resolve(process.env.IKI_REPO ?? "../iki") + "/packages/mcp/package.json");
const sharp = (await import(req.resolve("sharp"))).default;

const [file, target, coverS, growS = "3"] = process.argv.slice(2);
const grow = +growS, coverRe = new RegExp(coverS);
const model = JSON.parse(readFileSync(file, "utf8"));
const face = model.parts.find((p) => p.id === target);
if (!face) throw new Error(`no part ${target}`);
const decode = async (index) => {
  const src = model.textures[index].source;
  const { data, info } = await sharp(Buffer.from(src.split(",")[1], "base64")).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { d: data, W: info.width, H: info.height };
};
const rect = (part, tex) => ({
  x0: Math.round(part.texture.uv.x * tex.W), y0: Math.round(part.texture.uv.y * tex.H),
  w: Math.round(part.texture.uv.width * tex.W), h: Math.round(part.texture.uv.height * tex.H),
});
const faceTex = await decode(face.texture.index);
const fr = rect(face, faceTex);
const sx = fr.w / face.width, sy = fr.h / face.height; // face texels per model px
const faceLeft = face.transform.x - face.width / 2, faceTop = face.transform.y + face.height / 2;

// Footprint of the eye parts on the face texture.
const mask = new Uint8Array(fr.w * fr.h);
const covers = model.parts.filter((p) => coverRe.test(p.id) && p.id !== target);
for (const part of covers) {
  const tex = part.texture.index === face.texture.index ? faceTex : await decode(part.texture.index);
  const r = rect(part, tex);
  const left = part.transform.x - part.width / 2, top = part.transform.y + part.height / 2;
  for (let v = 0; v < r.h; v++) for (let u = 0; u < r.w; u++) {
    if (tex.d[((r.y0 + v) * tex.W + r.x0 + u) * 4 + 3] < 40) continue;
    const mx = left + (u + 0.5) * part.width / r.w, my = top - (v + 0.5) * part.height / r.h;
    const fx = Math.floor((mx - faceLeft) * sx), fy = Math.floor((faceTop - my) * sy);
    if (fx >= 0 && fy >= 0 && fx < fr.w && fy < fr.h) mask[fy * fr.w + fx] = 1;
  }
}
// Close pinholes, then grow.
for (let k = 0; k < grow + 1; k++) {
  const n = mask.slice();
  for (let y = 1; y < fr.h - 1; y++) for (let x = 1; x < fr.w - 1; x++) {
    const p = y * fr.w + x;
    if (!mask[p] && (mask[p - 1] || mask[p + 1] || mask[p - fr.w] || mask[p + fr.w])) n[p] = 1;
  }
  mask.set(n);
}
const at = (x, y) => ((fr.y0 + y) * faceTex.W + fr.x0 + x) * 4;
// Only refill pixels the face actually paints (keep its silhouette).
let count = 0;
for (let p = 0; p < mask.length; p++) if (mask[p] && faceTex.d[at(p % fr.w, (p / fr.w) | 0) + 3] < 200) mask[p] = 0; else if (mask[p]) count++;
// Harmonic fill: unknowns = mask, boundary = the face's own paint around it.
const val = [0, 1, 2].map((c) => { const a = new Float32Array(fr.w * fr.h); for (let p = 0; p < a.length; p++) a[p] = faceTex.d[at(p % fr.w, (p / fr.w) | 0) + c]; return a; });
// Start from the mean of the ring so it converges fast.
const ring = [];
for (let p = 0; p < mask.length; p++) if (!mask[p] && faceTex.d[at(p % fr.w, (p / fr.w) | 0) + 3] >= 200) {
  const x = p % fr.w, y = (p / fr.w) | 0;
  if ((x > 0 && mask[p - 1]) || (x < fr.w - 1 && mask[p + 1]) || (y > 0 && mask[p - fr.w]) || (y < fr.h - 1 && mask[p + fr.w])) ring.push(p);
}
const mean = [0, 1, 2].map((c) => ring.reduce((a, p) => a + val[c][p], 0) / Math.max(1, ring.length));
for (let p = 0; p < mask.length; p++) if (mask[p]) for (let c = 0; c < 3; c++) val[c][p] = mean[c];
const known = (p) => !mask[p] && faceTex.d[at(p % fr.w, (p / fr.w) | 0) + 3] >= 200;
for (let it = 0; it < 1500; it++) for (let p = 0; p < mask.length; p++) {
  if (!mask[p]) continue;
  const x = p % fr.w, y = (p / fr.w) | 0;
  const nb = [];
  if (x > 0 && (mask[p - 1] || known(p - 1))) nb.push(p - 1);
  if (x < fr.w - 1 && (mask[p + 1] || known(p + 1))) nb.push(p + 1);
  if (y > 0 && (mask[p - fr.w] || known(p - fr.w))) nb.push(p - fr.w);
  if (y < fr.h - 1 && (mask[p + fr.w] || known(p + fr.w))) nb.push(p + fr.w);
  if (!nb.length) continue;
  for (let c = 0; c < 3; c++) val[c][p] = nb.reduce((a, q) => a + val[c][q], 0) / nb.length;
}
for (let p = 0; p < mask.length; p++) if (mask[p]) { const i = at(p % fr.w, (p / fr.w) | 0); for (let c = 0; c < 3; c++) faceTex.d[i + c] = Math.round(val[c][p]); }
model.textures[face.texture.index].source = `data:image/png;base64,${(await sharp(faceTex.d, { raw: { width: faceTex.W, height: faceTex.H, channels: 4 } }).png().toBuffer()).toString("base64")}`;
writeFileSync(file, JSON.stringify(model));
console.log(`${target}: ${count} px under ${covers.map((p) => p.id).join(", ")} refilled with the skin around them`);
