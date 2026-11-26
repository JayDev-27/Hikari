import type { Language, VoiceLabEvent } from "@hikari/protocol";
import type { AbPair, AbSample } from "./ab";

/**
 * The Voice Lab contract on top of `voice_lab.event {op, voiceId, data}` (the schema leaves `data` open).
 * Proposed by A for B to implement; see DECISIONS.md "Voice Lab ops". UI → core ops are requests; core → UI ops
 * carry state. Every core → UI message may arrive unprompted (e.g. training progress, or another window's change).
 *
 *   UI → core                                   core → UI
 *   voices.list {}                              voices.list {voices: Voice[]}
 *   voice.create {name, language}               voice.updated {voice: Voice}
 *   voice.delete {}                             voice.deleted {}
 *   consent.check {}                            consent.check {ok, owner?, speakerName?, consentId?, at?, reason?}
 *   consent.record {…consentRecord()}           consent.check (same as above)
 *   script.get {language}                       script.get {lines: ScriptLine[], recorded?: lineId[]}
 *   clip.saved {lineId, text, take, audio…}     clip.ack {lineId, ok, reason?, take?}
 *   train.start {} / train.cancel {}            train.progress {stage, progress, step?, totalSteps?, etaSec?, loss?, message?}
 *   eval.get {rerun?}                           eval.report {metrics: Metric[] | Record<key, number>, samples?, summary?, at?}
 *   ab.next {}                                  ab.pair {pairId, text?, samples: [AbSample, AbSample]}
 *   ab.result {…AbResult, tally}                (none)
 *                                               error {message, about?: op}
 */
export const OPS = {
  voicesList: "voices.list",
  voiceCreate: "voice.create",
  voiceDelete: "voice.delete",
  voiceUpdated: "voice.updated",
  voiceDeleted: "voice.deleted",
  consentCheck: "consent.check",
  consentRecord: "consent.record",
  scriptGet: "script.get",
  clipSaved: "clip.saved",
  clipAck: "clip.ack",
  trainStart: "train.start",
  trainCancel: "train.cancel",
  trainProgress: "train.progress",
  evalGet: "eval.get",
  evalReport: "eval.report",
  abNext: "ab.next",
  abPair: "ab.pair",
  abResult: "ab.result",
  error: "error",
} as const;

export type VoiceStatus = "consent" | "recording" | "training" | "ready" | "failed";

export interface Voice {
  id: string;
  name: string;
  owner?: "self" | "other";
  speakerName?: string;
  language?: Language;
  status: VoiceStatus;
  consentOk: boolean;
  clips: number;
  /** Fewest clips the core will train on. */
  minClips: number;
  /** Clips in the full script. */
  targetClips: number;
  minutes?: number;
  /** 0..1 while training. */
  progress?: number;
}

export interface ScriptLine {
  id: string;
  text: string;
  language?: Language;
}

export type TrainStage = "queued" | "preparing" | "training" | "evaluating" | "done" | "failed" | "cancelled";
export interface TrainProgress {
  stage: TrainStage;
  progress: number;
  step?: number;
  totalSteps?: number;
  etaSec?: number;
  loss?: number;
  message?: string;
}

export interface Metric {
  key: string;
  label: string;
  value: number;
  target?: number;
  better: "higher" | "lower";
  unit?: string;
  note?: string;
}
export interface EvalReport {
  metrics: Metric[];
  samples: { id: string; label: string; text?: string; audio: string }[];
  summary?: string;
  at?: number;
}

export interface Take {
  status: "saving" | "saved" | "rejected" | "failed";
  take: number;
  durationMs?: number;
  reason?: string;
  /** Object URL of the local copy, for playback. */
  url?: string;
}

export interface ConsentInfo {
  ok: boolean;
  owner?: "self" | "other";
  speakerName?: string;
  consentId?: string;
  at?: number;
  reason?: string;
}

/* ---------- parsers: data comes from another process, so nothing is trusted ---------- */

type Obj = Record<string, unknown>;
const obj = (x: unknown): Obj => (x && typeof x === "object" && !Array.isArray(x) ? (x as Obj) : {});
const str = (x: unknown) => (typeof x === "string" ? x : undefined);
const num = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? x : undefined);
const LANGS: Language[] = ["en", "hi", "hinglish", "unknown"];
const lang = (x: unknown) => (LANGS.includes(x as Language) ? (x as Language) : undefined);
const STATUSES: VoiceStatus[] = ["consent", "recording", "training", "ready", "failed"];

