import { describe, expect, it } from "vitest";
import { base64ToBytes, bytesToBase64, encodeWav, meterLevel, parseWav, takeProblems, takeStats, trimSilence } from "./wav";
import { attestations, canAdvance, canRecord, consentRecord, consentReducer, consentStatement, initialConsent, STATEMENT_MIN_MS, type ConsentEvent, type ConsentState } from "./consent";
import { binomialTwoSided, canChoose, choose, makeTrial, mulberry32, tally, verdict, type AbPair, type AbResult } from "./ab";
import { canTrain, formatMetric, initialLab, labReducer, meetsTarget, newVoiceId, nextToRecord, parseAbPair, parseEval, parseProgress, parseVoice, sessionProgress, voiceStatusLabel, type LabAction, type Take } from "./ops";
import { FakeVoiceLabCore } from "./devCore";

const tone = (seconds: number, rate: number, amp = 0.5, hz = 220) =>
  Float32Array.from({ length: Math.round(seconds * rate) }, (_, i) => amp * Math.sin((2 * Math.PI * hz * i) / rate));

describe("WAV encoding", () => {
  it("writes a valid 16-bit mono header and round-trips samples", () => {
    const s = Float32Array.from([0, 0.5, -0.5, 1, -1, 2, -2]);
    const wav = encodeWav(s, 24000);
    expect(wav.length).toBe(44 + s.length * 2);
    const v = new DataView(wav.buffer);
    expect(String.fromCharCode(...wav.subarray(0, 4))).toBe("RIFF");
    expect(v.getUint32(4, true)).toBe(wav.length - 8);
    expect(String.fromCharCode(...wav.subarray(8, 16))).toBe("WAVEfmt ");
    expect(v.getUint16(22, true)).toBe(1); // mono
    expect(v.getUint32(24, true)).toBe(24000);
    expect(v.getUint32(28, true)).toBe(48000); // byte rate
    expect(v.getUint16(34, true)).toBe(16);
    expect(v.getInt16(44 + 3 * 2, true)).toBe(32767); // +1
    expect(v.getInt16(44 + 4 * 2, true)).toBe(-32768); // −1
    expect(v.getInt16(44 + 5 * 2, true)).toBe(32767); // clamped
    const back = parseWav(wav);
    expect(back.sampleRate).toBe(24000);
    expect(back.channels).toBe(1);
    expect(back.samples[1]).toBeCloseTo(0.5, 3);
    expect(back.samples[2]).toBeCloseTo(-0.5, 3);
  });

  it("survives base64 and rejects non-WAV data", () => {
    const wav = encodeWav(tone(0.1, 16000), 16000);
    expect(base64ToBytes(bytesToBase64(wav))).toEqual(wav);
    expect(() => parseWav(new Uint8Array(20))).toThrow(/not a WAV/);
  });

  it("maps levels to a −60…0 dBFS meter", () => {
    expect(meterLevel(0)).toBe(0);
    expect(meterLevel(1)).toBe(1);
    expect(meterLevel(0.001)).toBeCloseTo(0, 5); // −60 dB
    expect(meterLevel(0.1)).toBeCloseTo(2 / 3, 5); // −20 dB
  });

  it("flags takes that are short, quiet or clipped", () => {
    expect(takeProblems(takeStats(tone(2, 24000), 24000))).toEqual([]);
    expect(takeProblems(takeStats(tone(0.3, 24000), 24000))).toContain("too_short");
    expect(takeProblems(takeStats(tone(2, 24000, 0.002), 24000))).toContain("too_quiet");
    expect(takeProblems(takeStats(tone(2, 24000, 1.4), 24000))).toContain("clipped");
  });

  it("trims silence but keeps some room", () => {
    const rate = 16000;
    const s = new Float32Array(rate * 3);
    s.set(tone(1, rate), rate); // silence 1 s, tone 1 s, silence 1 s
    const t = trimSilence(s, rate, { padMs: 100 });
    expect(t.length / rate).toBeGreaterThan(1.15);
    expect(t.length / rate).toBeLessThan(1.3);
    expect(trimSilence(new Float32Array(rate), rate).length).toBe(0);
  });
});

