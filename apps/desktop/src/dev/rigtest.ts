/**
 * Rig test (dev only): renders a model through the real Cubism runtime with NO app
 * patches (no pose rig, no idle, no physics), i.e. what any standard Cubism viewer
 * would show, and writes contact sheets via the sink server (dev/model-audit/sink.mjs).
 *
 *   http://localhost:1420/#/rigtest?id=reze&mode=params
 *     mode=params       every parameter at min / default / max, cropped to what changed
 *     mode=expressions  every expression applied on the default pose
 *     mode=motions      every motion sampled at 5 moments
 *     mode=pose         the default pose only (checks the rest state)

 *     mode=holes        see-through gaps inside the figure at rest (transparent pixels enclosed by opaque ones)
 *     mode=custom       set=ParamEyeLOpen:0,ParamHairSwing:1  hide=hair1,Head  crop=x,y,w,h (canvas px)  zoom=8
 *                       `hide` zeroes those meshes' opacity (find which mesh draws a pixel); one row per set= group, ';'-separated
 *   other options: H=1800 (render height, px), rows=8 (rows per sheet), sink=18777
 */
import { Application, extensions, loadTextures } from "pixi.js";
import { Live2DModel, Live2DPlugin } from "untitled-pixi-live2d-engine/cubism";
import { patchCubismCore } from "../avatar/live2d/coreCompat";
import { installPoseRig, type DrawableModel } from "../avatar/live2d/poseRig";
import { getPack } from "../avatar/packs";

interface RawModel {
  parameters: { ids: string[]; minimumValues: Float32Array; maximumValues: Float32Array; defaultValues: Float32Array; count: number };
  parts: { ids: string[] };
  drawables: { ids: string[] };
}
interface CoreWrapper {
  getModel(): RawModel;
  setParameterValueByIndex(i: number, v: number, w?: number): void;
}
type Pose = { label: string; values: Float32Array };

const q = new URLSearchParams(location.hash.split("?")[1] ?? "");
const log = (s: string) => {
  const el = document.getElementById("rigtest-log");
  if (el) el.textContent += s + "\n";
  console.warn(`RIGTEST ${s}`);
};

async function post(name: string, body: Blob | string) {
  const port = q.get("sink") ?? "18777";
  await fetch(`http://127.0.0.1:${port}/${encodeURIComponent(name)}`, { method: "POST", body });
}

export async function mount() {
  document.body.style.cssText = "margin:0;background:#fff;color:#111;font:12px monospace";
  document.getElementById("root")!.innerHTML = '<pre id="rigtest-log" style="padding:8px"></pre>';
  // ids=reze,makima,… runs them one after another (each in a fresh Pixi app).
  for (const id of (q.get("ids") ?? q.get("id") ?? "reze").split(",")) {
    try {
      await run(id);
    } catch (e) {
      log(`FAILED ${id}: ${e instanceof Error ? e.stack : String(e)}`);
    }
  }
  log("DONE");
}

