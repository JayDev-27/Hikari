// node eye-glow.mjs <model.iki> <param> [hex=#3fb6ff] — glowing irises that fade in on `param` (0..1).
//
// Lu Guang's eyes glow blue while he reads a photo. This clones each iris (iris_L / iris_R) into `glow_iris_X`
// just above it, with the same mesh, deformer, clip and gaze bindings (so it follows the eyes exactly), and a
// recoloured texture: the iris's own shading mapped onto a luminous ramp from a deep shade of `hex` through
// `hex` to near-white, so the pupil, rim and catch-lights keep their drawing but read as lit from within.
// It shows on `param` through an opacity binding. Rerunnable: earlier glow parts / the parameter are replaced.
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
const req = createRequire((await import("node:path")).resolve(process.env.IKI_REPO ?? "../iki") + "/packages/mcp/package.json");
const sharp = (await import(req.resolve("sharp"))).default;

const [file, param, hex = "#3fb6ff"] = process.argv.slice(2);
const model = JSON.parse(readFileSync(file, "utf8"));
model.parameters = model.parameters.filter((p) => p.id !== param);
model.parameters.push({ id: param, name: param.replace(/^Param/, ""), min: 0, max: 1, default: 0 });
model.parts = model.parts.filter((p) => !p.id.startsWith("glow_iris_"));

const base = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const lerp = (a, b, k) => a.map((v, i) => v + (b[i] - v) * k);
const deep = base.map((v) => v * 0.28), white = [235, 250, 255];
// Luminance 0 → deep, ~0.55 → the colour itself, 1 → near-white (catch-lights stay white).
const ramp = (l) => (l < 0.55 ? lerp(deep, base, l / 0.55) : lerp(base, white, (l - 0.55) / 0.45));

for (const side of ["L", "R"]) {
  const iris = model.parts.find((p) => p.id === `iris_${side}`);
  const src = model.textures[iris.texture.index].source;
  const buf = Buffer.from(src.split(",")[1], "base64");
  const meta = await sharp(buf).metadata();
  const uv = iris.texture.uv;
  const rect = { left: Math.floor(uv.x * meta.width), top: Math.floor(uv.y * meta.height), width: Math.ceil(uv.width * meta.width), height: Math.ceil(uv.height * meta.height) };
  const { data, info } = await sharp(buf).extract(rect).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  // Normalise the iris's own lightness range so a dark grey-blue iris still uses the whole ramp.
  let lo = 255, hi = 0;
  for (let i = 0; i < data.length; i += 4) if (data[i + 3] > 128) { const l = 0.3 * data[i] + 0.59 * data[i + 1] + 0.11 * data[i + 2]; lo = Math.min(lo, l); hi = Math.max(hi, l); }
  for (let i = 0; i < data.length; i += 4) {
    const l = (0.3 * data[i] + 0.59 * data[i + 1] + 0.11 * data[i + 2] - lo) / Math.max(1, hi - lo);
    const [r, g, b] = ramp(Math.min(1, Math.max(0, l * 1.15)));
    data[i] = r; data[i + 1] = g; data[i + 2] = b;
  }
  const png = await sharp(data, { raw: info }).png().toBuffer();
  const index = model.textures.length;
  model.textures.push({ source: `data:image/png;base64,${png.toString("base64")}` });

  const glow = structuredClone(iris);
  glow.id = `glow_iris_${side}`;
  glow.order = iris.order + 0.25;
  // Same picture area, now the whole of its own texture: remap the mesh's atlas u/v's to 0..1.
  const ux = rect.left / meta.width, uy = rect.top / meta.height, uw = rect.width / meta.width, uh = rect.height / meta.height;
  glow.texture = { index, uv: { x: 0, y: 0, width: 1, height: 1 } };
  glow.mesh.uvs = iris.mesh.uvs.map((u, i) => Math.min(1, Math.max(0, i % 2 === 0 ? (u - ux) / uw : (u - uy) / uh)));
  glow.bindings = [...(iris.bindings ?? []), { parameter: param, channel: "opacity", from: 0, to: 1 }];
  model.parts.push(glow);
  console.log(`${glow.id}: ${hex} glow over iris_${side}, shown by ${param}`);
}
writeFileSync(file, JSON.stringify(model));
