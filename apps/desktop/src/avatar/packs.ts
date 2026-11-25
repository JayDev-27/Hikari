import { invoke } from "@tauri-apps/api/core";
import type { CharacterJson, CharacterPack } from "./characters";

// Built-in packs, bundled at build time straight from the repo's characters/ folder
// (no copy step that can drift). Models themselves are fetched separately.
const builtinJson = import.meta.glob<CharacterJson>("../../../../characters/*/character.json", {
  eager: true,
  import: "default",
});
const builtinPersona = import.meta.glob<string>("../../../../characters/*/persona.md", {
  eager: true,
  query: "?raw",
  import: "default",
});

// Profile portraits (characters/<id>/avatar.webp), bundled as hashed assets; optional per pack.
const builtinAvatar = import.meta.glob<string>("../../../../characters/*/avatar.webp", {
  eager: true,
  query: "?url",
  import: "default",
});

const idFromPath = (p: string) => p.split("/").at(-2)!;
const avatarFor = (id: string) => Object.entries(builtinAvatar).find(([p]) => idFromPath(p) === id)?.[1];
const personaFor = (id: string) =>
  Object.entries(builtinPersona).find(([p]) => idFromPath(p) === id)?.[1] ?? "";

const inTauri = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/** Built-in model files are served by the app (dev: Vite public/, prod: bundled dist). */
function builtinUrl(id: string, rel: string): string {
  // Absolute URL: Pixi's resolver drops the host for root-relative paths under tauri://.
  const base = typeof location !== "undefined" ? location.href : "http://localhost/";
  return new URL(`/characters/${id}/${rel}`, base).href;
}

/** Imported packs: Rust's hikari-pack:// scheme (real slashes so relative texture paths resolve). */
export function userUrl(id: string, rel: string): string {
  return `hikari-pack://localhost/${id}/${rel.split("/").map(encodeURIComponent).join("/")}`;
}

export function builtinPacks(): CharacterPack[] {
  return Object.entries(builtinJson)
    .map(([path, json]) => {
      const id = idFromPath(path);
      return {
        ...json,
        id,
        source: "builtin" as const,
        modelUrl: json.modelPath ? builtinUrl(id, json.modelPath) : null,
        personaText: personaFor(id),
        avatarUrl: avatarFor(id),
      };
    })
    .sort(sortPacks);
}

export async function userPacks(): Promise<CharacterPack[]> {
  if (!inTauri()) return [];
  const list = await invoke<Array<{ id: string; pack: CharacterJson }>>("list_user_packs");
  return list.map(({ id, pack }) => ({
    ...pack,
    id,
    source: "user" as const,
    modelUrl: pack.modelPath ? userUrl(id, pack.modelPath) : null,
    // An import into a franchise/original slot keeps that character's persona.
    personaText: personaFor(id),
  }));
}

/** All packs; a user pack overrides the built-in with the same id (filled import slot). */
export async function listPacks(): Promise<CharacterPack[]> {
  const byId = new Map(builtinPacks().map((p) => [p.id, p]));
  for (const p of await userPacks().catch(() => [])) byId.set(p.id, p);
  return [...byId.values()].sort(sortPacks);
}

export async function getPack(id: string): Promise<CharacterPack | undefined> {
  return (await listPacks()).find((p) => p.id === id);
}

/** Originals with models first, then imported, then empty slots; alphabetical within. */
function sortPacks(a: CharacterPack, b: CharacterPack): number {
  const rank = (p: CharacterPack) => (p.modelUrl ? (p.imported ? 1 : 0) : 2);
  return rank(a) - rank(b) || a.displayName.localeCompare(b.displayName);
}

export interface ImportResult {
  id: string;
  renderer: "live2d" | "vrm" | "iki";
  model_path: string;
  license: CharacterJson["license"];
  warnings: string[];
}

/** Import a model file/folder; `slot` keeps that pack's persona (e.g. "reze"). */
export async function importModel(src: string, slot?: CharacterPack): Promise<ImportResult> {
  const base = slot
    ? {
        ...stripRuntime(slot),
        motionMap: undefined,
        expressionMap: undefined,
        hitAreas: undefined,
        gazeScale: undefined,
        poseRig: undefined,
        speech: undefined,
        signatureMotions: undefined,
        modelPath: null,
        importSlot: false,
      }
    : { persona: null, defaultLanguage: "hinglish" };
  return invoke<ImportResult>("import_model", { src, base, targetId: slot?.id ?? null });
}

export async function deleteUserPack(id: string): Promise<void> {
  await invoke("delete_user_pack", { id });
}

function stripRuntime(p: CharacterPack): CharacterJson {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { source, modelUrl, personaText, ...json } = p;
  return json;
}
