import type { CharacterPack } from "../avatar/characters";
import { GESTURES, resolveGesture } from "../avatar/iki/gestures";

/** One `## Heading` section of a persona.md (first paragraph), or "" when absent. */
export function personaSection(md: string, heading: string): string {
  const m = md.match(new RegExp(`##\\s*${heading}\\s*\\n+([\\s\\S]*?)(\\n##|$)`, "i"));
  return (m?.[1] ?? "").trim().split(/\n\s*\n/)[0]?.replace(/\s+/g, " ").trim() ?? "";
}

/** "signature-study-photo" → "Study Photo", "think_chin" → "Think", "shy_look_away" → "Shy Look Away". */
export function moveLabel(name: string): string {
  const special: Record<string, string> = { think_chin: "Think", head_tilt: "Head Tilt", cross_arms: "Cross Arms", head_pat_react: "Head Pat", "signature-wave-shy": "Shy Wave" };
  if (special[name]) return special[name];
  return name
    .replace(/^signature-/, "")
    .split(/[-_]/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");
}

/** A stable hue (0–359) for a character, so its monogram and stage tint stay the same everywhere. */
export function characterHue(id: string): number {
  // Hand-picked hues for the built-in cast read better than a hash.
  const cast: Record<string, number> = {
    makima: 8, reze: 280, rize: 300, "cheng-xiaoshi": 215, "lu-guang": 195, hiyori: 340, haru: 30, mao: 260, rice: 45,
  };
  if (cast[id] !== undefined) return cast[id];
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}

/** "Rize Kamishiro" → "RK", "Makima" → "MA". */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/);
  return (words.length > 1 ? words[0][0] + words[words.length - 1][0] : name.slice(0, 2)).toUpperCase();
}

export const rendererLabel: Record<CharacterPack["renderer"], string> = { live2d: "Live2D", vrm: "VRM", iki: "Iki" };

const languageLabel: Record<string, string> = { en: "English", hi: "Hindi", hinglish: "Hinglish" };
export const languageName = (l?: string) => (l ? (languageLabel[l] ?? l) : "—");

/** Sidebar groups: ready-to-use built-ins, the user's imports, and empty slots waiting for a model. */
export function groupPacks(packs: CharacterPack[]) {
  return [
    { title: "Characters", items: packs.filter((p) => p.modelUrl && !p.imported) },
    { title: "Imported", items: packs.filter((p) => p.modelUrl && p.imported) },
    { title: "Needs a Model", items: packs.filter((p) => !p.modelUrl) },
  ].filter((g) => g.items.length);
}

/** A chip in the Studio's Moves strip: what to play (`id`, passed to playMotion) and what to call it. */
export interface Move {
  id: string;
  label: string;
  signature: boolean;
}

/** What the Studio reads from a character's model file to know which moves it can really perform. */
export interface ModelInfo {
  /** Iki: parameter id → range. */
  params?: Record<string, { min: number; max: number }>;
  /** Motion groups the model declares, one entry per motion (Live2D: its file; Iki: "<group>:<index>"). */
  motions?: Record<string, string[]>;
}

/** Id of a Live2D motion chip: plays that exact motion of the model (see CharacterPreview). */
export const motionId = (group: string, index: number) => `motion:${group}:${index}`;
export function parseMotionId(id: string): { group: string; index: number } | null {
  const m = id.match(/^motion:(.+):(\d+)$/);
  return m ? { group: m[1], index: Number(m[2]) } : null;
}

/** Everyday gestures an Iki character may offer after its signatures, in chip order. */
const IKI_EVERYDAY = ["wave", "nod", "head_tilt", "think_chin", "clap", "point", "cross_arms", "laugh"];
/** Offered only on rigs with their own variant: the generic straight-arm point and crossed forearms read as a
 *  twitch or a muddle on most rigs (Lu Guang has point-present and cross_arms-fold). */
const IKI_VARIANT_ONLY = new Set(["point", "cross_arms"]);

/** Iki: signatures, then the everyday gestures this rig performs (resolved per rig exactly as IkiAvatar does). */
function ikiMoves(pack: CharacterPack, model: ModelInfo): string[] {
  const params = model.params ?? {};
  const has = (id: string) => id in params;
  const signatures = (pack.signatureMotions ?? []).filter((s) => GESTURES[s] || pack.motionMap?.[s]);
  const everyday = IKI_EVERYDAY.filter((name) => {
    if (signatures.includes(name)) return false;
    // A tag mapped to one of the model's own motions (Nod, Tilt) plays that motion.
    const mapped = pack.motionMap?.[name];
    if (mapped && model.motions?.[mapped.group]?.length) return true;
    const resolved = resolveGesture(name, params.ParamArmR?.max ?? 0, params.ParamElbowR?.min ?? 0, params.ParamElbowR?.max ?? 0, has);
    const gesture = GESTURES[resolved];
    if (!gesture) return false;
    if (IKI_VARIANT_ONLY.has(name) && resolved === name) return false;
    // The rig must declare what the gesture moves: every arm joint it bends, and at least something it turns.
    const moved = Object.keys(gesture.pose(0.5));
    return moved.filter((id) => /^Param(Arm|Elbow)[LR]$/.test(id)).every(has) && moved.some(has);
  });
  return [...signatures, ...everyday];
}

