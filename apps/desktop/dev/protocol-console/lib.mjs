// Shared helpers for the protocol console: schema validation, WAV I/O, formatting.
// Plain ESM + zero runtime deps so B can run it with bare `node` (Node ≥ 22: global WebSocket).
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
export const SCHEMA = JSON.parse(
  readFileSync(join(here, "../../../../packages/protocol/schema/protocol.schema.json"), "utf8"),
);
export const PROTOCOL_VERSION = SCHEMA["x-protocolVersion"];
const DEFS = SCHEMA.$defs;
const PAYLOADS = SCHEMA["x-payloads"];

export function envelope(type, payload, extra = {}) {
  return { v: PROTOCOL_VERSION, type, ts: Date.now(), payload, ...extra };
}

// ---------- validation (the JSON-Schema subset protocol.schema.json uses) ----------

function check(schema, value, path, errs) {
  if (!schema || Object.keys(schema).length === 0) return;
  if (schema.$ref) return check(DEFS[schema.$ref.split("/").pop()], value, path, errs);
  if (schema.const !== undefined && value !== schema.const) {
    errs.push(`${path}: expected ${JSON.stringify(schema.const)}, got ${JSON.stringify(value)}`);
    return;
  }
  if (schema.enum && !schema.enum.includes(value)) {
    errs.push(`${path}: ${JSON.stringify(value)} not in [${schema.enum.join(", ")}]`);
    return;
  }
  const t = schema.type;
  const typeOk =
    !t ||
    (t === "string" && typeof value === "string") ||
    (t === "boolean" && typeof value === "boolean") ||
    (t === "number" && typeof value === "number" && Number.isFinite(value)) ||
    (t === "integer" && Number.isInteger(value)) ||
    (t === "array" && Array.isArray(value)) ||
    (t === "object" && value !== null && typeof value === "object" && !Array.isArray(value));
  if (!typeOk) {
    errs.push(`${path}: expected ${t}, got ${value === null ? "null" : Array.isArray(value) ? "array" : typeof value}`);
    return;
  }
  if (typeof schema.minimum === "number" && value < schema.minimum) errs.push(`${path}: ${value} < minimum ${schema.minimum}`);
  if (typeof schema.maximum === "number" && value > schema.maximum) errs.push(`${path}: ${value} > maximum ${schema.maximum}`);
  if (t === "array" && schema.items) value.forEach((v, i) => check(schema.items, v, `${path}[${i}]`, errs));
  if (t === "object" && schema.properties) {
    for (const k of schema.required ?? []) if (!(k in value)) errs.push(`${path}.${k}: missing (required)`);
    for (const [k, v] of Object.entries(value)) {
      if (schema.properties[k]) check(schema.properties[k], v, `${path}.${k}`, errs);
      else if (schema.additionalProperties === false) errs.push(`${path}.${k}: unknown field`);
    }
  }
}

/** Validate a decoded frame against the envelope and its payload def. Returns error strings. */
export function validate(msg) {
  const errs = [];
  check(DEFS.Envelope, msg, "msg", errs);
  const def = PAYLOADS[msg?.type];
  if (def && msg?.payload && typeof msg.payload === "object") check(DEFS[def], msg.payload, "payload", errs);
  return errs;
}

// ---------- WAV ----------

/** Parse a PCM WAV (8/16/24/32-bit int or 32-bit float, any channels) → mono Float32 + rate. */
export function readWav(buf) {
  if (buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WAVE") throw new Error("not a RIFF/WAVE file");
  let off = 12;
  let fmt = null;
  let data = null;
  while (off + 8 <= buf.length) {
    const id = buf.toString("ascii", off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    const body = off + 8;
    if (id === "fmt ") {
      fmt = {
        format: buf.readUInt16LE(body),
        channels: buf.readUInt16LE(body + 2),
        rate: buf.readUInt32LE(body + 4),
        bits: buf.readUInt16LE(body + 14),
      };
      if (fmt.format === 0xfffe) fmt.format = buf.readUInt16LE(body + 24); // WAVE_FORMAT_EXTENSIBLE subformat
    } else if (id === "data") {
      data = buf.subarray(body, Math.min(buf.length, body + size));
    }
    off = body + size + (size & 1);
  }
  if (!fmt || !data) throw new Error("WAV missing fmt or data chunk");
  const { format, channels, rate, bits } = fmt;
  const bytes = bits / 8;
  const frames = Math.floor(data.length / (bytes * channels));
  const out = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    let s = 0;
    for (let c = 0; c < channels; c++) {
      const p = (i * channels + c) * bytes;
      let v;
      if (format === 3 && bits === 32) v = data.readFloatLE(p);
      else if (bits === 16) v = data.readInt16LE(p) / 32768;
      else if (bits === 24) v = data.readIntLE(p, 3) / 8388608;
      else if (bits === 32) v = data.readInt32LE(p) / 2147483648;
      else if (bits === 8) v = (data.readUInt8(p) - 128) / 128;
      else throw new Error(`unsupported WAV: format ${format}, ${bits}-bit`);
      s += v;
    }
    out[i] = s / channels;
  }
  return { samples: out, rate };
}

/** Linear resample (fine for feeding STT test clips). */
export function resample(samples, from, to) {
  if (from === to) return samples;
  const n = Math.round((samples.length * to) / from);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i * from) / to;
    const i0 = Math.floor(x);
    const i1 = Math.min(samples.length - 1, i0 + 1);
    out[i] = samples[i0] + (samples[i1] - samples[i0]) * (x - i0);
  }
  return out;
}

export function floatToPcm16(samples) {
  const b = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i++) b.writeInt16LE(Math.round(Math.max(-1, Math.min(1, samples[i])) * 32767), i * 2);
  return b;
}

