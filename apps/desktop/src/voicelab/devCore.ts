import type { MessageType, PayloadMap, VoiceLabEvent } from "@hikari/protocol";
import type { Emit } from "../memory/link";
import { bytesToBase64, encodeWav } from "./wav";

/**
 * DEV browser preview only: a stand-in for the core's Voice Lab, so the window can be tried without B's core.
 * It follows the ops contract in ops.ts, including the rule that matters most: no clips are accepted for a voice
 * without a consent record. Samples are synthetic hums, not voices.
 */
type Reply = { type: MessageType; payload: unknown };
interface FakeVoice {
  id: string;
  name: string;
  owner?: "self" | "other";
  speakerName?: string;
  language?: string;
  status: "consent" | "recording" | "training" | "ready" | "failed";
  consentOk: boolean;
  clips: Set<string>;
  progress?: number;
}

const SCRIPT: [string, string][] = [
  ["en", "The quick brown fox jumps over the lazy dog, then naps in the afternoon sun."],
  ["hinglish", "Aaj ka plan kya hai? Chalo pehle chai peete hain, phir kaam shuru karte hain."],
  ["hi", "बारिश की पहली बूँदों के साथ मिट्टी की ख़ुशबू पूरे घर में फैल गई।"],
  ["en", "Could you remind me to call my sister at seven this evening?"],
  ["hinglish", "Yaar, yeh bug toh kal raat se pareshan kar raha hai, but I think I've found it."],
  ["en", "Honestly, that was the best mango I've had all summer."],
  ["hi", "क्या तुम मुझे कल सुबह छह बजे जगा सकती हो?"],
  ["en", "Wait — did you hear that? I think it's starting to rain."],
  ["hinglish", "Weekend pe Jaipur chalein? Bas do din, no laptops, promise."],
  ["en", "Okay, okay, you win this round. But I want a rematch tomorrow."],
  ["hi", "धीरे-धीरे सब ठीक हो जाएगा, बस थोड़ा सब्र रखो।"],
  ["en", "Good night! Sleep well, and don't stay up scrolling."],
];

/** A short synthetic "hum" with a voice-like pitch contour; `bright` changes the timbre so A and B differ. */
export function hum(seconds: number, f0: number, bright: number, rate = 16000): string {
  const n = Math.round(seconds * rate);
  const s = new Float32Array(n);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    const f = f0 * (1 + 0.06 * Math.sin(2 * Math.PI * 0.7 * t) + 0.012 * Math.sin(2 * Math.PI * 5.5 * t));
    phase += (2 * Math.PI * f) / rate;
    let x = 0;
    for (let h = 1; h <= 8; h++) x += Math.sin(h * phase) * Math.pow(bright, h - 1) / h;
    const syll = 0.55 + 0.45 * Math.sin(2 * Math.PI * 3.2 * t - Math.PI / 2); // syllable-rate envelope
    const edge = Math.min(1, t / 0.05, (seconds - t) / 0.08);
    s[i] = 0.28 * x * syll * edge;
  }
  return bytesToBase64(encodeWav(s, rate));
}

export class FakeVoiceLabCore {
  private voices = new Map<string, FakeVoice>();
  private timers: ReturnType<typeof setTimeout>[] = [];
  private pairs = 0;
  readonly minClips = 6;

  constructor(private readonly emit: Emit) {
    // One finished voice, so Evaluate and Compare have something to show.
    this.voices.set("my-voice", { id: "my-voice", name: "My voice", owner: "self", language: "hinglish", status: "ready", consentOk: true, clips: new Set(SCRIPT.map((_, i) => `l${i + 1}`)) });
  }

  private voice(v: FakeVoice) {
    return { id: v.id, name: v.name, owner: v.owner, speakerName: v.speakerName, language: v.language, status: v.status, consentOk: v.consentOk, clips: v.clips.size, minClips: this.minClips, targetClips: SCRIPT.length, minutes: v.clips.size * 0.08, progress: v.progress };
  }

  private ev(op: string, voiceId: string | undefined, data: unknown): Reply {
    return { type: "voice_lab.event", payload: { op, voiceId, data } satisfies VoiceLabEvent };
  }

