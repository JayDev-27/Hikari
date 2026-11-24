// Cubism conformance audit for a model folder: package (model3.json + files), moc3
// structure (opened with the real Cubism Core), motions, expressions, physics and the
// Hikari character.json. Calibrated against the official samples: anything flagged
// "error" is something the official Hiyori/Haru/Mao do not do.
//
//   node dev/model-audit/audit.mjs [--dir public/characters] [id …]   (exit 1 on errors)
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { coreAvailable, loadCore } from "./core.mjs";

/** Parameters every standard rig is expected to drive, with their conventional ranges. */
export const STANDARD_PARAMS = {
  ParamAngleX: { min: -30, max: 30, def: 0, required: true },
  ParamAngleY: { min: -30, max: 30, def: 0 },
  ParamAngleZ: { min: -30, max: 30, def: 0 },
  ParamEyeLOpen: { min: 0, max: 1, def: 1, required: true },
  ParamEyeROpen: { min: 0, max: 1, def: 1, required: true },
  ParamEyeBallX: { min: -1, max: 1, def: 0 },
  ParamEyeBallY: { min: -1, max: 1, def: 0 },
  // Lip sync is declared by the model's LipSync group (the official Mao drives ParamA), so these are recommended, not required.
  ParamMouthOpenY: { min: 0, max: 1, def: 0 },
  ParamMouthForm: { min: -1, max: 1, def: 0 },
  ParamBodyAngleX: { min: -10, max: 10, def: 0 },
  ParamBreath: { min: 0, max: 1, def: 0 },
  ParamBodyAngleY: { min: -10, max: 10, def: 0 },
  ParamBodyAngleZ: { min: -10, max: 10, def: 0 },
  ParamBrowLY: { min: -1, max: 1, def: 0 },
  ParamBrowRY: { min: -1, max: 1, def: 0 },
  ParamCheek: { min: 0, max: 1, def: 0 },
};

const FIN = (n) => Number.isFinite(n);
const near = (a, b, eps = 1e-3) => Math.abs(a - b) <= eps;

