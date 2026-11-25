// node palm-swap.mjs <model.iki> [param=ParamChengPalm] [wristDeg=30] [hand.png] — palm-side hands for a clap on an elbow-fold rig.
//
// The hands are painted hanging at the sides, palm toward the thigh. Folding the forearm ~150° in the picture
// plane to bring the hands up to the chest also turns them over, so the palms face OUT and the backs of the hands
// meet: a clap needs the forearm to supinate, which a 2D rotation cannot do. This adds, per arm, a twin of the
// forearm part whose hand (everything below the cuff) is mirrored about the wrist, so once the forearm is up the
// palm faces the other hand. The twin rides the same deformer, mesh and warps (the clap foreshortening) and fades
// in on `param` 0→1 while the original forearm fades out (an exclusive pair, as Iki's own pose forearms are).
// The twin's hand is also bent back at the wrist by `wristDeg` (fingertips toward the crop's middle, which is
// outward once the forearm is folded up), so the hands stand upright and the palms press flat, as in a real clap.
// A gesture swaps them while the hands are moving up fast, where the change can't be seen.
// `hand.png` (optional) replaces the painted hanging hand with another drawing of it, e.g. a flat, open hand with
// the fingers together (characters/cheng-xiaoshi/source/clap-hand.png, painted with Codex from his own hand so the
// palms seal flat). It is the LEFT arm's hand in that forearm's crop pixels (transparent elsewhere); the right arm
// uses its mirror image, lined up on its own wrist. The twin's texture is padded on both sides so the bent hand
// never runs off the crop.
// Rerunnable: earlier twins / the parameter are replaced.
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
const req = createRequire((await import("node:path")).resolve(process.env.IKI_REPO ?? "../iki") + "/packages/mcp/package.json");
const sharp = (await import(req.resolve("sharp"))).default;

// Flags: --sides=L,R (default both) · --start=<crop row where the hand begins> (default: below the cuff's stripe).
const flags = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith("--")).map((a) => a.slice(2).split("=")));
const [file, param = "ParamChengPalm", wristS = "30", handPng] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const SIDES = (flags.sides ?? "L,R").split(",");
// Padding only matters when the hand is bent off the arm's line; it needs the forearm to be a plain quad to widen.
const PAD = +wristS ? 120 : 0;
const wrist = (+wristS * Math.PI) / 180;
const model = JSON.parse(readFileSync(file, "utf8"));
model.parameters = model.parameters.filter((p) => p.id !== param);
model.parameters.push({ id: param, name: "Clap palms (forearm supinated)", min: 0, max: 1, default: 0 });
model.parts = model.parts.filter((p) => !p.id.endsWith("_palm"));
for (const p of model.parts) if (p.bindings) p.bindings = p.bindings.filter((b) => b.parameter !== param);

const atlasCache = new Map();
const atlas = async (index) => {
  if (!atlasCache.has(index)) {
    const buf = Buffer.from(model.textures[index].source.split(",")[1], "base64");
    atlasCache.set(index, { buf, meta: await sharp(buf).metadata() });
  }
  return atlasCache.get(index);
};

