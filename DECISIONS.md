# Decisions & assumptions

Newest first. "A" = Person A (Body & Desktop), "B" = Person B (Brain & Voice).

## 2026-11-24 — Reze as an Iki model (A)

- Reze uses `model/Reze.iki`. The previous pack configuration is preserved in
  `characters/reze/source/character.live2d.json`. The original Live2D assets are still available locally.
- Cut the visible 448×1528 PSD composite at 2.06× on a 1100×4096 canvas. Preserve the painted
  closed smile and use the PSD's hidden speaking mouth as the interior for the keyed lip set.
  The attached offer artwork supplies the foreshortened right arm, gripping hand and white
  flower for the offer pose.
- Keep the visible brows attached to the face. The expressions are smile, laugh and surprise.
  The offer lifts the right arm, brings the white flower forward and lifts the corners of her
  smile. The right elbow's inward range supports the shy wave. The lean uses `ParamLegShift`
  and passes the forearms behind the shorts.
- Blend the fringe and locks into the face warp along painted contact edges. Let the tips sway
  and hold the shoulders against the armholes while rotating the arms. Extend the tied hair
  under the neck using the source palette where the standing layers conceal it.
- The 1:1 hair check measured 42 of 97,725 pixels outside the 2 px tolerance (0.043%).
  Iki reported zero unexpected folds over 2,209 poses. The flower offer, shy wave, lean, and
  point stayed inside the native stage, and three repeated flower cues produced one offer.
- Reze's art has no torso under the upper arm: past ~12° out, the armpit opens and the cut
  armhole shows. `armLiftMax: 9` in character.json soft-limits `ParamArmL/R` for every gesture
  (`limitArmLift`); a near-straight arm bends out at the elbow by the angle taken off, so point
  still points. Her wave is now elbow-led with the hand beside her face. Repainting the side
  under the arm would lift the limit.
- The flower offer no longer uses `ParamOfferLift` (it squashed the upper arm into a stub). She
  bends her own arm in across the waist (elbow 110°), the painted offer arm cuts in over ~70 ms
  (a slow dissolve showed two half-transparent arms), and the hand then comes forward.

## 2026-11-24 — Makima as an Iki model, cut from her reference (A)

- **Renderer `iki`** (`src/avatar/iki/IkiAvatar.ts`, `@ikijs/engine` 0.13.0 / `@ikijs/format` 0.12.0, MIT). The user asked to use zeikar/iki strictly. Makima's pack now points at `model/Makima.iki`; her Live2D config is kept in `characters/makima/source/character.live2d.json`.
- **Cut, not generated.** Every part (hair, face, eyes, mouth, torso, legs, arms) is cut from her reference picture with iki's `cut_layers_from_illustration`; arms are split off the cut body into movable layers. Generated parts were tried first (about 45 Codex images) and never matched: wrong head scale, lopsided hair, short arms, no neck. Hair at rest: 0.13–0.16 % of hair pixels off by more than 2 px.
- **Additions on top of iki:** `ParamLegShift` (body-mesh warp: hips shift, relaxed knee, planted feet; iki has no leg rig) and procedural arm gestures in the renderer (the model has only Nod/Shake/Tilt; a raised-hand wave needs a drawn raised forearm the picture lacks). Expressions: smile, laugh, surprised (no brows are visible in the picture, so no angry/sad).
- **Upstream:** two iki bugs (lip-set green spill; arm shoulder row assumed at 12 % of the body, wrong for long necks) are documented and fixed in [zeikar/iki#71](https://github.com/zeikar/iki/pull/71) (from the user's fork; open, awaiting review): the lip set is despilled and the green check weighs what is drawn; a long-necked body's arms hang on the shoulder line found from its paint, and the report says to move `cy` down instead of `cx` inward.
- **Follow-up fixes:** the white border was the picture's backdrop in edge pixels (now unmixed per edge against the picture's local colour); the stuck arms were a renderer bug (offsets accumulated on parameters IkiMotion never resets; now restored every frame, unit-tested); motion moved to `src/avatar/iki/gestures.ts` (springs, envelopes, variation, idle arm life) with Makima's signature moves: folded-hands stance, closed-eye tilted smile, "bang".
- **Neck under the locks:** the body beside and under the side locks is restored from the picture and repainted, with the hidden collar and shoulder lines measured by hand (`assemble-makima.sh`). Head tilts uncover clean shirt. Torso corners above the sleeve roots are trimmed along the shoulder outline and small dark specks on the shirt are recoloured, so a lifted arm shows a clean shoulder.
- **Raised-hand wave via extended ranges (assumption):** `extend-arms.mjs` lets the shoulder go to 150 and the elbow open to −170, at the same slope as iki's auto-rig. Iki's validators only check the auto-rigged range, so poses past 32 were checked by eye on renders and in the app (no seam gap at the shoulder, only a slight kink). The renderer picks `wave-raised` only when the model has these ranges. A gesture already in progress is not restarted by repeat cues.
- Procedure, verification and prompts: `docs/IKI.md`; scripts: `apps/desktop/dev/iki-pipeline/`. Reze, Rize, Lu Guang and Cheng Xiaoshi are still Live2D.