describe("consent state machine", () => {
  const run = (events: ConsentEvent[], s: ConsentState = initialConsent) => events.reduce(consentReducer, s);
  const clip = (durationMs = STATEMENT_MIN_MS + 1000, peak = 0.4) => ({ wavBase64: "UklGRg==", sampleRate: 24000, durationMs, peak });
  const tickAll = (s: ConsentState): ConsentEvent[] => attestations(s.owner!, s.speakerName).map((a) => ({ type: "attest", key: a.key, value: true }));

  it("own voice: choose, attest, submit, and only the core's yes grants", () => {
    let s = run([{ type: "next" }]);
    expect(s.step).toBe("owner"); // can't skip choosing
    s = run([{ type: "owner", owner: "self" }, { type: "next" }], s);
    expect(s.step).toBe("attest");
    s = run([{ type: "submit" }], s);
    expect(s.step).toBe("attest"); // not ticked
    s = run([...tickAll(s), { type: "submit" }], s);
    expect(s.step).toBe("submitting");
    expect(canRecord(s)).toBe(false);
    s = run([{ type: "attest", key: "own", value: false }, { type: "back" }], s); // ignored while submitting
    expect(s.step).toBe("submitting");
    s = run([{ type: "accepted", consentId: "c1", at: 5 }], s);
    expect(s.step).toBe("granted");
    expect(canRecord(s)).toBe(true);
    expect(s.consentId).toBe("c1");
  });

  it("someone else's voice needs the speaker, a full statement recording and every attestation", () => {
    let s = run([{ type: "owner", owner: "other" }, { type: "next" }]);
    expect(s.step).toBe("speaker");
    s = run([{ type: "speaker", speakerName: "P" }, { type: "next" }], s);
    expect(s.step).toBe("speaker"); // name too short, no relationship
    s = run([{ type: "speaker", speakerName: "Priya", relationship: "Friend" }, { type: "next" }], s);
    expect(s.step).toBe("statement");
    s = run([{ type: "statement", clip: clip(2000) }, { type: "next" }], s);
    expect(s.step).toBe("statement"); // too short to be the whole statement
    s = run([{ type: "statement", clip: clip(STATEMENT_MIN_MS + 500, 0.01) }, { type: "next" }], s);
    expect(s.step).toBe("statement"); // silent
    s = run([{ type: "statement", clip: clip() }, { type: "next" }], s);
    expect(s.step).toBe("attest");
    const keys = attestations("other", "Priya");
    expect(keys).toHaveLength(5);
    expect(keys[0].text).toContain("Priya");
    s = run([...tickAll(s).slice(0, 4), { type: "submit" }], s);
    expect(s.step).toBe("attest"); // one box left
    s = run([...tickAll(s), { type: "submit" }, { type: "refused", reason: "Statement unclear" }], s);
    expect(s.step).toBe("attest");
    expect(s.error).toBe("Statement unclear");
    expect(canRecord(s)).toBe(false);
  });

  it("renaming the speaker throws away their statement and ticks", () => {
    let s = run([
      { type: "owner", owner: "other" }, { type: "next" },
      { type: "speaker", speakerName: "Priya", relationship: "Friend" }, { type: "next" },
      { type: "statement", clip: clip() }, { type: "next" },
    ]);
    s = run([...tickAll(s), { type: "back" }, { type: "back" }], s);
    expect(s.step).toBe("speaker");
    expect(s.statement).toBeDefined(); // kept while unchanged
    s = run([{ type: "speaker", relationship: "Family member" }], s);
    expect(s.statement).toBeDefined(); // relationship alone doesn't name them
    s = run([{ type: "speaker", speakerName: "Riya" }], s);
    expect(s.statement).toBeUndefined();
    expect(s.attest).toEqual({});
    s = run([{ type: "next" }, { type: "next" }], s);
    expect(s.step).toBe("statement");
  });

  it("switching owner starts over", () => {
    const s = run([{ type: "owner", owner: "self" }, { type: "next" }, { type: "attest", key: "own", value: true }, { type: "back" }, { type: "owner", owner: "other" }]);
    expect(s).toMatchObject({ step: "owner", owner: "other", attest: {} });
  });

  it("restores consent the core already holds, and nothing un-grants it but a reset", () => {
    let s = run([{ type: "restore", owner: "other", speakerName: "Priya", consentId: "c9" }]);
    expect(canRecord(s)).toBe(true);
    s = run([{ type: "owner", owner: "self" }, { type: "back" }, { type: "refused", reason: "x" }], s);
    expect(s.step).toBe("granted");
    expect(run([{ type: "reset" }], s)).toEqual(initialConsent);
  });

  it("builds the record the core stores", () => {
    let s = run([{ type: "owner", owner: "other" }, { type: "next" }, { type: "speaker", speakerName: " Priya ", relationship: "Friend" }, { type: "next" }, { type: "statement", clip: clip() }, { type: "next" }]);
    s = run(tickAll(s), s);
    expect(canAdvance(s)).toBe(true);
    const text = consentStatement("Priya", new Date(2026, 10, 26));
    expect(text).toMatch(/^My name is Priya, and today is 26 November 2026\./);
    const rec = consentRecord(s, text, 1234);
    expect(rec).toMatchObject({ owner: "other", speakerName: "Priya", relationship: "Friend", agreedAt: 1234, statement: { text, encoding: "wav", audio: "UklGRg==" } });
    expect(rec.attestations.every((a) => a.agreed)).toBe(true);
    expect(consentRecord(run([{ type: "owner", owner: "self" }]), undefined, 1).statement).toBeUndefined();
  });
});