async function run(id: string) {
  const mode = q.get("mode") ?? "params";
  const H = Number(q.get("H") ?? 1800);
  const rowsPerSheet = Number(q.get("rows") ?? 8);
  const pack = await getPack(id);
  if (!pack?.modelUrl) throw new Error(`no model for ${id}`);
  // orig=1 renders the pre-fix rig from public/characters/<id>-orig/ (copy of source/original-model) for before/after.
  const modelUrl = q.get("orig") ? pack.modelUrl.replace(`/characters/${id}/`, `/characters/${id}-orig/`) : pack.modelUrl;

  if (!(window as unknown as { __rigPlugin?: boolean }).__rigPlugin) {
    extensions.add(Live2DPlugin);
    (window as unknown as { __rigPlugin?: boolean }).__rigPlugin = true;
  }
  if (loadTextures.config) loadTextures.config.preferWorkers = false;
  if (!("Live2DCubismCore" in window)) throw new Error("Cubism Core is not loaded");
  patchCubismCore();

  const model = await Live2DModel.from(modelUrl, { autoHitTest: false, autoFocus: false, autoUpdate: false });
  const im = model.internalModel as unknown as {
    coreModel: CoreWrapper;
    originalWidth: number;
    originalHeight: number;
    on(ev: string, cb: () => void): void;
    motionManager: { settings: { motions?: Record<string, Array<{ File: string }>>; expressions?: Array<{ Name: string; File: string }> } };
  };
  const core = im.coreModel;
  const raw = core.getModel();
  const n = raw.parameters.count;
  const ids = Array.from(raw.parameters.ids);
  const mins = raw.parameters.minimumValues, maxs = raw.parameters.maximumValues, defs = raw.parameters.defaultValues;

  const W = Math.round((H * im.originalWidth) / im.originalHeight);
  const app = new Application();
  await app.init({ width: W, height: H, backgroundAlpha: 0, antialias: true, resolution: 1, autoStart: false, preference: "webgl" });
  app.stage.addChild(model);
  model.scale.set(H / im.originalHeight);
  model.position.set(0, 0);

  const hidden = new Set((q.get("hide") ?? "").split(",").filter(Boolean));
  if (hidden.size) {
    const dids = Array.from(raw.drawables.ids);
    const base = (core as unknown as { getDrawableOpacity(i: number): number }).getDrawableOpacity.bind(core);
    (core as unknown as { getDrawableOpacity(i: number): number }).getDrawableOpacity = (i) => (hidden.has(dids[i]) ? 0 : base(i));
  }
  if (q.get("poserig") && pack.poseRig) {
    // poserig=1 adds the app's runtime pose rig (hand/arm vertex patching) on top, as the stage does (no grip prop).
    im.on("beforeModelUpdate", installPoseRig(core as unknown as DrawableModel, pack.poseRig, -1));
  }
  let current: Float32Array = Float32Array.from(defs);
  im.on("beforeModelUpdate", () => {
    for (let i = 0; i < n; i++) core.setParameterValueByIndex(i, current[i]);
  });

  async function render(values: Float32Array): Promise<ImageData> {
    current = values;
    model.update(16);
    app.renderer.render(app.stage);
    const c = app.renderer.extract.canvas(app.stage) as HTMLCanvasElement;
    return c.getContext("2d")!.getImageData(0, 0, c.width, c.height);
  }
  const rest = await render(Float32Array.from(defs));
  log(`${id}: ${n} params, ${raw.parts.ids.length} parts, ${raw.drawables.ids.length} drawables, canvas ${im.originalWidth}x${im.originalHeight}, render ${W}x${H}`);

  if (mode === "holes") {
    const holes = findHoles(rest);
    log(`${id}: ${holes.length} enclosed transparent region(s) at rest` + holes.map((h) => ` [${h.n}px @canvas ${Math.round((h.x0 * im.originalHeight) / H)},${Math.round((h.y0 * im.originalHeight) / H)}→${Math.round((h.x1 * im.originalHeight) / H)},${Math.round((h.y1 * im.originalHeight) / H)}]`).join(""));
    await post(`${id}-holes.json`, JSON.stringify({ id, scale: im.originalHeight / H, holes }, null, 1));
    // Highlight: figure over a backdrop, hole pixels in magenta (upper body, where arms meet torso).
    const k = H / im.originalHeight;
    const y0 = Math.round(120 * k), hh = Math.round(640 * k);
    const hl = document.createElement("canvas");
    hl.width = rest.width;
    hl.height = hh;
    const g = hl.getContext("2d")!;
    g.fillStyle = "#c9d3e0";
    g.fillRect(0, 0, hl.width, hh);
    const full = document.createElement("canvas");
    full.width = rest.width;
    full.height = rest.height;
    full.getContext("2d")!.putImageData(rest, 0, 0);
    g.drawImage(full, 0, y0, rest.width, hh, 0, 0, rest.width, hh);
    g.fillStyle = "rgba(255,0,255,0.9)";
    for (const h of holes) g.fillRect(h.x0, h.y0 - y0, h.x1 - h.x0 + 1, h.y1 - h.y0 + 1);
    await post(`${id}-holes.png`, await new Promise<Blob>((res) => hl.toBlob((b) => res(b!), "image/png")));
    app.destroy(true, { children: true });
    return;
  }

  if (mode === "handarea") {
    // Silhouette area of each poseRig hand drawable alone, sampled through every clip:
    // a rigid hand keeps ~1.0× its rest area; dips are squeezing, rises are stretching.
    const dids = Array.from(raw.drawables.ids);
    const hands = (pack.poseRig?.hands ?? []).map((h) => h.drawable).filter((d) => dids.includes(d));
    const op = core as unknown as { getDrawableOpacity(i: number): number };
    const base0 = op.getDrawableOpacity.bind(core);
    let only = "";
    op.getDrawableOpacity = (i) => (dids[i] === only ? base0(i) : 0);
    const area = (im2: ImageData) => {
      let c = 0;
      for (let j = 3; j < im2.data.length; j += 4) if (im2.data[j] > 128) c++;
      return c;
    };
    const restArea: Record<string, number> = {};
    for (const h of hands) {
      only = h;
      restArea[h] = area(await render(Float32Array.from(defs)));
    }
    const N = Number(q.get("n") ?? 36);
    const report: Record<string, Record<string, { min: number; max: number; series: number[] }>> = {};
    for (const [group, list] of Object.entries(im.motionManager.settings.motions ?? {})) {
      for (let k = 0; k < list.length; k++) {
        const mj = (await (await fetch(new URL(list[k].File, modelUrl).href)).json()) as MotionJson;
        const key = `${group}[${k}] ${list[k].File.replace(/^.*\//, "").replace(".motion3.json", "")}`;
        report[key] = {};
        for (const h of hands) {
          only = h;
          let lo = Infinity, hi = 0;
          const series: number[] = [];
          for (let s = 0; s <= N; s++) {
            const a = Float32Array.from(defs);
            for (const c of mj.Curves) {
              if (c.Target !== "Parameter") continue;
              const i = ids.indexOf(c.Id);
              if (i >= 0) a[i] = Math.max(mins[i], Math.min(maxs[i], evalCurve(c.Segments, (s / N) * mj.Meta.Duration)));
            }
            const r = area(await render(a)) / (restArea[h] || 1);
            lo = Math.min(lo, r);
            hi = Math.max(hi, r);
            series.push(Math.round(r * 100) / 100);
          }
          report[key][h] = { min: Math.round(lo * 100) / 100, max: Math.round(hi * 100) / 100, series };
        }
      }
    }
    await post(`${id}-handarea${q.get("poserig") ? "-pose" : "-bare"}.json`, JSON.stringify({ id, restArea, report }, null, 1));
    log(`${id}: hand area sampled`);
    app.destroy(true, { children: true });
    return;
  }

  // ---- poses -------------------------------------------------------------------
  const poses: Pose[] = [];
  const base = () => Float32Array.from(defs);
  if (mode === "params") {
    for (let i = 0; i < n; i++) {
      for (const [tag, v] of [["min", mins[i]], ["max", maxs[i]]] as const) {
        const a = base();
        a[i] = v;
        poses.push({ label: `${ids[i]} ${tag}=${v.toFixed(2)}`, values: a });
      }
    }
  } else if (mode === "custom" && q.get("motion")) {
    // motion=TapBody:3 t=0.25,0.5 → those frames of that clip (use with crop/zoom to inspect hands)
    const [group, idx] = q.get("motion")!.split(":");
    const file = im.motionManager.settings.motions?.[group]?.[Number(idx)]?.File;
    if (!file) throw new Error(`no motion ${q.get("motion")}`);
    const mj = (await (await fetch(new URL(file, modelUrl).href)).json()) as MotionJson;
    for (const f of (q.get("t") ?? "0.25,0.5,0.75").split(",").map(Number)) {
      const a = base();
      for (const c of mj.Curves) {
        if (c.Target !== "Parameter") continue;
        const i = ids.indexOf(c.Id);
        if (i >= 0) a[i] = Math.max(mins[i], Math.min(maxs[i], evalCurve(c.Segments, f * mj.Meta.Duration)));
      }
      poses.push({ label: `${group}:${idx} @${Math.round(f * 100)}%`, values: a });
    }
  } else if (mode === "custom") {
    for (const grp of (q.get("set") ?? "").split(";")) {
      const a = base();
      for (const kv of grp.split(",").filter(Boolean)) {
        const [pid, val] = kv.split(":");
        const i = ids.indexOf(pid);
        if (i < 0) throw new Error(`unknown parameter ${pid}`);
        a[i] = Number(val);
      }
      poses.push({ label: grp || "default", values: a });
    }
  } else if (mode === "expressions") {
    const list = im.motionManager.settings.expressions ?? [];
    for (const e of list) {
      const ej = (await (await fetch(new URL(e.File, modelUrl).href)).json()) as { Parameters?: Array<{ Id: string; Value: number; Blend: string }> };
      const a = base();
      for (const p of ej.Parameters ?? []) {
        const i = ids.indexOf(p.Id);
        if (i < 0) continue;
        a[i] = p.Blend === "Add" ? a[i] + p.Value : p.Blend === "Multiply" ? a[i] * p.Value : p.Value;
      }
      poses.push({ label: `expression ${e.Name}`, values: a });
    }
  } else if (mode === "motions") {
    for (const [group, list] of Object.entries(im.motionManager.settings.motions ?? {})) {
      for (let k = 0; k < list.length; k++) {
        const mj = (await (await fetch(new URL(list[k].File, modelUrl).href)).json()) as MotionJson;
        const dur = mj.Meta.Duration;
        for (const f of [0, 0.25, 0.5, 0.75, 1]) {
          const a = base();
          for (const c of mj.Curves) {
            if (c.Target !== "Parameter") continue;
            const i = ids.indexOf(c.Id);
            if (i >= 0) a[i] = Math.max(mins[i], Math.min(maxs[i], evalCurve(c.Segments, f * dur)));
          }
          poses.push({ label: `${group}[${k}] ${list[k].File.replace(/^.*\//, "").replace(".motion3.json", "")} @${Math.round(f * 100)}%`, values: a });
        }
      }
    }
  }

  if (mode === "custom") {
    const [cx, cy, cw, chh] = (q.get("crop") ?? `0,0,${im.originalWidth},${im.originalHeight}`).split(",").map(Number);
    const k = H / im.originalHeight;
    const zoom = Number(q.get("zoom") ?? 1);
    const crops: HTMLCanvasElement[] = [];
    for (const p of poses) {
      const img = await render(p.values);
      const c = cropCanvas(img, cx * k, cy * k, cw * k, chh * k);
      crops.push(c);
    }
    if (q.get("raw")) {
      // raw=1: the first crop alone, as rendered (transparent background), for use as reference art.
      await post(`${id}-raw-${q.get("name") ?? "x"}.png`, await new Promise<Blob>((res) => crops[0].toBlob((b) => res(b!), "image/png")));
      app.destroy(true, { children: true });
      return;
    }
    const blob = await sheet([{ label: `${id} custom${hidden.size ? ` hide=${[...hidden].join("|")}` : ""}`, crops, note: poses.map((p) => p.label).join("  |  ") }], Math.round(chh * k * zoom * 0.5) || 400);
    await post(`${id}-custom-${q.get("name") ?? "x"}.png`, blob);
    log("custom sheet saved");
    app.destroy(true, { children: true });
    return;
  }

  // ---- diff + sheets -----------------------------------------------------------------
  const summary: Array<Record<string, unknown>> = [];
  const rows: Array<{ label: string; crops: HTMLCanvasElement[]; note: string }> = [];
  const groupSize = mode === "params" ? 2 : mode === "motions" ? 5 : 1;
  for (let g = 0; g < poses.length; g += groupSize) {
    const grp = poses.slice(g, g + groupSize);
    const imgs: ImageData[] = [];
    for (const p of grp) imgs.push(await render(p.values));
    const diffs = imgs.map((im2) => diff(rest, im2));
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const d of diffs) if (d.count > 0) { x0 = Math.min(x0, d.x0); y0 = Math.min(y0, d.y0); x1 = Math.max(x1, d.x1); y1 = Math.max(y1, d.y1); }
    const label = mode === "params" ? grp[0].label.split(" ")[0] : grp[0].label.replace(/ @\d+%$/, "");
    const changed = diffs.some((d) => d.count > 0);
    const nameTag = grp.map((p) => p.label.split(" ").slice(mode === "params" ? 1 : -1).join(" ")).join(" | ");
    summary.push({ label, changedPixels: diffs.map((d) => d.count), bbox: changed ? [x0, y0, x1, y1] : null });
    const pad = 24;
    const bx = changed ? Math.max(0, x0 - pad) : 0, by = changed ? Math.max(0, y0 - pad) : 0;
    const bw = changed ? Math.min(W, x1 + pad) - bx : W, bh = changed ? Math.min(H, y1 + pad) - by : H;
    // params: min | default | max, left to right; other modes: the poses themselves
    const shown = mode === "params" ? [imgs[0], rest, imgs[1]] : imgs;
    const crops = shown.map((im2) => cropCanvas(im2, bx, by, bw, bh));
    rows.push({ label, crops, note: changed ? nameTag : `${nameTag}  (NO VISIBLE CHANGE)` });
  }
  if (mode === "pose") rows.push({ label: "rest", crops: [cropCanvas(rest, 0, 0, W, H)], note: "" });

  await post(`${id}-${mode}-summary.json`, JSON.stringify({ id, mode, params: ids.length, summary }, null, 1));
  let sheetNo = 0;
  for (let r = 0; r < rows.length; r += rowsPerSheet) {
    const blob = await sheet(rows.slice(r, r + rowsPerSheet), mode === "pose" ? 900 : 360);
    await post(`${id}-${mode}-${String(++sheetNo).padStart(2, "0")}.png`, blob);
  }
  log(`${sheetNo} sheet(s), ${summary.length} entries`);
  const dead = summary.filter((s) => !s.bbox).map((s) => String(s.label));
  log(`no visible change: ${dead.length ? dead.join(", ") : "none"}`);
  app.destroy(true, { children: true });
}

