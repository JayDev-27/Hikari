// node despeck-edges.mjs <model.iki> [--dry] — take the light backdrop out of dark paint's edges.
//
// Cutting against a light backdrop leaves its colour in three places around a dark garment (trousers,
// a jacket, dark hair), each a light dot or line on the outline over a dark desktop — what is left of
// a "white border":
//   1. bleed: the transparent texels around a part keep the backdrop's colour at alpha 0, and texture
//      filtering mixes it into the outline. Every transparent texel beside paint takes its painted
//      neighbours' mean colour (it stays transparent; this is the usual edge padding).
//   2. unmix: an antialiased edge texel (alpha under 255) of dark paint carries colour pre-mixed with
//      the backdrop, sometimes a texel or two outside the outline. One with dark (luma < 80) opaque
//      paint within 3 texels (6 for a faint one, alpha under 100: a wisp of backdrop off the outline) and no light opaque paint there (skin, a cuff: their own edge), at least
//      40 levels lighter than that paint, takes its median colour, its alpha kept.
//   3. specks: a small group of light texels (luma ≥ 110, up to 12 texels: a strip of border a texel
//      or two wide) touching transparency, with dark (luma < 80) opaque paint around it, takes that
//      paint's median colour.
//   4. strips: a light strip one to three texels wide along a garment's dark edge (a long thin line
//      of border, too long for 3, next to transparency or the outline's soft fringe) takes the dark
//      paint's colour; hair is left out (a thin light
//      strand looks the same).
// Real light paint (an eye white, teeth, a cuff, skin) is an area or sits beside light paint, so 2-4
// never touch it, and
// the face's features (eyes, lashes, brows, mouth, nose) are left out of 2-4 outright: their fine
// lines are drawn on light paint by design. Alpha never changes, so no silhouette does.
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
const req = createRequire((await import("node:path")).resolve(process.env.IKI_REPO ?? "../iki") + "/packages/mcp/package.json");
const sharp = (await import(req.resolve("sharp"))).default;

