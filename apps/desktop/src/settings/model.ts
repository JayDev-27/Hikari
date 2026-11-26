import type { ProviderStatus } from "@hikari/protocol";

/**
 * Settings: the provider catalogue, the saved shape and the pure logic the window uses (formatting, status badges,
 * key validation, profile fit). Catalogue picks follow docs/research/03-speech.md §7 and 04-llm-memory.md §1–2.
 */

export type Capability = ProviderStatus["capability"];
export type ProfileId = "lite" | "standard" | "max";
export type ProfileSetting = "auto" | ProfileId;
export type LanguageSetting = "auto" | "en" | "hi" | "hinglish";

export interface ProviderChoice {
  provider: string;
  /** Model id, or "auto" for a local provider: the core picks the size that fits the hardware profile. */
  model: string;
}
export interface HikariSettings {
  version: 1;
  profile: ProfileSetting;
  language: LanguageSetting;
  providers: Record<Capability, ProviderChoice>;
}

export interface ModelDef { id: string; name: string }
export interface ProviderDef {
  id: string;
  name: string;
  /** Runs on this Mac: no key, no network. */
  local?: boolean;
  /** Typical key prefixes, for a gentle warning on a paste from the wrong console. */
  keyPrefixes?: string[];
}
export interface CapabilityDef {
  id: Capability;
  title: string;
  subtitle: string;
  providers: { provider: string; models: ModelDef[] }[];
}

export const PROVIDERS: Record<string, ProviderDef> = {
  local: { id: "local", name: "On this Mac", local: true },
  groq: { id: "groq", name: "Groq", keyPrefixes: ["gsk_"] },
  cerebras: { id: "cerebras", name: "Cerebras", keyPrefixes: ["csk-"] },
  gemini: { id: "gemini", name: "Google Gemini", keyPrefixes: ["AIza"] },
  openrouter: { id: "openrouter", name: "OpenRouter", keyPrefixes: ["sk-or-"] },
  anthropic: { id: "anthropic", name: "Anthropic", keyPrefixes: ["sk-ant-"] },
  openai: { id: "openai", name: "OpenAI", keyPrefixes: ["sk-"] },
  deepseek: { id: "deepseek", name: "DeepSeek", keyPrefixes: ["sk-"] },
  mistral: { id: "mistral", name: "Mistral" },
  sarvam: { id: "sarvam", name: "Sarvam" },
  elevenlabs: { id: "elevenlabs", name: "ElevenLabs", keyPrefixes: ["sk_"] },
  cartesia: { id: "cartesia", name: "Cartesia", keyPrefixes: ["sk_car_"] },
};

const AUTO: ModelDef = { id: "auto", name: "Automatic (fits profile)" };

