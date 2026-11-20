# Hikari — Phase 0 Research (2026-11-20)

Five parallel research passes, each with sources, in `docs/research/`:

| # | Area | File |
|---|---|---|
| 1 | Desktop shell (Tauri), prior art | [01-shell-prior-art.md](research/01-shell-prior-art.md) |
| 2 | Avatar rendering, Live2D/VRM licensing, models, lip sync | [02-avatar-assets.md](research/02-avatar-assets.md) |
| 3 | STT, TTS, voice conversion, eval, echo cancellation | [03-speech.md](research/03-speech.md) |
| 4 | LLM (local + cloud), provider router, memory, sidecar bundling | [04-llm-memory.md](research/04-llm-memory.md) |
| 5 | Mac control (MCP), TCC permissions, wake word | [05-mac-control.md](research/05-mac-control.md) |

Latency figures are publisher numbers (often M4 Pro / NVIDIA) unless stated; **none are measured on our M2/M3 yet** — `scripts/bench_pipeline.py` (B, M1) replaces them with real numbers.

## Decision table

| Area | Chosen | Version | License | Apple silicon | Rejected (why) |
|---|---|---|---|---|---|
| Shell | **Tauri v2** | 2.12.7 crate / CLI 2.12.6 | MIT/Apache | native | Electron 45 (≈2.4× RAM with 6 windows, 244–323 MB app — decisive on 8 GB) |
| Floating window | **tauri-nspanel** non-activating NSPanel, `PanelLevel::Floating`, CanJoinAllSpaces+FullScreenAuxiliary | 2.1.1 | MIT/Apache | — | plain NSWindow + `setLevel(25)` (activates app on click, unreliable over fullscreen) |
| Click-through | Rust cursor poll (30 Hz) → frontend alpha `readPixels` hit-test → `set_ignore_cursor_events` w/ 60 ms hysteresis | — | — | — | rect-only hit test (blocks clicks around her) |
| Secrets | `keyring` crate → macOS Keychain | 4.2.0 | MIT/Apache | ✔ | stale Tauri keychain plugins |
| Live2D | **untitled-pixi-live2d-engine** on pixi.js | 1.4.0 / 8.23.0 | MIT | WebGL2 ✔ | pixi-live2d-display (Pixi 6, dead), lipsyncpatch (Pixi 7), easy-live2d (backup; Cubism 5 only) |
| Cubism Core | bundled in signed .app, fetched from user-downloaded SDK zip, **never committed** | SDK 5-r.5 | Live2D PSLA | ✔ | committing to repo (PSLA violation) |
| VRM (M3) | @pixiv/three-vrm + three-vrm-animation, three, postprocessing + n8ao | 3.5.5 / 0.187.0 / 6.39.6 / 2.1.0 | MIT / Zlib / ISC | ✔ | Gaussian-splat avatars (no anime toolchain, photoreal heads only) |
| Lip sync | phonemes from TTS → else wav2vec2 phoneme CTC alignment → else spectral fallback (wlipsync later) | xlsr-53-espeak-cv-ft / wlipsync 1.3.1 | Apache-2.0 / MIT | ✔ | Rhubarb (batch, English-only), MMS (CC-BY-NC) |
| STT | **Hima-ASR** `Prahaladha/hima-asr-mlx-4bit` (Lite) / `-8bit` | — | Apache-2.0 + Gemma terms | MLX | Oriserve Hinglish-Prime (romanised only, WER ~29), parakeet (no Hindi) |
| STT fallback | mlx-whisper + `mlx-community/whisper-large-v3-turbo-4bit` | 0.4.3 | MIT | MLX | lightning-whisper-mlx (unmaintained) |
| VAD / turn | Silero VAD + `pipecat-ai/smart-turn-v3` (v3.2 CPU ONNX) | 6.2.3 | MIT / BSD-2 | ONNX | LiveKit turn-detector (licence: LiveKit Agents only) |
| TTS | **Hima TTS Nano** (ONNX int8 Lite / MLX fp16 Std) + adapters via `hima-finetune` | — | **NO LICENCE GRANT** (`other`, no text) | MLX/ONNX | XTTS-v2 (CPML), OmniVoice (NC), Qwen3-TTS/CosyVoice3/MOSS (no Hindi), IndicF5/Parler (slow) |
| TTS licensed fallbacks | Chatterbox Multilingual V3; Kokoro (only one with word timestamps); Max: maya2-native | — | MIT / Apache / Apache | ✔ | — |
| Voice conversion | **No live RVC**; Hima adapters / Maya cloning; RVC offline only | — | — | no MLX RVC exists | Seed-VC (GPL-3, +400 ms) |
| AEC | Std/Max: Swift VoiceProcessingIO helper; Lite: LiveKit APM Python | — | Apple / Apache | ✔ | WebView AEC (only works if TTS also plays in the WebView — it does in our design; keep as first try) |
| Local LLM | Ollama (OpenAI `/v1`): Lite `qwen3.5:4b-q4_K_M`, Std `gemma4:e4b-it-qat` (A/B `qwen3.5:9b`), Max `gemma4:12b-nvfp4` | 0.40.16 | MIT | MLX default | mlx-lm server (no tool calling), Sarvam-30B (19.6 GB Q4) |
| Cloud LLM chain | Groq → Cerebras → Gemini Flash → OpenRouter `:free` → local | — | BYOK | — | — |
| Router | own thin `httpx` adapters (OpenAI-format + native Anthropic) | — | — | — | LiteLLM (2026 PyPI compromises, heavy, bundling issues) |
| Memory | SQLite + sqlite-vec + FTS5 (Hindi-safe tokenizer) + RRF, bitemporal facts | 0.1.9 | Apache/MIT | arm64 wheel | hosted mem0/Zep |
| Embeddings | EmbeddingGemma-300m @256d (ONNX/MLX); alt Qwen3-Embedding-0.6B | — | Gemma / Apache | ✔ | Granite (no Hindi) |
| Sidecar bundling | python-build-standalone + uv venv in Resources, signed inside-out | — | — | keeps mlx.metallib | PyInstaller (fallback onedir only), Nuitka |
| Mac control | **Peekaboo** (AX + screenshot) + CursorTouch `macos-mcp` (AX-first, shell off) + own osascript tools | 4.9.9 / 0.4.7 | MIT | ✔ | steipete/macos-automator-mcp (archived 2026-09), mb-dev (stale), Daemon OS / MacWright |
| MCP client | `mcp` Python SDK (v2 API) | 2.3.0 | MIT | ✔ | — |
| Wake word | sherpa-onnx KWS ("hey hikari", no training) | 2.0.2 | Apache-2.0 | wheels | openWakeWord models (CC BY-NC-SA), Porcupine (free tier ended) |
| Models shipped | Live2D Hiyori, Haru; VRM1_Constraint_Twist_Sample, Seed-san | — | Free Material Lic. / VRM PL 1.0 | — | Natori/Tsumiki (Collaboration chars), VRoid Hub models (no redistribution), Booth models |