export async function auditModel(modelJsonPath) {
  const C = await loadCore();
  const out = { errors: [], warnings: [], info: [], stats: {} };
  const err = (code, msg) => out.errors.push({ code, msg });
  const warn = (code, msg) => out.warnings.push({ code, msg });
  const info = (code, msg) => out.info.push({ code, msg });

  const dir = dirname(modelJsonPath);
  const read = (rel) => JSON.parse(readFileSync(join(dir, rel), "utf8"));
  let m3;
  try {
    m3 = JSON.parse(readFileSync(modelJsonPath, "utf8"));
  } catch (e) {
    err("model3.json", `unreadable: ${e.message}`);
    return out;
  }
  const refs = m3.FileReferences ?? {};
  if (m3.Version !== 3) err("model3.version", `Version is ${m3.Version}, expected 3`);

  // ---- moc3 -------------------------------------------------------------------
  let model;
  if (!refs.Moc || !existsSync(join(dir, refs.Moc))) {
    err("moc.missing", `Moc file missing: ${refs.Moc}`);
    return out;
  }
  const mocBuf = readFileSync(join(dir, refs.Moc));
  const ab = mocBuf.buffer.slice(mocBuf.byteOffset, mocBuf.byteOffset + mocBuf.length);
  if (C.Moc.prototype.hasMocConsistency === undefined && !C.Moc.hasMocConsistency) {
    /* API shape differs by Core version; fall through to load attempt */
  }
  try {
    model = C.Model.fromMoc(C.Moc.fromArrayBuffer(ab));
  } catch (e) {
    err("moc.load", `Core could not load the moc3: ${e.message}`);
    return out;
  }
  const P = model.parameters, D = model.drawables, Pt = model.parts;
  const pid = Array.from(P.ids), did = Array.from(D.ids), partIds = Array.from(Pt.ids);
  const ci = model.canvasinfo;
  out.stats = {
    parameters: P.count, parts: Pt.count, drawables: D.count,
    canvas: `${ci.CanvasWidth}x${ci.CanvasHeight}`, ppu: ci.PixelsPerUnit,
    motions: 0, expressions: (refs.Expressions ?? []).length,
  };

  // Textures
  const textures = refs.Textures ?? [];
  const texSizes = [];
  if (!textures.length) err("textures.none", "model3.json lists no textures");
  for (const t of textures) {
    const p = join(dir, t);
    if (!existsSync(p)) {
      err("textures.missing", `texture missing: ${t}`);
      continue;
    }
    const b = readFileSync(p);
    if (b.readUInt32BE(0) !== 0x89504e47) err("textures.format", `${t} is not a PNG`);
    else {
      const w = b.readUInt32BE(16), h = b.readUInt32BE(20);
      texSizes.push([w, h]);
      if (w > 4096 || h > 4096) err("textures.size", `${t} is ${w}x${h}; Cubism limit is 4096`);
    }
  }
  out.stats.textureSizes = texSizes.map((s) => s.join("x")).join(", ");

  // Parameters
  for (const [id, std] of Object.entries(STANDARD_PARAMS)) {
    const i = pid.indexOf(id);
    if (i < 0) {
      (std.required ? err : warn)(std.required ? "param.missing" : "param.recommended", `${std.required ? "missing" : "no"} standard parameter ${id}`);
      continue;
    }
    const mn = P.minimumValues[i], mx = P.maximumValues[i], df = P.defaultValues[i];
    if (!near(mn, std.min) || !near(mx, std.max)) warn("param.range", `${id} range ${mn}…${mx} (standard ${std.min}…${std.max})`);
    if (!near(df, std.def)) warn("param.default", `${id} default ${df} (standard ${std.def})`);
  }
  // Parameters that only feed physics (e.g. Wind) have no keyforms but are not dead.
  const physicsInputs = new Set();
  if (refs.Physics && existsSync(join(dir, refs.Physics))) {
    try {
      for (const st of read(refs.Physics).PhysicsSettings ?? []) for (const inp of st.Input ?? []) physicsInputs.add(inp.Source?.Id);
    } catch {
      /* reported below */
    }
  }
  const dead = [];
  for (let i = 0; i < P.count; i++) {
    if (P.maximumValues[i] <= P.minimumValues[i]) err("param.range", `${pid[i]} has an empty range ${P.minimumValues[i]}…${P.maximumValues[i]}`);
    const d = P.defaultValues[i];
    if (d < P.minimumValues[i] || d > P.maximumValues[i]) err("param.default", `${pid[i]} default ${d} outside ${P.minimumValues[i]}…${P.maximumValues[i]}`);
    if (P.keyCounts[i] < 2 && !physicsInputs.has(pid[i])) dead.push(pid[i]);
  }
  if (dead.length) warn("param.dead", `${dead.length} parameter(s) have no keyforms and drive nothing: ${dead.join(", ")}`);
  if (new Set(pid).size !== pid.length) err("param.duplicate", "duplicate parameter ids");

  // Drawables
  const texCount = textures.length;
  let badUv = 0;
  for (let i = 0; i < D.count; i++) {
    if (D.vertexCounts[i] < 3) err("drawable.vertices", `${did[i]} has ${D.vertexCounts[i]} vertices`);
    if (D.textureIndices[i] >= texCount) err("drawable.texture", `${did[i]} uses texture ${D.textureIndices[i]} but only ${texCount} are listed`);
    for (const v of D.vertexUvs[i]) if (v < -0.001 || v > 1.001) { badUv++; break; }
    const masks = D.masks[i];
    for (const mi of masks) if (mi < 0 || mi >= D.count) err("drawable.mask", `${did[i]} masked by invalid drawable ${mi}`);
    if (!FIN(D.opacities[i])) err("drawable.opacity", `${did[i]} opacity is not finite`);
    for (const v of D.vertexPositions[i]) if (!FIN(v)) { err("drawable.vertices", `${did[i]} has non-finite vertex positions`); break; }
  }
  if (badUv) warn("drawable.uv", `${badUv} drawable(s) sample outside the texture (UV outside 0…1)`);
  if (new Set(did).size !== did.length) err("drawable.duplicate", "duplicate drawable ids");
  if (Pt.count < 3) warn("parts.few", `only ${Pt.count} part(s): official rigs group art into parts (Head, Body, Arms, Hair …) so the Cubism Editor and runtimes can fade and reorder them`);
  if (D.count < 30) warn("drawables.few", `only ${D.count} drawables (official samples use 84–262): eyes, brows, mouth, hair and clothes are usually separate meshes`);

  // Canvas convention
  if (!near(ci.PixelsPerUnit, ci.CanvasWidth, 1) && !near(ci.PixelsPerUnit, ci.CanvasHeight, 1)) warn("canvas.ppu", `PixelsPerUnit ${ci.PixelsPerUnit} is neither canvas width nor height`);
  else if (!near(ci.PixelsPerUnit, ci.CanvasWidth, 1)) warn("canvas.ppu", `PixelsPerUnit ${ci.PixelsPerUnit} equals canvas HEIGHT; official models use the canvas WIDTH (${ci.CanvasWidth})`);

  // ---- model3 groups, hit areas ---------------------------------------------------
  const groups = m3.Groups ?? [];
  for (const need of [["EyeBlink", ["ParamEyeLOpen", "ParamEyeROpen"]], ["LipSync", ["ParamMouthOpenY"]]]) {
    const g = groups.find((x) => x.Name === need[0] && x.Target === "Parameter");
    if (!g) warn("group.missing", `no ${need[0]} group in model3.json`);
    else for (const id of g.Ids ?? []) if (!pid.includes(id)) err("group.id", `${need[0]} group references unknown parameter ${id}`);
  }
  const hits = m3.HitAreas ?? [];
  if (!hits.length) warn("hit.none", "no HitAreas");
  for (const h of hits) if (!did.includes(h.Id)) err("hit.id", `HitArea "${h.Name}" references drawable id "${h.Id}", which does not exist (HitArea.Id must be an ArtMesh id)`);

  // Optional files
  for (const key of ["Physics", "Pose", "DisplayInfo", "UserData"]) {
    if (!refs[key]) {
      (key === "Physics" ? warn : info)(`file.${key}`, `no ${key} file`);
    } else if (!existsSync(join(dir, refs[key]))) err(`file.${key}`, `${key} file missing: ${refs[key]}`);
  }
  if (refs.DisplayInfo && existsSync(join(dir, refs.DisplayInfo))) {
    try {
      const cdi = read(refs.DisplayInfo);
      const named = new Set((cdi.Parameters ?? []).map((x) => x.Id));
      const unnamed = pid.filter((x) => !named.has(x));
      if (unnamed.length) warn("cdi.params", `${unnamed.length} parameter(s) missing from ${refs.DisplayInfo}`);
      for (const x of cdi.Parameters ?? []) if (!pid.includes(x.Id)) err("cdi.unknown", `${refs.DisplayInfo} names unknown parameter ${x.Id}`);
    } catch (e) {
      err("cdi.parse", `${refs.DisplayInfo}: ${e.message}`);
    }
  }

  // ---- motions ----------------------------------------------------------------------
  const paramRange = (id) => { const i = pid.indexOf(id); return i < 0 ? null : [P.minimumValues[i], P.maximumValues[i], P.defaultValues[i]]; };
  const motionGroups = refs.Motions ?? {};
  if (!motionGroups.Idle?.length) warn("motion.idle", "no Idle motion group");
  for (const [group, list] of Object.entries(motionGroups)) {
    list.forEach((entry, idx) => {
      out.stats.motions++;
      const label = `${group}[${idx}] ${entry.File}`;
      if (!existsSync(join(dir, entry.File ?? ""))) return err("motion.missing", `${label}: file missing`);
      let mj;
      try { mj = read(entry.File); } catch (e) { return err("motion.parse", `${label}: ${e.message}`); }
      for (const f of auditMotion(mj, { paramRange, partIds, label, isIdle: group === "Idle" })) (f.level === "error" ? err : f.level === "info" ? info : warn)(f.code, f.msg);
      if (entry.FadeInTime === undefined || entry.FadeOutTime === undefined) info("motion.fade", `${label}: no FadeInTime/FadeOutTime (the official samples declare them)`);
    });
  }

  // ---- expressions ----------------------------------------------------------------------
  const seen = new Set();
  for (const e of refs.Expressions ?? []) {
    if (seen.has(e.Name)) err("expr.name", `duplicate expression name ${e.Name}`);
    seen.add(e.Name);
    if (!existsSync(join(dir, e.File ?? ""))) { err("expr.missing", `${e.Name}: file missing`); continue; }
    let ej;
    try { ej = read(e.File); } catch (x) { err("expr.parse", `${e.Name}: ${x.message}`); continue; }
    if (ej.Type !== "Live2D Expression") err("expr.type", `${e.Name}: Type is "${ej.Type}"`);
    for (const p of ej.Parameters ?? []) {
      const r = paramRange(p.Id);
      if (!r) { err("expr.param", `${e.Name}: unknown parameter ${p.Id}`); continue; }
      if (!["Add", "Multiply", "Overwrite"].includes(p.Blend)) err("expr.blend", `${e.Name}/${p.Id}: Blend "${p.Blend}"`);
      const eff = p.Blend === "Add" ? r[2] + p.Value : p.Blend === "Multiply" ? r[2] * p.Value : p.Value;
      if (eff < r[0] - 1e-3 || eff > r[1] + 1e-3) warn("expr.range", `${e.Name}/${p.Id}: resulting value ${eff.toFixed(2)} outside ${r[0]}…${r[1]}`);
    }
  }

  // ---- physics ----------------------------------------------------------------------
  if (refs.Physics && existsSync(join(dir, refs.Physics))) {
    try {
      for (const f of auditPhysics(read(refs.Physics), pid, paramRange)) (f.level === "error" ? err : warn)(f.code, f.msg);
    } catch (e) {
      err("physics.parse", e.message);
    }
  }
  return out;
}

