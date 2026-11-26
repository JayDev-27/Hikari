import type { Phoneme } from "@hikari/protocol";

/**
 * Test phrases for the tuner's lip-sync check: IPA as the TTS/aligner sends it (espeak style), with plausible
 * durations, so the visemes can be judged without a voice. "|" separates words (a short pause).
 */
export const PHRASES: { id: string; label: string; language: "hi" | "en" | "hinglish"; ipa: string }[] = [
  { id: "hi-bharat", label: "मुझे भारत बहुत पसंद है", language: "hi", ipa: "m ʊ dʒʱ eː | bʱ aː ɾ ə t̪ | b ə ɦ ʊ t̪ | p ə s ə n d̪ | ɦ ɛː" },
  { id: "hi-retroflex", label: "ठीक है, घर चलो — गाड़ी धीरे", language: "hi", ipa: "ʈʰ iː k | ɦ ɛː | gʱ ə ɾ | tʃ ə l oː | g aː ɽ iː | d̪ʱ iː ɾ eː" },
  { id: "hi-nasal", label: "मैं यहाँ हूँ, माँ", language: "hi", ipa: "m ɛ̃ː | j ə ɦ ãː | ɦ ũː | m ãː" },
  { id: "hinglish", label: "Aaj ki meeting cancel ho gayi, theek hai?", language: "hinglish", ipa: "aː dʒ | k iː | m iː ʈ ɪ ŋ | k æ n s ə l | ɦ oː | g ə j iː | ʈʰ iː k | ɦ ɛː" },
  { id: "hinglish-plan", label: "Mujhe ye plan pasand hai", language: "hinglish", ipa: "m ʊ dʒʱ eː | j eː | p l æ n | p ə s ə n d̪ | ɦ ɛː" },
  { id: "en", label: "Hello, how are you today? Maybe both.", language: "en", ipa: "h ə l oʊ | h aʊ | ɑː | j uː | t ə d eɪ | m eɪ b iː | b oʊ θ" },
];

const VOWEL = /[aeiouəɛɔɪʊɑæʌɜɐ]/;

/** Phoneme timings for a phrase: vowels ~130 ms (long ~170), consonants ~70 ms, word gaps 90 ms, sil at the ends. */
export function phraseToPhonemes(ipa: string, rate = 1): Phoneme[] {
  const out: Phoneme[] = [];
  let t = 0;
  const push = (p: string, ms: number) => {
    const d = ms / Math.max(0.3, rate);
    out.push({ p, start: t, end: t + d });
    t += d;
  };
  push("sil", 150);
  for (const tok of ipa.split(/\s+/).filter(Boolean)) {
    if (tok === "|") push("sp", 90);
    else if (VOWEL.test(tok)) push(tok, tok.includes("ː") ? 170 : 125);
    else push(tok, tok.includes("ʰ") || tok.includes("ʱ") ? 95 : 70);
  }
  push("sil", 250);
  return out;
}
