# Decisions & assumptions

Newest first. "A" = Person A (Body & Desktop), "B" = Person B (Brain & Voice).

## 2026-11-20 — Phase 0 / M0 (A)

- **A/V sync measured: pass.** `pnpm -F desktop avsync` (dev/avsync.sh → `src/dev/avSyncProbe.ts`) plays 10 sharp /a/ bursts through the real chain and compares each burst's *heard* onset (AudioContext output timestamp, device latency included) with the first *displayed* frame where the mouth is half open. Result on an M2 with a Bluetooth headset (output latency 111.6 ms) at 30 fps (Low Power Mode): **mean −1.4 ms / +6.9 ms in two runs, spread under 2 ms, jitter 0.5 ms** (target ±40 ms). 60/120 Hz not yet measured. Ground truth is WebAudio's reported output latency, not a microphone; real Bluetooth latency can differ from what macOS reports.
- Three sync bugs the probe found, all fixed:
  1. **Silence blended too strongly** (`sil` dominance 1.5, 80 ms spread, plus the m/b/p closure gate): isolated vowels after a pause opened to only 0.40, and late. Silence is now a weak resting posture (0.4, 30 ms, no closure gate), and vowels open to ~0.8.
  2. **Jaw loudness read from an AnalyserNode**, which sees audio when it's *processed*, 100+ ms before it's *heard* on Bluetooth. Loudness now comes from the decoded samples at the audible time (`PlaybackQueue.energyAt`). The spectral fallback (used only with no phonemes) still reads the analyser.
  3. **Lips sampled for render time, not display time**: one frame late (+33 ms at 30 Hz). Lip sync now samples at audible time + the smoothed frame interval.
- **Deep idle tried and rejected (user call: "30 fps at idle was better, this looks lagging").** A 15 fps tier after 15 s of inactivity measured 19.4–21.5 % vs 24.7 % at 30 fps: too little saving for visibly choppier motion. Idle stays at 30 fps and ~25 % of a core is accepted for now. Two findings from the experiment:
  - A release build that renders **zero frames** still costs ~9 % (Hikari's process ~5 %, the rest WebKit). Disabling the cursor poll didn't change it, and driving the calm tiers with timers instead of rAF saved only ~2 points. So the fixed cost is WebKit/WKWebView overhead, not our render loop. Revisit with Instruments if the budget matters later.
  - Kept: a cursor moving **far** from her no longer forces 60 fps (only within 160 pt of the window does). Eyes still follow at the 30 fps idle rate, so using the mouse elsewhere doesn't double her cost.
- **Render tiers** (`src/stage/frameScheduler.ts`): 60 fps active (speaking, gestures, hover, listening/thinking, eyes catching up, 800 ms tail), 30 fps idle, 0 when hidden via the tray. Skips rAF ticks, so it's vsync-aligned on 60/120 Hz; under macOS Low Power Mode WebKit caps rAF at 30 fps and both tiers get every tick.
- **No pause on `document.visibilitychange`**: WebKit reported this floating panel as `hidden` at boot while it was on screen (release build, Chrome frontmost). Only the tray's explicit hide pauses rendering.
- **Cursor poll** reads CoreGraphics (`CGEventGetLocation`, thread-safe, no TCC) and caches window geometry from window events. Four Tauri getters at 30 Hz were each a synchronous main-thread round trip. Polls at 30 Hz near her or while the cursor moves, 8 Hz otherwise, and not at all while hidden.
- **Production-only bugs found by testing the release build** (dev serves without Tauri's CSP or the custom protocol, so none showed in dev):
  1. Pixi v8 needs `import "pixi.js/unsafe-eval"` under a CSP without `unsafe-eval`; otherwise it fails at init.
  2. Pixi decodes textures in a `blob:` Worker, which the CSP blocks, so loading hung forever with no error. Fix: `loadTextures.config.preferWorkers = false`. The CSP stays strict.
  3. Pixi resolves root-relative URLs under `tauri://` to `tauri://characters/…` (host dropped). Model URLs are now absolute.
- `src/diagnostics.ts` forwards webview errors and warnings to the Rust log (stdout + log file), since release builds have no devtools. `VITE_DIAG=1` adds a 5 s render heartbeat; `VITE_FORCE_TIER=active|idle` pins the tier for measurements.
- **Idle CPU, measured** on an M2 with a release build (`dev/measure-idle.sh`, app + its WebKit processes, % of one core): **37.2 % at 60 fps → 24.7 % at the 30 fps idle tier**. In both, about 20 points are WebKit rendering and compositing Live2D; the app process (~4 %) is mostly UI-side compositing. The spec's "idle CPU < 3 %" can't be met while idle stays at 30 fps (§9.5): cost scales roughly with frame rate. This needs a product decision (see PLAN open questions).
- **Cubism Core 6 compat shim** (`src/avatar/live2d/coreCompat.ts`): SDK 5-r.5 ships Core 6, which moved `drawables.renderOrders` to `Model.getRenderOrders()`; untitled-pixi-live2d-engine 1.4.0 still reads the old field and crashed on first draw. Every other Drawables field the engine uses is unchanged. Shim maps the old field for models without offscreens (warns otherwise). Remove when the engine supports Core 6.
- Captions follow the **audible** chunk on the audio clock, not schedule time (chunks are queued ahead; the old code showed the last sentence while she spoke the first).
- Dev flag `VITE_AUTOPLAY_MOCK=1` plays the mock turn on load (used for screenshot-based lip-sync checks). Debug overlay shows AudioContext state + live mouth opening.
- **Phase 0 research was run by A's session alone** (B had not started). B should review `docs/RESEARCH.md` and the `docs/research/03-speech.md` / `04-llm-memory.md` picks before building on them.
- **Protocol v0.1.0 drafted by A** (`packages/protocol`). Shared item: B must review before relying on it; v0.x may still break. `tts.chunk.pcm` is base64 in a JSON frame for simplicity; move to binary WS frames if profiling shows decode cost.
- `Error` schema def is named `ErrorInfo` (avoids shadowing JS `Error`).
- Stage = **non-activating NSPanel** (tauri-nspanel 2.1.1), `PanelLevel::Floating`, instead of NSWindow + level 25 — research found the latter activates Hikari on click and is unreliable over fullscreen apps.
- Hotkeys default: ⌥Space push-to-talk, ⌘⇧M mute, ⌘⇧Esc panic (Carbon hotkeys → no Input Monitoring permission needed).
- Asset fetch script lives in `apps/desktop/scripts/` (not root `scripts/`, which is B's).
- **The fetch script never downloads Cubism Core**: getting the SDK means accepting Live2D's licence (accepted by the user on 2026-11-20, SDK 5-r.5 downloaded to ~/Downloads); the script extracts Core only if it's listed in `RedistributableFiles.txt`.
- Haru's expression map (F01–F08 → emotions) is a first guess; tune in Character Studio (M2).
- Hima TTS has no licence: kept as the research pick for local prototyping; **must not ship** without a licence from the author (open question for B).
- No live RVC (no maintained Apple-Silicon real-time RVC); §5(c) downgraded to offline augmentation.
- Lip sync: Cohen–Massaro dominance blending + explicit bilabial closure gate (the unit test showed blending alone leaves lips ~19 % open on "m").
- Dev without core: releasing push-to-talk with no core connected plays an in-browser synthetic mock turn (formant buzz matched to phoneme timings); double-click on her also plays it. B's `core/mock_server.py` will replay real recorded Hinglish turns.