export function parseVoice(raw: unknown): Voice | undefined {
  const o = obj(raw);
  const id = str(o.id);
  if (!id) return undefined;
  const consentOk = o.consentOk === true || obj(o.consent).ok === true;
  const status = STATUSES.includes(o.status as VoiceStatus) ? (o.status as VoiceStatus) : consentOk ? "recording" : "consent";
  const owner = o.owner === "self" || o.owner === "other" ? o.owner : undefined;
  return {
    id, name: str(o.name) || "Untitled voice", owner, speakerName: str(o.speakerName), language: lang(o.language), status, consentOk,
    clips: num(o.clips) ?? 0, minClips: num(o.minClips) ?? 20, targetClips: num(o.targetClips) ?? 60, minutes: num(o.minutes), progress: num(o.progress),
  };
}

export function parseVoices(data: unknown): Voice[] {
  const list = obj(data).voices;
  return Array.isArray(list) ? list.map(parseVoice).filter((v): v is Voice => !!v) : [];
}

export function parseScript(data: unknown): { lines: ScriptLine[]; recorded: string[] } {
  const o = obj(data);
  const lines = (Array.isArray(o.lines) ? o.lines : []).flatMap((l: unknown, i): ScriptLine[] => {
    const x = obj(l);
    const text = str(x.text)?.trim();
    return text ? [{ id: str(x.id) ?? `line-${i + 1}`, text, language: lang(x.language) }] : [];
  });
  const recorded = Array.isArray(o.recorded) ? o.recorded.filter((x): x is string => typeof x === "string") : [];
  return { lines, recorded };
}

const STAGES: TrainStage[] = ["queued", "preparing", "training", "evaluating", "done", "failed", "cancelled"];
export function parseProgress(data: unknown): TrainProgress {
  const o = obj(data);
  const stage = STAGES.includes(o.stage as TrainStage) ? (o.stage as TrainStage) : "training";
  let progress = num(o.progress) ?? 0;
  if (progress > 1) progress /= 100; // accept percent
  return {
    stage, progress: Math.max(0, Math.min(1, stage === "done" ? 1 : progress)), step: num(o.step), totalSteps: num(o.totalSteps),
    etaSec: num(o.etaSec), loss: num(o.loss), message: str(o.message),
  };
}

/** Known metrics (research 03 §5) with their direction and target, for reports that send a plain {key: value} map. */
const KNOWN: Record<string, Omit<Metric, "key" | "value">> = {
  speakerSimilarity: { label: "Speaker similarity", better: "higher", target: 0.75, note: "ECAPA cosine, reference vs. output" },
  utmos: { label: "Naturalness (UTMOS)", better: "higher", note: "Relative only on Hindi" },
  cer: { label: "Character error rate", better: "lower", target: 0.05, unit: "%", note: "ASR judge, script-normalised" },
  ttfaMs: { label: "Time to first audio", better: "lower", target: 300, unit: "ms" },
  rtf: { label: "Real-time factor", better: "lower", target: 1, note: "Below 1 is faster than real time" },
};

export function parseEval(data: unknown): EvalReport {
  const o = obj(data);
  const metrics: Metric[] = Array.isArray(o.metrics)
    ? o.metrics.flatMap((m: unknown): Metric[] => {
      const x = obj(m);
      const key = str(x.key) ?? "";
      const known = KNOWN[key];
      const value = num(x.value);
      if (!key || value === undefined) return [];
      return [{
        key, value, label: str(x.label) ?? known?.label ?? key, target: num(x.target) ?? known?.target,
        better: x.better === "lower" || x.better === "higher" ? x.better : known?.better ?? "higher", unit: str(x.unit) ?? known?.unit, note: str(x.note) ?? known?.note,
      }];
    })
    : Object.entries(obj(o.metrics)).flatMap(([key, v]): Metric[] => {
      const value = num(v);
      const k = KNOWN[key];
      return value === undefined ? [] : [{ key, value, label: k?.label ?? key, better: k?.better ?? "higher", target: k?.target, unit: k?.unit, note: k?.note }];
    });
  const samples = (Array.isArray(o.samples) ? o.samples : []).flatMap((s: unknown, i): EvalReport["samples"] => {
    const x = obj(s);
    const audio = str(x.audio);
    return audio ? [{ id: str(x.id) ?? `s${i}`, label: str(x.label) ?? `Sample ${i + 1}`, text: str(x.text), audio }] : [];
  });
  return { metrics, samples, summary: str(o.summary), at: num(o.at) };
}