export const CAPABILITIES: CapabilityDef[] = [
  {
    id: "llm",
    title: "Conversation",
    subtitle: "Language model",
    providers: [
      { provider: "local", models: [AUTO, { id: "qwen3.5:2b-q4_K_M", name: "Qwen 3.5 2B" }, { id: "qwen3.5:4b-q4_K_M", name: "Qwen 3.5 4B" }, { id: "qwen3.5:9b-q4_K_M", name: "Qwen 3.5 9B" }, { id: "gemma4:e4b-it-qat", name: "Gemma 4 E4B" }, { id: "gemma4:12b-nvfp4", name: "Gemma 4 12B" }] },
      { provider: "groq", models: [{ id: "qwen/qwen3.8-27b", name: "Qwen 3.8 27B" }, { id: "openai/gpt-oss-20b", name: "GPT-OSS 20B" }, { id: "llama-3.1-8b-instant", name: "Llama 3.1 8B Instant" }] },
      { provider: "cerebras", models: [{ id: "qwen-3.8-27b", name: "Qwen 3.8 27B" }] },
      { provider: "gemini", models: [{ id: "gemini-3.8-flash", name: "Gemini 3.8 Flash" }, { id: "gemini-3.5-flash-lite", name: "Gemini 3.5 Flash-Lite" }] },
      { provider: "openrouter", models: [{ id: "openrouter/auto", name: "Auto router" }] },
      { provider: "anthropic", models: [{ id: "claude-haiku-5-5", name: "Claude Haiku 5.5" }] },
      { provider: "openai", models: [{ id: "gpt-6-luna", name: "GPT-6 Luna" }] },
      { provider: "deepseek", models: [{ id: "deepseek-flash", name: "DeepSeek Flash" }] },
      { provider: "mistral", models: [{ id: "mistral-small-4-0-26-03", name: "Mistral Small 4" }, { id: "ministral-3-8b-25-12", name: "Ministral 3 8B" }] },
    ],
  },
  {
    id: "stt",
    title: "Listening",
    subtitle: "Speech recognition",
    providers: [
      { provider: "local", models: [AUTO, { id: "hima-asr-mlx-4bit", name: "Hima ASR 4-bit" }, { id: "hima-asr-mlx-8bit", name: "Hima ASR 8-bit" }, { id: "whisper-large-v3-turbo-4bit", name: "Whisper Turbo 4-bit" }] },
      { provider: "groq", models: [{ id: "whisper-large-v3-turbo", name: "Whisper Large v3 Turbo" }] },
      { provider: "sarvam", models: [{ id: "saaras-v4", name: "Saaras v4" }] },
      { provider: "openai", models: [{ id: "gpt-live-transcribe", name: "GPT Live Transcribe" }] },
      { provider: "elevenlabs", models: [{ id: "scribe_v3_live", name: "Scribe v3 Live" }] },
    ],
  },
  {
    id: "tts",
    title: "Voice",
    subtitle: "Speech synthesis",
    providers: [
      { provider: "local", models: [AUTO, { id: "hima-tts-nano-hi", name: "Hima TTS Nano" }, { id: "kokoro-82m", name: "Kokoro 82M" }, { id: "maya2-native-mlx-8bit", name: "Maya 2 8-bit" }] },
      { provider: "sarvam", models: [{ id: "bulbul-v3", name: "Bulbul v3" }, { id: "bulbul-v4-flash", name: "Bulbul v4 Flash" }] },
      { provider: "elevenlabs", models: [{ id: "eleven_flash_v2_5", name: "Flash v2.5" }, { id: "eleven_v4_turbo", name: "v4 Turbo" }] },
      { provider: "cartesia", models: [{ id: "sonic-3.6", name: "Sonic 3.6" }] },
      { provider: "gemini", models: [{ id: "gemini-3.8-flash-tts", name: "Gemini 3.8 Flash TTS" }] },
    ],
  },
  {
    id: "embed",
    title: "Memory search",
    subtitle: "Embeddings",
    providers: [
      { provider: "local", models: [{ id: "embeddinggemma-300m", name: "EmbeddingGemma 300M" }, { id: "qwen3-embedding-0.6b", name: "Qwen3 Embedding 0.6B" }] },
    ],
  },
];

export const capabilityDef = (c: Capability) => CAPABILITIES.find((d) => d.id === c)!;
export const providerName = (id: string) => PROVIDERS[id]?.name ?? id;
export const modelsFor = (c: Capability, provider: string): ModelDef[] =>
  capabilityDef(c).providers.find((p) => p.provider === provider)?.models ?? [];
export const modelName = (c: Capability, provider: string, model: string) =>
  modelsFor(c, provider).find((m) => m.id === model)?.name ?? model;

// ---------- hardware profiles ----------

const GB = 1024 ** 3;
export interface ProfileDef {
  id: ProfileId;
  name: string;
  ram: string;
  /** Smallest machine it's meant for. */
  minBytes: number;
  /** Rough resident budget of local models (LLM + speech + embedder) when everything runs on this Mac. */
  budgetBytes: number;
  llm: string;
  speech: string;
  summary: string;
}
export const PROFILES: ProfileDef[] = [
  { id: "lite", name: "Light", ram: "8 GB", minBytes: 8 * GB, budgetBytes: 5 * GB, llm: "Qwen 3.5 4B", speech: "Hima ASR 4-bit · Hima TTS int8", summary: "Cloud first. Local models are the offline fallback, loaded only when needed." },
  { id: "standard", name: "Balanced", ram: "16 GB", minBytes: 16 * GB, budgetBytes: 8 * GB, llm: "Gemma 4 E4B", speech: "Hima ASR 8-bit · Hima TTS", summary: "Local first, with the cloud for long or complex replies." },
  { id: "max", name: "Max", ram: "32 GB+", minBytes: 32 * GB, budgetBytes: 13 * GB, llm: "Gemma 4 12B", speech: "Hima ASR 8-bit · Maya 2 voice", summary: "Everything local, the largest models kept loaded." },
];
export const profileDef = (p: ProfileId) => PROFILES.find((d) => d.id === p)!;