## 2026-11-24 — Model audit and fixes: Reze, Makima, Rize, Lu Guang, Cheng Xiaoshi (A)

Request: the hand-added Live2D rigs had many problems; bring them up to the standard of the official Cubism samples. Method: measure first, with the real Cubism Core, and calibrate every check on Hiyori/Haru/Mao/Rice so the audit only flags what official models don't do.

- **Tooling (`apps/desktop/dev/model-audit/`, `dev/model-fix/`).** `pnpm -F desktop audit:models [-v] [id…]` checks parameters (standard ids/ranges/defaults), model3.json references, groups, motions/expressions/physics, parts, UVs, canvas/PPU and the pack's own `character.json`. Exit 1 on errors; `audit.test.mjs` runs it per installed pack (skipped without Core, which is licensed and git-ignored). `rigmap.mjs` reports how far each drawable moves per parameter. `moc3.mjs` is a small moc3 reader/patcher (same-size, in-place edits only). `rigtest.ts` (`#/rigtest`, dev only) renders a rig with bare Cubism and **none** of our runtime patches, to see what any standard viewer would show. `pnpm -F desktop fix:models [--dry] [id…]` is the non-destructive fixer: originals are backed up to `characters/<id>/source/original-model/`, `model/` is rebuilt from them (idempotent), and every change is verified with Core (rest pose unchanged).
- **Defects fixed in the rigs.**
  1. *Hair/cloth swing tore the art open* (keyforms of ±1 moved hair meshes 8–15 px, exposing smeared inpaint and background). Swing amplitude is capped per model (Reze hair 3.2 px / cloth 6, Makima 4.5 / 6, Rize 5), verified at both Breath extremes. Physics outputs still drive the same parameters.
  2. *Left eye blinked through the hair* (lid overlay drawn under a hair mesh): lids now draw above hair.
  3. *Breath default* was 0 on a 0…1 parameter, so the idle pose differed from the rest pose. Default re-based so the rest pose is identical but breathing is symmetric.
  4. *BodyAngleX in the motions* exceeded the parameter range; clips are fitted to the range.
  5. *No DisplayInfo*: a `<Model>.cdi3.json` (parameter and part names/groups) is generated and referenced from model3.json, as in the official packages.
- **App fix found on the way.** Lip sync was hard-wired to `ParamMouthOpenY`. Mao's `LipSync` group is `ParamA`, so Mao's mouth never moved. `lipSyncIds()` now follows the model's `LipSync` group (fallback `ParamMouthOpenY`); unit-tested.
- **Makima's palm was enlarged by the app, not by the rig.** `poseRig.hands[].breadth` widens the palm at all times; Makima's `HandL` was 1.25 (+17 % silhouette area at rest vs the drawn art, 5266 vs 4485 px) and `joinedBreadth` 1.12. Set to 1.0 (HandR was 1.01): the palm is exactly the drawn size and the rigid hand fit keeps its area within ~5 % through the gestures. The *native* rig really does squeeze the hand while the arm bends (area down to 66–73 % in laugh/clap/cross_arms, measured with `rigtest mode=handarea`), which is what the rigid fit in `poseRig.ts` is there to prevent; it works at breadth 1.0. Reze, Rize, Lu Guang and Cheng Xiaoshi still use 1.04–1.24 (visible but subtle at rest); revisit per character. `rigtest` gained `poserig=1`, `orig=1`, `motion=Group:i t=…` and `mode=handarea` for this.
- **Result.** All nine packs (the 4 official/sample ones and the 5 new rigs) audit with **0 errors**. Rest-pose renders of the five new rigs show no tearing.
- **Not fixed — limits of the source art, not of the rig file.** These are flattened AI illustrations cut into 12–17 layers (the head and face are one layer; the inpaint behind hair is smeared). So: head turn has almost no parallax; a shoulder seam shows when the arms are raised high; there are no separate irises, lashes, nose or ears; no `ParamBodyAngleY/Z` or `ParamCheek`; 1–2 parts and 16–17 drawables where official samples have 84–262; a ~3 px see-through sliver at Reze's left armpit (other flagged regions are real space between arms and torso). These show up as audit *warnings*. Closing them means re-cutting the art into proper layers (separate eyes, brows, mouth, hair strands, neck, ears), then rigging in Cubism Editor, Stretchy Studio or iki; or switching those characters to VRM. `poseRig.ts` (runtime patching of drawable vertices) stays as the app's way to get arm poses out of these thin rigs; it is not a Cubism standard feature.
- **PixelsPerUnit** is the canvas *height* on four of the new rigs (official models use the width). It is a convention, the Core and our stage fit are unaffected, and changing it would mean rescaling every vertex, so it is left and reported as a warning.
- **Reference.** `zeikar/iki` was read for its standard parameter vocabulary and its fold/physics validators; it is an open rig format and engine, not a Cubism exporter, so none of its code runs here or ships. Downloaded third-party repos are treated as read-only data.
- **Licensing, for A and B to decide before publishing.** The five rigs are AI-generated fan illustrations of characters owned by rights holders (see `docs/LICENSES.md`). `characters/*/model/` and `source/` are untracked; committing them to the public repo is a risk the owner should accept explicitly, so this change commits tooling, the app fix and docs only.