/** Validate a motion3.json (Meta counts, curve targets, ranges, loop closure). */
export function auditMotion(mj, { paramRange, partIds, label, isIdle }) {
  const f = [];
  const e = (code, msg) => f.push({ level: "error", code, msg: `${label}: ${msg}` });
  const w = (code, msg) => f.push({ level: "warn", code, msg: `${label}: ${msg}` });
  if (mj.Version !== 3) e("motion.version", `Version ${mj.Version}`);
  const meta = mj.Meta ?? {};
  const curves = mj.Curves ?? [];
  let segs = 0, pts = 0, maxT = 0;
  const rangeIssues = [], loopIssues = [];
  curves.forEach((c, ci) => {
    const s = c.Segments ?? [];
    const cl = `curve ${ci} ${c.Id}`;
    if (s.length < 2 || s.some((v) => !FIN(v))) return e("motion.segments", `${cl}: malformed Segments`);
    pts += 1;
    // Segments: t0, v0, then per segment: type, then 1 point (linear / stepped / inverse
    // stepped) or 3 points (bezier), each point being (time, value).
    const vals = [s[1]];
    let i = 2, prevT = s[0], ok = true;
    while (i < s.length) {
      const type = s[i];
      const n = type === 1 ? 3 : type === 0 || type === 2 || type === 3 ? 1 : -1;
      if (n < 0 || i + 2 * n >= s.length + 0) { if (n < 0 || i + 2 * n > s.length - 1) { e("motion.segments", `${cl}: bad segment type ${type} at index ${i}`); ok = false; break; } }
      for (let k = 0; k < n; k++) vals.push(s[i + 2 + 2 * k]);
      const t = s[i + 2 * n - 1];
      if (t < prevT - 1e-6) e("motion.time", `${cl}: time goes backwards (${prevT} → ${t})`);
      prevT = t; maxT = Math.max(maxT, t);
      pts += n; segs += 1; i += 1 + 2 * n;
    }
    if (!ok) return;
    if (c.Target === "Parameter") {
      const r = paramRange(c.Id);
      if (!r) return e("motion.param", `${cl}: unknown parameter`);
      const lo = Math.min(...vals), hi = Math.max(...vals), span = r[1] - r[0];
      if (lo < r[0] - 0.05 * span || hi > r[1] + 0.05 * span) rangeIssues.push(`${c.Id} ${lo.toFixed(2)}…${hi.toFixed(2)} (range ${r[0]}…${r[1]})`);
      if (isIdle && meta.Loop && Math.abs(vals[0] - vals[vals.length - 1]) > 0.02 * span) loopIssues.push(`${c.Id} ${vals[0].toFixed(2)}→${vals[vals.length - 1].toFixed(2)}`);
    } else if (c.Target === "PartOpacity") {
      if (!partIds.includes(c.Id)) w("motion.part", `${cl}: part does not exist (ignored at runtime)`);
    } else if (c.Target !== "Model") e("motion.target", `${cl}: unknown Target ${c.Target}`);
    if (c.Target === "Model" && !["Opacity", "EyeBlink", "LipSync"].includes(c.Id)) w("motion.model", `${cl}: unknown Model curve`);
  });
  if (rangeIssues.length) w("motion.range", `${rangeIssues.length} curve(s) leave their parameter range, e.g. ${rangeIssues.slice(0, 3).join("; ")}`);
  // Official idles (Hiyori) don't close their loops either; the runtime crossfades. Informational only.
  if (loopIssues.length) f.push({ level: "info", code: "motion.loop", msg: `${label}: ${loopIssues.length} curve(s) end away from where they start (${loopIssues.slice(0, 3).join("; ")})` });
  if (meta.CurveCount !== curves.length) e("motion.meta", `Meta.CurveCount ${meta.CurveCount} but ${curves.length} curves`);
  if (meta.TotalSegmentCount !== segs) e("motion.meta", `Meta.TotalSegmentCount ${meta.TotalSegmentCount} but ${segs} segments`);
  if (meta.TotalPointCount !== pts) e("motion.meta", `Meta.TotalPointCount ${meta.TotalPointCount} but ${pts} points`);
  if (!near(meta.Duration ?? 0, maxT, 0.05)) w("motion.duration", `Meta.Duration ${meta.Duration} but curves end at ${maxT.toFixed(2)}s`);
  if (!(meta.Fps > 0)) w("motion.fps", `Meta.Fps ${meta.Fps}`);
  if (isIdle && !meta.Loop) w("motion.loop", "idle motion does not loop");
  return f;
}