/** The profile Auto picks for a Mac with this much memory: the largest one it meets the minimum for. */
export function recommendProfile(totalBytes: number | undefined): ProfileId {
  const fits = PROFILES.filter((p) => (totalBytes ?? 0) >= p.minBytes * 0.95);
  return fits.length ? fits[fits.length - 1].id : "lite";
}
export const resolveProfile = (s: ProfileSetting, totalBytes: number | undefined): ProfileId =>
  s === "auto" ? recommendProfile(totalBytes) : s;

/** A warning when this Mac has less memory than the profile is meant for (its models would crowd it). */
export function profileFitWarning(p: ProfileId, totalBytes: number | undefined): string | null {
  if (!totalBytes) return null;
  const d = profileDef(p);
  if (totalBytes >= d.minBytes * 0.95) return null;
  return `${d.name} needs about ${formatBytes(d.budgetBytes)} for its models; this Mac has ${formatBytes(totalBytes)}. Expect slowdowns.`;
}

// ---------- the saved shape ----------

export const DEFAULT_SETTINGS: HikariSettings = {
  version: 1,
  profile: "auto",
  language: "auto",
  providers: {
    llm: { provider: "local", model: "auto" },
    stt: { provider: "local", model: "auto" },
    tts: { provider: "local", model: "auto" },
    embed: { provider: "local", model: "embeddinggemma-300m" },
  },
};

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const oneOf = <T extends string>(v: unknown, options: readonly T[], fallback: T): T =>
  typeof v === "string" && (options as readonly string[]).includes(v) ? (v as T) : fallback;

/** Anything read from disk → a complete, valid settings object (unknown providers or models fall back to defaults). */
export function normalizeSettings(raw: unknown): HikariSettings {
  const r = isObj(raw) ? raw : {};
  const rp = isObj(r.providers) ? r.providers : {};
  const providers = {} as Record<Capability, ProviderChoice>;
  for (const def of CAPABILITIES) {
    const saved = isObj(rp[def.id]) ? (rp[def.id] as Record<string, unknown>) : {};
    const provider = def.providers.some((p) => p.provider === saved.provider) ? (saved.provider as string) : DEFAULT_SETTINGS.providers[def.id].provider;
    const models = modelsFor(def.id, provider);
    const model = models.some((m) => m.id === saved.model) ? (saved.model as string) : (models[0]?.id ?? "auto");
    providers[def.id] = { provider, model };
  }
  return {
    version: 1,
    profile: oneOf(r.profile, ["auto", "lite", "standard", "max"] as const, "auto"),
    language: oneOf(r.language, ["auto", "en", "hi", "hinglish"] as const, "auto"),
    providers,
  };
}

/** Switch a capability to another provider, with that provider's first (default) model. */
export function withProvider(s: HikariSettings, c: Capability, provider: string): HikariSettings {
  const model = modelsFor(c, provider)[0]?.id ?? "auto";
  return { ...s, providers: { ...s.providers, [c]: { provider, model } } };
}
export function withModel(s: HikariSettings, c: Capability, model: string): HikariSettings {
  return { ...s, providers: { ...s.providers, [c]: { ...s.providers[c], model } } };
}

/** Cloud providers the current choices need keys for, in capability order, without repeats. */
export const keysNeeded = (s: HikariSettings): string[] =>
  [...new Set(CAPABILITIES.map((d) => s.providers[d.id].provider))].filter((p) => !PROVIDERS[p]?.local);

// ---------- formatting ----------

