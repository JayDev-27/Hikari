import { describe, expect, it } from "vitest";
import type { ProviderStatus } from "@hikari/protocol";
import {
  CAPABILITIES, DEFAULT_SETTINGS, PROVIDERS, formatBytes, formatLatency, keysNeeded, maskedKey, memoryShares, modelsFor,
  normalizeSettings, profileFitWarning, recommendProfile, recordStatus, resolveProfile, statusBadge, summarize,
  validateApiKey, withModel, withProvider, type StatusTable,
} from "./model";

const GB = 1024 ** 3;
const MB = 1024 ** 2;

describe("formatting", () => {
  it("shows bytes the way Activity Monitor does", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(-5)).toBe("0 B");
    expect(formatBytes(NaN)).toBe("0 B");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1536)).toBe("2 KB");
    expect(formatBytes(312 * MB)).toBe("312 MB");
    expect(formatBytes(1.5 * GB)).toBe("1.5 GB");
    expect(formatBytes(8 * GB)).toBe("8 GB");
    expect(formatBytes(10.84 * GB)).toBe("10.8 GB");
    expect(formatBytes(128 * GB)).toBe("128 GB");
    expect(formatBytes(16 * GB)).toBe("16 GB");
    expect(formatBytes(2048 * GB)).toBe("2 TB");
  });

  it("shows latency in ms, then seconds", () => {
    expect(formatLatency(undefined)).toBeNull();
    expect(formatLatency(-1)).toBeNull();
    expect(formatLatency(412.4)).toBe("412 ms");
    expect(formatLatency(1200)).toBe("1.2 s");
    expect(formatLatency(3000)).toBe("3 s");
  });

  it("masks a saved key down to its last four", () => {
    expect(maskedKey("1234")).toBe("••••1234");
    expect(maskedKey(undefined)).toBe("Saved");
  });
});

describe("provider status", () => {
  it("maps every router status to a badge", () => {
    expect(statusBadge("active", true)).toMatchObject({ label: "Active", tone: "green" });
    expect(statusBadge("ok", true)).toMatchObject({ label: "Ready", tone: "blue" });
    expect(statusBadge("failover", true)).toMatchObject({ label: "Failover", tone: "orange" });
    expect(statusBadge("benched", true)).toMatchObject({ label: "Benched", tone: "orange" });
    expect(statusBadge("error", true)).toMatchObject({ label: "Error", tone: "red" });
    expect(statusBadge(undefined, true)).toMatchObject({ label: "Waiting", tone: "grey" });
    expect(statusBadge("active", false)).toMatchObject({ label: "Offline", tone: "grey" });
  });

  const st = (provider: string, status: ProviderStatus["status"], capability: ProviderStatus["capability"] = "llm"): ProviderStatus =>
    ({ capability, provider, status });

  it("keeps the latest status per capability and provider", () => {
    let t: StatusTable = {};
    t = recordStatus(t, st("groq", "active"));
    t = recordStatus(t, st("groq", "benched"));
    t = recordStatus(t, st("groq", "ok", "stt"));
    expect(Object.keys(t).sort()).toEqual(["llm:groq", "stt:groq"]);
    expect(t["llm:groq"].status).toBe("benched");
  });

  it("names the stand-in when the chosen provider is out", () => {
    const t = [st("groq", "benched"), st("cerebras", "failover"), st("local", "ok"), st("local", "active", "stt")].reduce(recordStatus, {});
    const s = summarize(t, "llm", "groq");
    expect(s.chosen?.status).toBe("benched");
    expect(s.standIn?.provider).toBe("cerebras");
    // Another capability's traffic never counts as a stand-in.
    expect(summarize(t, "stt", "groq").standIn?.provider).toBe("local");
    expect(summarize(t, "tts", "local")).toEqual({ chosen: undefined, standIn: undefined });
  });

  it("has no stand-in while the chosen provider is answering", () => {
    const t = [st("groq", "active"), st("local", "ok")].reduce(recordStatus, {});
    expect(summarize(t, "llm", "groq").standIn).toBeUndefined();
  });
});

describe("API key validation", () => {
  it("refuses what can't be a key", () => {
    expect(validateApiKey("groq", "")).toMatchObject({ ok: false });
    expect(validateApiKey("groq", "   \n")).toMatchObject({ ok: false });
    expect(validateApiKey("groq", "gsk_abc def ghi jkl")).toMatchObject({ ok: false, error: expect.stringMatching(/spaces/) });
    expect(validateApiKey("groq", "gsk_short")).toMatchObject({ ok: false, error: expect.stringMatching(/short/) });
    expect(validateApiKey("groq", `gsk_${"x".repeat(1100)}`)).toMatchObject({ ok: false, error: expect.stringMatching(/long/) });
  });

  it("trims a pasted key and accepts it", () => {
    expect(validateApiKey("groq", "  gsk_0123456789abcdef\n")).toEqual({ ok: true, value: "gsk_0123456789abcdef" });
  });

  it("warns, without blocking, on a key from another console", () => {
    const c = validateApiKey("anthropic", "sk-proj-0123456789abcdef");
    expect(c.ok).toBe(true);
    expect(c.warning).toMatch(/sk-ant-/);
    // Providers without a known prefix never warn.
    expect(validateApiKey("mistral", "0123456789abcdef").warning).toBeUndefined();
  });
});