/** Does a metric meet its target? undefined when there's no target. */
export function meetsTarget(m: Metric): boolean | undefined {
  if (m.target === undefined) return undefined;
  return m.better === "higher" ? m.value >= m.target : m.value <= m.target;
}

/** "0.81", "3.2%", "240 ms". `cer` arrives as a fraction and shows as a percentage. */
export function formatMetric(m: Pick<Metric, "value" | "unit">, value = m.value): string {
  if (m.unit === "%") return `${(value <= 1 ? value * 100 : value).toFixed(1)}%`;
  if (m.unit === "ms") return `${Math.round(value)} ms`;
  return Math.abs(value) >= 10 ? value.toFixed(0) : value.toFixed(2);
}

export function parseAbPair(data: unknown): AbPair | undefined {
  const o = obj(data);
  const pairId = str(o.pairId);
  const samples = (Array.isArray(o.samples) ? o.samples : []).map((s, i): AbSample | undefined => {
    const x = obj(s);
    const audio = str(x.audio);
    const system = str(x.system);
    return audio && system ? { id: str(x.id) ?? `${pairId}-${i}`, system, audio, label: str(x.label) } : undefined;
  });
  if (!pairId || samples.length !== 2 || !samples[0] || !samples[1] || samples[0].system === samples[1].system) return undefined;
  return { pairId, text: str(o.text), samples: [samples[0], samples[1]] };
}

export function parseConsent(data: unknown): ConsentInfo {
  const o = obj(data);
  return {
    ok: o.ok === true, owner: o.owner === "self" || o.owner === "other" ? o.owner : undefined, speakerName: str(o.speakerName),
    consentId: str(o.consentId), at: num(o.at), reason: str(o.reason),
  };
}

/* ---------- Voice Lab state ---------- */

export interface LabState {
  voices: Voice[];
  /** Has the core answered voices.list? */
  listed: boolean;
  scripts: Record<string, ScriptLine[]>;
  takes: Record<string, Record<string, Take>>;
  consent: Record<string, ConsentInfo>;
  training: Record<string, TrainProgress>;
  evals: Record<string, EvalReport>;
  ab: Record<string, AbPair | undefined>;
  /** Last error per voice ("" = not about a voice). */
  errors: Record<string, { message: string; about?: string } | undefined>;
}

export const initialLab: LabState = { voices: [], listed: false, scripts: {}, takes: {}, consent: {}, training: {}, evals: {}, ab: {}, errors: {} };

export type LabAction =
  | { type: "core"; event: VoiceLabEvent }
  | { type: "take"; voiceId: string; lineId: string; take: Take }
  | { type: "clearError"; voiceId: string }
  | { type: "offline" };

function setTake(s: LabState, voiceId: string, lineId: string, f: (t: Take | undefined) => Take | undefined): LabState {
  const cur = s.takes[voiceId] ?? {};
  const t = f(cur[lineId]);
  const forVoice = t ? { ...cur, [lineId]: t } : Object.fromEntries(Object.entries(cur).filter(([k]) => k !== lineId));
  return { ...s, takes: { ...s.takes, [voiceId]: forVoice } };
}

function upsertVoice(voices: Voice[], v: Voice): Voice[] {
  return voices.some((x) => x.id === v.id) ? voices.map((x) => (x.id === v.id ? v : x)) : [...voices, v];
}

