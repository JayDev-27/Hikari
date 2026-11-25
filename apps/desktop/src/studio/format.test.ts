import { describe, expect, it } from "vitest";
import type { CharacterPack } from "../avatar/characters";
import type { CharacterJson } from "../avatar/characters";
import { characterHue, groupPacks, initials, languageName, moveLabel, parseModelInfo, parseMotionId, personaSection, previewMoves, type ModelInfo } from "./format";

const pack = (over: Partial<CharacterPack>): CharacterPack => ({
  id: "x", displayName: "X", renderer: "iki", modelPath: "m.iki", source: "builtin", modelUrl: "/m.iki", personaText: "",
  license: { source: "", terms: "", url: "" }, ...over,
});

describe("Character Studio formatting", () => {
  it("names moves the way a person would read them", () => {
    expect(moveLabel("signature-study-photo")).toBe("Study Photo");
    expect(moveLabel("signature-photo-dive")).toBe("Photo Dive");
    expect(moveLabel("think_chin")).toBe("Think");
    expect(moveLabel("shy_look_away")).toBe("Shy Look Away");
    expect(moveLabel("wave")).toBe("Wave");
    expect(moveLabel("signature-wave-shy")).toBe("Shy Wave");
  });

  it("reads one persona section", () => {
    const md = "# Lu\n\n## Identity\nA photographer.\n\nMore.\n\n## Speech style\nShort and\nprecise.\n\n## Likes\nTea.";
    expect(personaSection(md, "Speech style")).toBe("Short and precise.");
    expect(personaSection(md, "Identity")).toBe("A photographer.");
    expect(personaSection(md, "Missing")).toBe("");
  });

  it("gives each character a stable tint and monogram", () => {
    expect(characterHue("lu-guang")).toBe(characterHue("lu-guang"));
    expect(characterHue("lu-guang")).not.toBe(characterHue("makima"));
    expect(characterHue("someone-new")).toBeGreaterThanOrEqual(0);
    expect(characterHue("someone-new")).toBeLessThan(360);
    expect(initials("Rize Kamishiro")).toBe("RK");
    expect(initials("Makima")).toBe("MA");
    expect(languageName("hinglish")).toBe("Hinglish");
    expect(languageName(undefined)).toBe("—");
  });

  it("groups the sidebar into ready, imported and empty slots, dropping empty groups", () => {
    const g = groupPacks([pack({ id: "a" }), pack({ id: "b", imported: true }), pack({ id: "c", modelUrl: null })]);
    expect(g.map((x) => [x.title, x.items.map((p) => p.id)])).toEqual([["Characters", ["a"]], ["Imported", ["b"]], ["Needs a Model", ["c"]]]);
    expect(groupPacks([pack({ id: "a" })]).map((x) => x.title)).toEqual(["Characters"]);
  });

  it("offers nothing until the model has been read", () => {
    expect(previewMoves(pack({ signatureMotions: ["signature-book"] }), null)).toEqual([]);
  });
});

// The real cast: character.json and, for Iki, the committed .iki rig.
const characterJson = import.meta.glob<CharacterJson>("../../../../characters/*/character.json", { eager: true, import: "default" });
const ikiModels = import.meta.glob<string>("../../../../characters/*/model/*.iki", { eager: true, query: "?raw", import: "default" });
const cast = (id: string) => pack({ ...characterJson[`../../../../characters/${id}/character.json`], modelUrl: "/m" });
const ids = (id: string, model: ModelInfo) => previewMoves(cast(id), model).map((m) => m.id);
const labels = (id: string, model: ModelInfo) => previewMoves(cast(id), model).map((m) => m.label);
const iki = (id: string) => {
  const p = cast(id);
  return parseModelInfo("iki", ikiModels[`../../../../characters/${id}/${p.modelPath}`]);
};
// Motion lists of the Live2D sample models (their model3.json files are fetched, not committed).
const live2d = (motions: Record<string, string[]>): ModelInfo => ({ motions: Object.fromEntries(Object.entries(motions).map(([g, f]) => [g, f.map((x) => `motions/${x}.motion3.json`)])) });
const HIYORI = live2d({ Idle: ["Hiyori_m01", "Hiyori_m02", "Hiyori_m03", "Hiyori_m05", "Hiyori_m06", "Hiyori_m07", "Hiyori_m08", "Hiyori_m09", "Hiyori_m10"], TapBody: ["Hiyori_m04"] });
const HARU = live2d({ Idle: ["haru_g_idle", "haru_g_m15"], TapBody: ["haru_g_m26", "haru_g_m06", "haru_g_m20", "haru_g_m09"] });
const MAO = live2d({ Idle: ["mtn_01", "sample_01"], TapBody: ["mtn_02", "mtn_03", "mtn_04", "special_01", "special_02", "special_03"] });
const RICE = live2d({ Idle: ["idle"], TapBody: ["mtn_01", "mtn_02", "mtn_03"] });

