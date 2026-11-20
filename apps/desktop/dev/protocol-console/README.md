# Protocol console (for Person B)

Talk to the Python core over the real wire protocol (`packages/protocol`) without running the desktop app. Plain Node ≥ 22, no build step. It validates every frame against the schema.

```bash
pnpm -F desktop console                                   # interactive, ws://127.0.0.1:8765/ws
pnpm -F desktop console --url ws://127.0.0.1:9000/ws      # other port (or HIKARI_CORE_URL)
pnpm -F desktop console --say "aaj ka plan kya hai?"      # one-shot text turn
pnpm -F desktop console --wav fixtures/turns/hello.wav    # one-shot voice turn (real-time paced)
pnpm -F desktop console --say "hi" --save out/ --raw      # save TTS audio, print full JSON
```

## What it does

- **Handshake:** sends `hello {role: "console"}` and expects a `hello` back. It warns if none arrives, and fails on a major-version mismatch.
- **Validation:** checks every incoming frame against `protocol.schema.json`, covering required fields, enums, types and nested phonemes, and prints exactly which field is wrong. `/send` also warns about invalid outgoing frames.
- **Latency:** each turn prints client-side time from end of input to `stt.final`, first `llm.token`, first `tts.chunk` and `tts.end`. It adds any `latency.mark` the core reports and marks pass/fail against the 1.2 s first-audio target.
- **WAV input:** any PCM WAV (8/16/24/32-bit, float, any channel count or sample rate) is downmixed, resampled to 16 kHz PCM16 and sent as 20 ms `audio.in.chunk` frames with `pushToTalk: true`. Sending is paced in real time unless you pass `--fast`.
- **TTS output:** with `--save <dir>`, each turn's `tts.chunk` audio is concatenated into `turn-<n>.wav`. The console also flags chunks that arrive without phonemes, because lip sync needs them.

## Interactive commands

| Command | Sends |
|---|---|
| `<text>` | `text.in` (starts a turn) |
| `/wav <file> [--fast]` | `audio.in.chunk` stream |
| `/barge` | `barge_in` |
| `/confirm <callId> yes\|no` | `tool.confirm` |
| `/mem [query]` | `memory.query` |
| `/send <type> <json>` | any message |
| `/save <dir>` · `/save off` | toggles WAV saving |
| `/raw on\|off` | full JSON frames |

## One-shot exit codes (for scripts/CI)

| Code | Meaning |
|---|---|
| 0 | the turn finished (`tts.end` or `turn.end`) with no schema violations or `error` frames |
| 1 | timeout (`--timeout`, default 30 s), an `error` frame, or invalid frames |
| 2 | couldn't connect, or the core's protocol is incompatible |

The tests in `console.test.ts` run the CLI against a fake core, and show the minimum a core must do to pass a turn.
