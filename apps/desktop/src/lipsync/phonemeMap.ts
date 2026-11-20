import type { Visemes } from "../avatar/types";

/**
 * IPA (espeak-ng style, as emitted by TTS or the phoneme aligner) → viseme target.
 * Covers English and Hindi, including aspirated/breathy stops (pʰ bʱ …),
 * retroflex series (ʈ ɖ ɳ ɽ ʂ), nasal vowels (ã ĩ ũ ẽ õ, anusvara), and
 * Hindi "ṛ" (ɽ). Schwa deletion is resolved upstream: the phoneme stream we get
 * already reflects what is actually spoken, so we never insert inherent schwas.
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
  // retroflex series (tongue curl; slightly rounded, jaw a bit lower)
  "ʈ": V({ aa: 0.2, oh: 0.12 }, 0.6), "ɖ": V({ aa: 0.2, oh: 0.12 }, 0.6), "ɳ": V({ aa: 0.18, oh: 0.1 }, 0.5),
  "ɽ": V({ aa: 0.25, oh: 0.15 }, 0.5), "ɻ": V({ aa: 0.2, oh: 0.15 }, 0.6), "ʂ": V({ ou: 0.3, ih: 0.2 }, 1.1),
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
  sil: { v: {}, dominance: 1.5, spread: 0.08, closed: true },
  br: V({ aa: 0.15 }, 0.8, 0.1), // breath: slight mouth-open
  sp: V({}, 0.6, 0.05),
};

const NASAL = /[̃]/g; // combining tilde
const LENGTH = /ː/g;
const ASPIRATION = /[ʰʱ]/g;

export interface ResolvedPhoneme {
  target: VisemeTarget;
  /** Aspirated/breathy stops release with a short open puff after closure. */
  aspirated: boolean;
  nasal: boolean;
}

/** Resolve one IPA token (possibly with diacritics) to its viseme target. */
export function resolvePhoneme(p: string): ResolvedPhoneme {
  const raw = p.trim().normalize("NFD");
  if (special[raw]) return { target: special[raw], aspirated: false, nasal: false };
  const aspirated = ASPIRATION.test(raw);
  ASPIRATION.lastIndex = 0;
  const nasal = NASAL.test(raw) || raw.endsWith("ⁿ") || raw === "ṃ";
  NASAL.lastIndex = 0;
  const base = raw.replace(ASPIRATION, "").replace(NASAL, "").replace("ⁿ", "").normalize("NFC");
  const hit = vowels[base] ?? consonants[base] ?? vowels[base.replace(LENGTH, "")] ?? consonants[base.replace(LENGTH, "")];
  if (hit) {
    // Nasal vowels: same shape, slightly less jaw opening.
    if (nasal && vowels[base.replace(LENGTH, "")]) {
      const v: Partial<Visemes> = {};
      for (const [k, w] of Object.entries(hit.v)) v[k as keyof Visemes] = (w ?? 0) * 0.85;
      return { target: { ...hit, v }, aspirated, nasal };
    }
    return { target: hit, aspirated, nasal };
  }
  // Diphthong / affricate cluster like "aɪ", "oʊ": take the first resolvable char.
  for (const ch of base) {
    const t = vowels[ch] ?? consonants[ch];
    if (t) return { target: t, aspirated, nasal };
  }
  return { target: V({ aa: 0.2 }, 0.3), aspirated, nasal };
}

/** Split diphthongs into two halves so the mouth actually travels (aɪ → a…ɪ). */
export function splitDiphthong(p: string): string[] | null {
  const s = p.normalize("NFC").replace(LENGTH, "");
  const m = s.match(/^([aeoɔəɛʌɑ])([ɪʊiuə])$/);
  return m ? [m[1], m[2]] : null;
}