## Findings that change the original brief

1. **Hima TTS has no licence.** Model card says `other` with no text anywhere → all rights reserved. Prototype locally only; **ask the author for an explicit licence before any release**. Chatterbox Multilingual (MIT) is the shippable fallback.
2. **No real-time RVC on Apple Silicon** (no maintained MLX/ONNX RVC pipeline). §5(c) becomes "offline RVC for dataset augmentation"; the live voice path is Hima adapters (5M params, ~5 min on a T4).
3. **`steipete/macos-automator-mcp` is archived**; Peekaboo replaces it. Peekaboo's TCC grants may attach to its own "Bridge" host — test `--no-remote` so grants attribute to Hikari.app.
4. **macOS 27.3 renames/splits the Accessibility pane** ("Accessibility" + "System & App Protection Override", per-target-app grants). Onboarding must detect at runtime, never hard-code pane names.
5. **Tauri `macOSPrivateApi` is always on since 2.12.1**; harmless to set, but rules out the Mac App Store. Distribution = notarised `.dmg`.
6. **"Transparent in dev, white in bundled DMG" (tauri#13415) is still open.** Mitigation checklist in 01; must be tested on every packaged build (M8).
7. **Live2D samples are fine to bundle for a publisher under ¥10M/yr**, with credit; Hiyori's design may not be altered; sample voice files may not be shipped (the fetch script deletes them).
8. **Mid-stream failover:** most providers can't continue a partial assistant message (Claude ≥4.6 returns 400). Strategy: keep spoken sentences, regenerate from the last complete sentence with a "continue from" instruction; use true prefill only where supported (DeepSeek, Mistral).
9. **FTS5's default tokenizer splits Devanagari at vowel signs** — use `tokenchars`/categories `'L* N* Co M*'`.
