import { describe, expect, it } from "vitest";
import type { Phoneme } from "@hikari/protocol";
import { LipSyncEngine, visemesToLive2D } from "./engine";
import { cleanPhoneme, markLanguages, resolvePhoneme } from "./phonemeMap";

/** Evenly timed phonemes: [symbol, ms] pairs from t = 0. */
function seq(...items: [string, number][]): Phoneme[] {
  let t = 0;
  return items.map(([p, ms]) => {
    const ph = { p, start: t, end: t + ms };
    t += ms;
    return ph;
  });
}

/** Mouth opening at the middle of phoneme `i`, steady state. */
function openAt(phs: Phoneme[], i: number, language?: string, frac = 0.5): number {
  const e = new LipSyncEngine();
  e.addChunk(0, phs, language);
  const t = (phs[i].start + (phs[i].end - phs[i].start) * frac) / 1000;
  let v = e.sample(t, 1 / 60);
  for (let k = 0; k < 40; k++) v = e.sample(t, 1 / 60);
  return visemesToLive2D(v).open;
}

describe("Hindi phonemes", () => {
  it("keeps m/b/p fully closed, including aspirated, breathy and geminate bilabials", () => {
    // भारत bʱaːɾət̪ — the breathy b closes the lips first
    const bharat = seq(["sil", 80], ["bʱ", 110], ["aː", 160], ["ɾ", 50], ["ə", 80], ["t̪", 90], ["sil", 80]);
    expect(openAt(bharat, 1, "hi", 0.3)).toBeLessThan(0.06);
    expect(openAt(bharat, 2, "hi")).toBeGreaterThan(0.5);
    // फूल pʰuːl
    const phool = seq(["sil", 80], ["pʰ", 110], ["uː", 170], ["l", 80], ["sil", 80]);
    expect(openAt(phool, 1, "hi", 0.3)).toBeLessThan(0.06);
    // तुम्हारा t̪ʊmʱaːɾaː — murmured m
    const tumhara = seq(["t̪", 70], ["ʊ", 70], ["mʱ", 100], ["aː", 150], ["ɾ", 45], ["aː", 160]);
    expect(openAt(tumhara, 2, "hi", 0.3)).toBeLessThan(0.06);
    // अब्बा əbːaː (geminate b, length mark) and a short 36 ms m in fast speech (मैं में …)
    const abba = seq(["ə", 90], ["bː", 140], ["aː", 160]);
    expect(openAt(abba, 1, "hi")).toBeLessThan(0.06);
    const fast = seq(["aː", 120], ["m", 36], ["eː", 120]);
    expect(openAt(fast, 1, "hi")).toBeLessThan(0.08);
  });

  it("aspirated stops release with a puff; breathy-voiced ones open wider than plain ones", () => {
    // धान d̪ʱaːn vs थान t̪ʰaːn: the murmured release opens wider than the voiceless puff, and both open past the stop
    const aspirated = seq(["sil", 80], ["t̪ʰ", 120], ["sil", 160]);
    const breathy = seq(["sil", 80], ["d̪ʱ", 120], ["sil", 160]);
    expect(openAt(breathy, 1, "hi", 0.8)).toBeGreaterThan(openAt(aspirated, 1, "hi", 0.8));
    expect(openAt(aspirated, 1, "hi", 0.85)).toBeGreaterThan(openAt(aspirated, 1, "hi", 0.3));
    expect(resolvePhoneme("ɖʱ").breathy).toBe(true);
    expect(resolvePhoneme("ʈʰ").breathy).toBe(false);
    expect(resolvePhoneme("ʈʰ").aspirated).toBe(true);
  });

  it("retroflex stops sit a little more open than dentals, the flap yields to its vowels", () => {
    const dental = resolvePhoneme("t̪").target, retro = resolvePhoneme("ʈ").target;
    expect((retro.v.aa ?? 0) + (retro.v.oh ?? 0)).toBeGreaterThan(dental.v.aa ?? 0);
    expect(resolvePhoneme("ɽ").target.dominance).toBeLessThan(retro.dominance);
    // गाड़ी gaːɽiː: the mouth stays open through the flap
    const gaadi = seq(["g", 70], ["aː", 150], ["ɽ", 40], ["iː", 150]);
    expect(openAt(gaadi, 2, "hi")).toBeGreaterThan(0.3);
    expect(resolvePhoneme("ɭ").target.v.aa).toBeGreaterThan(0);
  });

  it("nasal vowels keep their shape with a little less jaw; anusvara tokens never close the lips", () => {
    for (const [nasal, oral] of [["ã", "a"], ["ẽː", "eː"], ["ɛ̃", "ɛ"], ["ũ", "u"], ["ə̃", "ə"]]) {
      const n = resolvePhoneme(nasal, "hi"), o = resolvePhoneme(oral, "hi");
      expect(n.nasal, nasal).toBe(true);
      const sum = (x: typeof n) => Object.values(x.target.v).reduce((s, v) => s + (v ?? 0), 0);
      expect(sum(n), nasal).toBeLessThan(sum(o));
      expect(sum(n), nasal).toBeGreaterThan(sum(o) * 0.7);
    }
    for (const a of ["ⁿ", "ṃ", "ṁ"]) expect(resolvePhoneme(a).target.closed, a).toBeFalsy();
    // हैं hɛ̃: open, not a bilabial seal
    expect(openAt(seq(["ɦ", 60], ["ɛ̃", 180], ["sil", 80]), 1, "hi")).toBeGreaterThan(0.35);
  });

  it("Hindi schwa is a full vowel, English schwa a reduced one", () => {
    const hi = resolvePhoneme("ə", "hi").target.v.aa!, en = resolvePhoneme("ə", "en").target.v.aa!;
    expect(hi).toBeGreaterThan(0.5);
    expect(en).toBeLessThan(0.35);
    // कल kəl vs "the" ðə: same symbol, different mouth
    expect(openAt(seq(["k", 70], ["ə", 90], ["l", 70], ["sil", 80]), 1, "hi")).toBeGreaterThan(openAt(seq(["ð", 70], ["ə", 90], ["sil", 80]), 1, "en") + 0.1);
  });

  it("strips stress marks and tie bars before lookup", () => {
    expect(cleanPhoneme("ˈaː")).toEqual({ raw: "aː".normalize("NFD"), stressed: true });
    expect(resolvePhoneme("t͡ʃ").target).toBe(resolvePhoneme("tʃ").target);
    expect(resolvePhoneme("d͡ʒʱ").aspirated).toBe(true);
    expect(resolvePhoneme("ˈm").target.closed).toBe(true);
  });
});

