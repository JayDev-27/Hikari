# Hikari — Phased plan (two-person split, §12.5 is authoritative)

Status legend: ✅ done · 🟡 in progress · ⬜ not started

| M | Person A (Body & Desktop) | Person B (Brain & Voice) | Sync demo |
|---|---|---|---|
| M0 | 🟡 Tauri stage (NSPanel, transparent, all Spaces, per-pixel click-through), tray, hotkeys, Live2D renderer, lip-sync engine, playback queue, in-browser mock turn | ⬜ core scaffold (uv/FastAPI), Pydantic from protocol schema, `core/mock_server.py`, `scripts/fetch_models.py` | Mock server drives avatar mouth |
| M1 | mic capture + device select, AEC check, playback barge-in (done in M0), latency overlay (stub done) | VAD (Silero) → Hima-ASR → smart-turn → LLM router → Hima TTS → aligner phonemes; `bench_pipeline.py` | Real voice conversation < 1.2 s |
| M2 | Character Studio, pack import (.model3.json folder / zip / .vrm) + licence display, persona switcher | persona assembly, language detect, Hindi/English normaliser | Switch characters, talk in 3 language modes |
| M3 | 4-layer gestures, states, VRM renderer + realism pass, Hindi viseme tuning, animation tuner | emotion engine + mood, gesture tags | Emotional Hinglish dialogue with gestures |
| M4 | Settings: providers/keys (Keychain), RAM meters, profile switch | router failover, hardware profiles, lazy load/unload | Kill provider mid-reply → no break; 8 GB OK |
| M5 | Memory browser | memory service + consolidation | Recalls last week's facts; edit/delete |
| M6 | Voice Lab UI, consent flow, A/B player | dataset pipeline, clone, adapter notebook (hima-finetune), eval | Speaks in trained voice |
| M7 | confirm dialogs, audit log, panic, "working" anims | MCP agent (Peekaboo + macos-mcp + own tools), safety tiers, proactive scheduler | "Open VS Code and set a 25-min timer" safely |
| M8 | onboarding (runtime TCC detection), perf pass, `.dmg` + transparency regression check | perf/memory pass, python-build-standalone sidecar | Fresh-Mac install → working companion |

## M0 (A) remaining

- [x] Cubism Core installed (SDK 5-r.5, Core 6 + compat shim); Hiyori renders transparently on the stage; mock turn plays (AudioContext running), mouth follows phonemes, captions track audio.
- [ ] Hands-on check with a real cursor: click-through on transparent pixels, drag, eye-follow, ⌥Space barge-in.
- [ ] A/V sync measurement script (record loopback vs viseme timeline).
- [ ] `apps/desktop/dev/protocol-console` for B (§12.3).
- [ ] Idle FPS throttling (30 fps idle / 60 animating).
- [ ] Tag `m0` once B's mock server drives the mouth.

## Open questions

1. Hima TTS licence — B to contact the author before shipping anything that bundles it.
2. Peekaboo TCC attribution (Bridge host vs Hikari.app) — test in M7.
3. Live2D "Expandable Applications" clause: Hikari loads user models; check whether the SDK Release License applies even under ¥10M.
