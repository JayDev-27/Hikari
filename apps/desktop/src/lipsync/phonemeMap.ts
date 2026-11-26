import type { Visemes } from "../avatar/types";

/**
 * IPA (espeak-ng style, as emitted by TTS or the phoneme aligner) → viseme target.
 * Covers English and Hindi, including aspirated/breathy stops (pʰ bʱ …),
 * retroflex series (ʈ ɖ ɳ ɽ ʂ), nasal vowels (ã ĩ ũ ẽ õ, anusvara), and
 * Hindi "ṛ" (ɽ). Schwa deletion is resolved upstream: the phoneme stream we get
 * already reflects what is actually spoken, so we never insert inherent schwas.
 *
 * Hindi vs English (Hinglish code-switching): the same symbol can look different
 * in the two languages. Hindi's short "a" (अ, written ə) is a full, fairly open
 * vowel, while English ə is a reduced, nearly closed one. {@link markLanguages}
 * decides per phoneme from the phones around it (retroflex, aspirated, dental,
 * nasal-vowel and tap-r phones say Hindi; ɹ æ θ ð ɜ w and English diphthongs say
 * English), falling back to the chunk's language, and {@link resolvePhoneme}
 * picks the variant. m/b/p are full closures in both.
 *
 * `dominance` (Cohen–Massaro coarticulation): how strongly a segment imposes its
 * shape on neighbours. Bilabials are highest so lips always close on m/b/p.
 */
export interface VisemeTarget {
  v: Partial<Visemes>;
  dominance: number;
  /** Seconds the influence decays over outside the segment. */
  spread: number;
  closed?: boolean;
}

const V = (v: Partial<Visemes>, dominance = 1, spread = 0.06): VisemeTarget => ({ v, dominance, spread });

const vowels: Record<string, VisemeTarget> = {
  a: V({ aa: 1 }), "aː": V({ aa: 1 }), "ɑ": V({ aa: 1 }), "ɑː": V({ aa: 1 }), "æ": V({ aa: 0.7, ee: 0.4 }),
  "ʌ": V({ aa: 0.65 }), "ɐ": V({ aa: 0.55 }), "ə": V({ aa: 0.35 }, 0.5), "ɚ": V({ aa: 0.3, ou: 0.2 }, 0.5),
  "ɜ": V({ aa: 0.4, ee: 0.2 }), "ɜː": V({ aa: 0.4, ee: 0.2 }),
  i: V({ ih: 1 }), "iː": V({ ih: 1 }), "ɪ": V({ ih: 0.75 }), "ɨ": V({ ih: 0.6 }),
  u: V({ ou: 1 }, 1.1), "uː": V({ ou: 1 }, 1.1), "ʊ": V({ ou: 0.75 }),
  e: V({ ee: 1 }), "eː": V({ ee: 1 }), "ɛ": V({ ee: 0.85, aa: 0.2 }), "ɛː": V({ ee: 0.85, aa: 0.2 }),
  o: V({ oh: 1 }, 1.1), "oː": V({ oh: 1 }, 1.1), "ɔ": V({ oh: 0.85, aa: 0.25 }), "ɔː": V({ oh: 0.85, aa: 0.25 }), "ɒ": V({ oh: 0.7, aa: 0.3 }),
};

/** Language-specific variants (only where the mouth really differs). */
const hindiVowels: Record<string, VisemeTarget> = {
  // अ: open-mid central, the most common Hindi vowel; a full syllable nucleus, not a reduced one.
  "ə": V({ aa: 0.55 }, 0.75),
  // ऐ / औ in standard Hindi are long monophthongs [ɛː] [ɔː]: hold the shape (no glide).
  "ɛ": V({ ee: 0.8, aa: 0.3 }), "ɔ": V({ oh: 0.85, aa: 0.3 }, 1.1),
};
const englishVowels: Record<string, VisemeTarget> = {
  // Reduced English schwa ("about", "the"): barely open, yields to its neighbours.
  "ə": V({ aa: 0.28 }, 0.4, 0.05),
};