## 2026-11-22 — Native Cubism models for Makima, Reze and Rize

The default packs now include MOC3 rigs and texture atlases based on the official character sheets. All seven characters load through Live2DAvatar. Two idle clips, fourteen gesture clips, ten expressions and Cubism physics accompany each new rig. Each character has shoulder, elbow and wrist joints, separate hair and garment meshes, and a facial layer for blinking and speech. Character Studio previews and the desktop stage use the same rig. User-imported models continue to live in app data and override these defaults. Deleting an override restores the built-in rig and the character keeps its original persona.

## 2026-11-22 — M2 (A): characters, Character Studio, chat

- **Protocol 0.2.0 (additive; B please review):** new UI→core `character.select {id, displayName, persona, defaultLanguage?, voice?}`, sent after `hello` and on every switch. The core puts `persona` (persona.md) into the system prompt and namespaces memory by `id`. `hello` now sends the generated `PROTOCOL_VERSION` instead of a hard-coded string.
- **persona.md format** is fixed in `characters/PERSONA_FORMAT.md` (10 `##` sections, in order) so B's prompt builder can parse it. A unit test enforces it on every built-in persona, and checks that gesture tags are real protocol tags, that characters are adults, and that they're honest about being an AI.
- **Characters:** 4 originals on Live2D samples, keeping the sample names: Hiyori (genki), Haru (kuudere), Mao (tsundere apprentice magician), Rice (sleepy gamer). Mao and Rice are added to `fetch-assets`. Reze, Makima and Rize Kamishiro are **persona text + empty import slot** (§4), with original writing and no quoted dialogue. Makima's "control" flavour is explicitly playful and never pressure; Rize has no gore. Mao's `exp_01–08` emotion mapping is a first guess.
- **Built-in packs are bundled at build time** from `characters/` via Vite `import.meta.glob`, so no copy step can drift. Models are still fetched into `public/characters/`.
- **Imports** (`src-tauri/src/packs.rs`) go to `<app data>/characters/<id>/`. Accepted: a Live2D folder, a `.model3.json`, a `.zip`, or a `.vrm`.
  - Live2D: every referenced file is checked (a missing Moc/texture fails the import; missing motions only warn).
  - VRM: licence read from the GLB JSON chunk (VRM 1.0 `VRMC_vrm.meta` / 0.x `VRM.meta`).
  - Zips are extracted safely (zip-slip, symlinks, 1 GiB cap). Staging is atomic and removed on failure.
  - An import into a slot keeps that character's persona. 5 Rust unit tests; CI now runs `cargo test`.
- **`hikari-pack://localhost/<id>/<path>`** serves imported packs (async handler, `..`/encoded-traversal blocked via canonicalisation, CORS `*`). It's used because Tauri's `asset://` URLs encode `/` as `%2F`, which breaks the Live2D engine's relative texture paths. **Verified in the app:** an imported Live2D pack rendered with textures via this scheme.
- **Windows:** Character Studio and Chat open from the tray, hide on close, and use a `show_window` command allow-listed to those two. In an accessory app, macOS 14+ cooperative activation means they come forward only on user action (tray click), not when opened programmatically at launch.
- **Chat** talks through the stage via Tauri events (`chat://send` / `chat://event` / `chat://history`), so the core sees one UI connection. Typed text interrupts her if she's speaking. Typed **"switch to Mao" / "change to makima" / "Mao ko bulao"** switches characters locally (`switchIntent.ts`, one-typo tolerant, so "maxima" → Makima). An empty slot opens the Studio. **B:** voice switch requests need STT, so the core should detect them.
- **Bug class fixed: leaked async listeners.** Unmounting before Tauri's `listen()` resolved left listeners attached, so every event was handled twice. It showed as duplicated chat lines, and would also have left a destroyed runtime reacting to ⌥Space. `util/subscriptions.ts` now owns all subscriptions.

