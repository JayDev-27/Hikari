// node extend-arms.mjs <model.iki> [maxRaise=150] [elbowMin=-170] — extend the shoulder rotation (ParamArmL/R) beyond the auto-rig's 32°,
// keeping the same slope (1° per unit), so a raised arm plus the elbow's bend toward the body gives a raised hand.
import { readFileSync, writeFileSync } from "node:fs";
const [file, maxS = "150", elbowS = "-170"] = process.argv.slice(2); const max = +maxS, elbowMin = +elbowS;
const m = JSON.parse(readFileSync(file, "utf8"));
for (const side of ["L", "R"]) {
  const p = m.parameters.find((q) => q.id === `ParamArm${side}`); if (!p) continue;
  const d = m.deformers.find((q) => q.id === `armDeformer_${side}`); const b = d.bindings.find((q) => q.parameter === p.id);
  const slope = (b.to - b.from) / (p.max - p.min);
  b.to = b.from + slope * (max - p.min); p.max = max;
}
// The elbow bends only toward the body (−10…90); allow it to open the other way too, so a raised upper arm can
// carry the forearm upward (a raised-hand wave: elbow low beside the waist, forearm upright). Same slope, min −170.
for (const side of ["L", "R"]) {
  const p = m.parameters.find((q) => q.id === `ParamElbow${side}`); if (!p) continue;
  const d = m.deformers.find((q) => q.id === `forearmDeformer_${side}`); const b = d.bindings.find((q) => q.parameter === p.id);
  const slope = (b.to - b.from) / (p.max - p.min);
  b.from = b.from + slope * (elbowMin - p.min); p.min = elbowMin;
}
writeFileSync(file, JSON.stringify(m));
console.log("arm raise extended to", max, "elbow opens to", elbowMin);
