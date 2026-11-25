import { describe, expect, it } from "vitest";
import type { CharacterPack } from "../avatar/characters";
import { characterHue, groupPacks, initials, languageName, moveLabel, personaSection, previewMoves } from "./format";

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

  it("offers a character's signatures first, then everyday gestures without repeats", () => {
    expect(previewMoves(pack({ signatureMotions: ["signature-book", "wave"] }))).toEqual(["signature-book", "wave", "nod", "think_chin", "clap", "laugh"]);
  });
});