describe("Moves each character can really perform", () => {
  it("Iki: signatures first (marked), then the everyday gestures that rig resolves", () => {
    const moves = previewMoves(cast("makima"), iki("makima"));
    expect(moves.filter((m) => m.signature).map((m) => m.id)).toEqual(["signature-clasp", "signature-smile", "signature-bang"]);
    expect(ids("makima", iki("makima"))).toEqual(["signature-clasp", "signature-smile", "signature-bang", "wave", "nod", "head_tilt", "think_chin", "laugh"]);
    expect(labels("makima", iki("makima"))).toEqual(["Clasp", "Smile", "Bang", "Wave", "Nod", "Head Tilt", "Think", "Laugh"]);
    for (const id of ["reze", "rize"]) expect(ids(id, iki(id)).slice(3)).toEqual(["wave", "nod", "head_tilt", "think_chin", "laugh"]);
    // Cheng's elbows fold inward for his palm-to-palm clap.
    expect(ids("cheng-xiaoshi", iki("cheng-xiaoshi")).slice(3)).toEqual(["wave", "nod", "head_tilt", "think_chin", "clap", "laugh"]);
  });

  it("Iki: point, crossed arms, clap and think only where the rig has its own variant", () => {
    expect(ids("lu-guang", iki("lu-guang"))).toEqual([
      "signature-study-photo", "signature-folded-nod", "signature-quiet-thought",
      "wave", "nod", "head_tilt", "think_chin", "clap", "point", "cross_arms", "laugh",
    ]);
    for (const move of ["point", "cross_arms", "clap"]) expect(ids("makima", iki("makima"))).not.toContain(move);
  });

  it("Iki: nod and head tilt need the model's own motion, gestures need the parameters they move", () => {
    const bare: ModelInfo = { params: { ParamAngleX: { min: -30, max: 30 }, ParamAngleY: { min: -30, max: 30 }, ParamAngleZ: { min: -30, max: 30 } }, motions: {} };
    expect(ids("makima", bare)).toEqual(["signature-clasp", "signature-smile", "signature-bang", "laugh"]);
  });

  it("Live2D: one chip per motion the model has, named for what it does, never a generic gesture", () => {
    expect(labels("hiyori", HIYORI)).toEqual(["Surprised", "Shy", "Happy Sway", "Cheer", "Giggle"]);
    expect(labels("haru", HARU)).toEqual(["Surprised", "Giggle", "Think", "Nod"]);
    expect(labels("mao", MAO)).toEqual(["Shrug", "Sway", "Tip Hat", "Heart Magic", "Sparkle Magic", "Bunny Magic"]);
    expect(labels("rice", RICE)).toEqual(["Cast Spell", "Reach Out", "Fire Magic"]);
    expect(ids("haru", HARU).map(parseMotionId)).toEqual([0, 1, 2, 3].map((index) => ({ group: "TapBody", index })));
    expect(previewMoves(cast("mao"), MAO).some((m) => m.signature)).toBe(false);
  });

  it("Live2D: an unknown model falls back to its motion-map names, then group and number, skipping idle loops", () => {
    const imported = pack({ id: "someone", renderer: "live2d", motionMap: { tap: { group: "Tap", index: 0 }, wave: { group: "Tap", index: 1 } } });
    const model = live2d({ Idle: ["a", "b"], Tap: ["c", "d", "e"], FlickHead: ["f"] });
    expect(previewMoves(imported, model).map((m) => m.label)).toEqual(["Tap 1", "Wave", "Tap 3", "Flick Head"]);
  });

  it("reads a Live2D model3.json", () => {
    const info = parseModelInfo("live2d", JSON.stringify({ FileReferences: { Motions: { TapBody: [{ File: "m/a.motion3.json" }] } } }));
    expect(info.motions).toEqual({ TapBody: ["m/a.motion3.json"] });
  });
});