/**
 * Names for the Live2D sample models' motions, from watching each one play (the files are only numbered).
 * Idle-group motions are offered only when named here or mapped to a gesture: most are near-identical idle loops.
 */
const LIVE2D_MOTION_LABELS: Record<string, Record<string, string>> = {
  hiyori: {
    "Hiyori_m04.motion3.json": "Surprised",
    "Hiyori_m06.motion3.json": "Cheer",
    "Hiyori_m09.motion3.json": "Giggle",
    "Hiyori_m03.motion3.json": "Happy Sway",
    "Hiyori_m01.motion3.json": "Shy",
  },
  haru: {
    "haru_g_m26.motion3.json": "Surprised",
    "haru_g_m06.motion3.json": "Giggle",
    "haru_g_m20.motion3.json": "Think",
    "haru_g_m09.motion3.json": "Nod",
  },
  mao: {
    "mtn_02.motion3.json": "Shrug",
    "mtn_03.motion3.json": "Sway",
    "mtn_04.motion3.json": "Tip Hat",
    "special_01.motion3.json": "Heart Magic",
    "special_02.motion3.json": "Sparkle Magic",
    "special_03.motion3.json": "Bunny Magic",
  },
  rice: {
    "mtn_01.motion3.json": "Cast Spell",
    "mtn_02.motion3.json": "Reach Out",
    "mtn_03.motion3.json": "Fire Magic",
  },
};

/** Motion-map keys that are triggers or loops, not names for what a motion looks like. */
const NOT_A_GESTURE = new Set(["idle", "tap", "tap_head", "tap_body"]);

/** Live2D: every motion the model really has (one chip per motion file), with a readable name. */
function live2dMoves(pack: CharacterPack, model: ModelInfo): Move[] {
  const named = LIVE2D_MOTION_LABELS[pack.id] ?? {};
  const out: Move[] = [];
  const idle: Move[] = [];
  const seen = new Set<string>();
  for (const [group, files] of Object.entries(model.motions ?? {})) {
    const isIdle = group.toLowerCase() === "idle";
    files.forEach((file, index) => {
      const base = file.split("/").pop() ?? file;
      // Else a gesture the character.json maps here ("laugh" → TapBody 3), else the group and its number.
      const alias = Object.entries(pack.motionMap ?? {})
        .find(([k, m]) => !NOT_A_GESTURE.has(k) && m.group === group && (m.index ?? 0) === index)?.[0];
      let label = named[base] ?? (alias ? moveLabel(alias) : undefined);
      if (isIdle && !label) return;
      label ??= `${moveLabel(group.replace(/([a-z])([A-Z])/g, "$1_$2"))}${files.length > 1 ? ` ${index + 1}` : ""}`;
      // Two motions with one name would look like a duplicate chip.
      if (seen.has(label)) label = `${label} ${index + 1}`;
      seen.add(label);
      (isIdle ? idle : out).push({ id: motionId(group, index), label, signature: false });
    });
  }
  return [...out, ...idle];
}

/** Moves the Studio offers to preview: only what this character's model can actually perform. */
export function previewMoves(pack: CharacterPack, model: ModelInfo | null): Move[] {
  if (!model) return [];
  if (pack.renderer === "live2d") return live2dMoves(pack, model);
  if (pack.renderer === "iki") {
    const sig = new Set(pack.signatureMotions ?? []);
    return ikiMoves(pack, model).map((id) => ({ id, label: moveLabel(id), signature: sig.has(id) }));
  }
  return [];
}

/** Reads what {@link previewMoves} needs from a model file's text (an .iki, or a Live2D .model3.json). */
export function parseModelInfo(renderer: CharacterPack["renderer"], text: string): ModelInfo {
  const json = JSON.parse(text) as Record<string, unknown>;
  if (renderer === "iki") {
    const params: NonNullable<ModelInfo["params"]> = {};
    for (const p of (json.parameters as { id: string; min: number; max: number }[] | undefined) ?? []) params[p.id] = { min: p.min, max: p.max };
    const motions: Record<string, string[]> = {};
    for (const [group, list] of Object.entries((json.motions as Record<string, unknown[]> | undefined) ?? {})) {
      motions[group] = list.map((_, i) => `${group}:${i}`);
    }
    return { params, motions };
  }
  const refs = (json.FileReferences as { Motions?: Record<string, { File: string }[]> } | undefined)?.Motions ?? {};
  return { motions: Object.fromEntries(Object.entries(refs).map(([g, list]) => [g, list.map((m) => m.File)])) };
}
