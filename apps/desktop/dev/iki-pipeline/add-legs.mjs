// node add-legs.mjs <model.iki> <hipCanvasY> <footCanvasY> — add ParamLegShift (-1..1) with warp keyforms on the body mesh:
// +1 = weight on the viewer-left leg: hips shift toward it, the other leg's knee bends inward and its hip drops; feet stay planted.
import { readFileSync, writeFileSync } from "node:fs";
const [file, hipY, footY] = process.argv.slice(2);
const m = JSON.parse(readFileSync(file, "utf8"));
const body = m.parts.find((p) => p.id === "body");
const H = m.canvas.height, v = body.mesh.vertices, n = v.length / 2;
const { x: tx, y: ty } = body.transform, W = body.width, PH = body.height;
const smooth = (t) => { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); };
const plus = new Array(v.length).fill(0);
for (let i = 0; i < n; i++) {
  const mx = tx + v[2 * i] * W, my = ty + v[2 * i + 1] * PH;     // model space, +y up
  const cy = H / 2 - my;                                            // canvas row
  const t = (cy - +hipY) / (+footY - +hipY);                        // 0 at the hips, 1 at the soles
  if (t <= 0 || t >= 1.02) continue;
  const fade = smooth(t / 0.14) * (1 - smooth((t - 0.9) / 0.12));   // nothing at the waist seam or at the soles
  let dx = -18 * fade * (1 - t);                                    // hips toward the standing (viewer-left) leg
  let dy = 0;
  if (mx > 0) {                                                     // relaxed leg (viewer right): knee in, hip down
    dx += -30 * Math.sin(Math.PI * Math.min(1, t)) * fade;
    dy += -16 * (1 - t) * fade;
  } else dx += 3 * Math.sin(Math.PI * Math.min(1, t)) * fade;       // standing leg locks a touch straighter
  plus[2 * i] = dx / W; plus[2 * i + 1] = dy / PH;
}
// -1 mirrors it: the same motion with the legs swapped (the relaxed leg is the viewer-left one).
const minus = new Array(v.length).fill(0);
for (let i = 0; i < n; i++) {
  const mx = tx + v[2 * i] * W, my = ty + v[2 * i + 1] * PH;
  // find the mirrored vertex's offsets by evaluating the same formula on -mx
  const cy = H / 2 - my, t = (cy - +hipY) / (+footY - +hipY);
  if (t <= 0 || t >= 1.02) continue;
  const fade = smooth(t / 0.14) * (1 - smooth((t - 0.9) / 0.12));
  let dx = 18 * fade * (1 - t), dy = 0;
  if (mx < 0) { dx += 30 * Math.sin(Math.PI * Math.min(1, t)) * fade; dy += -16 * (1 - t) * fade; }
  else dx += -3 * Math.sin(Math.PI * Math.min(1, t)) * fade;
  minus[2 * i] = dx / W; minus[2 * i + 1] = dy / PH;
}
m.parameters = m.parameters.filter((p) => p.id !== "ParamLegShift");
m.parameters.push({ id: "ParamLegShift", name: "Leg Shift", min: -1, max: 1, default: 0 });
body.warps = (body.warps ?? []).filter((w) => w.parameter !== "ParamLegShift");
body.warps.push({ parameter: "ParamLegShift", keyforms: [{ value: -1, offsets: minus }, { value: 0, offsets: new Array(v.length).fill(0) }, { value: 1, offsets: plus }] });
writeFileSync(file, JSON.stringify(m));
console.log("ParamLegShift added to body:", n, "vertices");
