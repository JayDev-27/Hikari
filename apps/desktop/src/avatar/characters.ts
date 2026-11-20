import type { Emotion, Language } from "@hikari/protocol";

/** Runtime view of `characters/<id>/character.json` (see characters/README.md). */
export interface CharacterPack {
  id: string;
  displayName: string;
  renderer: "live2d" | "vrm";
  /** URL the webview can fetch (dev: /characters/<id>/…; imported packs: asset://…). */
  modelUrl: string;
  scale?: number;
  expressionMap?: Partial<Record<Emotion, string | number>>;
  motionMap?: Record<string, { group: string; index?: number }>;
  hitAreas?: Record<string, string>;
  persona?: string;
  voice?: { engine: string; voiceId?: string; clonePath?: string; rvcModel?: string };
  defaultLanguage?: Language;
  license: { source: string; terms: string; url: string; credit?: string };
}

interface CharacterJson extends Omit<CharacterPack, "modelUrl"> {
  modelPath: string | null;
}

export async function loadPack(id: string, base = "/characters"): Promise<CharacterPack> {
  const res = await fetch(`${base}/${id}/character.json`);
  // Vite's SPA fallback answers missing files with index.html (200 text/html).
  if (!res.ok || !res.headers.get("content-type")?.includes("json")) {
    throw new Error(`character pack '${id}' not found — run \`pnpm fetch:assets\``);
  }
  const json = (await res.json()) as CharacterJson;
  if (!json.modelPath) throw new Error(`'${json.displayName}' has no model yet — import your own model for this character`);
  return { ...json, modelUrl: `${base}/${id}/${json.modelPath}` };
}

export const DEFAULT_CHARACTER = "hiyori";
