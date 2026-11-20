#!/usr/bin/env node
// Hikari protocol console — talk to the Python core without the desktop app (§12.3).
//
//   node apps/desktop/dev/protocol-console/console.mjs [options]
//   pnpm -F desktop console [options]
//
// Options:
//   --url <ws-url>     core endpoint (default ws://127.0.0.1:8765/ws, or $HIKARI_CORE_URL)
//   --say "<text>"     one-shot: send text.in, wait for the reply, print latency, exit
//   --wav <file.wav>   one-shot: stream a WAV as audio.in.chunk (16 kHz mono PCM16, real-time paced)
//   --fast             stream WAV audio as fast as possible instead of real time
//   --save <dir>       save each turn's TTS audio to <dir>/turn-<n>.wav
//   --raw              print every frame as full JSON (pcm/data fields elided)
//   --quiet-tokens     don't print llm.token lines (show only the assembled reply)
//   --timeout <s>      one-shot: give up after this many seconds (default 30)
//
// One-shot exit code: 0 = reply finished (tts.end / turn.end) with no schema violations,
// 1 = timeout, error message, or invalid frames, 2 = could not connect / incompatible.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import {
  PROTOCOL_VERSION, TurnTimer, color as C, envelope, floatToPcm16, readWav, resample, summarize, validate,
} from "./lib.mjs";

const args = parseArgs(process.argv.slice(2));
const url = args.url ?? process.env.HIKARI_CORE_URL ?? "ws://127.0.0.1:8765/ws";
const oneShot = Boolean(args.say || args.wav);
const timer = new TurnTimer();
let turnNo = 0;
let invalid = 0;
let sawError = false;
let replyText = "";
let inTurn = false;
let coreHello = false;

if (typeof WebSocket === "undefined") {
  console.error("This console needs Node ≥ 22 (global WebSocket).");
  process.exit(2);
}

const ws = new WebSocket(url);
const connectTimer = setTimeout(() => {
  console.error(C.red(`could not connect to ${url} — is the core running?`));
  process.exit(2);
}, 5000);

ws.addEventListener("open", () => {
  clearTimeout(connectTimer);
  log(C.green(`connected ${url}`) + C.dim(` (console speaks protocol ${PROTOCOL_VERSION})`));
  send("hello", { role: "console", protocolVersion: PROTOCOL_VERSION, capabilities: ["tts.chunk.phonemes", "barge_in"] });
  setTimeout(() => !coreHello && log(C.yellow("no hello from core yet (it should answer the handshake)")), 2000);
  if (oneShot) void runOneShot();
  else startRepl();
});
ws.addEventListener("error", () => {
  clearTimeout(connectTimer);
  console.error(C.red(`connection failed: ${url}`));
  process.exit(2);
});
ws.addEventListener("close", (e) => {
  log(C.yellow(`disconnected (code ${e.code}${e.reason ? `: ${e.reason}` : ""})`));
  process.exit(oneShot ? 1 : 0);
});
ws.addEventListener("message", (ev) => onFrame(typeof ev.data === "string" ? ev.data : Buffer.from(ev.data).toString()));

function onFrame(text) {
  let m;
  try {
    m = JSON.parse(text);
  } catch {
    invalid++;
    return log(C.red(`✗ non-JSON frame: ${text.slice(0, 80)}`));
  }
  const errs = validate(m);
  if (errs.length) {
    invalid++;
    log(C.red(`✗ schema: ${m.type ?? "?"}`));
    for (const e of errs.slice(0, 6)) log(C.red(`    ${e}`));
  }
  if (m.type === "hello") {
    coreHello = true;
    const major = (v) => String(v).split(".")[0];
    if (major(m.payload?.protocolVersion) !== major(PROTOCOL_VERSION)) {
      log(C.red(`✗ incompatible core protocol ${m.payload?.protocolVersion} (console ${PROTOCOL_VERSION})`));
      if (oneShot) process.exit(2);
    }
  }
  timer.see(m);
  if (m.type === "llm.token") replyText += m.payload?.delta ?? "";
  if (m.type === "error") sawError = true;

  const quiet = args["quiet-tokens"] && m.type === "llm.token";
  if (!quiet) {
    const rel = timer.t0 === null ? "" : C.dim(`+${String(Math.round(performance.now() - timer.t0)).padStart(5)}ms `);
    const turn = m.turnId ? C.dim(` [${String(m.turnId).slice(0, 6)}]`) : "";
    log(`${rel}${C.cyan(m.type.padEnd(15))}${turn} ${args.raw ? rawJson(m) : summarize(m)}`);
  }
  if ((m.type === "tts.end" || m.type === "turn.end") && inTurn) finishTurn(m.type);
}

function finishTurn(reason) {
  inTurn = false;
  if (replyText) log(`${C.cyan("reply")} ${replyText.trim()}`);
  log(timer.report());
  if (args.save) {
    const wav = timer.wav();
    if (wav) {
      mkdirSync(args.save, { recursive: true });
      const f = resolve(join(args.save, `turn-${turnNo}.wav`));
      writeFileSync(f, wav);
      log(C.dim(`saved ${f}`));
    }
  }
  if (invalid) log(C.red(`${invalid} invalid frame(s) so far`));
  if (oneShot) process.exit(!sawError && invalid === 0 && reason ? 0 : 1);
}

