# Hikari — notes for Claude Code sessions

Native macOS anime AI companion. Two-person build: **A = Body & Desktop** (`apps/desktop/`, `characters/`), **B = Brain & Voice** (`core/`, `voices/`, `scripts/`). Stay in your role's folders; shared: `packages/protocol/`, `docs/`, `fixtures/`, this file, `DECISIONS.md` (PR reviewed by the other person). See `docs/ARCHITECTURE.md`, `docs/PLAN.md`, `docs/RESEARCH.md`.

## Setup

```bash
pnpm install                       # repo root (pnpm workspace)
pnpm -F desktop fetch:assets       # Live2D sample models; add --sdk <CubismSdkForWeb zip> for Cubism Core
```

Rust via rustup (`source ~/.cargo/env`). Cubism Core must come from the official SDK zip the user downloads (licence acceptance) — never commit it or any model weights.

## Commands

| What | Command |
|---|---|
| Run app (dev) | `pnpm dev` (= `pnpm -F desktop tauri dev`) |
| Typecheck / lint / test (frontend) | `pnpm -F desktop typecheck` · `pnpm -F desktop lint` · `pnpm -F desktop test` |
| Rust lint | `cd apps/desktop/src-tauri && cargo clippy` |
| Regenerate protocol types | `pnpm gen:protocol` (CI: `pnpm check:protocol`) |
| Bundle `.app`/`.dmg` | `pnpm build` |
| A/V sync regression (audible, ~6 s) | `pnpm -F desktop avsync` (exit 0 = within ±40 ms) |
| Fake core for the app (until B's core exists) | `pnpm -F desktop fake-core` (echoes your voice; `console --say` makes Hikari speak via macOS `say`) |
| Talk to the core without the app (B) | `pnpm -F desktop console [--say "…" \| --wav f.wav]` — see `apps/desktop/dev/protocol-console/README.md` |

## Conventions

- Protocol changes: edit `packages/protocol/schema/protocol.schema.json`, bump `x-protocolVersion` + `Envelope.v` const, regenerate, PR touching both sides.
- Dev without core: double-click Hikari or release ⌥Space with no core running → in-browser mock turn (`src/dev/mockReplay.ts`).
- Core WebSocket: `ws://127.0.0.1:8765/ws`. UI sends `turn.end {reason: "push_to_talk"}` on ⌥Space release.
- Dev mic mode override: `VITE_MIC_MODE=open pnpm dev` (always-listening).
- Record decisions/assumptions in `DECISIONS.md`; asset terms in `docs/LICENSES.md`.
