import { loadIkiModel } from "@ikijs/format";
import { describe, expect, it } from "vitest";
import { builtinPacks, userUrl } from "./packs";
import { personaSummary } from "../studio/Studio";
import { foldChat } from "../chat/Chat";

const SECTIONS = [
  "Identity",
  "Backstory",
  "Speech style",
  "Language style",
  "Addressing the user",
  "Likes and dislikes",
  "Emotional tendencies",
  "Gesture tendencies",
  "Boundaries",
  "Healthy companion",
];
const GESTURES = ["wave", "shrug", "facepalm", "laugh", "shy_look_away", "think_chin", "clap", "point", "pout", "cross_arms", "head_pat_react", "nod", "head_tilt", "bow"];

describe("built-in character packs", () => {
  const packs = builtinPacks();

  it("resolves all nine native characters (Live2D or Iki) and their replaceable slots", () => {
    expect(packs.map((p) => p.id).sort()).toEqual(["cheng-xiaoshi", "haru", "hiyori", "lu-guang", "makima", "mao", "reze", "rice", "rize"]);
    expect(packs.filter((p) => p.importSlot).map((p) => p.id).sort()).toEqual(["cheng-xiaoshi", "lu-guang", "makima", "reze", "rize"]);
    for (const p of packs) {
      expect(["live2d", "iki"]).toContain(p.renderer);
      expect(p.modelUrl).toMatch(p.renderer === "iki" ? /\.iki$/ : /\.model3\.json$/);
    }
  });

  interface Model {
    FileReferences: {
      Moc: string;
      Textures: string[];
      Physics: string;
      Motions: Record<string, { File: string }[]>;
      Expressions: { Name: string; File: string }[];
    };
  }
  const models = import.meta.glob<Model>("../../../../characters/*/model/*.model3.json", { eager: true, import: "default" });
  const files = import.meta.glob("../../../../characters/*/model/**/*", { query: "?url" });

  it.each(packs.filter((p) => p.importSlot && p.renderer === "live2d"))("$displayName has matching motion, physics, texture and expression files", (p) => {
    const root = `../../../../characters/${p.id}/`;
    const refs = models[root + p.modelPath].FileReferences;
    const asset = (name: string) => expect(files).toHaveProperty([root + "model/" + name]);
    [refs.Moc, refs.Physics, ...refs.Textures, ...refs.Expressions.map((e) => e.File)].forEach(asset);
    for (const motions of Object.values(refs.Motions)) motions.forEach((m) => asset(m.File));
    for (const tag of ["idle", "tap_head", "tap_body", ...GESTURES, ...(p.signatureMotions ?? []), ...(p.speech?.motions ?? []), ...Object.values(p.speech?.emotionMotions ?? {}).flat()]) {
      const motion = p.motionMap![tag];
      expect(refs.Motions[motion.group][motion.index ?? 0], tag).toBeDefined();
    }
    for (const name of Object.values(p.expressionMap!)) expect(refs.Expressions.map((e) => e.Name)).toContain(name);
  });

  const ikiModels = import.meta.glob<string>("../../../../characters/*/model/*.iki", { eager: true, query: "?raw", import: "default" });
  it.each(packs.filter((p) => p.renderer === "iki"))("$displayName's Iki model is valid and declares what the pack maps", (p) => {
    const raw = ikiModels[`../../../../characters/${p.id}/${p.modelPath}`];
    expect(raw, "model file").toBeDefined();
    const model = loadIkiModel(raw);
    const expressions = (model.expressions ?? []).map((e) => e.id);
    for (const [emotion, id] of Object.entries(p.expressionMap ?? {})) expect(expressions, emotion).toContain(id);
    for (const [tag, m] of Object.entries(p.motionMap ?? {})) expect(model.motions?.[m.group]?.[m.index ?? 0], tag).toBeDefined();
  });

  it("every pack has a matching id, licence and a persona with all sections in order", () => {
    for (const p of packs) {
      expect(p.id).toMatch(/^[a-z0-9-]+$/);
      expect(p.license.source.length).toBeGreaterThan(5);
      expect(p.license.terms.length).toBeGreaterThan(10);
      const headings = [...p.personaText.matchAll(/^##\s+(.+)$/gm)].map((m) => m[1].trim());
      expect(headings, `${p.id} persona sections`).toEqual(SECTIONS);
      expect(personaSummary(p.personaText).length, `${p.id} identity`).toBeGreaterThan(60);
    }
  });

  it("personas mention only real protocol gesture tags and stay adult + honest", () => {
    for (const p of packs) {
      const gestureLine = p.personaText.split("## Gesture tendencies")[1].split("##")[0];
      const used = gestureLine.match(/\b[a-z]+(?:_[a-z]+)+\b|\b(wave|shrug|facepalm|laugh|clap|point|pout|nod|bow)\b/g) ?? [];
      for (const g of used) expect(GESTURES, `${p.id} uses unknown gesture "${g}"`).toContain(g);
      expect(p.personaText, `${p.id} adult`).toMatch(/adult/i);
      expect(p.personaText, `${p.id} AI honesty`).toMatch(/\bAI\b/);
    }
  });

  it("built-in Live2D motion maps point at groups that exist in the samples", () => {
    // Groups present in the official sample models (checked against CubismWebSamples).
    const groups: Record<string, string[]> = { hiyori: ["Idle", "TapBody"], haru: ["Idle", "TapBody"], mao: ["Idle", "TapBody"], rice: ["Idle", "TapBody"] };
    for (const p of packs.filter((x) => x.id in groups)) {
      for (const [tag, m] of Object.entries(p.motionMap ?? {})) expect(groups[p.id], `${p.id}.${tag}`).toContain(m.group);
    }
  });
});

describe("pack URLs", () => {
  it("serves imported packs from hikari-pack:// with real slashes (engine-relative paths work)", () => {
    expect(userUrl("reze", "model/My Model/reze.model3.json")).toBe("hikari-pack://localhost/reze/model/My%20Model/reze.model3.json");
  });
});

describe("personaSummary", () => {
  it("takes the first paragraph of the Identity section", () => {
    expect(personaSummary("# X\n\n## Identity\nShe is kind.\nVery kind.\n\nSecond para.\n\n## Backstory\nNo.")).toBe("She is kind. Very kind.");
  });
});

describe("foldChat", () => {
  it("streams her tokens into one line per turn and closes it on tts.end", () => {
    let lines = foldChat([], { kind: "user", text: "hi", via: "text" });
    lines = foldChat(lines, { kind: "her", text: "Na", turnId: "t1", append: true });
    lines = foldChat(lines, { kind: "her", text: "maste!", turnId: "t1", append: true });
    lines = foldChat(lines, { kind: "end", text: "", turnId: "t1" });
    lines = foldChat(lines, { kind: "her", text: "Again", turnId: "t1", append: true }); // after end → new line
    expect(lines.map((l) => [l.kind, l.text])).toEqual([
      ["user", "hi"],
      ["her", "Namaste!"],
      ["her", "Again"],
    ]);
  });
});