function beginTurn() {
  turnNo++;
  replyText = "";
  inTurn = true;
  timer.start();
}

function sayText(text) {
  send("text.in", { text });
  beginTurn();
}

async function streamWav(file, fast = false) {
  const { samples, rate } = readWav(readFileSync(file));
  const pcm = floatToPcm16(resample(samples, rate, 16000));
  const frameBytes = 16000 * 0.02 * 2; // 20 ms
  log(C.dim(`streaming ${file}: ${(samples.length / rate).toFixed(2)} s, ${rate} Hz → 16 kHz${fast ? " (fast)" : ""}`));
  let seq = 0;
  const t0 = performance.now();
  for (let off = 0; off < pcm.length; off += frameBytes, seq++) {
    send("audio.in.chunk", {
      seq, sampleRate: 16000, encoding: "pcm_s16le", data: pcm.subarray(off, off + frameBytes).toString("base64"), pushToTalk: true,
    });
    if (!fast) {
      const due = t0 + (seq + 1) * 20;
      const wait = due - performance.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    }
  }
  // End of input ≈ end of speech: start the latency clock here.
  beginTurn();
  log(C.dim(`sent ${seq} chunks; waiting for reply…`));
}

async function runOneShot() {
  const timeout = Number(args.timeout ?? 30) * 1000;
  setTimeout(() => {
    log(C.red(`✗ timeout after ${timeout / 1000}s (no tts.end / turn.end)`));
    if (inTurn) log(timer.report());
    process.exit(1);
  }, timeout);
  await new Promise((r) => setTimeout(r, 150)); // let hello land first
  if (args.say) sayText(args.say);
  else await streamWav(args.wav, Boolean(args.fast));
}

function startRepl() {
  log(C.dim("type a message to send text.in, or /help"));
  const rl = createInterface({ input: process.stdin, output: process.stdout, prompt: C.dim("you› ") });
  rl.prompt();
  rl.on("line", async (line) => {
    const s = line.trim();
    try {
      if (!s) { /* nothing */ }
      else if (!s.startsWith("/")) sayText(s);
      else await command(s, rl);
    } catch (e) {
      log(C.red(String(e instanceof Error ? e.message : e)));
    }
    rl.prompt();
  });
  rl.on("close", () => { ws.close(); process.exit(0); });
}

async function command(s, rl) {
  const [cmd, ...rest] = s.split(/\s+/);
  const arg = s.slice(cmd.length).trim();
  switch (cmd) {
    case "/help":
      log([
        "  <text>                      send text.in (starts a turn)",
        "  /wav <file> [--fast]        stream a WAV as audio.in.chunk",
        "  /barge                      send barge_in",
        "  /confirm <callId> yes|no    answer a tool.request",
        "  /mem [query]                memory.query",
        "  /send <type> <json>         send any message type with a JSON payload",
        "  /save <dir> | /save off     save each turn's TTS audio as WAV",
        "  /raw on|off                 print full JSON frames",
        "  /quit",
      ].join("\n"));
      break;
    case "/wav": await streamWav(rest[0], rest.includes("--fast")); break;
    case "/barge": send("barge_in", { source: "ui" }); break;
    case "/confirm": {
      const [callId, ans] = rest;
      if (!callId || !/^(y|yes|n|no)$/i.test(ans ?? "")) throw new Error("usage: /confirm <callId> yes|no");
      send("tool.confirm", { callId, approved: /^y/i.test(ans), via: "click" });
      break;
    }
    case "/mem": send("memory.query", arg ? { q: arg, limit: 10 } : { limit: 10 }); break;
    case "/send": {
      const sp = arg.indexOf(" ");
      const type = sp < 0 ? arg : arg.slice(0, sp);
      const payload = sp < 0 ? {} : JSON.parse(arg.slice(sp + 1));
      const errs = validate(envelope(type, payload));
      if (errs.length) log(C.yellow(`warning: outgoing frame violates schema:\n    ${errs.join("\n    ")}`));
      send(type, payload);
      if (type === "text.in" || type === "audio.in.chunk") beginTurn();
      break;
    }
    case "/save": args.save = arg === "off" ? undefined : arg || "./console-audio"; log(C.dim(`save: ${args.save ?? "off"}`)); break;
    case "/raw": args.raw = arg !== "off"; break;
    case "/quit": case "/exit": rl.close(); break;
    default: throw new Error(`unknown command ${cmd} — /help`);
  }
}

function send(type, payload, extra) {
  ws.send(JSON.stringify(envelope(type, payload, extra)));
}

function rawJson(m) {
  return JSON.stringify(m, (k, v) => ((k === "pcm" || k === "data") && typeof v === "string" ? `<${v.length} b64 chars>` : v));
}

function log(line) {
  // Keep the prompt tidy when async frames arrive mid-typing.
  if (process.stdout.isTTY && !oneShot) process.stdout.write("\r\x1b[K");
  console.log(line);
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) out[key] = true;
    else { out[key] = next; i++; }
  }
  return out;
}
