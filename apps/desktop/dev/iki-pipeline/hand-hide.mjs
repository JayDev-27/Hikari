// node hand-hide.mjs <model.iki> <side L|R> <param> <startRow> — a forearm twin without its hand, for a held prop that brings its own.
//
// Lu Guang's photo is painted together with the hand that grips it (source/photo-grip.png): fingers flat on the
// back of the photo, the back of the hand to the viewer, as a person holds a picture up to look at it. While that
// prop shows, the forearm's own open hand must not. This adds `forearm_<side>_grip`, a twin of the forearm (same
// deformer, mesh and warps) whose picture stops at crop row `startRow` (just below the wristband: the prop's
// wrist takes over there), shown by `param` 0→1 while the forearm and any palm twin fade out on it.
// Rerunnable: an earlier twin and its bindings are replaced.
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
const req = createRequire((await import("node:path")).resolve(process.env.IKI_REPO ?? "../iki") + "/packages/mcp/package.json");
const sharp = (await import(req.resolve("sharp"))).default;

const [file, side, param, startS] = process.argv.slice(2);
const start = +startS;
const model = JSON.parse(readFileSync(file, "utf8"));
const id = `forearm_${side}_grip`;
model.parts = model.parts.filter((p) => p.id !== id);
const fore = model.parts.find((p) => p.id === `forearm_${side}`);
if (!fore) throw new Error(`no forearm_${side}`);
if (!model.parameters.some((p) => p.id === param)) throw new Error(`no parameter ${param}`);

const buf = Buffer.from(model.textures[fore.texture.index].source.split(",")[1], "base64");
const meta = await sharp(buf).metadata();
const uv = fore.texture.uv;
const rect = { left: Math.round(uv.x * meta.width), top: Math.round(uv.y * meta.height), width: Math.round(uv.width * meta.width), height: Math.round(uv.height * meta.height) };
const { data, info } = await sharp(buf).extract(rect).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
// Fade the last few rows so the cut under the wristband has no hard edge where the prop's wrist overlaps it.
for (let y = Math.max(0, start - 6); y < info.height; y++) {
  const k = y >= start ? 0 : (start - y) / 6;
  for (let x = 0; x < info.width; x++) { const o = (y * info.width + x) * 4 + 3; data[o] = Math.round(data[o] * k); }
}
const png = await sharp(data, { raw: info }).png().toBuffer();
const index = model.textures.length;
model.textures.push({ source: `data:image/png;base64,${png.toString("base64")}` });

const twin = structuredClone(fore);
twin.id = id;
twin.order = fore.order + 0.02;
twin.texture = { index, uv: { x: 0, y: 0, width: 1, height: 1 } };
twin.mesh.uvs = fore.mesh.uvs.map((u, i) => Math.min(1, Math.max(0, i % 2 === 0 ? (u - uv.x) / uv.width : (u - uv.y) / uv.height)));
const others = (b) => b.parameter !== param;
twin.bindings = [...(fore.bindings ?? []).filter((b) => others(b) && b.channel !== "opacity"), { parameter: param, channel: "opacity", from: 0, to: 1 }];
for (const p of model.parts) if (p.id === fore.id || p.id === `${fore.id}_palm`) p.bindings = [...(p.bindings ?? []).filter(others), { parameter: param, channel: "opacity", from: 1, to: 0 }];
model.parts.push(twin);
writeFileSync(file, JSON.stringify(model));
console.log(`${id}: forearm_${side} without its hand below crop row ${start}, shown by ${param}`);
