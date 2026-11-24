// node elbow-in.mjs <model.iki> [max=170] — let each forearm fold inward up to `max` degrees.
//
// The rig's elbow stops at +90° inward, where the forearm lies level across the waist, so a hand can
// never reach the face across the chest. This extends ParamElbowL/R's max to `max`, growing the
// forearm deformer's rotate binding by the same degrees-per-unit slope, so every angle the rig
// already had (the rest pose included) lands exactly where it did. gestures.ts then picks the
// hand-to-face variants (think_chin-fold, facepalm-fold) for this rig. Rerunnable.
import { readFileSync, writeFileSync } from "node:fs";

const [file, maxS = "170"] = process.argv.slice(2);
const max = +maxS;
const model = JSON.parse(readFileSync(file, "utf8"));
for (const side of ["L", "R"]) {
  const elbow = model.parameters.find(({ id }) => id === `ParamElbow${side}`);
  const forearm = model.deformers.find(({ id }) => id === `forearmDeformer_${side}`);
  const rotate = forearm?.bindings.find(({ channel, parameter }) => channel === "rotate" && parameter === `ParamElbow${side}`);
  if (!elbow || !rotate) { console.log(`${side}: no elbow/forearm rotate binding, skipped`); continue; }
  if (elbow.max >= max) { console.log(`${side}: elbow already opens to ${elbow.max}`); continue; }
  const slope = (rotate.to - rotate.from) / (elbow.max - elbow.min);
  rotate.to += (max - elbow.max) * slope;
  console.log(`${side}: elbow max ${elbow.max} -> ${max}, rotate to ${rotate.to.toFixed(1)}`);
  elbow.max = max;
}
writeFileSync(file, JSON.stringify(model));