for (const side of SIDES) {
  const fore = model.parts.find((p) => p.id === `forearm_${side}`);
  const { buf, meta } = await atlas(fore.texture.index);
  const uv = fore.texture.uv;
  const rect = { left: Math.round(uv.x * meta.width), top: Math.round(uv.y * meta.height), width: Math.round(uv.width * meta.width), height: Math.round(uv.height * meta.height) };
  const { data, info } = await sharp(buf).extract(rect).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const W = info.width, H = info.height, at = (x, y) => (y * W + x) * 4;

  // The cuff's last row: the lowest row with its blue stripe. The hand is everything below it.
  const blue = (i) => data[i + 3] > 128 && data[i + 2] > data[i] + 25 && data[i + 2] > 90;
  let cuff = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (blue(at(x, y))) { cuff = y; break; }
  const start = flags.start ? +flags.start : cuff + 6; // below the cuff's cream edge band
  // The wrist's centre, from the opaque run just under the cuff: the hand flips about it.
  let lo = W, hi = -1;
  for (let y = start; y < start + 12; y++) for (let x = 0; x < W; x++) if (data[at(x, y) + 3] > 128) { lo = Math.min(lo, x); hi = Math.max(hi, x); }
  const axis = (lo + hi) / 2;

  // The hand to flip: the painted one, or the replacement drawing (the right arm's is the left's mirror image).
  let hand = data;
  if (handPng) {
    const h = await sharp(handPng).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const flip = side === "R";
    // Line the drawing's wrist up with this crop's wrist (the drawing's wrist axis, measured the same way).
    let hlo = h.info.width, hhi = -1;
    for (let y = start; y < start + 12; y++) for (let x = 0; x < h.info.width; x++) if (h.data[(y * h.info.width + x) * 4 + 3] > 128) { hlo = Math.min(hlo, x); hhi = Math.max(hhi, x); }
    const haxis = flip ? h.info.width - 1 - (hlo + hhi) / 2 : (hlo + hhi) / 2;
    hand = Buffer.from(data);
    for (let y = start; y < H; y++) for (let x = 0; x < W; x++) {
      let sx = Math.round(x - axis + haxis);
      if (flip) sx = h.info.width - 1 - sx;
      const o = at(x, y), ok = sx >= 0 && sx < h.info.width && y < h.info.height;
      for (let c = 0; c < 4; c++) hand[o + c] = ok ? h.data[(y * h.info.width + sx) * 4 + c] : 0;
    }
  }

  // Mirror the hand about the wrist axis (palm to the other side), then bend it at the wrist: each output pixel
  // below the cuff samples the mirrored hand rotated about the wrist point (bilinear).
  const dir = axis > W / 2 ? 1 : -1; // fingertips swing toward the crop's middle
  const cos = Math.cos(wrist), sin = Math.sin(dir * wrist);
  // Bilinear sample of the mirrored hand (rows below the cuff only), colour weighted by alpha so the
  // transparent surround doesn't darken the outline.
  const sample = (fx, fy) => {
    const x0 = Math.floor(fx), y0 = Math.floor(fy), ax = fx - x0, ay = fy - y0;
    let r = 0, g = 0, b = 0, a = 0;
    for (const [dx, dy, w] of [[0, 0, (1 - ax) * (1 - ay)], [1, 0, ax * (1 - ay)], [0, 1, (1 - ax) * ay], [1, 1, ax * ay]]) {
      const x = x0 + dx, y = y0 + dy;
      if (w === 0 || y < start || y >= H) continue;
      const mx = Math.round(2 * axis - x); // the mirrored hand
      if (mx < 0 || mx >= W) continue;
      const i = at(mx, y), wa = w * hand[i + 3];
      r += wa * hand[i]; g += wa * hand[i + 1]; b += wa * hand[i + 2]; a += wa;
    }
    return a > 0 ? [r / a, g / a, b / a, a] : [0, 0, 0, 0];
  };
  // The twin's picture: the crop padded by PAD on each side; the sleeve and cuff as painted, the hand flipped/bent.
  const OW = W + 2 * PAD, oat = (x, y) => (y * OW + x) * 4;
  const out = Buffer.alloc(OW * H * 4);
  for (let y = 0; y < start; y++) data.copy(out, oat(PAD, y), at(0, y), at(0, y) + W * 4);
  for (let y = start; y < H; y++) {
    for (let ox = 0; ox < OW; ox++) {
      // Inverse-rotate about the wrist (axis, start) to find where this pixel comes from in the mirrored hand.
      const rx = ox - PAD - axis, ry = y - start;
      const [r, g, b, a] = sample(axis + cos * rx + sin * ry, start - sin * rx + cos * ry);
      const i = oat(ox, y);
      out[i] = Math.round(r); out[i + 1] = Math.round(g); out[i + 2] = Math.round(b); out[i + 3] = Math.round(a);
    }
  }
  const png = await sharp(out, { raw: { width: OW, height: H, channels: 4 } }).png().toBuffer();
  const index = model.textures.length;
  model.textures.push({ source: `data:image/png;base64,${png.toString("base64")}` });

  const twin = structuredClone(fore);
  twin.id = `${fore.id}_palm`;
  twin.order = fore.order + 0.01;
  twin.texture = { index, uv: { x: 0, y: 0, width: 1, height: 1 } };
  // Widen the part by the padding: same centre, vertices and u's rescaled to the wider picture.
  const k = W / OW;
  if (PAD && fore.mesh.vertices.length !== 8) throw new Error(`${fore.id}: bending the hand needs a quad forearm mesh`);
  twin.width = fore.width / k;
  twin.mesh.vertices = fore.mesh.vertices.map((v, i) => (i % 2 === 0 && PAD ? (v < 0 ? -0.5 : v > 0 ? 0.5 : v) : v));
  twin.mesh.uvs = fore.mesh.uvs.map((u, i) => Math.min(1, Math.max(0, i % 2 === 0
    ? (PAD && u <= uv.x + 1e-6 ? 0 : PAD && u >= uv.x + uv.width - 1e-6 ? 1 : (PAD + (u - uv.x) / uv.width * W) / OW)
    : (u - uv.y) / uv.height)));
  for (const w of twin.warps ?? []) for (const kf of w.keyforms) kf.offsets = kf.offsets.map((o, i) => (i % 2 === 0 ? o * k : o));
  twin.bindings = [...(fore.bindings ?? []).filter((b) => b.parameter !== param), { parameter: param, channel: "opacity", from: 0, to: 1 }];
  fore.bindings = [...(fore.bindings ?? []).filter((b) => b.parameter !== param), { parameter: param, channel: "opacity", from: 1, to: 0 }];
  model.parts.push(twin);
  console.log(`${twin.id}: hand below crop row ${start} flipped about x=${axis.toFixed(1)}, wrist bent ${wristS}°${handPng ? `, hand from ${handPng}` : ""}, shown by ${param}`);
}
writeFileSync(file, JSON.stringify(model));
