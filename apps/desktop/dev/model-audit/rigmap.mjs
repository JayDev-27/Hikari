#!/usr/bin/env node
// Rig map: for every parameter, how far does each drawable move (in canvas pixels) and
// does its opacity change, between the parameter's min / default / max? Reveals which
// meshes a parameter really drives, global transforms where a local one is expected,
// and parameters that drive nothing. Uses the real Cubism Core, no rendering.
//   node dev/model-audit/rigmap.mjs <model3.json> [--min-px 1.5]
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { loadCore } from "./core.mjs";

export async function rigMap(model3Path) {
  const C = await loadCore();
  const m3 = JSON.parse(readFileSync(model3Path, "utf8"));
  const b = readFileSync(join(dirname(model3Path), m3.FileReferences.Moc));
  const model = C.Model.fromMoc(C.Moc.fromArrayBuffer(b.buffer.slice(b.byteOffset, b.byteOffset + b.length)));
  const P = model.parameters, D = model.drawables;
  const ppu = model.canvasinfo.PixelsPerUnit;
  const snap = () => {
    model.update();
    return { v: D.vertexPositions.map((a) => Float32Array.from(a)), o: Float32Array.from(D.opacities), ro: Array.from(model.getRenderOrders?.() ?? D.drawOrders) };
  };
  const setAll = (vals) => { for (let i = 0; i < P.count; i++) P.values[i] = vals[i]; };
  const defs = Float32Array.from(P.defaultValues);
  setAll(defs);
  const rest = snap();
  const rows = [];
  for (let i = 0; i < P.count; i++) {
    const row = { id: P.ids[i], min: P.minimumValues[i], max: P.maximumValues[i], moves: {} };
    for (const [tag, val] of [["min", P.minimumValues[i]], ["max", P.maximumValues[i]]]) {
      const vals = Float32Array.from(defs);
      vals[i] = val;
      setAll(vals);
      const s = snap();
      for (let d = 0; d < D.count; d++) {
        let maxd = 0;
        const a = rest.v[d], c = s.v[d];
        for (let k = 0; k < a.length; k += 2) maxd = Math.max(maxd, Math.hypot(c[k] - a[k], c[k + 1] - a[k + 1]) * ppu);
        const dop = Math.abs(s.o[d] - rest.o[d]);
        if (maxd > 0.5 || dop > 0.02) {
          const m = (row.moves[D.ids[d]] ??= { min: 0, max: 0, opMin: 0, opMax: 0 });
          m[tag] = Math.round(maxd * 10) / 10;
          m[tag === "min" ? "opMin" : "opMax"] = Math.round(dop * 100) / 100;
        }
      }
    }
    rows.push(row);
  }
  setAll(defs);
  return { ids: Array.from(D.ids), params: rows, canvas: model.canvasinfo, partCount: model.parts.count };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === new URL(import.meta.url).pathname;
if (isMain) {
  const path = process.argv[2];
  const r = await rigMap(resolve(path));
  console.log(`drawables (${r.ids.length}): ${r.ids.join(", ")}\n`);
  for (const p of r.params) {
    const names = Object.entries(p.moves);
    const summary = names.length
      ? names.map(([d, m]) => `${d}(${Math.max(m.min, m.max)}px${m.opMin || m.opMax ? `, α${Math.max(m.opMin, m.opMax)}` : ""})`).join(" ")
      : "— drives nothing —";
    console.log(`${p.id.padEnd(18)} [${p.min}…${p.max}]  ${summary}`);
  }
}