/** Bytes the way Activity Monitor shows them (binary multiples, "GB"): "16 GB", "1.5 GB", "312 MB". */
export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  const digits = i >= 3 && v < 100 ? 1 : 0;
  const text = v.toFixed(digits).replace(/\.0$/, "");
  return `${text} ${units[i]}`;
}

export function formatLatency(ms: number | undefined): string | null {
  if (ms === undefined || !Number.isFinite(ms) || ms < 0) return null;
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1).replace(/\.0$/, "")} s`;
}

export const maskedKey = (last4?: string) => (last4 ? `••••${last4}` : "Saved");

// ---------- live provider status ----------

export type Tone = "green" | "blue" | "orange" | "red" | "grey";
export interface Badge { label: string; tone: Tone; title: string }

export function statusBadge(status: ProviderStatus["status"] | undefined, coreConnected: boolean): Badge {
  if (!coreConnected) return { label: "Offline", tone: "grey", title: "Hikari's core isn't running" };
  switch (status) {
    case "active": return { label: "Active", tone: "green", title: "Answering now" };
    case "ok": return { label: "Ready", tone: "blue", title: "Healthy, standing by" };
    case "failover": return { label: "Failover", tone: "orange", title: "Taking over from a provider that failed" };
    case "benched": return { label: "Benched", tone: "orange", title: "Resting after errors or rate limits; retried later" };
    case "error": return { label: "Error", tone: "red", title: "The last request failed" };
    default: return { label: "Waiting", tone: "grey", title: "No status from the core yet" };
  }
}

/** Latest status per capability and provider (key `${capability}:${provider}`). */
export type StatusTable = Record<string, ProviderStatus>;
export const statusKey = (c: Capability, provider: string) => `${c}:${provider}`;
export const recordStatus = (t: StatusTable, s: ProviderStatus): StatusTable => ({ ...t, [statusKey(s.capability, s.provider)]: s });

export interface CapabilitySummary {
  /** Status of the provider the user chose. */
  chosen?: ProviderStatus;
  /** Another provider currently answering for this capability (router failover), if any. */
  standIn?: ProviderStatus;
}
export function summarize(t: StatusTable, c: Capability, chosenProvider: string): CapabilitySummary {
  const chosen = t[statusKey(c, chosenProvider)];
  const others = Object.values(t).filter((s) => s.capability === c && s.provider !== chosenProvider);
  const standIn = chosen?.status === "active" ? undefined : others.find((s) => s.status === "failover") ?? others.find((s) => s.status === "active");
  return { chosen, standIn };
}

// ---------- API key validation (mirrors secrets.rs, which has the last word) ----------

export interface KeyCheck { ok: boolean; value: string; error?: string; warning?: string }

export function validateApiKey(provider: string, raw: string): KeyCheck {
  const value = raw.trim();
  if (!value) return { ok: false, value, error: "Paste a key to save it." };
  if (/\s/.test(value)) return { ok: false, value, error: "The key has spaces or line breaks in it." };
  if (value.length < 12) return { ok: false, value, error: "That's too short to be an API key." };
  if (value.length > 1024) return { ok: false, value, error: "That's too long to be an API key." };
  const prefixes = PROVIDERS[provider]?.keyPrefixes;
  if (prefixes && !prefixes.some((p) => value.startsWith(p))) {
    return { ok: true, value, warning: `${providerName(provider)} keys usually start with “${prefixes[0]}”. Check it's the right key.` };
  }
  return { ok: true, value };
}

// ---------- memory meters ----------

export interface MemoryStats {
  totalBytes: number;
  usedBytes: number;
  appBytes: number;
  helperBytes: number;
  helperCount: number;
}
/** Fractions of total memory for the meter: everything in use, and Hikari's part of it. */
export function memoryShares(m: MemoryStats): { used: number; hikari: number; hikariBytes: number } {
  const hikariBytes = m.appBytes + m.helperBytes;
  if (!(m.totalBytes > 0)) return { used: 0, hikari: 0, hikariBytes };
  const clamp = (v: number) => Math.min(1, Math.max(0, v));
  const used = clamp(m.usedBytes / m.totalBytes);
  return { used, hikari: Math.min(used, clamp(hikariBytes / m.totalBytes)), hikariBytes };
}
