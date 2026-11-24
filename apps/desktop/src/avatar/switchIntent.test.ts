import { describe, expect, it } from "vitest";
import { matchSwitch } from "./switchIntent";

const packs = [
  { id: "mao", displayName: "Mao" },
  { id: "makima", displayName: "Makima" },
  { id: "rize", displayName: "Rize Kamishiro" },
  { id: "reze", displayName: "Reze" },
];
const hit = (t: string) => matchSwitch(t, packs)?.id ?? null;

describe("matchSwitch", () => {
  it("understands English and Hinglish switch requests", () => {
    expect(hit("switch to Mao")).toBe("mao");
    expect(hit("Change to makima character")).toBe("makima");
    expect(hit("talk to Rize")).toBe("rize");
    expect(hit("Rize Kamishiro se baat karni hai")).toBe("rize");
    expect(hit("reze ko bulao")).toBe("reze");
    expect(hit("/switch mao")).toBe("mao");
  });

  it("tolerates one typo in longer names (the user typed 'maxima')", () => {
    expect(hit("Change to maxima character")).toBe("makima");
  });

  it("does not trigger on ordinary chat", () => {
    expect(hit("aaj hum baat karne vale hai makima ki")).toBeNull();
    expect(hit("when will reze come")).toBeNull();
    expect(hit("change to dark mode")).toBeNull();
    expect(hit("mao")).toBeNull();
  });
});