describe("A/B test", () => {
  const pair = (i: number): AbPair => ({ pairId: `p${i}`, text: "Namaste!", samples: [{ id: "x", system: "base", audio: "AA" }, { id: "y", system: "adapter", audio: "BB" }] });

  it("shuffles A/B fairly and reproducibly", () => {
    const rand = mulberry32(42);
    const trials = Array.from({ length: 2000 }, (_, i) => makeTrial(pair(i), rand));
    const swapped = trials.filter((t) => t.swapped).length;
    expect(swapped / trials.length).toBeGreaterThan(0.46);
    expect(swapped / trials.length).toBeLessThan(0.54);
    expect(trials.every((t) => t.A.system !== t.B.system)).toBe(true);
    const again = Array.from({ length: 5 }, (_, i) => makeTrial(pair(i), mulberry32(42)).swapped);
    expect(again.every((x) => x === again[0])).toBe(true); // same seed, same first draw
    expect(makeTrial(pair(0), () => 0.9).A.system).toBe("base");
    expect(makeTrial(pair(0), () => 0.1).A.system).toBe("adapter");
  });

  it("records the preferred system, not the letter", () => {
    const t = makeTrial(pair(0), () => 0.1); // A = adapter
    expect(canChoose({ A: true, B: false })).toBe(false);
    const r = choose(t, "A", { A: true, B: true }, 4200.4);
    expect(r).toMatchObject({ preferred: "adapter", other: "base", shown: { A: "adapter", B: "base" }, decisionMs: 4200 });
    expect(choose(t, "same", { A: true, B: true }, 1).preferred).toBeNull();
  });

  it("tallies wins, ties, position bias and significance", () => {
    const res = (preferred: string | null, choice: AbResult["choice"]): AbResult => ({ pairId: "p", choice, preferred, other: null, shown: { A: "base", B: "adapter" }, listened: { A: true, B: true }, decisionMs: 1 });
    const t = tally([...Array(9).fill(res("adapter", "B")), res("base", "A"), res(null, "same")]);
    expect(t).toMatchObject({ trials: 11, ties: 1, wins: { adapter: 9, base: 1 }, leader: "adapter" });
    expect(t.share).toBeCloseTo(0.9);
    expect(t.aShare).toBeCloseTo(0.1);
    expect(t.p).toBeCloseTo(0.0215, 3); // 9 of 10, two-sided
    expect(verdict(t, (s) => (s === "adapter" ? "Trained" : "Base"))).toMatch(/^Trained preferred in 9 of 10: a clear preference/);
    expect(tally([res("base", "A"), res("adapter", "B")]).leader).toBeUndefined();
    expect(verdict(tally([]))).toBe("No comparisons yet.");
  });

  it("computes exact binomial p-values", () => {
    expect(binomialTwoSided(5, 10)).toBeCloseTo(1, 6);
    expect(binomialTwoSided(10, 10)).toBeCloseTo(2 / 1024, 6);
    expect(binomialTwoSided(0, 0)).toBe(1);
  });
});

