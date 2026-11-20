# Decisions & assumptions

Newest first. "A" = Person A (Body & Desktop), "B" = Person B (Brain & Voice).

## 2026-11-20 — Phase 0 / M0 (A)

- **Phase 0 research was run by A's session alone** (B had not started). B should review `docs/RESEARCH.md` and the `docs/research/03-speech.md` / `04-llm-memory.md` picks before building on them.
- **Protocol v0.1.0 drafted by A** (`packages/protocol`). Shared item: B must review before relying on it; v0.x may still break. `tts.chunk.pcm` is base64 in a JSON frame for simplicity; move to binary WS frames if profiling shows decode cost.
- `Error` schema def is named `ErrorInfo` (avoids shadowing JS `Error`).
- Stage = **non-activating NSPanel** (tauri-nspanel 2.1.1), `PanelLevel::Floating`, instead of NSWindow + level 25 — research found the latter activates Hikari on click and is unreliable over fullscreen apps.
- Hotkeys default: ⌥Space push-to-talk, ⌘⇧M mute, ⌘⇧Esc panic (Carbon hotkeys → no Input Monitoring permission needed).
- Asset fetch script lives in `apps/desktop/scripts/` (not root `scripts/`, which is B's).
- **Cubism Core is never downloaded automatically**: getting the SDK means accepting Live2D's licence, so the user downloads the zip; the script extracts Core only if it's listed in `RedistributableFiles.txt`.
- Haru's expression map (F01–F08 → emotions) is a first guess; tune in Character Studio (M2).
- Hima TTS has no licence: kept as the research pick for local prototyping; **must not ship** without a licence from the author (open question for B).
- No live RVC (no maintained Apple-Silicon real-time RVC); §5(c) downgraded to offline augmentation.
- Lip sync: Cohen–Massaro dominance blending + explicit bilabial closure gate (the unit test showed blending alone leaves lips ~19 % open on "m").
- Dev without core: releasing push-to-talk with no core connected plays an in-browser synthetic mock turn (formant buzz matched to phoneme timings); double-click on her also plays it. B's `core/mock_server.py` will replay real recorded Hinglish turns.
