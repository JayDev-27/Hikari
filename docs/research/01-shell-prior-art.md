# 01 — Desktop Shell & Prior Art

Researched 2026-11-20. Versions were checked against crates.io, npm, GitHub releases and source. "Unverified" marks anything I could not confirm from a primary source.

## TL;DR
- **Shell:** Tauri **2.12.7** (crate, released 2026-11-18), `@tauri-apps/cli` 2.12.6, `@tauri-apps/api` 2.12.5. Use an **NSPanel** through `tauri-nspanel` **2.1.1** for the stage window.
- **Click-through:** Rust polls the cursor, the webview tests the canvas alpha under it, and the result toggles `set_ignore_cursor_events`. Tauri has no equivalent of Electron's `{forward:true}`.
- **`macOSPrivateApi` is a no-op from Tauri 2.12.1 onward.** Transparency and fullscreen private APIs are always enabled now ([PR #16166](https://github.com/tauri-apps/tauri/pull/16166), merged 2026-09-29).
- **Plugins:** global-shortcut 2.4.1, autostart 2.7.0, shell 2.6.0 (sidecar), single-instance 2.5.5, store 2.5.1, positioner 2.4.0, updater 2.14.1. Secrets go through `keyring` 4.2.0.
- **What to borrow:** AIRI's alpha hit-test and cursor-loop design (MIT). Open-LLM-VTuber's `emotionMap` with `[tag]` parsing and its interrupt flow. **Do not copy its frontend code**, which is under a non-OSI license. Local-AI-Companion's sentence-level TTS queue.

## 1. Tauri v2 shell on macOS

### 1.1 Transparency, `macOSPrivateApi`, and the "transparent in dev, opaque in bundle" bug
- The config reference describes `app.macOSPrivateApi` as *"No-op in Tauri 2.12.1+ because the APIs are always enabled now."* The changelog for 2.12.1 says the flag *"is no longer required to use transparency or fullscreen on macOS."* Keeping `"macOSPrivateApi": true` and the `macos-private-api` feature does no harm, and tauri-build still handles the feature automatically. The **Mac App Store rule still applies**: private APIs are now always linked, so MAS distribution is effectively off the table. We plan to ship a notarized DMG, so this is fine.
- **Known bug:** [tauri#13415](https://github.com/tauri-apps/tauri/issues/13415) (tauri 2.5.1, macOS 15.4.1 arm64). A transparent window works under `tauri dev` but renders **solid white** when run from the DMG. It is still open and labeled *needs triage*. A second report came in Nov 2025. No fix exists upstream. The reporter tried the private-API flag, `TAURI_PRIVATE_API=1` and `ActivationPolicy::Accessory`, and none of them helped.
- **Mitigation checklist.** Nothing below is a confirmed upstream fix. Each item rules out a known cause.
  1. Use tauri ≥ 2.12.1 so the private API can't be dropped from a release build. That was the classic cause in older versions.
  2. Set `html, body, #app { background: transparent !important }` in the **production** CSS bundle. Check that the reset or UI library (Tailwind preflight, UnoCSS reset, antd) doesn't paint `body` after your rule. Inspect the built CSS, not the dev CSS.
  3. Set `"backgroundColor": "#00000000"` on the window. Per a third-party guide, `set_background_color` changes the NSWindow but not the WKWebView, so you need both this and the CSS.
  4. Create the window with `visible:false` and call `show()` after the first transparent frame. This avoids the white flash.
  5. Give the Live2D/three canvas `premultipliedAlpha:true` and a clear color of alpha 0.
  6. Run a CI smoke test on the **bundled .app**: screenshot it and assert that a corner pixel is transparent.

### 1.2 Always-on-top, all Spaces, above fullscreen apps
- WindowConfig fields (confirmed in the v2 config reference): `transparent`, `alwaysOnTop`, `visibleOnAllWorkspaces`, `skipTaskbar`, `decorations`, `shadow`, `focusable`, `focus`, `acceptFirstMouse` (macOS), `backgroundColor`, `windowEffects` (requires transparent), `preventOverflow`.
- `Window` methods in 2.12.7 (confirmed on docs.rs): `set_ignore_cursor_events(bool)`, `cursor_position() -> PhysicalPosition<f64>`, `set_visible_on_all_workspaces(bool)`, `set_always_on_top(bool)`, `set_focusable(bool)`, `set_background_color(Option<Color>)`, `set_skip_taskbar(bool)`. `ns_window()` is on `WebviewWindow`.
- **Floating over other apps' fullscreen Spaces** needs an **NSPanel with the `nonactivatingPanel` style mask** together with `fullScreenAuxiliary`. A plain NSWindow raised with `alwaysOnTop` does not reliably appear there. This is why BongoCat v1 (Tauri) used tauri-nspanel, and why BongoCat v2 rewrote its overlay as a native `NSPanel` + `CAMetalLayer` (see its ADR-0003).
- `tauri-nspanel` 2.1.1 (MIT OR Apache-2.0; use the `v2.1` branch or crates.io) provides:
  - `WebviewWindowExt::to_panel::<T>()` and `PanelBuilder`
  - `PanelLevel::{Normal(0), Floating(4), ModalPanel(8), Utility(19), Dock(20), MainMenu(24), Status(25), PopUpMenu(101), ScreenSaver(1000)}`
  - `CollectionBehavior::new().can_join_all_spaces().stationary().full_screen_auxiliary().ignores_cycle()`
  - `StyleMask::empty().nonactivating_panel()`
  - panel methods `set_level`, `set_collection_behavior`, `set_style_mask`, `set_ignores_mouse_events`, `set_hides_on_deactivate`, `set_becomes_key_only_if_needed`, `order_front_regardless`
- AIRI (Electron) uses `setAlwaysOnTop(true,'screen-saver')` plus `setVisibleOnAllWorkspaces(true,{visibleOnFullScreen:true})` for its overlays.

### 1.3 Review of the current Hikari stage-window approach
Current setup: tauri 2.12.7 + `macos-private-api`, a Rust cursor-poll thread driving `set_ignore_cursor_events`, objc2-app-kit `setCollectionBehavior(CanJoinAllSpaces|FullScreenAuxiliary|Stationary)` and `setLevel(25)`.

| Item | Verdict | Detail |
|---|---|---|
| `macos-private-api` feature / `macOSPrivateApi` | **Redundant, harmless** | No-op since 2.12.1 (PR #16166). It does not fix #13415, so still run the §1.1 checklist. |
| Rust cursor-poll thread | **Correct pattern** | Same as WindowPet (`mouse_position` crate, Tauri 1) and AIRI (`screen.getCursorScreenPoint()` loop). Caveats: (a) the window rect alone isn't enough, so add the alpha hit-test (§1.4); (b) call `set_ignore_cursor_events` **only when the state changes**. WindowPet adds a 50 ms delay before re-enabling ignore *"to avoid crash when call setIgnoreCursorEvents too fast"*; (c) `cursor_position()` returns **physical** pixels with a global origin, while the window position is also physical, so divide by `scale_factor` before handing it to the webview's CSS pixels. |
| `setCollectionBehavior` via objc2-app-kit | **OK, with two caveats** | (1) AppKit calls must run on the **main thread**, so wrap them in `app.run_on_main_thread`. (2) Tauri/tao's own `set_visible_on_all_workspaces` (and probably `set_always_on_top`) write the same NSWindow properties, so **don't also set `visibleOnAllWorkspaces`/call those setters later**, or your mask or level may get overwritten (unverified in tao source; re-apply after any such call). Never combine `CanJoinAllSpaces` with `MoveToActiveSpace`; Apple documents them as mutually exclusive. |
| `setLevel(25)` on a plain NSWindow | **Main gap** | 25 is `NSStatusWindowLevel`, which sits above the menu bar (24). That works for staying on top, but on a regular **activating NSWindow** it won't reliably float over **other apps' fullscreen Spaces**, and clicking the pet steals focus from the user's app. Fix: convert it to an NSPanel with the `nonactivating_panel` style mask (tauri-nspanel `to_panel`), or at least use `ActivationPolicy::Accessory` / `set_dock_visibility(false)`. Consider level 25 → `Floating(4)`/`Dock(20)` (BongoCat used Dock) to keep from covering menu-bar extras. Use ScreenSaver(1000) only for a deliberate "over everything" mode. |

### 1.4 Per-pixel click-through technique (recommended)
How prior art does it:
- **BongoCat v1:** toggles the whole window with `appWindow.setIgnoreCursorEvents(value)` as a user setting. No per-pixel test.
- **WindowPet:** a Rust command `get_mouse_position` feeds Phaser's `input.hitTestPointer()`, which is pixel-perfect on sprites, and that toggles ignore on change.
- **AIRI:** the main process loops on `getCursorScreenPoint` and pushes the position only when it changes. The renderer's `canvas-alpha.ts` calls `gl.readPixels` in a small radius around the cursor and compares against a threshold. Electron's `setIgnoreMouseEvents(true,{forward:true})` lets mousemove reach the page anyway. Tauri has no `forward` option ([#11461](https://github.com/tauri-apps/tauri/issues/11461), [#9250](https://github.com/tauri-apps/tauri/issues/9250) are open), so **polling is mandatory in Tauri**.
- **claude-pet (IMMINJU, Tauri 2, MIT):** small window with `transparent`, `alwaysOnTop` and `decorations:false`. I found no per-pixel logic.

Hikari loop:
1. A Rust thread runs at 30 Hz, or 60 Hz while the cursor is near the window. It reads `window.cursor_position()` and `outer_position()`/`outer_size()`.
2. If the cursor is outside the window rect, set ignore=true and skip the IPC.
3. If it is inside, `emit` local CSS px to the webview. JS does `readPixels` on a 5×5 area at the cursor, right after render, or from a downscaled alpha mask refreshed every ~100 ms. A cheaper alternative is to test the Live2D hit areas or VRM bounding meshes.
4. JS returns hit/no-hit, and Rust toggles ignore only on change, with about 50 ms hysteresis.

Also: while dragging, force ignore=false; set `acceptFirstMouse:true` so the first click on the panel registers.

### 1.5 Tray, shortcut, autostart, sidecar, secrets
```toml
# src-tauri/Cargo.toml
tauri = { version = "2.12.7", features = ["tray-icon", "image-png"] }  # macos-private-api now optional
tauri-nspanel = "2.1.1"
tauri-plugin-global-shortcut = "2.4.1"
tauri-plugin-autostart = "2.7.0"
tauri-plugin-shell = "2.6.0"
tauri-plugin-single-instance = "2.5.5"
tauri-plugin-store = "2.5.1"
keyring = "4.2.0"   # default "v1" feature = classic Entry API on macOS Keychain
```
```json
// tauri.conf.json (stage window)
{ "app": { "macOSPrivateApi": true, "windows": [{ "label": "stage", "transparent": true,
  "decorations": false, "shadow": false, "alwaysOnTop": true, "skipTaskbar": true,
  "acceptFirstMouse": true, "backgroundColor": "#00000000", "visible": false, "resizable": false }] },
  "bundle": { "externalBin": ["binaries/hikari-voice"], "macOS": { "minimumSystemVersion": "13.0" } } }
```
```rust
// main-thread panel setup (pattern from BongoCat v1 src-tauri/src/core/setup/macos.rs)
tauri_panel! { panel!(StagePanel { config: { is_floating_panel: true, can_become_key_window: true, can_become_main_window: false } }) }
app.set_activation_policy(tauri::ActivationPolicy::Accessory);
let panel = stage.to_panel::<StagePanel>()?;
panel.set_level(PanelLevel::Floating.value());
panel.set_style_mask(StyleMask::empty().nonactivating_panel().into());
panel.set_collection_behavior(CollectionBehavior::new().can_join_all_spaces().stationary()
    .full_screen_auxiliary().ignores_cycle().into());
// plugins
.plugin(tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, None)) // variants: LaunchAgent | AppleScript
.plugin(tauri_plugin_global_shortcut::Builder::new().with_handler(|app, sc, ev| { /* push-to-talk */ }).build())
// tray: tauri::tray::TrayIconBuilder::new().icon(..).menu(&menu).on_menu_event(..).build(app)?
// sidecar: app.shell().sidecar("hikari-voice")?.spawn()?  (filename only, not "binaries/…")
// keychain: keyring::Entry::new("ai.hikari", "openai")?.set_password(&k)?; .get_password()?
```
- **Sidecar:** the binary must exist as `binaries/hikari-voice-aarch64-apple-darwin`, plus `-x86_64-apple-darwin` if you build universal. Get the triple from `rustc --print host-tuple`. The capability needs `{"identifier":"shell:allow-spawn","allow":[{"name":"binaries/hikari-voice","sidecar":true}]}`.
- **Keychain options:**
  - `keyring` 4.2.0 is a wrapper. Its v1 API is kept, and the real stores now live in `keyring-core` 1.0.1 and `apple-native-keyring-store` 1.0.2. The `keychain` module is for apps without a provisioning profile. The `protected` module needs a provisioning profile and adds iCloud and biometrics.
  - `tauri-plugin-keychain` 2.0.2 and `tauri-plugin-keyring` 0.1.0 were last updated in 2024 and are effectively stale. Rejected.
  - `tauri-plugin-stronghold` 2.4.0 is overkill.
  - `tauri-plugin-secure-storage` 1.5.0 is an acceptable JS-facing alternative.

### 1.6 Tauri vs Electron (decision: **Tauri**)
| Metric (macOS) | Tauri | Electron | Source |
|---|---|---|---|
| Idle RAM, summed across helper processes | 109 MB (main alone ~36 MB) | 128 MB | Better Stack, updated 2026-07-20 |
| RAM with 6 windows open | ~172 MB | ~409 MB | gethopp / dev.to, 2025-07-07, MacBook Pro, N=1 |
| .app size | 8.6 MiB / 57 MB | 244 MiB / 323 MB | same two sources |
| Startup (median) | 311 ms | 273 ms | Better Stack |

Why Tauri:
- On an 8 GB M3, the shell competes with local ASR, TTS and maybe an LLM. Electron 45.4.1 (current npm) ships a second Chromium on top of the OS WebKit. Each extra Electron window costs ~2× the RAM, and Hikari runs a stage, a chat bubble and a settings window.
- We need Rust anyway for the cursor poll, NSPanel, keychain and sidecar supervision.

Costs:
- WKWebView only: no `{forward:true}`, and the WebGL behavior is Safari's.
- The #13415 bundling bug.
- Tauri's own issue [#5889](https://github.com/tauri-apps/tauri/issues/5889) warns that real-world memory can grow. **Budget target:** stage process ≤ 150 MB summed (main + WebContent + GPU), measured in Activity Monitor on the M3 8 GB machine.

## 2. Prior art (architecture and licenses only)

**Project AIRI** ([moeru-ai/airi](https://github.com/moeru-ai/airi), **MIT**, v0.15.4 released 2026-11-12, ~51.6k stars)
- **Stack:** Vue 3.5 + Vite + UnoCSS monorepo. The desktop app `apps/stage-tamagotchi` runs on **Electron ^43.8.4** with electron-builder ^26.16.1. Siblings are `stage-web` and `stage-pocket`.
- **Rendering:** Live2D in `stage-ui-live2d` uses `pixi-live2d-display` ^0.4.0 (patched) with Pixi v6 `@pixi/*`. VRM in `stage-ui-three` uses `three` ^0.185.1, `@pixiv/three-vrm` ^3.5.5 and `@tresjs/core` ^5.8.3. It does auto blink, look-at and idle eyes.
- **LLM and memory:** LLM I/O goes through the `xsai` 0.5.1 SDK. Memory runs in-browser on DuckDB-WASM or PGlite ^0.5.6 via drizzle. Its "Memory Alaya" layer is still WIP.
- **Desktop mode:** separate BrowserWindows for stage, chat, caption, controls and overlay. They use `setIgnoreMouseEvents(true,{forward:true})`, the `screen-saver` level and `visibleOnFullScreen`, plus a cursor-point loop and alpha `readPixels` hit-testing.
- **Borrow:** the alpha hit-test, the "send cursor only on change" loop, the multi-window split (stage vs. chat bubble), and the provider abstraction idea. Don't borrow Electron itself.

**Open-LLM-VTuber** ([repo](https://github.com/Open-LLM-VTuber/Open-LLM-VTuber), v1.2.1 released 2025-08-26; last push 2026-05; v2 rewrite "in planning")
- **Stack:** Python 3.10–3.12 + FastAPI WebSocket backend. The frontend [Open-LLM-VTuber-Web](https://github.com/Open-LLM-VTuber/Open-LLM-VTuber-Web) is React 18 + Electron ^31 + Vite and provides web and desktop clients.
- **Pet mode:** a transparent, top-most, click-through, draggable window.
- **Barge-in:** Silero VAD (`prob_threshold` 0.4, `db_threshold` 60, smoothing 5) is described as letting you interrupt without headphones. On interrupt, the backend cancels the asyncio conversation task, calls `agent.handle_interrupt(heard_response)` to truncate memory to what was actually spoken, and stores it. `interrupt_method: 'system'|'user'` controls how the interruption note is injected into history.
- **Emotions:** each model in `model_dict.json` has an `emotionMap`, e.g. `{"neutral":0,"anger":2,"joy":3,"surprise":3,…}`, mapping to expression indices. Its keys are inserted into the prompt as `[joy], [anger], …`. Tags are stripped from the TTS text and sent as expression actions. `faster_first_response` speaks at the first comma, with `pysbd` sentence segmentation.
- **License:** the backend is **MIT**, except Live2D sample models, which fall under the Live2D Free Material License. Since **v1.2.0** the **frontend changed from "no license / all rights reserved" to the "Open-LLM-VTuber License 1.0"**. That license is Apache-2.0 plus extra conditions, and a commercial license is required for paid hosting, rebranded redistribution, or embedding in a paid product. Maintainers said they plan to move the backend to the same license around v1.3/v1.4.
- **Borrow:** ideas only — the emotionMap and tag protocol, interrupt-truncates-memory, and first-comma TTS. **Do not copy frontend code.**

**Local-AI-Companion** ([LiiLk/Local-AI-Companion](https://github.com/LiiLk/Local-AI-Companion), **MIT**, Python, ~12 stars, pushed 2026-10)
- Windows-first. Pipeline: Mic → Silero VAD → faster-whisper → LLM (Ollama, OpenRouter optional) → **sentence splitter + TTS task manager** → Kokoro → RVC → playback. It deliberately runs one GPU-heavy TTS job at a time and owns preload, warmup and degraded-state handling centrally.
- **Borrow:** the sentence-queue design, where each sentence is a TTS task with ordered playback that can be cancelled on barge-in. Also its explicit runtime lifecycle and its one-heavy-model-at-a-time rule, which suits an 8 GB machine.

**Anima** (ambiguous name)
- The project matching "accessibility-driven desktop agent" is **animaios/anima**, an AIRI-based "agentic desktop OS". Its README described using accessibility integration to open, close and switch windows and read their text, sending desktop-context snapshots with AIRI heartbeats, and an "Agentic Mode" for full control. It is Linux-targeted (CachyOS/EndeavourOS distro). **The repo returns 404 as of 2026-11-20**, so I couldn't verify its license or code.
- Other projects by the same name: `diana-random1st/anima` (macOS Tauri 2 daemon, also 404), `btangonan/anima` (MIT, Tauri v2 Claude Code companion, unrelated) and `jimmyxu-code/anima` (MIT, Windows, Python).
- **Borrow:** the concept only — periodic accessibility-tree context snapshots that feed the companion. On macOS that means AXUIElement, gated by TCC Accessibility permission (see 05-mac-control.md).

**BongoCat** ([ayangweb/BongoCat](https://github.com/ayangweb/BongoCat), **Apache-2.0**, v2.4.1 released 2026-10-28, ~24.7k stars)
- v0.x–1.1.0 (to 2026-04) used Tauri 2 + Vue + `easy-live2d` + pixi.js 8, with tauri-nspanel at `PanelLevel::Dock`, `nonactivating_panel`, `stationary|move_to_active_space|full_screen_auxiliary`, and `set_dock_visibility(false)`.
- **v2.0.0 (2026-09-28) dropped Tauri.** It now uses GPUI for settings and a native NSPanel + Metal/CAMetalLayer overlay, linking the Cubism SDK 5 directly. The reasons given were low-latency transparency, click-through and GPU lifecycle control.
- **Takeaway:** our webview-based stage is a defensible v1. Keep the renderer behind an interface so a native overlay stays possible later.

**WindowPet** ([SeakMengs/WindowPet](https://github.com/SeakMengs/WindowPet), MIT, v0.0.9, Tauri **1.5**, stale since 2025-04): the cursor-poll + Phaser pixel hit-test reference.

## 3. Recommendation table

| Option | Version | License | Apple silicon | Notes | Decision |
|---|---|---|---|---|---|
| Tauri | 2.12.7 (cli 2.12.6, api 2.12.5) | Apache-2.0/MIT | Native aarch64, universal optional | Private API always on (≥2.12.1); bug #13415 open | **Chosen**: lowest RAM, Rust needed anyway |
| Electron | 45.4.1 | MIT | Native | ~2× RAM per window, 244–323 MB .app; has `forward:true` | Rejected: RAM on 8 GB |
| Native Swift/AppKit or GPUI overlay (BongoCat v2 path) | n/a | n/a | Native | Best latency and control; rewrites Live2D/VRM rendering | Deferred: reconsider post-v1 |
| tauri-nspanel | 2.1.1 (`v2.1` branch) | MIT/Apache-2.0 | Yes | Nonactivating panel, fullscreen auxiliary, levels | **Chosen** for the stage window |
| Raw objc2-app-kit calls | 0.3.2 | Zlib/Apache/MIT | Yes | Current approach; window stays activating | Keep only for extras |
| Cursor poll + alpha hit-test | (pattern) | n/a | n/a | AIRI/WindowPet-proven | **Chosen** |
| tauri-plugin-polygon | 0.1.2 | unverified | unverified | Polygon click regions via mouse polling | Rejected: we need alpha, not polygons |
| tauri-plugin-global-shortcut | 2.4.1 | Apache/MIT | Yes | Push-to-talk, summon | **Chosen** |
| tauri-plugin-autostart | 2.7.0 | Apache/MIT | Yes | `MacosLauncher::LaunchAgent` (no SMAppService variant) | **Chosen** |
| tauri-plugin-shell (sidecar) | 2.6.0 | Apache/MIT | Yes (needs `-aarch64-apple-darwin` bin) | Voice/ML sidecar supervision | **Chosen** |
| keyring | 4.2.0 (core 1.0.1, apple store 1.0.2) | MIT/Apache | Yes | Keychain; `protected` needs provisioning profile | **Chosen** |
| tauri-plugin-keychain / -keyring | 2.0.2 / 0.1.0 | MIT(/Apache) | Yes | Last updated 2024 | Rejected: stale |
| tauri-plugin-stronghold | 2.4.0 | Apache/MIT | Yes | Encrypted vault, password UX | Rejected: overkill |
| AIRI (reference) | v0.15.4 | MIT | Yes (Electron) | Live2D + VRM + memory reference | Borrow patterns/code (MIT, attribute) |
| Open-LLM-VTuber (reference) | v1.2.1 | Backend MIT / frontend OLV License 1.0 | Yes | Emotion map, barge-in | Borrow ideas only |
| Local-AI-Companion (reference) | main (2026-10) | MIT | Windows-first | Sentence TTS queue | Borrow design |
| Anima / animaios (reference) | n/a (404) | Unverified | Linux | Accessibility context snapshots | Concept only |

## Sources
- https://github.com/tauri-apps/tauri/releases
- https://raw.githubusercontent.com/tauri-apps/tauri/dev/crates/tauri/CHANGELOG.md
- https://github.com/tauri-apps/tauri/pull/16166
- https://v2.tauri.app/reference/config/
- https://docs.rs/tauri/2.12.7/tauri/window/struct.Window.html
- https://github.com/tauri-apps/tauri/issues/13415
- https://github.com/tauri-apps/tauri/issues/11461
- https://github.com/tauri-apps/tauri/issues/9250
- https://github.com/tauri-apps/tauri/issues/5889
- https://txz.cool/blog/m36p2ntvjgaazq07pg08wix5
- https://github.com/ahkohd/tauri-nspanel (branch v2.1: src/builder.rs, src/panel.rs, src/common.rs)
- https://v2.tauri.app/develop/sidecar/
- https://v2.tauri.app/plugin/stronghold/
- https://docs.rs/tauri-plugin-autostart/2.7.0/tauri_plugin_autostart/enum.MacosLauncher.html
- https://crates.io/crates/keyring , https://crates.io/crates/keyring-core , https://crates.io/crates/apple-native-keyring-store
- https://betterstack.com/community/guides/scaling-nodejs/tauri-vs-electron-vs-deno-vs-electrobun/
- https://dev.to/gethopp/tauri-vs-electron-performance-bundle-size-and-the-real-trade-offs-1el4
- https://github.com/moeru-ai/airi (pnpm-workspace.yaml; apps/stage-tamagotchi/src/main/windows/desktop-overlay/window-contract.ts; services/electron/screen.ts; packages/stage-ui/src/composables/canvas-alpha.ts)
- https://github.com/Open-LLM-VTuber/Open-LLM-VTuber (LICENSE, model_dict.json, config_templates/conf.default.yaml, conversations/conversation_handler.py, live2d_model.py)
- https://github.com/Open-LLM-VTuber/Open-LLM-VTuber-Web (LICENSE, package.json)
- https://docs.llmvtuber.com/en/blog/v1.2.0-release
- https://github.com/LiiLk/Local-AI-Companion
- https://github.com/animaios/anima (404 on 2026-11-20; described via search snippets)
- https://github.com/ayangweb/BongoCat (v1.1.0 src-tauri/src/core/setup/macos.rs, tauri.conf.json; master docs/adr/0003-native-overlay-renderers.md, crates/bongocat-overlay/src/hover.rs)
- https://github.com/SeakMengs/WindowPet (src/scenes/manager.ts, src-tauri/src/app/cmd.rs)
- https://github.com/IMMINJU/claude-pet
