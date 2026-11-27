# Contributing to Hikari

Thanks for helping build Hikari, a local-first anime AI companion for macOS. Whether this is your first open-source contribution or your hundredth, this guide gets you from "I'd like to help" to a merged pull request.

Hikari is taking part in **Winter of Code Social (WOCS) 2026**. The WOCS rules are in [their own section](#winter-of-code-social-2026) below.

## How the project is organised

Hikari is built by two people, and the code is split the same way:

| Area | Folders | What lives there |
|---|---|---|
| **Body & desktop** | `apps/desktop/`, `characters/` | The Tauri + React app: the transparent stage, the Iki / Live2D / VRM renderers, lip sync, Character Studio, Chat, Settings, Memories, Voice Lab, Activity, onboarding |
| **Brain & voice** | `core/`, `voices/`, `scripts/` | The Python core: speech-to-text, the language-model router, text-to-speech, memory, the Mac-control agent |
| **Shared** | `packages/protocol/`, `docs/`, `fixtures/` | The WebSocket protocol both sides speak, architecture and decision docs |

Start with [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the big picture and [`DECISIONS.md`](DECISIONS.md) for why things are the way they are.

## Set up your machine

You'll need macOS 13 or later on Apple Silicon, Xcode Command Line Tools, Node 24, pnpm 12 and Rust 1.100 or later (via [rustup](https://rustup.rs)).

```bash
git clone https://github.com/<your-username>/Hikari.git
cd Hikari
pnpm install
pnpm dev
```

`pnpm dev` starts the native app. With no core running, double-click the character (or press and release <kbd>⌥ Space</kbd>) to play the built-in demo. The README's [Quick start](README.md#quick-start) covers Live2D models and the development voice loop.

Most UI work can also be done in the browser: `pnpm -F desktop dev` serves the app at `http://localhost:1420`, for example `/#/studio`, `/#/chat` or `/#/settings`. Panels fall back to sample data there.

## Find something to work on

1. Browse the [open WOCS issues](https://github.com/JayDev-27/Hikari/issues?q=is%3Aissue+is%3Aopen+label%3Awocs). Each one says what to do, where in the code, and what "done" looks like.
2. New to the project? Start with [`level 1`](https://github.com/JayDev-27/Hikari/issues?q=is%3Aissue+is%3Aopen+label%3A%22level+1%22) issues.
3. **Claim an issue before you start:** comment "I'd like to work on this" and wait until a maintainer or mentor assigns it to you. Please work on one issue at a time.
4. If you've been assigned but can't continue, say so in the issue so someone else can pick it up. Assigned issues with no activity for 7 days may be reassigned.
5. Have an idea that isn't an issue yet? Open one first, so we can agree on the scope before you write code.

Questions are welcome in the issue itself or in Hikari's forum on the Code Social Discord. Please keep discussion public rather than in DMs, so everyone can learn from it.

## Make your change

1. Fork the repository and create a branch from `main`, for example `fix/chat-scroll` or `feat/studio-search`.
2. Keep the change focused on the issue. Small pull requests get reviewed and merged faster.
3. Follow the existing style. The tooling enforces most of it:
   - TypeScript is strict, React components are function components, styles use the shared tokens in `apps/desktop/src/ui/tokens.css`.
   - Rust is formatted with `cargo fmt` and must pass Clippy with no warnings.
   - Write comments that explain *why*, not *what*.
4. Add or update tests for logic you change (Vitest for TypeScript, `cargo test` for Rust).
5. Never commit secrets, API keys, model weights or Live2D's Cubism Core (it's licensed and fetched separately).
6. Protocol changes: edit `packages/protocol/schema/protocol.schema.json`, bump the version, run `pnpm gen:protocol` and commit the regenerated types.

## Check it before you push

Run the same checks CI runs:

```bash
pnpm check:protocol
pnpm -F desktop lint --max-warnings 0
pnpm -F desktop typecheck
pnpm -F desktop test
cargo fmt --check --manifest-path apps/desktop/src-tauri/Cargo.toml
cargo clippy --all-targets --manifest-path apps/desktop/src-tauri/Cargo.toml -- -D warnings
```

## Open a pull request

1. Push your branch and open a pull request against `main`.
2. Fill in the template: what changed, the issue it closes (`Closes #123`), and how you verified it.
3. For anything visible on screen, attach a screenshot or a short recording.
4. A maintainer or mentor reviews it. Expect questions and requests for changes; that's a normal part of review, not a rejection.
5. Once it's approved and the checks pass, a maintainer merges it.

GitHub Actions adds `area:` labels based on the files changed. The WOCS label check flags missing or conflicting scoring labels in the workflow summary so a maintainer or mentor can correct them.

## Winter of Code Social 2026

Hikari is a WOCS 2026 project. To earn points:

- **Register** for Winter of Code Social at [woc.codesocial.tech](https://woc.codesocial.tech). Only registered participants are counted.
- Work on an issue labelled **`wocs`** that you've been **assigned**.
- Every eligible pull request gets the `wocs` label plus exactly one level label. Maintainers and mentors add these **before merging**:

  | Label | Points | Typical work |
  |---|---|---|
  | `level 1` | 2 | Small, beginner-friendly: docs, copy, a focused bug fix, a test |
  | `level 2` | 5 | Moderate: a feature or fix that needs understanding of one part of the app |
  | `level 3` | 11 | Substantial: work across several parts, or a tricky renderer / audio / native change |

- The level is decided by the maintainers and mentors, usually matching the issue's label. It's final once the pull request is merged.
- Points are counted only for merged pull requests. The leaderboard is at [woc.codesocial.tech/leaderboard](https://woc.codesocial.tech/leaderboard).
- Please don't open low-value pull requests or split one change into many to collect points; they'll be closed.

## AI policy

**AI-assisted contributions are allowed, with conditions.** Tools like Copilot, ChatGPT or Claude can help you learn the codebase and write code, but you are the author:

- **Understand every line** you submit, and be ready to explain it in review. "The AI wrote it" isn't an answer to a review question.
- **Say so in your pull request** if AI tools wrote a substantial part of the change ("AI assistance: …").
- **Test it yourself.** Run the checks above and, for visible changes, try it in the app.
- **No AI-generated issues, comments or review replies** posted without you reading and editing them.

Pull requests that break these rules may be closed, and for WOCS they can be reported to Team Code Social.

## Be kind

Many people contribute here for the first time. Be patient and specific in reviews and discussions, assume good intent, and help others learn. Harassment or disrespect of any kind isn't tolerated.

Thank you for contributing!
