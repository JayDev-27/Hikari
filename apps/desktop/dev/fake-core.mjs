#!/usr/bin/env node
// Dev fake core (Person A's side) — stands in for the Python core until B's real
// pipeline exists, so the desktop app can be exercised end to end:
//
//   voice:  mic audio.in.chunk → (PTT release `turn.end`, or end of speech in
//           always-listening mode) → echoes your own audio back as tts.chunk
//   text:   text.in (e.g. from the protocol console) → macOS `say` → tts.chunk
//           (Lekha for Devanagari, Tara for English/Hinglish)
//
// Phonemes are estimated from loudness so the lips move; it is NOT STT/LLM/TTS.
// Replies are broadcast to every connected UI, so `pnpm -F desktop console --say …`
// makes the running app speak. Logs mic frame rate and level once a second.
//
//   pnpm -F desktop fake-core [--port 8765]
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebSocketServer } from "ws";
import { PROTOCOL_VERSION, envelope, floatToPcm16, readWav, resample } from "./protocol-console/lib.mjs";

const argPort = process.argv.indexOf("--port");
const PORT = argPort > 0 ? Number(process.argv[argPort + 1]) : 8765;
const OUT_RATE = 24000;

const wss = new WebSocketServer({ host: "127.0.0.1", port: PORT });
const clients = new Map(); // ws -> { role, audio: Int16[] chunks, speechMs, silenceMs, frames, levelSum }
let speakingUntil = 0;
let turnNo = 0;
const log = (...a) => console.log(new Date().toISOString().slice(11, 23), ...a);

wss.on("listening", () => log(`fake core on ws://127.0.0.1:${PORT}/ws (protocol ${PROTOCOL_VERSION})`));
wss.on("connection", (ws) => {
  const st = { role: "?", audio: [], speechMs: 0, silenceMs: 0, frames: 0, levelSum: 0, peak: 0 };
  clients.set(ws, st);
  ws.on("close", () => clients.delete(ws));
  ws.on("message", (raw) => {
    let m;
    try {
      m = JSON.parse(String(raw));
    } catch {
      return;
    }
    const p = m.payload ?? {};
    switch (m.type) {
      case "hello":
        st.role = p.role;
        log(`client hello: ${p.role} (protocol ${p.protocolVersion})`);
        send(ws, "hello", { role: "core", protocolVersion: PROTOCOL_VERSION, capabilities: ["fake", "echo", "say"] });
        break;
      case "audio.in.chunk":
        requester = ws;
        onAudio(st, p);
        break;
      case "turn.end":
        requester = ws;
        if (p.reason === "push_to_talk") void endUtterance(st, "push_to_talk");
        break;
      case "text.in":
        requester = ws;
        void replyText(p.text);
        break;
      case "barge_in":
        log(`barge_in from UI (heard until seq ${p.playedUntilSeq} +${Math.round(p.playedMsInSeq ?? 0)} ms)`);
        speakingUntil = 0;
        break;
      default:
        break;
    }
  });
});

function send(ws, type, payload, extra) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(envelope(type, payload, extra)));
}
// Replies go to every UI (so the console can make the app speak) and to the requester.
let requester = null;
function broadcast(type, payload, extra) {
  for (const [ws, st] of clients) if (st.role === "ui" || ws === requester) send(ws, type, payload, extra);
}

// ---------- mic audio ----------

function onAudio(st, p) {
  const pcm = Buffer.from(p.data, "base64");
  const i16 = new Int16Array(pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + pcm.length));
  let sum = 0;
  for (const v of i16) sum += (v / 32768) ** 2;
  const rms = Math.sqrt(sum / i16.length);
  st.frames++;
  st.levelSum += rms;
  st.peak = Math.max(st.peak, rms);
  if (Date.now() < speakingUntil) return; // ignore audio while "speaking" (the app does barge-in)
  st.audio.push(i16);
  if (p.pushToTalk) return; // PTT: wait for turn.end
  // Always-listening: crude end-of-utterance (real core uses Silero VAD + smart-turn).
  const ms = (i16.length / p.sampleRate) * 1000;
  if (rms > 0.02) {
    st.speechMs += ms;
    st.silenceMs = 0;
  } else if (st.speechMs > 0) {
    st.silenceMs += ms;
  }
  if (st.speechMs < 200 && st.silenceMs === 0 && rms <= 0.02) {
    // Keep only ~300 ms of pre-speech context.
    const keep = Math.ceil(300 / ms);
    if (st.audio.length > keep) st.audio.splice(0, st.audio.length - keep);
  }
  if (st.speechMs >= 200 && st.silenceMs >= 700) void endUtterance(st, "vad");
}

setInterval(() => {
  for (const st of clients.values()) {
    if (!st.frames) continue;
    log(`mic: ${st.frames} frames/s, avg level ${(st.levelSum / st.frames).toFixed(3)}, peak ${st.peak.toFixed(3)}`);
    st.frames = 0;
    st.levelSum = 0;
    st.peak = 0;
  }
}, 1000);

