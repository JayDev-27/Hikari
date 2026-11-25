// node add-prop.mjs <model.iki> <prop.png> <partId> <param> <cx,cy,w> <order> [deformer=bodyWarp] [turnDeg=0] — add a held prop.
//
// A prop (Rize's open book) is a painted part shown by its own 0..1 parameter through an opacity binding, so a
// gesture can bring it in while the hands hold it and take it away before they drop. cx,cy are its centre in
// canvas px (top-left origin, as measured on render_poses at the gesture's peak), w its width in canvas px (the
// height keeps the picture's aspect). It rides `deformer` (bodyWarp: it moves with the body like the arms do).
// Draw order: just above the forearms (7.x) puts the prop in front of the hands, so fingers holding it from
// below show under its bottom edge. Rerunnable: an earlier part / parameter of the same id is replaced.
// A prop riding a forearm (Lu Guang's photo on forearmDeformer_R) is placed where it sits in the REST pose and
// turned by `turnDeg` (clockwise on screen) there, so the forearm's own turn brings it upright in the hand; `w`
// is then the picture's own width, before the turn (the part grows to the turned picture's box).
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
const req = createRequire((await import("node:path")).resolve(process.env.IKI_REPO ?? "../iki") + "/packages/mcp/package.json");
const sharp = (await import(req.resolve("sharp"))).default;

const [file, png, id, param, placeS, orderS, deformer = "bodyWarp", turnS = "0"] = process.argv.slice(2);
const [cx, cy, w] = placeS.split(",").map(Number);
const model = JSON.parse(readFileSync(file, "utf8"));
if (!model.deformers.some((d) => d.id === deformer)) throw new Error(`no deformer ${deformer}`);
const meta = await sharp(png).metadata();
// Store the picture at twice the drawn size (Lanczos), so the renderer downsamples instead of blurring it up.
const scale = (2 * w) / meta.width;
let pic = await sharp(png).resize({ width: Math.round(meta.width * scale), height: Math.round(meta.height * scale), kernel: "lanczos3" }).png().toBuffer();
if (+turnS) pic = await sharp(pic).rotate(+turnS, { background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
const turned = await sharp(pic).metadata();
const tex = pic;
const pw = turned.width / 2, h = turned.height / 2;

model.parameters = model.parameters.filter((p) => p.id !== param);
model.parameters.push({ id: param, name: param.replace(/^Param/, ""), min: 0, max: 1, default: 0 });
const old = model.parts.find((p) => p.id === id);
model.parts = model.parts.filter((p) => p.id !== id);
let index = old?.texture?.index;
if (index === undefined || model.parts.some((p) => p.texture?.index === index)) index = model.textures.length;
model.textures[index] = { source: `data:image/png;base64,${tex.toString("base64")}` };
model.parts.push({
  id, width: pw, height: h, transform: { x: cx - model.canvas.width / 2, y: model.canvas.height / 2 - cy },
  deformer, order: +orderS, color: [1, 1, 1, 1],
  texture: { index, uv: { x: 0, y: 0, width: 1, height: 1 } },
  mesh: { vertices: [-0.5, 0.5, 0.5, 0.5, -0.5, -0.5, 0.5, -0.5], uvs: [0, 0, 1, 0, 0, 1, 1, 1], indices: [0, 2, 1, 1, 2, 3] },
  bindings: [{ parameter: param, channel: "opacity", from: 0, to: 1 }],
});
writeFileSync(file, JSON.stringify(model));
console.log(`${id}: ${pw.toFixed(0)}×${h.toFixed(0)} canvas px at (${cx}, ${cy}) on ${deformer}, turned ${turnS}°, order ${orderS}, shown by ${param}`);
