import { msg, type AnyMessage, type Emotion, type GestureTag, type Phoneme } from "@hikari/protocol";
import { encodePcm16 } from "../audio/playback";

/**
 * Frontend-only mock (Person A's side) for building lip sync without the core.
 * Synthesises a formant "vowel buzz" per phoneme so the audio actually matches
 * the phoneme timings — good enough to judge A/V sync by eye and ear.
 * Person B's core/mock_server.py replays real recorded Hinglish turns instead.
 */

const SR = 24000;
// Rough F1/F2 (Hz) for vowel-like sounds; consonants get noise or silence.
const FORMANTS: Record<string, [number, number]> = {
  a: [800, 1300], "aː": [800, 1300], "ə": [550, 1500], "ʌ": [650, 1250], i: [300, 2300], "iː": [300, 2300],
  "ɪ": [400, 2000], u: [320, 800], "uː": [320, 800], "ʊ": [420, 1000], e: [450, 2100], "eː": [450, 2100],
  "ɛ": [580, 1800], o: [480, 850], "oː": [480, 850], "ɔ": [600, 900], "æ": [700, 1700],
};
const VOICED_CONS = new Set(["m", "n", "l", "r", "ɾ", "ɽ", "ɳ", "j", "w", "ʋ", "b", "d", "g", "ɡ", "v", "z", "ɖ", "dʒ"]);

interface Line {
  text: string;
  emotion?: [Emotion, number];
  gesture?: [GestureTag, number];
  /** "phoneme:ms" pairs */
  ph: string;
}

// Hindi, English and Hinglish demo lines with hand-written IPA timings.
const LINES: Line[] = [
  { text: "Hi! I'm Hikari.", emotion: ["joy", 0.7], gesture: ["wave", 0],
    ph: "h:60 a:120 ɪ:80 sil:90 a:110 ɪ:70 m:70 h:50 ɪ:70 k:60 aː:140 ɾ:40 iː:160 sil:200" },
  { text: "आज तुम कैसे हो?", emotion: ["fun", 0.5], gesture: ["head_tilt", 300],
    ph: "aː:140 dʒ:90 sil:60 t̪:60 u:90 m:80 sil:50 k:60 ɛː:150 s:90 eː:120 sil:40 ɦ:60 oː:220 sil:200" },
  { text: "Chalo, let's build something cool!", emotion: ["joy", 0.8], gesture: ["clap", 900],
    ph: "tʃ:80 ə:70 l:50 oː:160 sil:100 l:50 ɛ:90 t:50 s:80 b:60 ɪ:80 l:50 d:60 sil:40 s:80 ʌ:90 m:70 θ:70 ɪ:70 ŋ:70 k:60 uː:200 l:90 sil:250" },
  { text: "Hmm… thoda soch rahi hoon.", emotion: ["thinking", 0.6], gesture: ["think_chin", 0],
    ph: "m:350 sil:150 t̪ʰ:80 oː:110 ɽ:40 ə:70 s:80 oː:120 tʃ:90 r:40 ə:70 ɦ:50 iː:110 ɦ:50 ũː:220 sil:250" },
  { text: "Bilkul! Main samajh gayi.", emotion: ["joy", 0.6], gesture: ["nod", 200],
    ph: "b:60 ɪ:70 l:50 k:60 uː:110 l:80 sil:120 m:60 ɛ̃ː:180 s:80 ə:60 m:60 ə:70 dʒʱ:110 g:50 ə:70 j:50 iː:200 sil:250" },
];

function synth(phs: Phoneme[], totalMs: number): Float32Array {
  const out = new Float32Array(Math.ceil((totalMs / 1000) * SR));
  let phase = 0;
  for (const ph of phs) {
    const s0 = Math.floor((ph.start / 1000) * SR);
    const s1 = Math.floor((ph.end / 1000) * SR);
    const base = ph.p.normalize("NFD").replace(/[̃ʰʱ]/g, "").normalize("NFC");
    const f = FORMANTS[base] ?? FORMANTS[base.replace("ː", "")];
    for (let i = s0; i < s1 && i < out.length; i++) {
      const t = i / SR;
      const env = Math.min(1, (i - s0) / 200, (s1 - i) / 200);
      const f0 = 210 + 20 * Math.sin(t * 3);
      phase += (2 * Math.PI * f0) / SR;
      if (f) {
        // Glottal buzz shaped by two formant resonances (cheap: sum of harmonics weighted by distance to formants).
        let v = 0;
        for (let h = 1; h < 18; h++) {
          const hf = f0 * h;
          const w = Math.exp(-((hf - f[0]) ** 2) / 2e4) + 0.6 * Math.exp(-((hf - f[1]) ** 2) / 6e4);
          v += w * Math.sin(phase * h);
        }
        out[i] = 0.18 * env * v;
      } else if (VOICED_CONS.has(base)) {
        out[i] = 0.06 * env * Math.sin(phase);
      } else if (base !== "sil") {
        out[i] = 0.04 * env * (Math.random() * 2 - 1);
      }
    }
  }
  return out;
}

function parse(line: Line): { phonemes: Phoneme[]; totalMs: number } {
  let t = 0;
  const phonemes = line.ph.split(" ").map((pair) => {
    const idx = pair.lastIndexOf(":");
    const p = pair.slice(0, idx);
    const d = Number(pair.slice(idx + 1));
    const ph: Phoneme = { p, start: t, end: t + d };
    t += d;
    return ph;
  });
  return { phonemes, totalMs: t };
}

/** Emit a full mock turn as protocol messages, chunk per sentence. */
export function* mockTurn(turnId = crypto.randomUUID()): Generator<AnyMessage> {
  yield msg("state", { state: "speaking" }, { turnId });
  let seq = 0;
  for (const line of LINES) {
    const { phonemes, totalMs } = parse(line);
    if (line.emotion) yield msg("avatar.emotion", { name: line.emotion[0], intensity: line.emotion[1], seq }, { turnId });
    if (line.gesture) yield msg("avatar.gesture", { tag: line.gesture[0], atMs: line.gesture[1], seq }, { turnId });
    yield msg(
      "tts.chunk",
      {
        seq,
        sampleRate: SR,
        encoding: "pcm_s16le",
        pcm: encodePcm16(synth(phonemes, totalMs)),
        durationMs: totalMs,
        text: line.text,
        phonemes,
        phonemeSource: "tts",
      },
      { turnId },
    );
    seq++;
  }
  yield msg("tts.end", { reason: "complete" }, { turnId });
}
