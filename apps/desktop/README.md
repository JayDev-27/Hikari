# apps/desktop

The Hikari desktop app: Tauri v2 (Rust) shell plus a React/TypeScript stage. See the [root README](../../README.md) and [`docs/ARCHITECTURE.md`](../../docs/ARCHITECTURE.md).

| Path | What |
|---|---|
| `src-tauri/` | Rust: NSPanel stage, click-through cursor poll, tray, global hotkeys |
| `src/stage/` | `StageRuntime` (one clock: AudioContext), frame scheduler, stage UI |
| `src/avatar/` | `AvatarController` interface, Live2D renderer, character packs |
| `src/lipsync/` | Phoneme → viseme map (Hindi + English), coarticulation engine, A/V sync analysis |
| `src/audio/` | Gapless TTS playback queue, barge-in |
| `src/core/` | WebSocket client for the Python core |
| `dev/` | Protocol console, A/V sync probe, idle-CPU and cursor test helpers |
| `scripts/fetch-assets.mjs` | Fetches Live2D sample models + Cubism Core (never committed) |