describe("Voice Lab protocol data", () => {
  const ev = (op: string, data?: unknown, voiceId = "v1"): LabAction => ({ type: "core", event: { op, voiceId, data } });

  it("parses voices defensively", () => {
    expect(parseVoice({ name: "x" })).toBeUndefined();
    expect(parseVoice({ id: "v1" })).toMatchObject({ name: "Untitled voice", status: "consent", consentOk: false, minClips: 20 });
    expect(parseVoice({ id: "v1", consent: { ok: true } })?.status).toBe("recording");
    expect(parseVoice({ id: "v1", status: "bogus", consentOk: true, language: "xx" })).toMatchObject({ status: "recording", language: undefined });
  });

  it("folds core events into state", () => {
    let s = [ev("voices.list", { voices: [{ id: "v1", name: "Priya", status: "consent", minClips: 2, targetClips: 3 }] }, "")].reduce(labReducer, initialLab);
    expect(s.listed).toBe(true);
    s = [ev("consent.check", { ok: true, owner: "other", speakerName: "Priya" })].reduce(labReducer, s);
    expect(s.voices[0]).toMatchObject({ consentOk: true, status: "recording", owner: "other" });
    s = [ev("script.get", { lines: [{ id: "l1", text: "One" }, { id: "l2", text: "  " }, { text: "Three" }], recorded: ["l1"] })].reduce(labReducer, s);
    expect(s.scripts.v1.map((l) => l.id)).toEqual(["l1", "line-3"]);
    expect(s.takes.v1.l1.status).toBe("saved");
    s = labReducer(s, { type: "take", voiceId: "v1", lineId: "line-3", take: { status: "saving", take: 2 } });
    s = labReducer(s, ev("clip.ack", { lineId: "line-3", ok: false, reason: "Clipped", take: 1 })); // stale take
    expect(s.takes.v1["line-3"].status).toBe("saving");
    s = labReducer(s, ev("clip.ack", { lineId: "line-3", ok: true, take: 2, clips: 2 }));
    expect(s.takes.v1["line-3"].status).toBe("saved");
    expect(s.voices[0].clips).toBe(2);
    s = labReducer(s, ev("train.progress", { stage: "training", progress: 45 }));
    expect(s.voices[0]).toMatchObject({ status: "training", progress: 0.45 });
    s = labReducer(s, ev("train.progress", { stage: "done" }));
    expect(s.voices[0]).toMatchObject({ status: "ready", progress: 1 });
    s = labReducer(s, ev("voice.updated", { voice: { id: "v2", name: "Me", owner: "self" } }));
    expect(s.voices.map((v) => v.id)).toEqual(["v1", "v2"]);
    s = labReducer(s, ev("voice.deleted", {}, "v2"));
    expect(s.voices).toHaveLength(1);
    s = labReducer(s, ev("error", { message: "GPU busy", about: "train.start" }));
    expect(s.errors.v1).toEqual({ message: "GPU busy", about: "train.start" });
  });

  it("drives the recording session", () => {
    const lines = [{ id: "a", text: "A" }, { id: "b", text: "B" }, { id: "c", text: "C" }];
    const takes: Record<string, Take> = { a: { status: "saved", take: 1, durationMs: 60_000 }, b: { status: "rejected", take: 1 } };
    expect(sessionProgress(lines, takes)).toEqual({ done: 1, total: 3, minutes: 1 });
    expect(nextToRecord(lines, takes, 0)).toBe(1); // rejected → redo
    expect(nextToRecord(lines, { ...takes, b: { status: "saved", take: 2 } }, 1)).toBe(2);
    expect(nextToRecord(lines, { a: takes.a, b: { status: "saved", take: 1 }, c: { status: "saving", take: 1 } }, 2)).toBe(-1);
    const v = parseVoice({ id: "v", consentOk: true, minClips: 2 })!;
    expect(canTrain(v, takes)).toBe(false);
    expect(canTrain(v, { ...takes, b: { status: "saved", take: 2 } })).toBe(true);
    expect(canTrain(v, { ...takes, b: { status: "saved", take: 2 }, c: { status: "saving", take: 1 } })).toBe(false);
    expect(canTrain({ ...v, consentOk: false, clips: 99 })).toBe(false);
    expect(voiceStatusLabel({ ...v, status: "recording", targetClips: 40 }, takes)).toBe("Recording · 1 of 40");
  });

  it("reads progress, eval reports and A/B pairs", () => {
    expect(parseProgress({ stage: "weird", progress: 0.3, etaSec: 90 })).toMatchObject({ stage: "training", progress: 0.3, etaSec: 90 });
    const r = parseEval({ metrics: { speakerSimilarity: 0.81, cer: 0.032, ttfaMs: 410, custom: 2 }, samples: [{ label: "Hindi", audio: "AA" }, { label: "no audio" }] });
    expect(r.metrics.map((m) => m.key)).toEqual(["speakerSimilarity", "cer", "ttfaMs", "custom"]);
    expect(r.samples).toHaveLength(1);
    const [sim, cer, ttfa] = r.metrics;
    expect([meetsTarget(sim), meetsTarget(cer), meetsTarget(ttfa), meetsTarget(r.metrics[3])]).toEqual([true, true, false, undefined]);
    expect([formatMetric(sim), formatMetric(cer), formatMetric(ttfa)]).toEqual(["0.81", "3.2%", "410 ms"]);
    expect(parseEval({ metrics: [{ key: "rtf", value: 0.4 }, { key: "x" }] }).metrics).toMatchObject([{ key: "rtf", better: "lower", target: 1 }]);
    expect(parseAbPair({ pairId: "p", samples: [{ system: "a", audio: "A" }, { system: "b", audio: "B" }] })?.samples[1].system).toBe("b");
    expect(parseAbPair({ pairId: "p", samples: [{ system: "a", audio: "A" }, { system: "a", audio: "B" }] })).toBeUndefined();
    expect(parseAbPair({ pairId: "p", samples: [{ system: "a", audio: "A" }] })).toBeUndefined();
  });

  it("makes readable voice ids", () => {
    expect(newVoiceId("Priya's Voice!", () => 0.5)).toMatch(/^priyas-voice-[0-9a-z]{4}$/);
    expect(newVoiceId("हिंदी", () => 0)).toBe("voice-0000");
  });
});