// ---- helpers ---------------------------------------------------------------------------
/** Transparent regions not connected to the image border: holes through the figure. */
function findHoles(img: ImageData, alphaMax = 40, minPixels = 12) {
  const { width: w, height: h, data } = img;
  const seen = new Uint8Array(w * h);
  const transparent = (i: number) => data[i * 4 + 3] <= alphaMax;
  const stack: number[] = [];
  const flood = (start: number, collect?: { n: number; x0: number; y0: number; x1: number; y1: number }) => {
    stack.push(start);
    seen[start] = 1;
    while (stack.length) {
      const i = stack.pop()!;
      const x = i % w, y = (i / w) | 0;
      if (collect) { collect.n++; collect.x0 = Math.min(collect.x0, x); collect.x1 = Math.max(collect.x1, x); collect.y0 = Math.min(collect.y0, y); collect.y1 = Math.max(collect.y1, y); }
      for (const j of [i - 1, i + 1, i - w, i + w]) {
        if (j < 0 || j >= w * h || seen[j] || !transparent(j)) continue;
        if ((j === i - 1 && x === 0) || (j === i + 1 && x === w - 1)) continue;
        seen[j] = 1;
        stack.push(j);
      }
    }
  };
  for (let x = 0; x < w; x++) for (const y of [0, h - 1]) if (!seen[y * w + x] && transparent(y * w + x)) flood(y * w + x);
  for (let y = 0; y < h; y++) for (const x of [0, w - 1]) if (!seen[y * w + x] && transparent(y * w + x)) flood(y * w + x);
  const holes: Array<{ n: number; x0: number; y0: number; x1: number; y1: number }> = [];
  for (let i = 0; i < w * h; i++) {
    if (seen[i] || !transparent(i)) continue;
    const c = { n: 0, x0: w, y0: h, x1: 0, y1: 0 };
    flood(i, c);
    if (c.n >= minPixels) holes.push(c);
  }
  return holes.sort((a, b) => b.n - a.n);
}