// Consonants: lips/jaw only; tongue-only distinctions collapse to a small opening.
const consonants: Record<string, VisemeTarget> = {
  // bilabials: full closure, high dominance
  p: { v: {}, dominance: 3, spread: 0.04, closed: true },
  b: { v: {}, dominance: 3, spread: 0.04, closed: true },
  m: { v: {}, dominance: 3, spread: 0.05, closed: true },
  // labiodental (English f/v, Hindi ʋ "va" is lighter)
  f: V({ ih: 0.25 }, 2, 0.04), v: V({ ih: 0.25 }, 1.8, 0.04), "ʋ": V({ ou: 0.25, ih: 0.1 }, 1.2),
  w: V({ ou: 0.8 }, 1.6, 0.08),
  // dentals / alveolars (incl. Hindi dental t̪ d̪)
  t: V({ ih: 0.25, aa: 0.1 }, 0.6), d: V({ ih: 0.25, aa: 0.1 }, 0.6), "t̪": V({ ih: 0.25, aa: 0.15 }, 0.6), "d̪": V({ ih: 0.25, aa: 0.15 }, 0.6),
  n: V({ ih: 0.2, aa: 0.1 }, 0.5), s: V({ ih: 0.35 }, 1.2), z: V({ ih: 0.35 }, 1.1), l: V({ aa: 0.25, ih: 0.15 }, 0.5),
  "θ": V({ ih: 0.3, aa: 0.15 }, 1), "ð": V({ ih: 0.3, aa: 0.15 }, 0.9),
  r: V({ ou: 0.25, aa: 0.15 }, 0.7), "ɾ": V({ aa: 0.2 }, 0.4), "ɹ": V({ ou: 0.35, aa: 0.1 }, 0.8),
  // retroflex series: the tongue tip curls back, so the jaw sits a little lower than for dentals and the lips are
  // neutral to slightly rounded. Low-ish dominance: the vowels around them shape the lips.
  "ʈ": V({ aa: 0.22, oh: 0.1 }, 0.55), "ɖ": V({ aa: 0.22, oh: 0.1 }, 0.55), "ɳ": V({ aa: 0.2, oh: 0.08 }, 0.45),
  // ड़ / ढ़: a quick flap, nearly all neighbour.
  "ɽ": V({ aa: 0.28, oh: 0.12 }, 0.4, 0.04), "ɻ": V({ aa: 0.2, oh: 0.15 }, 0.6), "ɭ": V({ aa: 0.25, oh: 0.08 }, 0.45),
  "ʂ": V({ ou: 0.3, ih: 0.2 }, 1.1), "ʐ": V({ ou: 0.3, ih: 0.2 }, 1.0),
  // post-alveolars: lip protrusion
  "ʃ": V({ ou: 0.45, ee: 0.25 }, 1.4), "ʒ": V({ ou: 0.45, ee: 0.25 }, 1.3),
  "tʃ": V({ ou: 0.4, ee: 0.25 }, 1.3), "dʒ": V({ ou: 0.4, ee: 0.25 }, 1.3), "ʧ": V({ ou: 0.4, ee: 0.25 }, 1.3), "ʤ": V({ ou: 0.4, ee: 0.25 }, 1.3),
  "c": V({ ee: 0.3, ih: 0.2 }, 0.8), "ɟ": V({ ee: 0.3, ih: 0.2 }, 0.8), j: V({ ih: 0.55 }, 0.8), "ɲ": V({ ih: 0.3 }, 0.5),
  // velars / glottals: follow neighbouring vowel (low dominance)
  k: V({ aa: 0.3 }, 0.3), g: V({ aa: 0.3 }, 0.3), "ɡ": V({ aa: 0.3 }, 0.3), "ŋ": V({ aa: 0.25 }, 0.3),
  q: V({ aa: 0.35 }, 0.3), x: V({ aa: 0.35 }, 0.3), "ɣ": V({ aa: 0.35 }, 0.3),
  h: V({ aa: 0.35 }, 0.15), "ɦ": V({ aa: 0.35 }, 0.2), "ʔ": V({}, 0.2),
};

const special: Record<string, VisemeTarget> = {
  // Anusvara / chandrabindu written as its own token: the velum drops, the lips do nothing of their own.
  "ⁿ": V({ aa: 0.12 }, 0.25), "ṃ": V({ aa: 0.12 }, 0.25), "ṁ": V({ aa: 0.12 }, 0.25), "̃": V({ aa: 0.12 }, 0.25),
  // Silence = resting posture: weak, short reach, NOT a closure (that's for m/b/p).
  // Alone it still yields a closed mouth (all-zero target); next to speech it yields.
  sil: V({}, 0.4, 0.03),
  br: V({ aa: 0.15 }, 0.8, 0.1), // breath: slight mouth-open
  sp: V({}, 0.6, 0.05),
};