async function endUtterance(st, reason) {
  const chunks = st.audio;
  st.audio = [];
  st.speechMs = 0;
  st.silenceMs = 0;
  const total = chunks.reduce((n, c) => n + c.length, 0);
  if (total < 1600) return log(`utterance (${reason}) too short, ignored`);
  const pcm16k = new Float32Array(total);
  let o = 0;
  for (const c of chunks) for (const v of c) pcm16k[o++] = v / 32768;
  const secs = total / 16000;
  log(`utterance (${reason}): ${secs.toFixed(2)} s → echoing back`);
  const turnId = `fake-${++turnNo}`;
  const t0 = Date.now();
  broadcast("turn.start", { reason: reason === "vad" ? "vad" : "push_to_talk" }, { turnId });
  broadcast("latency.mark", { stage: "eos", ms: 0 }, { turnId });
  broadcast("stt.final", { text: `(echo) ${secs.toFixed(1)} s of your voice`, language: "unknown" }, { turnId });
  broadcast("latency.mark", { stage: "stt_final", ms: Date.now() - t0 }, { turnId });
  speak(turnId, resample(pcm16k, 16000, OUT_RATE), `(echo) ${secs.toFixed(1)} s`, t0);
}

// ---------- text → macOS say ----------

async function replyText(text) {
  const turnId = `fake-${++turnNo}`;
  const t0 = Date.now();
  const voice = /[ऀ-ॿ]/.test(text) ? "Lekha" : "Tara";
  log(`text.in "${text}" → say -v ${voice}`);
  const dir = mkdtempSync(join(tmpdir(), "hikari-say-"));
  try {
    const f = join(dir, "out.wav");
    execFileSync("say", ["-v", voice, "-o", f, "--file-format=WAVE", `--data-format=LEI16@${OUT_RATE}`, text]);
    const { samples, rate } = readWav(readFileSync(f));
    broadcast("turn.start", { reason: "text" }, { turnId });
    broadcast("llm.token", { delta: text, provider: "fake" }, { turnId });
    broadcast("latency.mark", { stage: "llm_first_token", ms: Date.now() - t0 }, { turnId });
    speak(turnId, resample(samples, rate, OUT_RATE), text, t0);
  } catch (e) {
    broadcast("error", { code: "fake_say_failed", message: String(e), recoverable: true }, { turnId });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ---------- shared: audio → tts.chunk with loudness phonemes ----------

function speak(turnId, samples, text, t0) {
  const phonemes = loudnessPhonemes(samples, OUT_RATE);
  const durationMs = Math.round((samples.length / OUT_RATE) * 1000);
  broadcast("state", { state: "speaking" }, { turnId });
  broadcast("avatar.emotion", { name: "joy", intensity: 0.6, seq: 0 }, { turnId });
  broadcast(
    "tts.chunk",
    {
      seq: 0, sampleRate: OUT_RATE, encoding: "pcm_s16le", pcm: floatToPcm16(samples).toString("base64"),
      durationMs, text, phonemes, phonemeSource: "aligner",
    },
    { turnId },
  );
  broadcast("latency.mark", { stage: "tts_first_chunk", ms: Date.now() - t0 }, { turnId });
  broadcast("tts.end", { reason: "complete" }, { turnId });
  speakingUntil = Date.now() + durationMs + 300;
  log(`→ tts.chunk ${durationMs} ms, ${phonemes.length} phonemes`);
}

/**
 * Pseudo-phonemes from loudness (40 ms windows): loud → a vowel (cycling so the
 * mouth shape varies), dips inside speech → a brief "m" closure, quiet → "sil".
 * Enough to see lips move with the words; the real core supplies true phonemes.
 */
function loudnessPhonemes(samples, rate) {
  const win = Math.round(rate * 0.04);
  const levels = [];
  for (let i = 0; i < samples.length; i += win) {
    let s = 0;
    const end = Math.min(samples.length, i + win);
    for (let j = i; j < end; j++) s += samples[j] * samples[j];
    levels.push(Math.sqrt(s / Math.max(1, end - i)));
  }
  const peak = Math.max(1e-6, ...levels);
  const vowels = ["a", "e", "o", "i", "a", "u"];
  const out = [];
  let v = 0;
  for (let k = 0; k < levels.length; k++) {
    const rel = levels[k] / peak;
    let p = "sil";
    if (rel > 0.12) {
      const prev = levels[k - 1] ?? 0;
      const next = levels[k + 1] ?? 0;
      p = levels[k] < prev * 0.6 && levels[k] < next * 0.6 ? "m" : vowels[Math.floor(v++ / 2) % vowels.length];
    }
    const start = k * 40;
    const last = out[out.length - 1];
    if (last && last.p === p) last.end = start + 40;
    else out.push({ p, start, end: start + 40 });
  }
  return out;
}