const [file, flag] = process.argv.slice(2);
const model = JSON.parse(readFileSync(file, "utf8"));
const luma = (d, i) => 0.3 * d[i] + 0.59 * d[i + 1] + 0.11 * d[i + 2];
const FEATURE = /eye|iris|lash|brow|mouth|lip|teeth|tongue|nose|blush|smile/;
let total = 0;
for (const [t, tex] of model.textures.entries()) {
  const m = /^data:image\/png;base64,(.*)$/.exec(tex.source);
  if (!m) continue;
  const { data: d, info } = await sharp(Buffer.from(m[1], "base64")).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const W = info.width, H = info.height, out = Buffer.from(d);
  // Only the atlas areas of the parts allowed (not the face's features).
  const allow = new Uint8Array(W * H);
  for (const part of model.parts) {
    if (part.texture?.index !== t || FEATURE.test(part.id)) continue;
    const { x, y, width, height } = part.texture.uv;
    const x0 = Math.floor(x * W), y0 = Math.floor(y * H), x1 = Math.ceil((x + width) * W), y1 = Math.ceil((y + height) * H);
    for (let yy = Math.max(0, y0); yy < Math.min(H, y1); yy++) allow.fill(1, yy * W + Math.max(0, x0), yy * W + Math.min(W, x1));
  }
  for (const part of model.parts) { // a feature's area always wins over an overlapping allowed one
    if (part.texture?.index !== t || !FEATURE.test(part.id)) continue;
    const { x, y, width, height } = part.texture.uv;
    const x0 = Math.floor(x * W) - 2, y0 = Math.floor(y * H) - 2, x1 = Math.ceil((x + width) * W) + 2, y1 = Math.ceil((y + height) * H) + 2;
    for (let yy = Math.max(0, y0); yy < Math.min(H, y1); yy++) allow.fill(0, yy * W + Math.max(0, x0), yy * W + Math.min(W, x1));
  }
  let bled = 0, unmixed = 0, specks = 0;
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const p = y * W + x, i = p * 4;
    const ring = [p - W - 1, p - W, p - W + 1, p - 1, p + 1, p + W - 1, p + W, p + W + 1];
    if (d[i + 3] === 0) { // 1. bleed
      const painted = ring.filter((q) => d[q * 4 + 3] >= 128);
      if (!painted.length) continue;
      for (let c = 0; c < 3; c++) out[i + c] = Math.round(painted.reduce((a, q) => a + d[q * 4 + c], 0) / painted.length);
      bled++;
      continue;
    }
    if (!allow[p]) continue;
    if (d[i + 3] < 255) { // 2. unmix, against the opaque paint within 3 texels (6 for a faint wisp)
      const dark = [];
      let light = false;
      const R = d[i + 3] < 100 ? 6 : 3;
      for (let dy = -R; dy <= R && !light; dy++) for (let dx = -R; dx <= R; dx++) {
        const yy = y + dy, xx = x + dx;
        if (yy < 0 || yy >= H || xx < 0 || xx >= W) continue;
        const k = (yy * W + xx) * 4;
        if (d[k + 3] < 200) continue;
        const L = luma(d, k);
        if (L >= 120) { light = true; break; } // light paint beside it (skin, a cuff): its own edge
        if (L < 80) dark.push(k);
      }
      if (light || dark.length < 3) continue;
      dark.sort((a, b) => luma(d, a) - luma(d, b));
      const m = dark[dark.length >> 1];
      if (luma(d, i) < luma(d, m) + 40) continue;
      for (let c = 0; c < 3; c++) out[i + c] = d[m + c];
      unmixed++;
      continue;
    }
  }
  // 3. specks: small groups of light texels (up to SPECK texels) touching transparency, inside dark paint.
  const SPECK = 12, seen = new Uint8Array(W * H);
  const lightish = (p) => d[p * 4 + 3] >= 20 && luma(d, p * 4) >= 110;
  for (let p0 = W + 1; p0 < W * H - W - 1; p0++) {
    if (seen[p0] || !allow[p0] || !lightish(p0)) continue;
    const comp = [p0]; seen[p0] = 1;
    for (let h = 0; h < comp.length && comp.length <= SPECK; h++) {
      const q = comp[h];
      for (const r of [q - 1, q + 1, q - W, q + W, q - W - 1, q - W + 1, q + W - 1, q + W + 1])
        if (!seen[r] && allow[r] && lightish(r)) { seen[r] = 1; comp.push(r); }
    }
    if (comp.length > SPECK) continue; // an area of light paint
    const set = new Set(comp);
    const touches = comp.some((q) => [q - 1, q + 1, q - W, q + W].some((r) => d[r * 4 + 3] < 20));
    if (!touches) continue;
    const ringK = [];
    for (const q of comp) for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const r = q + dy * W + dx;
      if (r < 0 || r >= W * H || set.has(r) || d[r * 4 + 3] < 200) continue;
      ringK.push(r * 4);
    }
    if (ringK.length < 3) continue;
    ringK.sort((a, b) => luma(d, a) - luma(d, b));
    const m = ringK[ringK.length >> 1];
    if (luma(d, m) >= 80) continue; // not inside dark paint
    for (const q of comp) for (let c = 0; c < 3; c++) out[q * 4 + c] = d[m + c];
    specks += comp.length;
  }
  // 4. strips: a light strip one to three texels wide along the edge of dark paint (garments only:
  //    a thin light hair strand looks the same). From a light texel with transparency beside it,
  //    walk away from the transparency; dark opaque paint within 3 texels makes the walked texels
  //    border, and they take that paint's colour.
  let strips = 0;
  const garment = new Uint8Array(W * H);
  for (const part of model.parts) {
    if (part.texture?.index !== t || FEATURE.test(part.id) || /hair/.test(part.id)) continue;
    const { x, y, width, height } = part.texture.uv;
    const x0 = Math.floor(x * W), y0 = Math.floor(y * H), x1 = Math.ceil((x + width) * W), y1 = Math.ceil((y + height) * H);
    for (let yy = Math.max(0, y0); yy < Math.min(H, y1); yy++) garment.fill(1, yy * W + Math.max(0, x0), yy * W + Math.min(W, x1));
  }
  for (const part of model.parts) { // hair and features over a garment's area win
    if (part.texture?.index !== t || !(FEATURE.test(part.id) || /hair/.test(part.id))) continue;
    const { x, y, width, height } = part.texture.uv;
    const x0 = Math.floor(x * W) - 2, y0 = Math.floor(y * H) - 2, x1 = Math.ceil((x + width) * W) + 2, y1 = Math.ceil((y + height) * H) + 2;
    for (let yy = Math.max(0, y0); yy < Math.min(H, y1); yy++) garment.fill(0, yy * W + Math.max(0, x0), yy * W + Math.min(W, x1));
  }
  const cur = (p) => luma(out, p * 4);
  for (let y = 4; y < H - 4; y++) for (let x = 4; x < W - 4; x++) {
    const p = y * W + x;
    if (!garment[p] || out[p * 4 + 3] < 20 || cur(p) < 85) continue;
    for (const step of [1, -1, W, -W]) {
      if (out[(p - step) * 4 + 3] >= 200) continue; // the edge (transparent or its soft fringe) on the other side
      const walked = [p];
      let q = p + step, dark = -1;
      for (let k = 0; k < 3; k++, q += step) {
        if (out[q * 4 + 3] >= 200 && cur(q) < 60) { dark = q; break; }
        if (out[q * 4 + 3] < 20) break;
        walked.push(q);
      }
      if (dark < 0) continue;
      for (const w of walked) for (let c = 0; c < 3; c++) out[w * 4 + c] = out[dark * 4 + c];
      strips += walked.length;
      break;
    }
  }
  const fixed = unmixed + specks + strips;
  total += fixed;
  console.log(`texture ${t} (${W}×${H}): ${bled} transparent texels bled, ${unmixed} edge texels unmixed, ${specks} speck texels, ${strips} border-strip texels`);
  if (flag !== "--dry" && (fixed || bled)) tex.source = `data:image/png;base64,${(await sharp(out, { raw: { width: W, height: H, channels: 4 } }).png().toBuffer()).toString("base64")}`;
}
if (flag !== "--dry") writeFileSync(file, JSON.stringify(model));
console.log(`${total} light edge texels recoloured${flag === "--dry" ? " (dry run)" : ""}`);
