import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocketServer, type WebSocket } from "ws";
// @ts-expect-error plain ESM helper without types
import { envelope, readWav, validate, writeWav, floatToPcm16 } from "./lib.mjs";

const CONSOLE = join(__dirname, "console.mjs");

/** Minimal fake core: answers hello, replies to text.in / audio with a scripted turn. */
function fakeCore(behaviour: "good" | "bad" = "good") {
  const wss = new WebSocketServer({ port: 0 });
  const received: Array<{ type: string; payload: Record<string, unknown> }> = [];
  wss.on("connection", (ws: WebSocket) => {
    ws.on("message", (raw) => {
      const m = JSON.parse(String(raw));
      received.push(m);
      const tx = (type: string, payload: unknown) => ws.send(JSON.stringify(envelope(type, payload, { turnId: "t1" })));
      if (m.type === "hello") tx("hello", { role: "core", protocolVersion: "0.1.0" });
      const trigger = m.type === "text.in" || (m.type === "audio.in.chunk" && m.payload.seq === 4);
      if (!trigger) return;
      tx("turn.start", { reason: "text" });
      tx("llm.token", { delta: "Namaste! " });
      tx("llm.token", { delta: "Kaise ho?" });
      const pcm = floatToPcm16(new Float32Array(2400).fill(0.1)).toString("base64");
      if (behaviour === "bad") tx("tts.chunk", { seq: 0, sampleRate: 24000, pcm }); // missing encoding + text
      else tx("tts.chunk", { seq: 0, sampleRate: 24000, encoding: "pcm_s16le", pcm, text: "Namaste! Kaise ho?", phonemes: [{ p: "n", start: 0, end: 50 }] });
      tx("avatar.emotion", { name: "joy", intensity: 0.7, seq: 0 });
      tx("latency.mark", { stage: "tts_first_chunk", ms: 640 });
      tx("tts.end", { reason: "complete" });
    });
  });
  const port = (wss.address() as { port: number }).port;
  return { url: `ws://127.0.0.1:${port}/ws`, received, close: () => wss.close() };
}

function run(args: string[]): Promise<{ code: number | null; out: string }> {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [CONSOLE, ...args], { env: { ...process.env, NO_COLOR: "1" } });
    let out = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (out += d));
    p.on("close", (code) => resolve({ code, out }));
  });
}

let core: ReturnType<typeof fakeCore> | undefined;
afterEach(() => core?.close());

describe("protocol console (end to end against a fake core)", () => {
  it("--say: sends hello + text.in, prints reply and latency, saves audio, exits 0", async () => {
    core = fakeCore();
    const dir = mkdtempSync(join(tmpdir(), "hk-console-"));
    const { code, out } = await run(["--url", core.url, "--say", "hi", "--save", dir, "--timeout", "5"]);
    expect(out).toContain("reply Namaste! Kaise ho?");
    expect(out).toContain("first tts.chunk");
    expect(out).toContain("tts_first_chunk");
    expect(code).toBe(0);
    expect(core.received.map((m) => m.type)).toEqual(["hello", "text.in"]);
    expect(core.received[0].payload.role).toBe("console");
    const wav = readWav(readFileSync(join(dir, "turn-1.wav")));
    expect(wav.rate).toBe(24000);
    expect(wav.samples.length).toBe(2400);
  });

  it("exits 1 and reports the field when the core sends a schema-invalid frame", async () => {
    core = fakeCore("bad");
    const { code, out } = await run(["--url", core.url, "--say", "hi", "--timeout", "5"]);
    expect(out).toContain("✗ schema: tts.chunk");
    expect(out).toContain("payload.encoding: missing (required)");
    expect(code).toBe(1);
  });

  it("--wav: streams 16 kHz PCM16 audio.in.chunk frames", async () => {
    core = fakeCore();
    const dir = mkdtempSync(join(tmpdir(), "hk-console-"));
    const f = join(dir, "in.wav");
    // 0.1 s of mono 96 kHz → console must resample to 16 kHz (1600 samples = 5 × 20 ms frames).
    writeFileSync(f, writeWav(floatToPcm16(new Float32Array(9600).fill(0.2)), 96000));
    const { code } = await run(["--url", core.url, "--wav", f, "--fast", "--timeout", "5"]);
    expect(code).toBe(0);
    const chunks = core.received.filter((m) => m.type === "audio.in.chunk");
    expect(chunks.length).toBe(5); // 100 ms / 20 ms
    expect(chunks.every((c) => c.payload.sampleRate === 16000 && c.payload.encoding === "pcm_s16le")).toBe(true);
    expect(validate(envelope("audio.in.chunk", chunks[0].payload))).toEqual([]);
  });

  it("exits 2 when no core is listening", async () => {
    const { code, out } = await run(["--url", "ws://127.0.0.1:1/ws", "--say", "hi"]);
    expect(code).toBe(2);
    expect(out).toMatch(/connection failed|could not connect/);
  });
});

describe("lib", () => {
  it("validates envelopes and nested payloads", () => {
    expect(validate(envelope("state", { state: "idle" }))).toEqual([]);
    expect(validate(envelope("state", { state: "dancing" }))[0]).toContain("not in");
    expect(validate({ ...envelope("state", { state: "idle" }), v: "9.0.0" })[0]).toContain("msg.v");
    const bad = validate(envelope("tts.chunk", { seq: 0, sampleRate: 24000, encoding: "pcm_s16le", pcm: "", text: "x", phonemes: [{ p: "a", start: "0" }] }));
    expect(bad.some((e: string) => e.includes("phonemes[0].start: expected number"))).toBe(true);
    expect(bad.some((e: string) => e.includes("phonemes[0].end: missing"))).toBe(true);
  });

  it("downmixes stereo WAV to mono", () => {
    // L=0.5, R=-0.1 interleaved → mono 0.2. Patch a mono header to 2 channels.
    const pcm = floatToPcm16(new Float32Array([0.5, -0.1, 0.5, -0.1]));
    const buf = writeWav(pcm, 16000);
    buf.writeUInt16LE(2, 22); // channels
    buf.writeUInt32LE(16000 * 4, 28); // byte rate
    buf.writeUInt16LE(4, 32); // block align
    const { samples } = readWav(buf);
    expect(samples.length).toBe(2);
    expect(Math.round(samples[0] * 100) / 100).toBe(0.2);
  });

  it("WAV write/read round trip", () => {
    const s = new Float32Array([0, 0.5, -0.5, 0.25]);
    const back = readWav(writeWav(floatToPcm16(s), 16000));
    expect(back.rate).toBe(16000);
    expect(Array.from(back.samples).map((x: number) => Math.round(x * 100) / 100)).toEqual([0, 0.5, -0.5, 0.25]);
  });
});