- **Menu-bar icon is a macOS template image** (`icons/tray/tray-template@2x.png`, made by `assets/brand/tray.swift`): the sakura flower only (largest connected white shape of the logo), black + alpha, `icon_as_template(true)`, so the system tints it like other status items. It previously used the full-colour app icon (pink square).
- **Franchise models:** Downloaded from the web (fan art of the design) and  recreated as lookalikes in this public repo into the Reze/Makima/Rize slots these stay in the app data folder.

- **Model fitting uses the visible artwork, not the model canvas** (`Live2DAvatar.layout`). The union of all drawable meshes with opacity is fitted to the window in both dimensions (6 % side / 4 % top / 1 % bottom margins), centred, with her feet on the bottom edge. Before, Rice (drawn right of centre in a wide canvas) was cut in half by the window edge. Checked with `apps/desktop/dev/capture-models.sh` for all four built-ins, and Mao over 9 s of idle animation (her magic orbs stay inside).
- **Stage parks in logical points** (`stage::park`). With a 2x Retina plus a 1x external display (LG ULTRAGEAR), physical coordinates were converted using the wrong screen's scale, and the stage landed outside every display.

## 2026-11-22 — M1 (A): microphone, push-to-talk, barge-in

- **Protocol semantics (B, please review):** the UI now **sends** `turn.end {reason: "push_to_talk"}` when ⌥Space is released, meaning "end of user input". No schema change (the enum already had `push_to_talk`). In always-listening mode the UI sends audio with `pushToTalk: false` and the core's VAD decides turns. The protocol console's `--wav` sends the same `turn.end`.
- **Capture in the WebView** (`src/audio/capture.ts` + `captureWorklet.ts`): `getUserMedia` with echoCancellation / noiseSuppression / autoGainControl on the *same AudioContext TTS plays on*, so WebKit's echo canceller has her voice as reference (research 03 §6, fallback design). An AudioWorklet downsamples to 16 kHz with a windowed-sinc filter (12 kHz test tone suppressed, no aliasing into the speech band) and posts 20 ms Int16 frames → `audio.in.chunk`.
- **Push-to-talk (default):** the mic opens on the first press and closes 10 s after the last release (the orange mic indicator doesn't stay on). While warm, a 200 ms pre-roll keeps the first syllable. **Always-listening** keeps it open. **Mute** (tray or ⌘⇧M) closes it. Rust now owns the mute state, so the tray check mark and the hotkey stay in sync.
- **Local barge-in** (`src/audio/localVad.ts`, always-listening only; in PTT, pressing the key interrupts): energy VAD with a minimum-statistics noise floor (quietest RMS over 1.5 s) ducks her to 25 % after 250 ms of speech and cuts her off at 450 ms. The core's Silero VAD will refine this. Three bugs found by its tests, all fixed:
  1. a steady fan above the threshold read as endless speech;
  2. the floor learned the user's own voice, so barge-in failed right after their turn;
  3. the tail of the user's turn instantly "cut" her reply.
- macOS: `Info.plist` (NSMicrophoneUsageDescription) and `Entitlements.plist` (`com.apple.security.device.audio-input`) for hardened-runtime builds. wry grants the WebView's media request, so only the macOS prompt appears.
- **Dev fake core** (`pnpm -F desktop fake-core`): a protocol-true stand-in until B's core exists. It echoes your voice back (PTT release, or end of speech when always-listening) with loudness-based phonemes, and speaks `text.in` with macOS `say` (Lekha for Devanagari, Tara otherwise). Replies go to all UIs, so the console can make the app speak.
- **Verified:** dev and release builds deliver 50 frames/s (20 ms) to the core. A console-driven reply played in the app with lip sync, caption and the speaking state, with no false barge-in during a 4.8 s reply. **Not verified:** echo cancellation with speakers (output was AirPods), the ⌥Space press path with a real key (synthetic keys need Accessibility), and an always-listening barge-in by a real voice.

## 2026-11-20 — Phase 0 / M0 (A)

- **Hands-on cursor test** (`apps/desktop/dev/cursor.swift` moves the real cursor; click-through toggles are logged at debug level). It found a bug: the hit test answered from the *previous* pixel readback, so with the cursor resting on her she stayed click-through until the mouse moved again. Fresh readbacks now apply immediately (`onHitChange`). After the fix, 6/7 points were correct within 0.5 s: face and cardigan clickable; leg gap, empty window area and far away pass clicks through. The 7th point was on her hair's outer edge, so inconclusive. **Not tested by me:** clicking and dragging (synthetic clicks need Accessibility permission for the terminal, which isn't granted, and I won't change security settings) and eye-follow (screenshot caught a blink).
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