export function labReducer(s: LabState, a: LabAction): LabState {
  if (a.type === "offline") return { ...s, listed: false };
  if (a.type === "clearError") return { ...s, errors: { ...s.errors, [a.voiceId]: undefined } };
  if (a.type === "take") return setTake(s, a.voiceId, a.lineId, () => a.take);

  const { op, data } = a.event;
  const id = a.event.voiceId ?? "";
  switch (op) {
    case OPS.voicesList:
      return { ...s, voices: parseVoices(data), listed: true };
    case OPS.voiceUpdated: {
      const v = parseVoice(obj(data).voice ?? data);
      return v ? { ...s, voices: upsertVoice(s.voices, v) } : s;
    }
    case OPS.voiceDeleted:
      return { ...s, voices: s.voices.filter((v) => v.id !== id) };
    case OPS.consentCheck: {
      const c = parseConsent(data);
      const voices = s.voices.map((v) => (v.id === id ? { ...v, consentOk: c.ok, owner: c.owner ?? v.owner, speakerName: c.speakerName ?? v.speakerName, status: c.ok && v.status === "consent" ? "recording" as const : v.status } : v));
      return { ...s, voices, consent: { ...s.consent, [id]: c } };
    }
    case OPS.scriptGet: {
      const { lines, recorded } = parseScript(data);
      let next: LabState = { ...s, scripts: { ...s.scripts, [id]: lines } };
      for (const lineId of recorded) next = setTake(next, id, lineId, (t) => t ?? { status: "saved", take: 1 });
      return next;
    }
    case OPS.clipAck: {
      const o = obj(data);
      const lineId = str(o.lineId);
      if (!lineId) return s;
      const ok = o.ok !== false;
      const next = setTake(s, id, lineId, (t) => {
        // An ack for an older take of this line (the user re-recorded since) is ignored.
        const take = num(o.take);
        if (t && take !== undefined && take !== t.take) return t;
        return { ...(t ?? { take: take ?? 1 }), status: ok ? "saved" : "rejected", reason: ok ? undefined : str(o.reason) ?? "The core rejected this take." };
      });
      const clips = num(o.clips);
      return clips === undefined ? next : { ...next, voices: next.voices.map((v) => (v.id === id ? { ...v, clips } : v)) };
    }
    case OPS.trainProgress: {
      const p = parseProgress(data);
      const status: VoiceStatus | undefined = p.stage === "done" ? "ready" : p.stage === "failed" ? "failed" : p.stage === "cancelled" ? undefined : "training";
      const voices = s.voices.map((v) => (v.id === id ? { ...v, progress: p.progress, status: status ?? (v.status === "training" ? "recording" : v.status) } : v));
      return { ...s, voices, training: { ...s.training, [id]: p } };
    }
    case OPS.evalReport:
      return { ...s, evals: { ...s.evals, [id]: parseEval(data) } };
    case OPS.abPair:
      return { ...s, ab: { ...s.ab, [id]: parseAbPair(data) } };
    case OPS.error: {
      const o = obj(data);
      return { ...s, errors: { ...s.errors, [id]: { message: str(o.message) ?? "Something went wrong in the Voice Lab.", about: str(o.about) } } };
    }
    default:
      return s;
  }
}

/* ---------- recording session ---------- */

/** Lines recorded (saved or still saving), out of the script. */
export function sessionProgress(lines: ScriptLine[], takes: Record<string, Take> = {}): { done: number; total: number; minutes: number } {
  let done = 0;
  let ms = 0;
  for (const l of lines) {
    const t = takes[l.id];
    if (t && (t.status === "saved" || t.status === "saving")) {
      done++;
      ms += t.durationMs ?? 0;
    }
  }
  return { done, total: lines.length, minutes: ms / 60_000 };
}

/** Next line still to record after `from` (wrapping), or -1 when all are done. */
export function nextToRecord(lines: ScriptLine[], takes: Record<string, Take> = {}, from = -1): number {
  for (let k = 1; k <= lines.length; k++) {
    const i = (from + k) % lines.length;
    const t = takes[lines[i].id];
    if (!t || t.status === "rejected" || t.status === "failed") return i;
  }
  return -1;
}

/** Can training start? Enough saved clips (the core's count wins when it sends one) and nothing still saving. */
export function canTrain(v: Voice, takes: Record<string, Take> = {}): boolean {
  const vals = Object.values(takes);
  const saved = Math.max(v.clips, vals.filter((t) => t.status === "saved").length);
  return v.consentOk && v.status !== "training" && saved >= v.minClips && !vals.some((t) => t.status === "saving");
}

export function voiceStatusLabel(v: Voice, takes: Record<string, Take> = {}): string {
  const saved = Math.max(v.clips, Object.values(takes).filter((t) => t.status === "saved").length);
  switch (v.status) {
    case "consent":
      return "Needs consent";
    case "recording":
      return saved ? `Recording · ${saved} of ${v.targetClips}` : "Ready to record";
    case "training":
      return `Training · ${Math.round((v.progress ?? 0) * 100)}%`;
    case "ready":
      return "Ready";
    case "failed":
      return "Training failed";
  }
}

/** A voice id from its name: readable, unique enough for one Mac. */
export function newVoiceId(name: string, rand: () => number = Math.random): string {
  const slug = name.toLowerCase().normalize("NFKD").replace(/[^\w\s-]/g, "").trim().replace(/[\s_]+/g, "-").slice(0, 24) || "voice";
  return `${slug}-${Math.floor(rand() * 36 ** 4).toString(36).padStart(4, "0")}`;
}