/** Validate a physics3.json against the model's parameters. */
export function auditPhysics(pj, pid, paramRange) {
  const f = [];
  const e = (code, msg) => f.push({ level: "error", code, msg });
  const w = (code, msg) => f.push({ level: "warn", code, msg });
  if (pj.Version !== 3) e("physics.version", `Version ${pj.Version}`);
  const settings = pj.PhysicsSettings ?? [];
  const meta = pj.Meta ?? {};
  let inputs = 0, outputs = 0, verts = 0;
  settings.forEach((s, i) => {
    const sl = `setting ${i} (${s.Id ?? "?"})`;
    inputs += (s.Input ?? []).length; outputs += (s.Output ?? []).length; verts += (s.Vertices ?? []).length;
    for (const inp of s.Input ?? []) if (!pid.includes(inp.Source?.Id)) e("physics.input", `${sl}: input parameter ${inp.Source?.Id} does not exist`);
    for (const o of s.Output ?? []) if (!pid.includes(o.Destination?.Id)) e("physics.output", `${sl}: output parameter ${o.Destination?.Id} does not exist`);
    if ((s.Vertices ?? []).length < 2) e("physics.vertices", `${sl}: needs at least 2 vertices`);
    for (const o of s.Output ?? []) if (o.VertexIndex >= (s.Vertices ?? []).length) e("physics.vertexIndex", `${sl}: output VertexIndex ${o.VertexIndex} out of range`);
    const norm = s.Normalization ?? {};
    for (const k of ["Position", "Angle"]) if (norm[k] && norm[k].Minimum >= norm[k].Maximum) e("physics.norm", `${sl}: ${k} normalization range is empty`);
    for (const v of s.Vertices ?? []) if (!(v.Mobility > 0 && v.Mobility <= 1) || !(v.Delay > 0) || !(v.Acceleration > 0)) w("physics.vertex", `${sl}: vertex mobility/delay/acceleration out of the usual (0,1] / >0 range`);
  });
  if (meta.PhysicsSettingCount !== settings.length) e("physics.meta", `Meta.PhysicsSettingCount ${meta.PhysicsSettingCount} but ${settings.length} settings`);
  if (meta.TotalInputCount !== inputs) e("physics.meta", `Meta.TotalInputCount ${meta.TotalInputCount} but ${inputs}`);
  if (meta.TotalOutputCount !== outputs) e("physics.meta", `Meta.TotalOutputCount ${meta.TotalOutputCount} but ${outputs}`);
  if (meta.VertexCount !== verts) e("physics.meta", `Meta.VertexCount ${meta.VertexCount} but ${verts}`);
  return f;
}

