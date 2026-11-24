// node palm-swap.mjs <model.iki> [param=ParamChengPalm] [wristDeg=30] — palm-side hands for a clap on an elbow-fold rig.
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
// Rerunnable: earlier twins / the parameter are replaced.
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
const req = createRequire((await import("node:path")).resolve(process.env.IKI_REPO ?? "../iki") + "/packages/mcp/package.json");
const sharp = (await import(req.resolve("sharp"))).default;

const [file, param = "ParamChengPalm", wristS = "30"] = process.argv.slice(2);
const wrist = (+wristS * Math.PI) / 180;
const model = JSON.parse(readFileSync(file, "utf8"));
model.parameters = model.parameters.filter((p) => p.id !== param);
model.parameters.push({ id: param, name: "Clap palms (forearm supinated)", min: 0, max: 1, default: 0 });
model.parts = model.parts.filter((p) => !p.id.endsWith("_palm"));

const atlasCache = new Map();
const atlas = async (index) => {
  if (!atlasCache.has(index)) {
    const buf = Buffer.from(model.textures[index].source.split(",")[1], "base64");
    atlasCache.set(index, { buf, meta: await sharp(buf).metadata() });
  }
  return atlasCache.get(index);
};

for (const side of ["L", "R"]) {
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
  const start = cuff + 6; // below the cuff's cream edge band
  // The wrist's centre, from the opaque run just under the cuff: the hand flips about it.
  let lo = W, hi = -1;
  for (let y = start; y < start + 12; y++) for (let x = 0; x < W; x++) if (data[at(x, y) + 3] > 128) { lo = Math.min(lo, x); hi = Math.max(hi, x); }
  const axis = (lo + hi) / 2;

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
      const i = at(mx, y), wa = w * data[i + 3];
      r += wa * data[i]; g += wa * data[i + 1]; b += wa * data[i + 2]; a += wa;
    }
    return a > 0 ? [r / a, g / a, b / a, a] : [0, 0, 0, 0];
  };
  const out = Buffer.from(data);
  for (let y = start; y < H; y++) {
    for (let x = 0; x < W; x++) {
      // Inverse-rotate about the wrist (axis, start) to find where this pixel comes from in the mirrored hand.
      const rx = x - axis, ry = y - start;
      const [r, g, b, a] = sample(axis + cos * rx + sin * ry, start - sin * rx + cos * ry);
      const i = at(x, y);
      out[i] = Math.round(r); out[i + 1] = Math.round(g); out[i + 2] = Math.round(b); out[i + 3] = Math.round(a);
    }
  }
  const png = await sharp(out, { raw: { width: W, height: H, channels: 4 } }).png().toBuffer();
  const index = model.textures.length;
  model.textures.push({ source: `data:image/png;base64,${png.toString("base64")}` });

  const twin = structuredClone(fore);
  twin.id = `${fore.id}_palm`;
  twin.order = fore.order + 0.01;
  twin.texture = { index, uv: { x: 0, y: 0, width: 1, height: 1 } };
  twin.mesh.uvs = fore.mesh.uvs.map((u, i) => (i % 2 === 0 ? (u - uv.x) / uv.width : (u - uv.y) / uv.height));
  twin.bindings = [...(fore.bindings ?? []).filter((b) => b.parameter !== param), { parameter: param, channel: "opacity", from: 0, to: 1 }];
  fore.bindings = [...(fore.bindings ?? []).filter((b) => b.parameter !== param), { parameter: param, channel: "opacity", from: 1, to: 0 }];
  model.parts.push(twin);
  console.log(`${twin.id}: hand below crop row ${start} flipped about x=${axis.toFixed(1)}, wrist bent ${wristS}°, shown by ${param}`);
}
writeFileSync(file, JSON.stringify(model));