  handle<T extends MessageType>(type: T, payload: PayloadMap[T]): Reply[] {
    if (type !== "voice_lab.event") return [];
    const { op, voiceId = "", data } = payload as VoiceLabEvent;
    const d = (data ?? {}) as Record<string, unknown>;
    const v = this.voices.get(voiceId);
    switch (op) {
      case "voices.list":
        return [this.ev("voices.list", undefined, { voices: [...this.voices.values()].map((x) => this.voice(x)) })];
      case "voice.create": {
        const nv: FakeVoice = { id: voiceId, name: String(d.name ?? "New voice"), language: d.language as string, status: "consent", consentOk: false, clips: new Set() };
        this.voices.set(voiceId, nv);
        return [this.ev("voice.updated", voiceId, { voice: this.voice(nv) })];
      }
      case "voice.delete":
        this.voices.delete(voiceId);
        return [this.ev("voice.deleted", voiceId, {})];
      case "consent.check":
        return [this.ev("consent.check", voiceId, v?.consentOk ? { ok: true, owner: v.owner, speakerName: v.speakerName, consentId: `consent-${voiceId}`, at: Date.now() } : { ok: false })];
      case "consent.record": {
        if (!v) return [this.ev("error", voiceId, { message: "No such voice.", about: op })];
        const attest = Array.isArray(d.attestations) ? (d.attestations as { agreed?: boolean }[]) : [];
        const st = d.statement as { audio?: string; durationMs?: number } | undefined;
        const ok = attest.length > 0 && attest.every((a) => a.agreed) && (d.owner === "self" || (!!st?.audio && (st.durationMs ?? 0) >= 5000));
        if (!ok) return [this.ev("consent.check", voiceId, { ok: false, reason: "The consent record is incomplete." })];
        Object.assign(v, { consentOk: true, owner: d.owner, speakerName: d.speakerName, status: "recording" });
        return [
          this.ev("consent.check", voiceId, { ok: true, owner: v.owner, speakerName: v.speakerName, consentId: `consent-${voiceId}`, at: Date.now() }),
          this.ev("voice.updated", voiceId, { voice: this.voice(v) }),
        ];
      }
      case "script.get":
        return [this.ev("script.get", voiceId, { lines: SCRIPT.map(([language, text], i) => ({ id: `l${i + 1}`, text, language })), recorded: v ? [...v.clips] : [] })];
      case "clip.saved": {
        const lineId = String(d.lineId ?? "");
        if (!v?.consentOk) return [this.ev("clip.ack", voiceId, { lineId, take: d.take, ok: false, reason: "No consent on record for this voice." })];
        if (!d.audio) return [this.ev("clip.ack", voiceId, { lineId, take: d.take, ok: false, reason: "The clip had no audio." })];
        v.clips.add(lineId);
        return [this.ev("clip.ack", voiceId, { lineId, take: d.take, ok: true, clips: v.clips.size })];
      }
      case "train.start":
        if (!v?.consentOk) return [this.ev("error", voiceId, { message: "No consent on record for this voice.", about: op })];
        if (v.clips.size < this.minClips) return [this.ev("error", voiceId, { message: `Record at least ${this.minClips} lines first.`, about: op })];
        this.train(v);
        return [];
      case "train.cancel":
        this.stop();
        if (v) Object.assign(v, { status: "recording", progress: undefined });
        return [this.ev("train.progress", voiceId, { stage: "cancelled", progress: 0 })];
      case "eval.get":
        return v?.status === "ready" ? [this.ev("eval.report", voiceId, this.report())] : [this.ev("error", voiceId, { message: "Train the voice first.", about: op })];
      case "ab.next": {
        const k = ++this.pairs;
        const [lang, text] = SCRIPT[k % SCRIPT.length];
        void lang;
        return [this.ev("ab.pair", voiceId, {
          pairId: `pair-${k}`, text,
          samples: [{ id: `b${k}`, system: "base", audio: hum(1.4, 190 + (k % 3) * 8, 0.35) }, { id: `a${k}`, system: "adapter", audio: hum(1.4, 210 + (k % 3) * 8, 0.62) }],
        })];
      }
      default:
        return [];
    }
  }

  private report() {
    return {
      metrics: { speakerSimilarity: 0.79, utmos: 3.6, cer: 0.041, ttfaMs: 240, rtf: 0.38 },
      samples: [
        { id: "e1", label: "English", text: SCRIPT[3][1], audio: hum(1.6, 205, 0.6) },
        { id: "e2", label: "Hinglish", text: SCRIPT[1][1], audio: hum(1.8, 215, 0.6) },
        { id: "e3", label: "Hindi", text: SCRIPT[2][1], audio: hum(1.7, 200, 0.6) },
      ],
      summary: "Close to your recordings. Hindi intelligibility is good; a little flat on questions.",
      at: Date.now(),
    };
  }

  private stop() {
    this.timers.forEach(clearTimeout);
    this.timers = [];
  }

  /** ~9 s of plausible progress: preparing → training (steps, falling loss) → evaluating → done. */
  private train(v: FakeVoice) {
    this.stop();
    v.status = "training";
    const total = 400;
    const ticks = 18;
    const at = (ms: number, f: () => void) => this.timers.push(setTimeout(f, ms));
    const send = (data: unknown) => this.emit("voice_lab.event", { op: "train.progress", voiceId: v.id, data });
    at(100, () => send({ stage: "preparing", progress: 0.03, message: "Trimming silence and normalising loudness" }));
    for (let i = 1; i <= ticks; i++) {
      at(600 + i * 420, () => {
        const step = Math.round((i / ticks) * total);
        v.progress = 0.08 + 0.82 * (i / ticks);
        send({ stage: "training", progress: v.progress, step, totalSteps: total, loss: +(1.9 * Math.exp(-i / 6) + 0.31).toFixed(3), etaSec: Math.round((ticks - i) * 0.42 + 2) });
      });
    }
    at(600 + (ticks + 1) * 420, () => send({ stage: "evaluating", progress: 0.95, message: "Scoring similarity and intelligibility" }));
    at(600 + (ticks + 3) * 420, () => {
      Object.assign(v, { status: "ready", progress: 1 });
      send({ stage: "done", progress: 1 });
      this.emit("voice_lab.event", { op: "voice.updated", voiceId: v.id, data: { voice: this.voice(v) } });
      this.emit("voice_lab.event", { op: "eval.report", voiceId: v.id, data: this.report() });
    });
  }
}
