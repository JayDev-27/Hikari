<div align="center">

<img src="assets/brand/hikari-macos-icon-256.png" alt="Hikari macOS app icon" width="160" height="160">

# 光 Hikari

**A local-first anime AI companion for macOS**

A Live2D / VRM character who lives on your desktop, talks with you in **Hindi, English and Hinglish** with phoneme-accurate lip sync, remembers you, and can operate your Mac — fully local by default, cloud optional.

![macOS](https://img.shields.io/badge/macOS-Apple%20Silicon-000?logo=apple)
![Tauri](https://img.shields.io/badge/Tauri-2.12-24C8DB?logo=tauri&logoColor=white)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)
![Rust](https://img.shields.io/badge/Rust-1.100-000?logo=rust)
![Live2D](https://img.shields.io/badge/Live2D-Cubism%205-FF6699)
[![Code checks](https://github.com/JayDev-27/Hikari/actions/workflows/checks.yml/badge.svg?branch=main)](https://github.com/JayDev-27/Hikari/actions/workflows/checks.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

</div>

---

> **Status: early development (milestone M0).** The desktop stage, Live2D renderer, lip-sync engine and wire protocol work today. The voice brain (speech-to-text, LLM, text-to-speech), memory and Mac control come in M1–M7. See the [roadmap](#roadmap).

## What works now

| | |
|---|---|
| 🪟 **Desktop stage** | Transparent, frameless, non-activating macOS panel that floats over every Space and full-screen app without stealing focus |
| 🖱️ **Per-pixel click-through** | Clicks pass through the transparent pixels around her; she's clickable only where she's actually drawn (alpha read-back) |
| 💋 **Phoneme lip sync** | Hindi + English IPA → visemes (aspirated, retroflex and nasal sounds), Cohen–Massaro coarticulation, full lip closure on m/b/p |
| ⏱️ **Measured A/V sync** | Lips land within **±8 ms** of the audio you hear, even on Bluetooth (~112 ms output latency, compensated) — `pnpm -F desktop avsync` |
| 🎭 **Live2D renderer** | PixiJS v8 + Cubism 2–5 models, idle breathing and head sway, eyes that follow your cursor, expressions and gestures |
| ⚡ **Adaptive frame rate** | 60 fps while animating, 30 fps idle, paused when hidden |
| 🔌 **Typed protocol** | One JSON Schema → generated TypeScript types (Pydantic for the core); versioned handshake |
| 🧪 **Protocol console** | CLI to drive the Python core without the app: schema validation, latency report vs the 1.2 s target |
| ⌨️ **Global hotkeys** | ⌥Space push-to-talk · ⌘⇧M mute · ⌘⇧Esc panic-stop |

## Vision

- **Talks like a person:** sentence-level streaming, barge-in (interrupt her mid-sentence), under 1.2 s from end of speech to first audio
- **Speaks your languages:** Hindi, English and natural code-switched Hinglish, in a personalised voice (consented voice cloning only)
- **Feels alive:** a layered gesture system (life → conversational → expressive → emotion pose), moods that drift, and a VRM 3D mode
- **Remembers you:** local SQLite memory (sqlite-vec + FTS5), facts that update over time, per-character namespaces, full control to view, edit or forget
- **Gets things done:** an MCP agent that controls your Mac through the accessibility tree, with read / act / sensitive safety tiers, spoken confirmation, an audit log and a panic key
- **Runs on 8 GB:** hardware profiles; the avatar is never downgraded, only model sizes are
- **A healthy companion:** a supportive friend who nudges you toward sleep, breaks and real-world plans, with no guilt-tripping or engagement traps

## Architecture

```
┌──────────── Tauri v2 (Rust) ────────────┐        ┌──────── Python core (planned) ────────┐
│ non-activating NSPanel stage, tray,     │        │ VAD → STT → turn detection → LLM      │
│ hotkeys, cursor poll → click-through    │        │ router (failover) → TTS → phonemes    │
└───────────────┬─────────────────────────┘        │ emotion · memory · MCP agent          │
                │ IPC                               └──────────────────┬────────────────────┘
┌───────────────▼──── WebView (React + TS) ───────────────┐            │
│ StageRuntime — one clock: the AudioContext               │◀── WS ────┘  packages/protocol
│ PlaybackQueue → LipSyncEngine → AvatarController          │             (JSON Schema → TS / Pydantic)
│                         ├─ Live2DAvatar (PixiJS 8)        │
│                         └─ VrmAvatar (three-vrm, M3)      │
└──────────────────────────────────────────────────────────┘
```

Details: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) · research and decision tables with sources: [`docs/RESEARCH.md`](docs/RESEARCH.md) · decision log: [`DECISIONS.md`](DECISIONS.md)

## Getting started

**Requirements:** macOS 13+ on Apple Silicon, Node 24, pnpm 12, and Rust (via [rustup](https://rustup.rs)).

```bash
git clone https://github.com/JayDev-27/Hikari.git
cd Hikari
pnpm install
```

**Avatar assets** aren't in the repo, for licensing reasons:

1. Download **Cubism SDK for Web** from [live2d.com](https://www.live2d.com/en/sdk/download/web/). This means accepting Live2D's licence.
2. Run:

```bash
pnpm -F desktop fetch:assets      # Live2D sample models + Cubism Core from the SDK zip in ~/Downloads
pnpm dev                          # run Hikari
```

Double-click Hikari, or press and release ⌥Space while no core is running, to play a demo conversation with lip sync.

| Command | What it does |
|---|---|
| `pnpm dev` | Run the app (dev) |
| `pnpm build` | Build `.app` / `.dmg` |
| `pnpm -F desktop test` | Unit tests (lip sync, scheduler, protocol console) |
| `pnpm -F desktop avsync` | A/V sync regression check (audible, ~6 s) |
| `pnpm -F desktop console` | Talk to the Python core over the wire protocol |
| `pnpm gen:protocol` | Regenerate protocol types from the schema |

## Project layout

```
apps/desktop/        Tauri + React app (stage, avatar, lip sync, audio, dev tools)
packages/protocol/   Shared wire protocol: JSON Schema → generated types
characters/          Character packs (character.json, persona.md; models fetched separately)
docs/                Architecture, research, plan, licences
core/                Python core: voice pipeline, memory, agent (coming in M1)
```

## Roadmap

| Milestone | Scope |
|---|---|
| **M0** ✅ (mostly) | Desktop stage, Live2D, lip sync, A/V sync, protocol + console |
| M1 | Voice loop: VAD → STT → LLM → TTS streaming, barge-in, < 1.2 s |
| M2 | Personas, Character Studio, Hindi / English / Hinglish handling |
| M3 | Emotions, 4-layer gestures, VRM renderer with realism pass |
| M4 | Multi-provider router with seamless failover, hardware profiles (8 GB) |
| M5 | Long-term memory and memory browser |
| M6 | Voice Lab: consented voice cloning, adapter training, A/B testing |
| M7 | Mac-control agent (MCP) with safety tiers and audit log |
| M8 | Onboarding, performance, signed `.dmg` |

The full plan is in [`docs/PLAN.md`](docs/PLAN.md).

## Contributing

Bug fixes, docs improvements, and tests are welcome. For a bug report, include reproduction steps, your macOS version, and any relevant logs. For a larger change, open an issue to discuss the scope first. [Open an issue](https://github.com/JayDev-27/Hikari/issues/new)

Fork the repo, create a branch, and open a pull request against `main`. In the PR, explain what changed and how you verified it. Include a short screen recording for visible desktop changes. If you change the wire schema, run `pnpm gen:protocol` and commit the regenerated types.

Run these checks from the repo root on macOS with Clippy installed (`rustup component add clippy`):

```bash
pnpm install --frozen-lockfile
pnpm check:protocol
pnpm -F desktop lint --max-warnings 0
pnpm typecheck
pnpm -F desktop test
pnpm -F desktop build
cargo clippy --locked --all-targets --manifest-path apps/desktop/src-tauri/Cargo.toml -- -D warnings
```

GitHub Actions runs the same checks on pull requests and pushes to `main`. For changes to the avatar, tray, or hotkeys, also verify the behavior in the running app on macOS. Dependabot checks pnpm, Cargo, and GitHub Actions dependencies weekly and opens update PRs for review. [Code checks](https://github.com/JayDev-27/Hikari/actions/workflows/checks.yml)

## Assets & licences

Third-party models and runtimes aren't committed. [`docs/LICENSES.md`](docs/LICENSES.md) lists each one and its terms.

- **Live2D Cubism Core** is proprietary (Live2D PSLA). It's fetched from the official SDK, bundled only inside the built app, and never redistributed in this repo.
- **Sample models** (Hiyori, Haru) are under the Live2D Free Material License. *This content uses sample data owned and copyrighted by Live2D Inc.*
- **Makima, Reze, Rize Kamishiro, Lu Guang and Cheng Xiaoshi** include native Live2D models and individual personas. Their hand gestures, hair and clothing animate in both Character Studio and the desktop stage. Select one in Character Studio or type `switch to Reze` in chat. Studio also accepts a custom model for each character.
- **Voice cloning** requires a recorded consent file for any voice other than your own.

## License

Hikari's own code is under the [MIT License](LICENSE). Third-party models, runtimes and SDKs keep their own licences, which MIT doesn't change. That includes Live2D Cubism Core and the Live2D sample models; see [`docs/LICENSES.md`](docs/LICENSES.md).
