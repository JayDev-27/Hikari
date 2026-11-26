# Release bundle check (M8)

`pnpm -F desktop check:bundle` inspects a built `Hikari.app` or `.dmg` and exits 1 if
anything ships that shouldn't, or is missing. Run it after every `pnpm build`.

```bash
pnpm build                                   # → src-tauri/target/release/bundle/{macos,dmg}/
pnpm -F desktop check:bundle                 # checks target/release/bundle/macos/Hikari.app
pnpm -F desktop check:bundle path/to/Hikari_0.1.0_aarch64.dmg          # mounts read-only, checks, detaches
pnpm -F desktop check:bundle --launch path/to/Hikari_0.1.0_aarch64.dmg # also runs it from the dmg
```

| Check | Fails when |
|---|---|
| Info.plist | identifier/version differ from `tauri.conf.json`; `NSMicrophoneUsageDescription` missing (macOS kills the app on mic access without it); `LSMinimumSystemVersion` wrong |
| Structure / size | executable or icon missing; app over 400 MB (warns over 200 MB) |
| Secrets | a `.env`, `.pem`, `.p12`, `.key`, `id_rsa`, `credentials.json`… anywhere in the bundle or the embedded frontend; an API key or private key pattern (Anthropic, OpenAI, AWS, GitHub, Slack, Google, Hugging Face) in the executable or in `dist/` |
| Cubism Core licence | any embedded `live2d/` file other than `live2dcubismcore.min.js` (the only file in the SDK's `RedistributableFiles.txt`, see `docs/LICENSES.md`); any archive; Core missing (pass `--no-live2d` for builds made without the SDK) |
| Resources | `index.html`, the JS bundle, every built-in pack in `characters/` and its model file are embedded |
| Signature | a sealed signature that doesn't verify. An unsealed bundle (Tauri's default without `signingIdentity`) and ad-hoc signing are warnings |
| `--launch` | the stage window doesn't appear; isn't above normal windows; its corners aren't fully transparent; it's not mostly transparent; no character is drawn; a mouse-down at a transparent point would land on the stage instead of the window below (click-through) |

How it works: Tauri compiles `dist/` into the executable (compressed), so the check lists the
embedded asset paths from the binary itself. Text in the frontend is scanned in the matching
`dist/` (same build, by modification time). The launch check compiles a small Swift probe:
`CGWindowListCopyWindowInfo` finds the stage, `screencapture -o -l <id>` captures it with
alpha, and `NSWindow.windowNumber(at:)` asks the window server which window a click at a
clear point would hit. Capturing needs Screen Recording for the terminal that runs it
(checked with `CGPreflightScreenCaptureAccess`); without it the pixel checks are skipped with a
warning and the click-through check uses the top-left margin. A cold first launch is retried for
up to ~18 s before "character drawn" fails. `--launch` uses the real app config, so
on a Mac that never finished onboarding the welcome window opens too; quit Hikari afterwards.

Not covered (do by hand before publishing): Gatekeeper on a second Mac (needs a Developer ID
and notarisation), TCC prompts (each ad-hoc rebuild is a new app to TCC), dragging and
petting her with a real mouse.