describe("settings shape", () => {
  it("fills in defaults for nothing or garbage", () => {
    expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings("x")).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings({ profile: "huge", language: "fr", providers: [] })).toEqual(DEFAULT_SETTINGS);
  });

  it("keeps valid choices and repairs invalid ones", () => {
    const s = normalizeSettings({
      profile: "lite",
      language: "hinglish",
      providers: {
        llm: { provider: "groq", model: "openai/gpt-oss-20b" },
        stt: { provider: "groq", model: "not-a-model" },
        tts: { provider: "nobody", model: "x" },
        embed: { provider: "groq" },
      },
    });
    expect(s.profile).toBe("lite");
    expect(s.language).toBe("hinglish");
    expect(s.providers.llm).toEqual({ provider: "groq", model: "openai/gpt-oss-20b" });
    expect(s.providers.stt).toEqual({ provider: "groq", model: "whisper-large-v3-turbo" });
    expect(s.providers.tts).toEqual({ provider: "local", model: "auto" });
    expect(s.providers.embed).toEqual(DEFAULT_SETTINGS.providers.embed);
  });

  it("switches provider with that provider's default model", () => {
    const s = withProvider(DEFAULT_SETTINGS, "llm", "gemini");
    expect(s.providers.llm).toEqual({ provider: "gemini", model: "gemini-3.8-flash" });
    expect(withModel(s, "llm", "gemini-3.5-flash-lite").providers.llm.model).toBe("gemini-3.5-flash-lite");
    expect(DEFAULT_SETTINGS.providers.llm.provider).toBe("local"); // not mutated
  });

  it("lists the keys the current choices need, once each", () => {
    expect(keysNeeded(DEFAULT_SETTINGS)).toEqual([]);
    let s = withProvider(DEFAULT_SETTINGS, "llm", "gemini");
    s = withProvider(s, "tts", "gemini");
    s = withProvider(s, "stt", "groq");
    expect(keysNeeded(s)).toEqual(["gemini", "groq"]);
  });

  it("has a consistent catalogue", () => {
    for (const def of CAPABILITIES) {
      expect(modelsFor(def.id, DEFAULT_SETTINGS.providers[def.id].provider).map((m) => m.id)).toContain(DEFAULT_SETTINGS.providers[def.id].model);
      for (const p of def.providers) {
        expect(PROVIDERS[p.provider], p.provider).toBeDefined();
        expect(p.models.length).toBeGreaterThan(0);
        // "auto" only makes sense where the core picks a local size.
        if (p.models.some((m) => m.id === "auto")) expect(PROVIDERS[p.provider].local).toBe(true);
        // Provider ids are Keychain account names (secrets.rs accepts [a-z0-9_-]{1,32}).
        expect(p.provider).toMatch(/^[a-z0-9_-]{1,32}$/);
      }
    }
  });
});

describe("hardware profiles and memory", () => {
  it("picks a profile from installed memory", () => {
    expect(recommendProfile(undefined)).toBe("lite");
    expect(recommendProfile(8 * GB)).toBe("lite");
    expect(recommendProfile(16 * GB)).toBe("standard");
    expect(recommendProfile(12 * GB)).toBe("lite");
    expect(recommendProfile(24 * GB)).toBe("standard");
    expect(recommendProfile(32 * GB)).toBe("max");
    expect(recommendProfile(64 * GB)).toBe("max");
    expect(resolveProfile("auto", 16 * GB)).toBe("standard");
    expect(resolveProfile("lite", 64 * GB)).toBe("lite");
  });

  it("warns when a profile would crowd the Mac", () => {
    expect(profileFitWarning("max", 16 * GB)).toMatch(/Max needs about 13 GB for its models; this Mac has 16 GB/);
    expect(profileFitWarning("standard", 8 * GB)).toMatch(/Balanced/);
    expect(profileFitWarning("standard", 16 * GB)).toBeNull();
    expect(profileFitWarning("lite", 8 * GB)).toBeNull();
    expect(profileFitWarning("max", 36 * GB)).toBeNull();
    expect(profileFitWarning("max", undefined)).toBeNull();
  });

  it("splits the meter into in-use and Hikari's part", () => {
    const m = { totalBytes: 16 * GB, usedBytes: 8 * GB, appBytes: 1 * GB, helperBytes: 1 * GB, helperCount: 3 };
    expect(memoryShares(m)).toEqual({ used: 0.5, hikari: 0.125, hikariBytes: 2 * GB });
    expect(memoryShares({ ...m, usedBytes: 20 * GB }).used).toBe(1);
    expect(memoryShares({ ...m, usedBytes: 1 * GB }).hikari).toBe(1 / 16); // never more than in use
    expect(memoryShares({ ...m, totalBytes: 0 })).toEqual({ used: 0, hikari: 0, hikariBytes: 2 * GB });
  });
});