/** Audit the Hikari character.json against the model it points at. */
export function auditPack(packDir, modelAudit) {
  const f = [];
  const e = (code, msg) => f.push({ level: "error", code, msg });
  const w = (code, msg) => f.push({ level: "warn", code, msg });
  const pj = JSON.parse(readFileSync(join(packDir, "character.json"), "utf8"));
  const m3 = JSON.parse(readFileSync(join(packDir, pj.modelPath), "utf8"));
  const groups = m3.FileReferences?.Motions ?? {};
  for (const [tag, m] of Object.entries(pj.motionMap ?? {})) {
    const list = groups[m.group];
    if (!list) e("pack.motion", `motionMap.${tag} → group "${m.group}" does not exist`);
    else if ((m.index ?? 0) >= list.length) e("pack.motion", `motionMap.${tag} → ${m.group}[${m.index}] out of range (${list.length})`);
  }
  const exprNames = new Set((m3.FileReferences?.Expressions ?? []).map((x) => x.Name));
  for (const [emo, name] of Object.entries(pj.expressionMap ?? {})) {
    if (typeof name === "string" && !exprNames.has(name)) e("pack.expression", `expressionMap.${emo} → "${name}" does not exist`);
  }
  if (exprNames.size) {
    for (const emo of ["neutral", "joy", "fun", "angry", "sorrow", "surprised", "shy", "teasing", "thinking", "sleepy"]) {
      if (!(pj.expressionMap ?? {})[emo]) w("pack.expressionMap", `no expression mapped for emotion "${emo}"`);
    }
  }
  for (const [name, area] of Object.entries(pj.hitAreas ?? {})) {
    if (!(m3.HitAreas ?? []).some((h) => h.Name === name)) w("pack.hitAreas", `hitAreas.${name} (${area}) is not a HitArea in model3.json`);
  }
  return f;
}

