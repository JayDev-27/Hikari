import type { CharacterPack } from "../avatar/characters";

/** One `## Heading` section of a persona.md (first paragraph), or "" when absent. */
export function personaSection(md: string, heading: string): string {
  const m = md.match(new RegExp(`##\\s*${heading}\\s*\\n+([\\s\\S]*?)(\\n##|$)`, "i"));
  return (m?.[1] ?? "").trim().split(/\n\s*\n/)[0]?.replace(/\s+/g, " ").trim() ?? "";
}

/** "signature-study-photo" → "Study Photo", "think_chin" → "Think", "shy_look_away" → "Shy Look Away". */
export function moveLabel(name: string): string {
  const special: Record<string, string> = { think_chin: "Think", head_tilt: "Head Tilt", cross_arms: "Cross Arms", head_pat_react: "Head Pat" };
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

/** Moves the Studio offers to preview: the character's signatures first, then a few everyday gestures. */
export function previewMoves(pack: CharacterPack): string[] {
  const everyday = ["wave", "nod", "think_chin", "clap", "laugh"];
  return [...(pack.signatureMotions ?? []), ...everyday.filter((m) => !pack.signatureMotions?.includes(m))];
}
