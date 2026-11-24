#!/usr/bin/env node
// Standardise and repair the layered character models (characters/<id>/model/).
//
// Non-destructive: the first run copies the model folder to characters/<id>/source/original-model/
// and every run rebuilds characters/<id>/model/ from that backup, so it is idempotent.
// All moc3 edits are in-place numeric patches (no structural change), and the result is
// checked against the real Cubism Core before being written.
//
//   node dev/model-fix/fix-models.mjs [--dry] [id …]       (default: all configured ids)
//
// What it does, and why (each item was found with dev/model-audit + the rig test):
//   1. SWING   hair/cloth swing keyforms are scaled so their displacement can never expose the
//              blurry inpainted fill under the hair (visible tearing at ±1). Per-model caps in px.
//   2. LIDS    closed-eyelid meshes are drawn above the hair so a blink fully covers the eye
//              (hair1's own pixels contain part of the iris).
//   3. BREATH  ParamBreath default 0 (standard) with the identical rest pose: its keys
//              [0,1] become [-1,1], so value 0 still evaluates to the old mid-pose.
//   4. MOTIONS ParamBodyAngleX curves are scaled into the parameter's ±10 range (they ran to
//              −14…+17, which the runtime clamps into flat plateaus).
//   5. CDI     <Model>.cdi3.json (display names + groups) as every Cubism export ships.
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { meshKeyforms, parseMoc3 } from "../model-audit/moc3.mjs";
import { loadCore } from "../model-audit/core.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(here, "../../../..");

/** Per-model repairs. Values chosen by looking at sweeps at ±1 (see DECISIONS.md). */
export const CONFIG = {
  reze: { hairMaxPx: 3.2, clothMaxPx: 6, lidsAboveHair: true },
  makima: { hairMaxPx: 4.5, clothMaxPx: 6, lidsAboveHair: true },
  rize: { hairMaxPx: 5, lidsAboveHair: true },
  "lu-guang": {},
  "cheng-xiaoshi": {},
};

// ------------------------------------------------------------------ moc3 patches

/** Scale the ±key keyforms of every mesh bound to `paramId` toward the middle keyform so the
 *  largest vertex displacement is `maxPx` canvas pixels. Returns what it did. */
export function capSwing(moc, paramId, maxPx) {
  const s = (n) => moc.sections[n].view;
  const ppu = moc.canvas.ppu;
  const ids = s("art_mesh.ids");
  const targets = [];
  let worst = 0;
  ids.forEach((id, mi) => {
    const k = meshKeyforms(moc, mi);
    const bi = k.bindings.findIndex((b) => b.paramId === paramId);
    if (bi < 0) return;
    const b = k.bindings[bi];
    if (b.keys.length !== 3 || b.keys[0] !== -1 || b.keys[1] !== 0 || b.keys[2] !== 1) return;
    // Keyform index = Σ keyIndex(binding) × stride(binding), first binding fastest.
    const stride = k.bindings.slice(0, bi).reduce((a, x) => a * x.keys.length, 1);
    const groups = k.keyformCount / 3;
    const pairs = []; // [midKeyform, lowKeyform, highKeyform]
    for (let g = 0; g < groups; g++) {
      const rest = Math.floor(g / stride) * stride * 3 + (g % stride);
      pairs.push([rest + stride, rest, rest + 2 * stride]);
    }
    const pos = (kf) => s("art_mesh_keyform.keyform_position_begin_indices")[k.keyformBegin + kf];
    for (const [mid, lo, hi] of pairs) {
      for (const kf of [lo, hi]) {
        for (let v = 0; v < k.vertexCount * 2; v += 2) {
          const dx = s("keyform_position.xys")[pos(kf) + v] - s("keyform_position.xys")[pos(mid) + v];
          const dy = s("keyform_position.xys")[pos(kf) + v + 1] - s("keyform_position.xys")[pos(mid) + v + 1];
          worst = Math.max(worst, Math.hypot(dx, dy) * ppu);
        }
      }
    }
    targets.push({ id, k, pairs, pos });
  });
  if (!targets.length || worst <= maxPx) return { meshes: targets.map((t) => t.id), worstPx: worst, factor: 1 };
  const f = maxPx / worst;
  const xys = s("keyform_position.xys");
  for (const t of targets) {
    for (const [mid, lo, hi] of t.pairs) {
      for (const kf of [lo, hi]) {
        const a = t.pos(kf), m = t.pos(mid);
        for (let v = 0; v < t.k.vertexCount * 2; v++) xys[a + v] = xys[m + v] + f * (xys[a + v] - xys[m + v]);
      }
    }
  }
  return { meshes: targets.map((t) => t.id), worstPx: worst, factor: f };
}