function diff(a: ImageData, b: ImageData) {
  let count = 0, x0 = a.width, y0 = a.height, x1 = -1, y1 = -1;
  const w = a.width;
  for (let i = 0; i < a.data.length; i += 4) {
    const d = Math.abs(a.data[i] - b.data[i]) + Math.abs(a.data[i + 1] - b.data[i + 1]) + Math.abs(a.data[i + 2] - b.data[i + 2]) + Math.abs(a.data[i + 3] - b.data[i + 3]);
    if (d > 40) {
      count++;
      const p = i / 4, x = p % w, y = (p / w) | 0;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  return { count, x0, y0, x1, y1 };
}

function cropCanvas(src: ImageData, x: number, y: number, w: number, h: number): HTMLCanvasElement {
  const full = document.createElement("canvas");
  full.width = src.width;
  full.height = src.height;
  full.getContext("2d")!.putImageData(src, 0, 0);
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  const g = c.getContext("2d")!;
  g.fillStyle = "#c9d3e0"; // contrasting backdrop: white seams and holes show
  g.fillRect(0, 0, c.width, c.height);
  g.drawImage(full, x, y, w, h, 0, 0, c.width, c.height);
  return c;
}

async function sheet(rows: Array<{ label: string; crops: HTMLCanvasElement[]; note: string }>, cellH: number): Promise<Blob> {
  const cellMaxW = cellH * 0.9;
  const cols = Math.max(...rows.map((r) => r.crops.length));
  const labelH = 22, pad = 8;
  const sized = rows.map((r) => r.crops.map((c) => {
    const s = Math.min(cellH / c.height, cellMaxW / c.width);
    return { c, w: Math.round(c.width * s), h: Math.round(c.height * s) };
  }));
  const colW = Array.from({ length: cols }, (_, k) => Math.max(...sized.map((r) => r[k]?.w ?? 0)));
  const W = colW.reduce((a, b) => a + b + pad, pad);
  const H = rows.length * (cellH + labelH + pad) + pad;
  const cv = document.createElement("canvas");
  cv.width = W;
  cv.height = H;
  const g = cv.getContext("2d")!;
  g.fillStyle = "#fff";
  g.fillRect(0, 0, W, H);
  g.font = "bold 14px monospace";
  rows.forEach((r, ri) => {
    const y = pad + ri * (cellH + labelH + pad);
    g.fillStyle = "#000";
    g.fillText(`${r.label}   ${r.note}`, pad, y + 14);
    let x = pad;
    sized[ri].forEach((s, k) => {
      g.drawImage(s.c, x, y + labelH, s.w, s.h);
      g.strokeStyle = "#e33";
      g.strokeRect(x, y + labelH, s.w, s.h);
      x += colW[k] + pad;
    });
  });
  return new Promise((res) => cv.toBlob((b) => res(b!), "image/png"));
}

interface MotionJson {
  Meta: { Duration: number };
  Curves: Array<{ Target: string; Id: string; Segments: number[] }>;
}

/** Evaluate a motion3 curve at time t (bezier uses the parametric form the runtimes use). */
export function evalCurve(s: number[], t: number): number {
  if (t <= s[0]) return s[1];
  let i = 2, p0t = s[0], p0v = s[1];
  while (i < s.length) {
    const type = s[i];
    if (type === 1) {
      const [v1, v2, t3, v3] = [s[i + 2], s[i + 4], s[i + 5], s[i + 6]];
      if (t <= t3) {
        const u = (t - p0t) / (t3 - p0t || 1);
        const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
        const pv = lerp(lerp(lerp(p0v, v1, u), lerp(v1, v2, u), u), lerp(lerp(v1, v2, u), lerp(v2, v3, u), u), u);
        return pv;
      }
      p0t = t3; p0v = v3; i += 7;
    } else {
      const t1 = s[i + 1], v1 = s[i + 2];
      if (t <= t1) return type === 0 ? p0v + ((v1 - p0v) * (t - p0t)) / (t1 - p0t || 1) : type === 2 ? p0v : v1;
      p0t = t1; p0v = v1; i += 3;
    }
  }
  return p0v;
}