// ---------------------------------------------------------------- CLI
const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  // Cubism Core is licensed and git-ignored (pnpm fetch:assets --sdk …): CI has none, so skip rather than fail.
  if (!coreAvailable()) {
    console.log("audit:models skipped — Cubism Core not installed (pnpm -F desktop fetch:assets --sdk <CubismSdkForWeb.zip>)");
    process.exit(0);
  }
  const here = dirname(fileURLToPath(import.meta.url));
  const argv = process.argv.slice(2);
  const di = argv.indexOf("--dir");
  const root = di >= 0 ? resolve(argv.splice(di, 2)[1]) : join(here, "../../public/characters");
  const verbose = argv.includes("-v") && argv.splice(argv.indexOf("-v"), 1);
  const only = argv;
  let errors = 0;
  for (const id of readdirSync(root).sort()) {
    if (only.length && !only.includes(id)) continue;
    const packDir = join(root, id);
    if (!statSync(packDir).isDirectory() || !existsSync(join(packDir, "character.json"))) continue;
    const pj = JSON.parse(readFileSync(join(packDir, "character.json"), "utf8"));
    if (!pj.modelPath || !existsSync(join(packDir, pj.modelPath))) { console.log(`${id}: no model, skipped`); continue; }
    if (!pj.modelPath.endsWith(".model3.json")) { console.log(`${id}: ${pj.renderer ?? "non-Live2D"} model, skipped (Cubism audit only)`); continue; }
    const r = await auditModel(join(packDir, pj.modelPath));
    for (const x of auditPack(packDir, r)) (x.level === "error" ? r.errors : r.warnings).push({ code: x.code, msg: x.msg });
    errors += r.errors.length;
    const s = r.stats;
    console.log(`\n${id}  params ${s.parameters} · parts ${s.parts} · drawables ${s.drawables} · canvas ${s.canvas} · motions ${s.motions} · expressions ${s.expressions} · textures ${s.textureSizes}`);
    console.log(`  ${r.errors.length} error(s), ${r.warnings.length} warning(s)`);
    for (const x of r.errors) console.log(`  ✗ [${x.code}] ${x.msg}`);
    for (const x of r.warnings) console.log(`  ! [${x.code}] ${x.msg}`);
    if (verbose) for (const x of r.info) console.log(`  · [${x.code}] ${x.msg}`);
  }
  process.exit(errors ? 1 : 0);
}