/** Draw the closed-lid meshes above hair/cloth so a blink covers everything under it. */
export function lidsAboveHair(moc) {
  const s = (n) => moc.sections[n].view;
  const ids = s("art_mesh.ids");
  const order = ids.map((id, mi) => ({ id, mi, o: s("art_mesh_keyform.draw_orders")[meshKeyforms(moc, mi).keyformBegin] }));
  const lids = order.filter((m) => /^Blink\d/.test(m.id));
  const hair = order.filter((m) => /^(hair|fabric|skirt)/i.test(m.id));
  if (!lids.length || !hair.length) return { moved: false };
  const base = Math.min(...order.map((m) => m.o));
  const topHair = Math.max(...hair.map((m) => m.o));
  if (lids.every((l) => l.o > topHair)) return { moved: false, reason: "already above" };
  const rest = order.filter((m) => !lids.includes(m)).sort((a, b) => a.o - b.o);
  const cut = rest.findIndex((m) => m.o > topHair);
  const arranged = [...rest.slice(0, cut < 0 ? rest.length : cut), ...lids, ...(cut < 0 ? [] : rest.slice(cut))];
  arranged.forEach((m, i) => {
    const k = meshKeyforms(moc, m.mi);
    for (let kf = 0; kf < k.keyformCount; kf++) s("art_mesh_keyform.draw_orders")[k.keyformBegin + kf] = base + i;
  });
  return { moved: true, lids: lids.map((l) => l.id), from: lids.map((l) => l.o), to: lids.map((l) => base + arranged.findIndex((m) => m === l)) };
}

/** ParamBreath default 0 with an unchanged rest pose (keys [0,1] → [-1,1]). */
export function rebaseBreath(moc) {
  const s = (n) => moc.sections[n].view;
  const p = moc.paramIndex("ParamBreath");
  if (p < 0) return { changed: false };
  const def = s("parameter.default_values")[p];
  if (def === 0) return { changed: false, reason: "default already 0" };
  if (def !== 0.5) throw new Error(`ParamBreath default ${def}: only 0.5 is handled`);
  const b0 = s("parameter.keyform_binding_begin_indices")[p], bc = s("parameter.keyform_binding_counts")[p];
  let patched = 0;
  for (let b = b0; b < b0 + bc; b++) {
    const kBegin = s("keyform_binding.keys_begin_indices")[b], kCount = s("keyform_binding.keys_counts")[b];
    const keys = s("keys.values");
    if (kCount !== 2 || keys[kBegin] !== 0 || keys[kBegin + 1] !== 1) throw new Error("unexpected ParamBreath keys");
    keys[kBegin] = -1;
    keys[kBegin + 1] = 1;
    patched++;
  }
  s("parameter.default_values")[p] = 0;
  return { changed: true, bindings: patched };
}

// ------------------------------------------------------------------ motions

/** Run `fn` over every value of a motion3 segment array (t0,v0, then type + points). */
function mapValues(seg, fn) {
  const out = seg.slice();
  out[1] = fn(out[1]);
  let i = 2;
  while (i < out.length) {
    const n = out[i] === 1 ? 3 : 1;
    for (let k = 0; k < n; k++) out[i + 2 + 2 * k] = fn(out[i + 2 + 2 * k]);
    i += 1 + 2 * n;
  }
  return out;
}

export function fitBodyAngle(motion, limit = 10) {
  let scaled = null;
  for (const c of motion.Curves) {
    if (c.Target !== "Parameter" || c.Id !== "ParamBodyAngleX") continue;
    let max = 0;
    mapValues(c.Segments, (v) => (max = Math.max(max, Math.abs(v)), v));
    if (max > limit) {
      c.Segments = mapValues(c.Segments, (v) => v * (limit / max));
      scaled = max;
    }
  }
  return scaled;
}

// ------------------------------------------------------------------ cdi3