describe("Hinglish code-switching", () => {
  it("marks English words inside a Hindi sentence by their English phones", () => {
    // "aaj meeting hai" → aːdʒ | m iː t ɪ ŋ | ɦ ɛː   (an English word with English vowels between Hindi ones)
    const phs = ["aː", "dʒ", "sp", "ð", "ə", "sp", "k", "ə", "l", "sp", "ɹ", "ɪ", "p", "ɔ", "ɹ", "t", "sp", "ʈ", "ʰ", "iː", "k", "ɦ", "ɛː"];
    const langs = markLanguages(phs, "hinglish");
    expect(langs[4]).toBe("en"); // "the" schwa
    expect(langs[7]).toBe("hi"); // "kal" schwa (no English evidence: Hinglish defaults to Hindi)
    expect(langs[12]).toBe("en"); // "report"
    expect(langs[17]).toBe("hi"); // "ʈʰiːk"
  });

  it("follows the chunk language when nothing nearby decides", () => {
    expect(markLanguages(["k", "ə", "l"], "en")).toEqual(["en", "en", "en"]);
    expect(markLanguages(["k", "ə", "l"], "hi")).toEqual(["hi", "hi", "hi"]);
  });

  it("a mixed sentence keeps every bilabial closed in both languages", () => {
    // "mujhe ye plan pasand hai" — m, p (English "plan"), p, and the Hindi words around them
    const phs = seq(["m", 70], ["ʊ", 60], ["dʒʱ", 90], ["eː", 110], ["sp", 60], ["p", 80], ["l", 60], ["æ", 140], ["n", 70],
      ["sp", 60], ["p", 80], ["ə", 70], ["s", 90], ["ə", 70], ["n", 60], ["d̪", 70], ["ɦ", 60], ["ɛː", 150]);
    for (const i of [0, 5, 10]) expect(openAt(phs, i, "hinglish"), phs[i].p).toBeLessThan(0.06);
    // and the vowels open
    expect(openAt(phs, 7, "hinglish")).toBeGreaterThan(0.45);
    expect(openAt(phs, 17, "hinglish")).toBeGreaterThan(0.45);
  });
});