/** Decode a tts.chunk / audio.in.chunk payload's base64 audio → Int16 PCM buffer. */
export function chunkToPcm16(p) {
  const raw = Buffer.from(p.pcm ?? p.data, "base64");
  if (p.encoding !== "pcm_f32le") return raw;
  const f = new Float32Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.length));
  return floatToPcm16(f);
}

export function writeWav(pcm16, rate) {
  const h = Buffer.alloc(44);
  h.write("RIFF", 0, "ascii");
  h.writeUInt32LE(36 + pcm16.length, 4);
  h.write("WAVEfmt ", 8, "ascii");
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20); // PCM
  h.writeUInt16LE(1, 22); // mono
  h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write("data", 36, "ascii");
  h.writeUInt32LE(pcm16.length, 40);
  return Buffer.concat([h, pcm16]);
}

// ---------- formatting ----------

const C = process.stdout.isTTY && !process.env.NO_COLOR
  ? { dim: (s) => `\x1b[2m${s}\x1b[0m`, red: (s) => `\x1b[31m${s}\x1b[0m`, green: (s) => `\x1b[32m${s}\x1b[0m`, cyan: (s) => `\x1b[36m${s}\x1b[0m`, yellow: (s) => `\x1b[33m${s}\x1b[0m` }
  : { dim: (s) => s, red: (s) => s, green: (s) => s, cyan: (s) => s, yellow: (s) => s };
export { C as color };

const clip = (s, n = 70) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

/** One-line human summary of an incoming message. */
export function summarize(m) {
  const p = m.payload ?? {};
  switch (m.type) {
    case "hello": return `role=${p.role} protocol=${p.protocolVersion}${p.capabilities?.length ? ` caps=[${p.capabilities.join(",")}]` : ""}`;
    case "stt.partial": case "stt.final": return `${JSON.stringify(p.text)}${p.language ? ` (${p.language})` : ""}`;
    case "llm.token": return JSON.stringify(p.delta) + (p.provider ? C.dim(` via ${p.provider}`) : "");
    case "tts.chunk": {
      const ms = p.durationMs ?? Math.round((Buffer.from(p.pcm, "base64").length / (p.encoding === "pcm_f32le" ? 4 : 2) / p.sampleRate) * 1000);
      const ph = p.phonemes?.length ? `${p.phonemes.length} phonemes (${p.phonemeSource ?? "?"})` : C.yellow("no phonemes");
      return `seq=${p.seq} ${ms}ms @${p.sampleRate}Hz ${ph} ${JSON.stringify(clip(p.text, 50))}`;
    }
    case "avatar.emotion": return `${p.name} ${p.intensity}${p.seq !== undefined ? ` from seq ${p.seq}` : ""}`;
    case "avatar.gesture": return `${p.tag} at +${p.atMs}ms${p.seq !== undefined ? ` of seq ${p.seq}` : ""}`;
    case "state": return p.state + (p.detail ? ` (${p.detail})` : "");
    case "tool.request": return `${C.yellow(p.tier)} ${p.tool} — ${p.summary} ${C.dim(`callId=${p.callId}`)}`;
    case "tool.result": return `${p.callId} ${p.ok ? C.green("ok") : C.red("failed")} ${p.error ?? ""}`;
    case "provider.status": return `${p.capability}/${p.provider}${p.model ? `:${p.model}` : ""} ${p.status}${p.reason ? ` — ${p.reason}` : ""}`;
    case "latency.mark": return `${p.stage} ${p.ms}ms`;
    case "memory.results": return `${p.items?.length ?? 0} items${p.total !== undefined ? ` of ${p.total}` : ""}`;
    case "error": return C.red(`${p.code}: ${p.message}${p.recoverable ? " (recoverable)" : ""}`);
    default: return clip(JSON.stringify(p), 100);
  }
}

/**
 * Per-turn latency tracker. Starts at the moment the console finishes sending
 * input (end of text / end of streamed audio ≈ end-of-speech) and records the
 * first arrival of each pipeline stage, plus whatever latency.mark the core reports.
 */
export class TurnTimer {
  constructor() { this.reset(); }
  reset() { this.t0 = null; this.first = {}; this.core = {}; this.chunks = []; this.rate = 0; }
  start() { this.reset(); this.t0 = performance.now(); }
  see(m) {
    if (this.t0 === null) return;
    const dt = Math.round(performance.now() - this.t0);
    if (!(m.type in this.first)) this.first[m.type] = dt;
    if (m.type === "latency.mark") this.core[m.payload.stage] = m.payload.ms;
    if (m.type === "tts.chunk") { this.chunks.push(chunkToPcm16(m.payload)); this.rate = m.payload.sampleRate; }
  }
  report() {
    const f = this.first;
    const row = (label, v) => `  ${label.padEnd(22)} ${v === undefined ? C.dim("—") : `${v} ms`}`;
    return [
      C.cyan("turn latency (client clock, from end of input):"),
      row("stt.final", f["stt.final"]),
      row("first llm.token", f["llm.token"]),
      row("first tts.chunk", f["tts.chunk"]),
      row("tts.end", f["tts.end"]),
      ...(Object.keys(this.core).length
        ? [C.cyan("core-reported latency.mark (from EOS):"), ...Object.entries(this.core).map(([k, v]) => row(k, v))]
        : []),
      f["tts.chunk"] !== undefined
        ? (f["tts.chunk"] <= 1200 ? C.green("  ✓ under the 1.2 s first-audio target") : C.red("  ✗ over the 1.2 s first-audio target"))
        : "",
    ].filter(Boolean).join("\n");
  }
  /** Concatenate this turn's TTS audio as a WAV buffer (null if none). */
  wav() { return this.chunks.length ? writeWav(Buffer.concat(this.chunks), this.rate) : null; }
}