const NAMES = {
  ParamAngleX: ["Face", "Angle X"], ParamAngleY: ["Face", "Angle Y"], ParamAngleZ: ["Face", "Angle Z"],
  ParamEyeLOpen: ["Eyes", "Left Eye Open"], ParamEyeROpen: ["Eyes", "Right Eye Open"],
  ParamEyeBallX: ["Eyeballs", "Eyeball X"], ParamEyeBallY: ["Eyeballs", "Eyeball Y"],
  ParamBrowLY: ["Brows", "Left Brow Up/Down"], ParamBrowRY: ["Brows", "Right Brow Up/Down"],
  ParamMouthOpenY: ["Mouth", "Mouth Open"], ParamMouthForm: ["Mouth", "Mouth Shape"],
  ParamBodyAngleX: ["Body", "Body Rotation X"], ParamBreath: ["Body", "Breath"],
  ParamHairSwing: ["Physics", "Hair Swing"], ParamClothSwing: ["Physics", "Cloth Swing"], ParamWind: ["Physics", "Wind"],
  ParamShoulderL: ["Arm L", "Left Shoulder"], ParamElbowL: ["Arm L", "Left Elbow"], ParamWristL: ["Arm L", "Left Wrist"], ParamDepthL: ["Arm L", "Left Arm Depth"],
  ParamShoulderR: ["Arm R", "Right Shoulder"], ParamElbowR: ["Arm R", "Right Elbow"], ParamWristR: ["Arm R", "Right Wrist"], ParamDepthR: ["Arm R", "Right Arm Depth"],
  ParamSignatureProp: ["Props", "Signature Prop"], ParamSignatureHands: ["Props", "Signature Hands"],
};
const humanise = (id) => id.replace(/^Param/, "").replace(/([a-z])([A-Z])/g, "$1 $2");

export function buildCdi3(paramIds, partIds) {
  const groups = new Map();
  const Parameters = paramIds.map((Id) => {
    const [g, Name] = NAMES[Id] ?? ["Other", humanise(Id)];
    const GroupId = `ParamGroup${g.replace(/\s+/g, "")}`;
    groups.set(GroupId, g);
    return { Id, GroupId, Name };
  });
  const display = { PartRoot: "Root", __RootPart__: "Root Part" };
  return {
    Version: 3,
    Parameters,
    ParameterGroups: [...groups].map(([Id, Name]) => ({ Id, GroupId: "", Name })),
    Parts: partIds.map((Id) => ({ Id, Name: display[Id] ?? humanise(Id) })),
    CombinedParameters: [["ParamAngleX", "ParamAngleY"], ["ParamEyeBallX", "ParamEyeBallY"]].filter((pair) => pair.every((p) => paramIds.includes(p))),
  };
}

// ------------------------------------------------------------------ driver