describe("dev preview Voice Lab core", () => {
  it("refuses clips before consent and accepts them after", () => {
    const core = new FakeVoiceLabCore(() => undefined);
    core.handle("voice_lab.event", { op: "voice.create", voiceId: "v", data: { name: "Me" } });
    const early = core.handle("voice_lab.event", { op: "clip.saved", voiceId: "v", data: { lineId: "l1", take: 1, audio: "AA" } });
    expect(early[0].payload).toMatchObject({ op: "clip.ack", data: { ok: false } });
    core.handle("voice_lab.event", { op: "consent.record", voiceId: "v", data: { owner: "self", attestations: [{ key: "own", agreed: true }] } });
    const ok = core.handle("voice_lab.event", { op: "clip.saved", voiceId: "v", data: { lineId: "l1", take: 1, audio: "AA" } });
    expect(ok[0].payload).toMatchObject({ op: "clip.ack", data: { ok: true, lineId: "l1" } });
  });
});

describe("Voice Lab window state", () => {
  it("grants consent only on the core's confirmation, and drops it when the core says it's gone", async () => {
    const { uiReducer, initialUi, consentOf } = await import("./state");
    const core = (op: string, data: unknown) => ({ type: "core" as const, event: { op, voiceId: "v", data } });
    let s = uiReducer(initialUi, { type: "consent", voiceId: "v", event: { type: "owner", owner: "self" } });
    s = uiReducer(s, { type: "consent", voiceId: "v", event: { type: "next" } });
    for (const a of attestations("self", "")) s = uiReducer(s, { type: "consent", voiceId: "v", event: { type: "attest", key: a.key, value: true } });
    s = uiReducer(s, { type: "consent", voiceId: "v", event: { type: "submit" } });
    expect(consentOf(s, "v").step).toBe("submitting");
    const lost = uiReducer(s, { type: "offline" });
    expect(consentOf(lost, "v")).toMatchObject({ step: "attest", error: expect.stringMatching(/Lost the connection/) });
    const refused = uiReducer(s, core("consent.check", { ok: false, reason: "No" }));
    expect(consentOf(refused, "v")).toMatchObject({ step: "attest", error: "No" });
    s = uiReducer(s, core("consent.check", { ok: true, consentId: "c1" }));
    expect(consentOf(s, "v")).toMatchObject({ step: "granted", consentId: "c1" });
    s = uiReducer(s, core("consent.check", { ok: false }));
    expect(consentOf(s, "v").step).toBe("owner");
    // Reopening: the core already has consent → granted without the form.
    expect(consentOf(uiReducer(initialUi, core("consent.check", { ok: true, owner: "other", speakerName: "Priya" })), "v")).toMatchObject({ step: "granted", owner: "other", speakerName: "Priya" });
  });

  it("keeps A/B order stable for a pair within a session", async () => {
    const { trialRng } = await import("./ab");
    const p: AbPair = { pairId: "pair-7", samples: [{ id: "x", system: "base", audio: "A" }, { id: "y", system: "adapter", audio: "B" }] };
    expect(makeTrial(p, trialRng(123, "pair-7")).swapped).toBe(makeTrial(p, trialRng(123, "pair-7")).swapped);
    const flips = Array.from({ length: 400 }, (_, i) => makeTrial({ ...p, pairId: `pair-${i}` }, trialRng(99, `pair-${i}`)).swapped).filter(Boolean).length;
    expect(flips).toBeGreaterThan(160);
    expect(flips).toBeLessThan(240);
  });
});
