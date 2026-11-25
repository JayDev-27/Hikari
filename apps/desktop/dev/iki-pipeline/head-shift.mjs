// node head-shift.mjs <model.iki> <nodPx> <turnPx> — make head pitch and yaw move the head, not only warp the face.
//
// The auto-rig drives ParamAngleY (nod) and ParamAngleX (turn) through face and hair warps only, and on a
// slender, high-contrast face like Lu Guang's those warps are a few pixels: a nod, a bow or a shy look away
// barely reads. A real head also travels: it drops forward as it nods and slides a little as it turns. This adds
// translate bindings on headDeformer — ParamAngleY −30…30 → −nodPx…+nodPx (down to up) and ParamAngleX −30…30 →
// −turnPx…+turnPx — on top of the warps already there, so the face keeps its shading and simply moves with the
// head. Small values (6–12 px at the extremes) stay inside the collar. Rerunnable: replaces its own bindings.
import { readFileSync, writeFileSync } from "node:fs";

const [file, nodS, turnS] = process.argv.slice(2);
const nod = +nodS, turn = +turnS;
const model = JSON.parse(readFileSync(file, "utf8"));
const head = model.deformers.find((d) => d.id === "headDeformer");
if (!head) throw new Error("no headDeformer");
const range = (id) => model.parameters.find((p) => p.id === id);
const mine = (b) => (b.parameter === "ParamAngleY" && b.channel === "translateY") || (b.parameter === "ParamAngleX" && b.channel === "translateX");
head.bindings = (head.bindings ?? []).filter((b) => !mine(b));
const y = range("ParamAngleY"), x = range("ParamAngleX");
head.bindings.push({ parameter: "ParamAngleY", channel: "translateY", from: (nod * y.min) / 30, to: (nod * y.max) / 30 });
head.bindings.push({ parameter: "ParamAngleX", channel: "translateX", from: (turn * x.min) / 30, to: (turn * x.max) / 30 });
writeFileSync(file, JSON.stringify(model));
console.log(`headDeformer: ParamAngleY ±${nod}px vertical, ParamAngleX ±${turn}px sideways`);