async function fixOne(id, { dry }) {
  const charDir = join(REPO, "characters", id);
  const modelDir = join(charDir, "model");
  const backup = join(charDir, "source", "original-model");
  if (!existsSync(modelDir)) return console.log(`${id}: no model folder, skipped`);
  if (!existsSync(backup)) {
    if (dry) console.log(`${id}: (dry) would back up model/ → source/original-model/`);
    else {
      mkdirSync(dirname(backup), { recursive: true });
      cpSync(modelDir, backup, { recursive: true });
      console.log(`${id}: backed up original model to source/original-model/`);
    }
  }
  const src = existsSync(backup) ? backup : modelDir;
  const cfg = CONFIG[id] ?? {};
  const m3Name = readdirSync(src).find((f) => f.endsWith(".model3.json"));
  const m3 = JSON.parse(readFileSync(join(src, m3Name), "utf8"));
  const stem = m3Name.replace(".model3.json", "");
  const mocName = m3.FileReferences.Moc;

  // moc3
  const mocBytes = readFileSync(join(src, mocName));
  const moc = parseMoc3(mocBytes);
  const report = [];
  if (cfg.hairMaxPx) { const r = capSwing(moc, "ParamHairSwing", cfg.hairMaxPx); report.push(`hair swing ${r.worstPx.toFixed(1)}px → ≤${cfg.hairMaxPx}px (×${r.factor.toFixed(2)}, ${r.meshes.join("/")})`); }
  if (cfg.clothMaxPx) { const r = capSwing(moc, "ParamClothSwing", cfg.clothMaxPx); report.push(`cloth swing ${r.worstPx.toFixed(1)}px → ≤${cfg.clothMaxPx}px (×${r.factor.toFixed(2)}, ${r.meshes.join("/")})`); }
  if (cfg.lidsAboveHair) { const r = lidsAboveHair(moc); report.push(r.moved ? `lids ${r.lids.join(",")} draw order ${r.from}→${r.to}` : `lids unchanged (${r.reason ?? "n/a"})`); }
  const rb = rebaseBreath(moc);
  report.push(rb.changed ? `breath default 0 (${rb.bindings} bindings rebased)` : `breath unchanged (${rb.reason ?? "n/a"})`);

  // Verify with the real Core: loads, and the rest pose is unchanged by the breath rebase.
  const C = await loadCore();
  const load = (bytes) => C.Model.fromMoc(C.Moc.fromArrayBuffer(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length)));
  const before = load(mocBytes), after = load(moc.bytes());
  before.update(); after.update();
  let maxRestDelta = 0;
  for (let d = 0; d < before.drawables.count; d++) {
    const a = before.drawables.vertexPositions[d], b = after.drawables.vertexPositions[d];
    for (let k = 0; k < a.length; k++) maxRestDelta = Math.max(maxRestDelta, Math.abs(a[k] - b[k]) * before.canvasinfo.PixelsPerUnit);
  }
  report.push(`rest pose max change ${maxRestDelta.toFixed(3)}px`);
  if (maxRestDelta > 0.01) throw new Error(`${id}: rest pose changed by ${maxRestDelta}px, refusing to write`);

  // The cap must hold at EVERY value of the other parameters a mesh is keyed on (e.g. Breath):
  // this catches a wrong keyform-index convention for multi-binding meshes.
  const swingWorst = (model, pid, other) => {
    const p = Array.from(model.parameters.ids).indexOf(pid), o = Array.from(model.parameters.ids).indexOf(other);
    if (p < 0) return 0;
    const ppu = model.canvasinfo.PixelsPerUnit;
    const pose = (sv, ov) => { model.parameters.values.set(model.parameters.defaultValues); model.parameters.values[p] = sv; if (o >= 0) model.parameters.values[o] = ov; model.update(); return model.drawables.vertexPositions.map((a) => Float32Array.from(a)); };
    let worst = 0;
    for (const ov of o >= 0 ? [model.parameters.minimumValues[o], model.parameters.maximumValues[o]] : [0]) {
      const mid = pose(0, ov);
      for (const sv of [-1, 1]) {
        const cur = pose(sv, ov);
        cur.forEach((a, d) => { for (let k = 0; k < a.length; k += 2) worst = Math.max(worst, Math.hypot(a[k] - mid[d][k], a[k + 1] - mid[d][k + 1]) * ppu); });
      }
    }
    model.parameters.values.set(model.parameters.defaultValues);
    return worst;
  };
  for (const [pid, cap] of [["ParamHairSwing", cfg.hairMaxPx], ["ParamClothSwing", cfg.clothMaxPx]]) {
    if (!cap) continue;
    const w = swingWorst(after, pid, "ParamBreath");
    report.push(`${pid} verified: worst ${w.toFixed(2)}px at ±1 (cap ${cap}px)`);
    if (w > cap * 1.05) throw new Error(`${id}: ${pid} still moves ${w.toFixed(2)}px (> ${cap}px cap), refusing to write`);
  }

  // motions
  const motionsFixed = [];
  const outM3 = JSON.parse(JSON.stringify(m3));
  for (const list of Object.values(outM3.FileReferences.Motions ?? {})) {
    for (const entry of list) {
      const mj = JSON.parse(readFileSync(join(src, entry.File), "utf8"));
      const was = fitBodyAngle(mj);
      if (was) {
        motionsFixed.push(`${entry.File.replace(/^.*\//, "")} (${was.toFixed(1)}→10)`);
        if (!dry) writeFileSync(join(modelDir, entry.File), JSON.stringify(mj));
      }
    }
  }
  report.push(`motions: ${motionsFixed.length} BodyAngleX curve(s) fitted to ±10`);

  // cdi3 + model3
  const cdiName = `${stem}.cdi3.json`;
  outM3.FileReferences.DisplayInfo = cdiName;
  const cdi = buildCdi3(Array.from(after.parameters.ids), moc.sections["part.ids"].view);
  report.push(`${cdiName}: ${cdi.Parameters.length} parameters in ${cdi.ParameterGroups.length} groups`);

  if (!dry) {
    mkdirSync(modelDir, { recursive: true });
    writeFileSync(join(modelDir, mocName), moc.bytes());
    writeFileSync(join(modelDir, cdiName), JSON.stringify(cdi, null, 2) + "\n");
    writeFileSync(join(modelDir, m3Name), JSON.stringify(outM3, null, 2) + "\n");
    // Restore any untouched files from the backup (idempotent rebuild).
    for (const f of ["texture.png", `${stem}.physics3.json`]) if (existsSync(join(src, f))) copyFileSync(join(src, f), join(modelDir, f));
  }
  console.log(`\n${id}${dry ? " (dry run)" : ""}\n  ` + report.join("\n  "));
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = process.argv.slice(2);
  const dry = args.includes("--dry");
  const ids = args.filter((a) => !a.startsWith("--"));
  for (const id of ids.length ? ids : Object.keys(CONFIG)) await fixOne(id, { dry });
}
