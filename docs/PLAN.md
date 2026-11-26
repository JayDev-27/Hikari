# Hikari — Phased plan (two-person split, §12.5 is authoritative)

Status legend: ✅ done · 🟡 in progress · ⬜ not started

| M | Person A (Body & Desktop) | Person B (Brain & Voice) | Sync demo |
|---|---|---|---|
| M0 | 🟡 Tauri stage (NSPanel, transparent, all Spaces, per-pixel click-through), tray, hotkeys, Live2D renderer, lip-sync engine, playback queue, in-browser mock turn | ⬜ core scaffold (uv/FastAPI), Pydantic from protocol schema, `core/mock_server.py`, `scripts/fetch_models.py` | Mock server drives avatar mouth |
| M1 | 🟡 mic capture (16 kHz worklet, AEC/NS/AGC) ✅, device select ✅, PTT + always-listening ✅, mute ✅, local barge-in ✅, dev fake core ✅ — AEC with speakers + real-voice barge-in still to test | VAD (Silero) → Hima-ASR → smart-turn → LLM router → Hima TTS → aligner phonemes; `bench_pipeline.py` | Real voice conversation < 1.2 s |
| M2 | 🟡 Character Studio ✅, pack import (folder / zip / .vrm) + licence display ✅, persona switcher (Studio + chat command) ✅, chat panel ✅, 4 original + 3 franchise personas ✅, VRM rendering of imports ✅ (M3 VRM renderer) | persona assembly, language detect, Hindi/English normaliser | Switch characters, talk in 3 language modes |
| M3 | 4-layer gestures + states ✅ (`src/avatar/layers/`, all three renderers), VRM renderer ✅ (`src/avatar/vrm/`, VRM 0.x + 1.0), realism pass ✅, Hindi viseme tuning ✅, animation tuner ✅ (dev `#/tuner`) | emotion engine + mood, gesture tags | Emotional Hinglish dialogue with gestures |
| M4 | 🟡 Settings window ✅: providers/keys (Keychain) ✅, live provider status ✅, RAM meters ✅, profile switch ✅, launch at login ✅ — still to do: check inside the app; send settings to the core once the protocol has `settings.update` (see DECISIONS 2026-11-26) | router failover, hardware profiles, lazy load/unload | Kill provider mid-reply → no break; 8 GB OK |
| M5 | 🟡 Memory browser ✅ (`src/memory/`: search, kind + character filters, inline edit, multi-delete, paging, optimistic with rollback; offline state) — not yet tried in the Tauri app or against B's core | memory service + consolidation | Recalls last week's facts; edit/delete |
| M6 | 🟡 Voice Lab UI ✅, consent flow ✅, recording session ✅ (24 kHz WAV, level meter), training/eval views ✅, blind A/B player ✅ (`src/voicelab/`) — ops contract proposed for B (DECISIONS 2026-11-26); real mic and the Tauri app not yet tried | dataset pipeline, clone, adapter notebook (hima-finetune), eval | Speaks in trained voice |
| M7 | 🟡 confirm dialogs ✅, audit log + Activity window ✅, panic ✅ (hotkey/tray → stage; dialog + log follow it), "working" signal ✅ (`activity://working`; avatar hook pending, M3 owner) — not yet tried in the Tauri app | MCP agent (Peekaboo + macos-mcp + own tools), safety tiers, proactive scheduler | "Open VS Code and set a 25-min timer" safely |
| M8 | 🟡 onboarding ✅ (`src/onboarding/`, first run + live TCC detection, `permissions.rs`), perf pass ✅ measured (recommendations for the stage owner in DECISIONS 2026-11-26), `.dmg` + transparency regression check ✅ (`pnpm -F desktop check:bundle [--launch]`, docs/RELEASE-CHECK.md) — still to do: Developer ID signing + notarisation, a fresh-Mac install test | perf/memory pass, python-build-standalone sidecar | Fresh-Mac install → working companion |

## M0 (A) remaining

- [x] Cubism Core installed (SDK 5-r.5, Core 6 + compat shim); Hiyori renders transparently on the stage; mock turn plays (AudioContext running), mouth follows phonemes, captions track audio.
- [x] Hover / per-pixel click-through tested with the real cursor (fixed a one-event lag).
- [ ] Needs a person: drag her, click/pat reactions, eye-follow, ⌥Space barge-in.
- [x] A/V sync: `pnpm -F desktop avsync` — pass at −1.4 / +6.9 ms (Bluetooth, 30 fps; target ±40 ms). Fixed 3 sync bugs. Still to do: measure at 60/120 Hz; acoustic check with a mic/loopback.
- [x] `apps/desktop/dev/protocol-console` for B (§12.3): interactive + one-shot `--say`/`--wav`, schema validation, latency report, TTS WAV capture.
- [x] Idle FPS throttling: 60 active / 30 idle / 0 hidden. Release idle CPU 37.2 % → 24.7 % (M2). Fixed 3 production-only bugs (CSP eval, blob-worker textures, tauri:// URL resolution).
- [ ] Tag `m0` once B's mock server drives the mouth.

## Open questions

0. ~~Idle CPU budget vs smooth idle~~ — decided: keep 30 fps idle (~25 % of a core, release build on M2); deep idle was tried and rejected as laggy. The < 3 % target needs a different approach (e.g. a native renderer), so it's revisited at M8. **M8 measurement (2026-11-26, release, M2):** idle 17.9 % (Iki, Reze) / 28.1 % (Live2D, Hiyori); active 60 fps 39.9 % / 38.4 %. Still far from 3 %; the cheap wins listed in DECISIONS 2026-11-26 (M8) are worth a few points each, not an order of magnitude. **Locked screen / sleeping display:** the stage now pauses (1.0 % measured while locked, DECISIONS 2026-11-26).

1. Hima TTS licence — B to contact the author before shipping anything that bundles it.
2. Peekaboo TCC attribution (Bridge host vs Hikari.app) — test in M7.
3. Live2D "Expandable Applications" clause: Hikari loads user models; check whether the SDK Release License applies even under ¥10M.