const NASAL = /\u0303/g; // combining tilde
const LENGTH = /ː/g;
const ASPIRATION = /[ʰʱ]/g;
/** Stress marks, tie bars, syllable breaks and espeak's ASCII stress: not sounds, stripped before lookup. */
const MARKS = /[ˈˌ'",.]|\u035C|\u0361/g;

export type PhonemeLanguage = "hi" | "en";

export interface ResolvedPhoneme {
  target: VisemeTarget;
  /** Aspirated (ʰ) or breathy-voiced (ʱ) stop: releases with an open puff after the closure. */
  aspirated: boolean;
  /** ʱ: murmured release, longer and more open than a plain ʰ puff. */
  breathy: boolean;
  nasal: boolean;
  /** Primary stress mark (ˈ) on the token. */
  stressed: boolean;
}

/** Strip diacritics that don't change the mouth (stress, tie bars) and normalise for lookup. */
export function cleanPhoneme(p: string): { raw: string; stressed: boolean } {
  const n = p.trim().normalize("NFD");
  return { raw: n.replace(MARKS, ""), stressed: n.includes("ˈ") || n.includes("'") };
}

/** Resolve one IPA token (possibly with diacritics) to its viseme target. `lang` picks Hindi/English variants. */
export function resolvePhoneme(p: string, lang?: PhonemeLanguage): ResolvedPhoneme {
  const { raw, stressed } = cleanPhoneme(p);
  const sp = special[raw] ?? special[raw.normalize("NFC")];
  if (sp) return { target: sp, aspirated: false, breathy: false, nasal: raw !== "sil" && raw !== "sp" && raw !== "br", stressed };
  const aspirated = ASPIRATION.test(raw);
  ASPIRATION.lastIndex = 0;
  const breathy = raw.includes("ʱ");
  const nasal = NASAL.test(raw) || raw.endsWith("ⁿ");
  NASAL.lastIndex = 0;
  const base = raw.replace(ASPIRATION, "").replace(NASAL, "").replace("ⁿ", "").normalize("NFC");
  const short = base.replace(LENGTH, "");
  const variant = lang === "hi" ? hindiVowels : lang === "en" ? englishVowels : undefined;
  const hit = variant?.[short] ?? vowels[base] ?? consonants[base] ?? vowels[short] ?? consonants[short];
  if (hit) {
    // Nasal vowels: same shape, slightly less jaw opening (the velum, not the lips, makes the difference).
    if (nasal && (vowels[short] || variant?.[short])) {
      const v: Partial<Visemes> = {};
      for (const [k, w] of Object.entries(hit.v)) v[k as keyof Visemes] = (w ?? 0) * 0.85;
      return { target: { ...hit, v }, aspirated, breathy, nasal, stressed };
    }
    return { target: hit, aspirated, breathy, nasal, stressed };
  }
  // Diphthong / affricate cluster like "aɪ", "oʊ": take the first resolvable char.
  for (const ch of base) {
    const t = vowels[ch] ?? consonants[ch];
    if (t) return { target: t, aspirated, breathy, nasal, stressed };
  }
  return { target: V({ aa: 0.2 }, 0.3), aspirated, breathy, nasal, stressed };
}

// \u032A: dental bridge (t̪ d̪), \u0303: nasal vowel tilde.
const HINDI_MARKERS = /[ʈɖɳɽʂɭɦʋɾʰʱ]|\u032A|\u0303|aː|eː|oː/;
const ENGLISH_MARKERS = /[ɹæθðɜɚɒw]|eɪ|oʊ|aɪ|aʊ|ɔɪ|ɪə|ʊə|əʊ/;
const BOUNDARY = new Set(["sil", "sp", "br", "|", " ", ""]);

/**
 * Hindi or English, per phoneme, for a chunk that may switch between them (Hinglish). Evidence comes from the
 * phones within ±`reach` of each one (not across a pause): Hindi-only phones vs English-only phones. Ties (and
 * phones with no evidence nearby) take the chunk's language; "hinglish"/"unknown" chunks default to Hindi, since
 * an English word in Hinglish usually carries its own English markers.
 */
export function markLanguages(phonemes: string[], chunkLanguage?: string, reach = 3): PhonemeLanguage[] {
  const fallback: PhonemeLanguage = chunkLanguage === "en" ? "en" : "hi";
  const score = phonemes.map((p) => {
    const n = cleanPhoneme(p).raw;
    if (BOUNDARY.has(n)) return null;
    return (HINDI_MARKERS.test(n) ? 1 : 0) - (ENGLISH_MARKERS.test(n) ? 1 : 0);
  });
  return phonemes.map((_, i) => {
    if (score[i] === null) return fallback;
    let sum = 0;
    for (const dir of [-1, 1]) {
      for (let k = dir === -1 ? 0 : 1; k <= reach; k++) {
        const s = score[i + dir * k];
        if (s === undefined || s === null) break;
        // Nearer phones count more.
        sum += s * (k === 0 ? 1.5 : 1 / k);
      }
    }
    return sum > 0.01 ? "hi" : sum < -0.01 ? "en" : fallback;
  });
}

/** Split diphthongs into two halves so the mouth actually travels (aɪ → a…ɪ). */
export function splitDiphthong(p: string): string[] | null {
  const s = p.normalize("NFC").replace(LENGTH, "");
  const m = s.match(/^([aeoɔəɛʌɑ])([ɪʊiuə])$/);
  return m ? [m[1], m[2]] : null;
}
