# 02 — Avatar Rendering, Assets & Lip Sync

Researched 2026-11-20. Versions come from the npm registry, GitHub, Hugging Face and the vendor license pages listed under Sources.
Target: Tauri v2 (WKWebView on macOS, Apple silicon), a transparent window, React + TS.

## TL;DR

- **Live2D renderer:** `untitled-pixi-live2d-engine@1.4.0` on `pixi.js@8.23.0`. It supports Cubism 2–5, uses a native Pixi v8 render pipe and can play motions in parallel, which suits layered gestures. It has `speak()` lip sync, and the mouth parameters can also be set directly.
- **VRM renderer (secondary/"3D mode"):** `@pixiv/three-vrm@3.5.5` + `@pixiv/three-vrm-animation@3.5.5` on `three@0.187.0`, with `postprocessing@6.39.6` + `n8ao@2.1.0`.
- **Cubism Core:** do not commit `live2dcubismcore.min.js` to a public repo. Fetch it from the official SDK zip at build time and ship it inside the signed `.app`. Bundling is limited to the files listed in `RedistributableFiles.txt` and requires passing the license terms on to end users. The SDK Release License is free for individuals and businesses with sales under ¥10M.
- **Models:** Live2D **Hiyori** + **Haru** (Free Material License, Original Characters). VRM **VRM1_Constraint_Twist_Sample** (pixiv) + **Seed-san** (VirtualCast). Both VRM models allow redistribution and corporate use.
- **Lip sync:** use (1) phoneme/viseme timestamps from the TTS when it provides them, (2) otherwise forced alignment with `facebook/wav2vec2-xlsr-53-espeak-cv-ft` (Apache-2.0, multilingual IPA, Hindi possible), and (3) the `wlipsync@1.3.1` MFCC AudioWorklet as a real-time fallback. Use Rhubarb only for offline English.

## 1. Live2D on PixiJS v8

| Package | Latest | Pixi | Cubism | Lip sync API | Parallel motions | Maintenance | License |
|---|---|---|---|---|---|---|---|
| `untitled-pixi-live2d-engine` | 1.4.0 (2026-09-20) | `^8.13.1` (peer + `@pixi/sound ^6`, sound optional) | 2.1 / 3 / 4 / 5 (separate `cubism-legacy` / `cubism` entries) | `model.speak(url,{volume,expression,onFinish})`, `stopSpeaking()`, `lipSyncGain` (1.5) / `lipSyncWeight` (0.4) options; or set params directly | **Yes:** `parallelMotion([...])`, `parallelLastFrame`, per-item `loop` | Active (pushed 2026-11-15, 83★, 13 issues); refactor of Sekai-World `pixi-live2d-display-mulmotion` | MIT |
| `easy-live2d` | 1.1.0 (2026-11-12) | Pixi 8 (tested 8.17.1, not a peer dep); WebGL2 only, no WebGPU | Cubism 5 SDK R5 Core only (pin 0.4.4 for older Core) | `playVoice({voicePath})` uses model `LipSync` group | Not documented (priority-based `startMotion`) | Active (223★), wraps official Framework | MIT |
| `pixi-live2d-display` (guansss) | 0.4.0 (2022-09-04) | Pixi **6** only | 2.1 / 3 / 4 | none built in | no | **Dead** (last push 2024-08) | MIT |
| `pixi-live2d-display-lipsyncpatch` | 0.5.0-ls-8 (2025-06) | Pixi **7** | 2.1 / 4 | `speak()` | no | Slow (last push 2025-06) | MIT |
| `@naari3/pixi-live2d-display` | 1.2.5 (2025-11-30) | `^8` | 5 only | none documented | no | Small (6★), quiet for a year | MIT |
| `@jannchie/pixi-live2d-display` | 1.4.0 (2026-07-17) | `^8` | 2.1 / 4 | `speak()`, mic, `setLipSyncValue()` | no | Tiny (2★) | MIT |
| `live2d-motionsync` | 0.0.4 (2025-01-24) | built for pixi-live2d-display + Pixi 6.5 | Cubism 4, **needs `.motionsync3.json`** models | `new MotionSync(model.internalModel).play(src)` | n/a | Repo active (2026-09) but npm stale | MIT (bundles Live2D MotionSync, which carries Live2D's own terms) |

**Chosen: `untitled-pixi-live2d-engine`.** It is the only Pixi-v8-native option with all of Cubism 2–5, parallel motions (body gesture plus face plus idle layers), filters/RenderTexture, hit testing and lip sync. `easy-live2d` is the fallback if we only ever need Cubism 5 and want the official Framework semantics. Rejected: guansss original (Pixi 6) and lipsyncpatch (Pixi 7). `live2d-motionsync` only works with models authored for MotionSync and an old Pixi.

### Install + minimal usage

```bash
pnpm add pixi.js@8.23.0 untitled-pixi-live2d-engine@1.4.0 @pixi/sound@6
# Core is NOT on npm. Copy live2dcubismcore.min.js from the Cubism SDK for Web zip into public/live2d/ (see §2)
```

```html
<!-- index.html: Core must load before the engine -->
<script src="/live2d/live2dcubismcore.min.js"></script>
```

```ts
import { Application, extensions } from 'pixi.js'
import { Live2DModel, Live2DPlugin, configureCubismSDK } from 'untitled-pixi-live2d-engine/cubism'

extensions.add(Live2DPlugin)                 // before creating the renderer
configureCubismSDK({ memorySizeMB: 32 })     // optional (default 16)

const app = new Application()
await app.init({ preference: 'webgl', backgroundAlpha: 0, resizeTo: window,
                 autoDensity: true, resolution: devicePixelRatio, antialias: true })
document.body.appendChild(app.canvas)

const model = await Live2DModel.from('/models/hiyori/Hiyori.model3.json', {
  autoHitTest: true, autoFocus: false, textureOptions: { lod: 'single-auto' },
})
model.anchor.set(0.5, 1); model.position.set(app.screen.width / 2, app.screen.height)
app.stage.addChild(model)

// Parameter IDs → indices once (raw Core model exposes string ids)
const core = (model.internalModel as any).coreModel            // CubismModel
const ids: string[] = core.getModel().parameters.ids
const P = (id: string) => ids.indexOf(id)
const MOUTH_OPEN = P('ParamMouthOpenY'), MOUTH_FORM = P('ParamMouthForm')

// Per-frame mouth: write AFTER motions/expressions, before the model is drawn
let mouth = { open: 0, form: 0 }                               // fed by the lip-sync engine (§6)
model.internalModel.on('beforeModelUpdate', () => {
  core.setParameterValueByIndex(MOUTH_OPEN, mouth.open)        // 0..1
  core.setParameterValueByIndex(MOUTH_FORM, mouth.form)        // -1..1
})

model.expression('f01')                                        // expression by name or index
model.motion('Idle', 0)                                        // group, index
model.parallelMotion([{ group: 'TapBody', index: 0 }, { group: 'Idle', index: 1, loop: true }])
model.on('hit', (areas: string[]) => { if (areas.includes('Body')) model.motion('TapBody') })
const hits = model.hitTest(x, y)                               // manual hit test (e.g. click-through logic)
model.focus(mouseX, mouseY)                                    // eye/head tracking
// or built-in audio-driven lip sync: await model.speak(blobUrl, { volume: 1 })
```

Tauri: set `"transparent": true` on the window plus `app.macOSPrivateApi: true`. Pixi `backgroundAlpha: 0` preserves alpha in WKWebView (WebGL2).

## 2. Live2D Cubism Core & sample-model licensing

- **Cubism Core** (`live2dcubismcore(.min).js`) is under the *Live2D Proprietary Software License Agreement* (PSLA). The Framework and Samples use the *Live2D Open Software License*.
  - Under PSLA §5.1–5.2 you may redistribute only the "Redistributable Code" listed in `RedistributableFiles.txt` inside the SDK. It must be embedded in a derivative work that adds significant functionality. End users must accept protective terms equivalent to the PSLA, you indemnify Live2D, and the file ships as-is with no modification.
  - §6.2/6.5 prohibit standalone redistribution and sublicensing. §5.3.2 and §6.8 forbid putting it under a non-Live2D license.
  - Live2D's docs say Core is deliberately not published on GitHub, and Live2D support has told developers that repos re-hosting it violate the PSLA.
  - **Practice:**
    - **Bundling inside the shipped app is allowed.** Confirm the filename appears in `RedistributableFiles.txt` of the downloaded zip, and add a Live2D clause to Hikari's EULA/about screen.
    - **Never commit it to a public repo.** A CI/setup script downloads the SDK zip from the official page instead. Users do not have to download it themselves.
- **SDK Release License (publication):**
  - It is needed only at release. Individuals and Small-Scale Enterprises (latest fiscal-year sales **under ¥10,000,000**) are exempt from both the agreement and payment, except for "Expandable Applications". An app that loads user-supplied models could count as one, so this needs review.
  - Middle-scale (¥10M–¥100M) and large-scale (¥100M+) businesses must sign at least one month before release.
  - Latest SDK: Cubism 5 SDK for Web **5-r.5** (2026-04-02).
- **Free Material License (sample models):**
  - **Live2D Original Characters** (Hiyori, Haru, Mao, Rice, Mark, Miara, Kei, Ren, Epsilon, Shizuku, Wanko…) may be used, altered and distributed "for Purpose of Use".
  - Commercial use is limited to **General Users and Small-Scale Enterprises (<¥10M)**. Larger companies get internal/test use only unless Live2D approves.
  - The credit "*This content uses sample data owned and copyrighted by Live2D Inc.*" is required.
  - Hiyori and Miara allow **no design changes**. Shizuku's name and settings cannot be changed. Sound data in the samples cannot be redistributed.
  - **Collaboration characters (Jin Natori, Tsumiki Harugasa) cannot be used commercially, altered or distributed. Do not ship them.**
  - Content that is sexual, violent, political or religious is prohibited.
- **Download:**
  - The model pages are at https://www.live2d.com/en/learn/sample/ (e.g. `/momose-hiyori/`, `/haru/`).
  - The runtime folders are also in the official repo https://github.com/Live2D/CubismWebSamples/tree/develop/Samples/Resources (Haru, Hiyori, Mao, Mark, Natori, Ren, Rice, Wanko; its LICENSE.md says they are under the Free Material License).
  - The Core comes from the "Cubism SDK for Web" zip at https://www.live2d.com/en/sdk/download/web/ and is not in that repo.
- **Verdict:** bundling Hiyori and Haru in a free or open app is OK while the publisher is an individual or a business under ¥10M. Display the credit, don't alter Hiyori's design, and don't ship the sample voice files. Revisit if Hikari is published by a company with ¥10M+ sales.

## 3. VRM on three.js

| Package | Version | Notes |
|---|---|---|
| `three` | 0.187.0 (2026-10-30) | three-vrm peer `>=0.137`, developed against `^0.180` |
| `@pixiv/three-vrm` | 3.5.5 (2026-07-09) | MIT; VRM 0.x and 1.0; core, MToon, springbone, node-constraint |
| `@pixiv/three-vrm-animation` | 3.5.5 | MIT; `.vrma` loader → `AnimationClip` |
| `@pixiv/three-vrm-materials-mtoon/nodes` | 3.5.5 | `MToonNodeMaterial` (TSL) for `WebGPURenderer`, three r167+; pixiv warns it may break with three updates |
| `postprocessing` (pmndrs) | 6.39.6 (Zlib); peer `three >=0.168 <0.188` | v7 is beta (`7.0.0-beta.16`); stay on 6.x |
| `n8ao` | 2.1.0 (ISC) | SSAO for postprocessing ≥6.30; `transparencyAware` |

- **Expressions (VRM 1.0 presets):**
  - Emotions: `happy, angry, sad, relaxed, surprised`.
  - Visemes: `aa, ih, ou, ee, oh`.
  - Blink and gaze: `blink, blinkLeft, blinkRight, lookUp/Down/Left/Right`, plus `neutral`.
  - Use `vrm.expressionManager.setValue('aa', w)`. Both chosen models contain every one of these, verified from their `VRMC_vrm` JSON.
- **Look-at:** `vrm.lookAt.target = camera` (bone or expression type). In VRMA, use `VRMLookAtQuaternionProxy`.
- **Spring bones:** they update automatically in `vrm.update(dt)`. After a teleport, call `vrm.springBoneManager.reset()`.
- **WebGPU:**
  - WKWebView on macOS 26 (Safari 26) ships WebGPU, but WebGL2 + standard MToon is the stable path.
  - Treat `MToonNodeMaterial` with WebGPU as experimental. The pmndrs postprocessing package is WebGL-only.
- **Transparent canvas:**
  - Use `new WebGLRenderer({ alpha: true, premultipliedAlpha: true })`, `setClearColor(0x000000, 0)` and `scene.background = null`.
  - pmndrs `EffectComposer` keeps alpha. Use `frameBufferType: HalfFloatType` and clear alpha 0. three's built-in `UnrealBloomPass` blacks out the background.
  - Bloom bleeds glow into alpha=0 pixels, which shows as a halo on the desktop. Keep bloom subtle and the luminance threshold high.
  - N8AO is fine: transparent objects with depthWrite off don't occlude, but they render twice.

```ts
import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { VRMLoaderPlugin, VRMUtils, type VRM } from '@pixiv/three-vrm'
import { VRMAnimationLoaderPlugin, createVRMAnimationClip, type VRMAnimation } from '@pixiv/three-vrm-animation'

const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, premultipliedAlpha: true })
renderer.setClearColor(0x000000, 0)
const loader = new GLTFLoader()
loader.register(p => new VRMLoaderPlugin(p)); loader.register(p => new VRMAnimationLoaderPlugin(p))

const vrm: VRM = (await loader.loadAsync('/models/vrm/Seed-san.vrm')).userData.vrm
VRMUtils.removeUnnecessaryVertices(vrm.scene); VRMUtils.combineSkeletons(vrm.scene)
VRMUtils.rotateVRM0(vrm); scene.add(vrm.scene)
vrm.lookAt!.target = camera

const vrma: VRMAnimation = (await loader.loadAsync('/anim/idle.vrma')).userData.vrmAnimations[0]
const mixer = new THREE.AnimationMixer(vrm.scene)
mixer.clipAction(createVRMAnimationClip(vrma, vrm)).play()   // layer gestures via additional actions/weights

renderer.setAnimationLoop((t) => {
  const dt = clock.getDelta()
  mixer.update(dt)
  const em = vrm.expressionManager!
  em.setValue('aa', vis.aa); em.setValue('ih', vis.ih); em.setValue('ou', vis.ou)
  em.setValue('ee', vis.ee); em.setValue('oh', vis.oh); em.setValue('happy', mood.happy)
  vrm.update(dt)                                // expressions, look-at, spring bones
  composer.render(dt)                           // pmndrs EffectComposer(renderer,{frameBufferType: THREE.HalfFloatType})
})
```

**Animation sources:**
- **VRoid Project "VRMアニメーション7種セット"** (https://booth.pm/ja/items/5512385). It is free, © pixiv. Individuals and companies may use it commercially and modify it, with the credit "Character animation credits to pixiv Inc.'s VRoid Project".
  - Redistribution in extractable form is **not allowed** without permission, and files in `.app/Contents/Resources` are extractable.
  - So either get permission, embed the files non-extractably (for example obfuscated or packed into the binary, which is weak), or have the user download them on first run.
- **Mixamo:**
  - Animations are royalty-free for commercial projects, including games and apps, even on non-Mixamo characters. Retargeting to the VRM humanoid is fine: use the three-vrm `loadMixamoAnimation` example (bone map `mixamorig*` → VRM humanoid).
  - Raw FBX/animation files may not be redistributed as standalone assets. Bake them into our own format (e.g. pre-converted clips inside the bundle) and never offer them as a downloadable pack.
  - Requires an Adobe account; the files are not open licensed.
- **Own VRMA:** export from Blender with the VRM add-on (VRMA export) or author in VRM Posing Desktop. Owning the files avoids licensing questions entirely.

## 4. Gaussian-splat / neural avatars (brief)

- **Renderers are mature:**
  - Spark `@sparkjsdev/spark@2.4.0` (MIT, three.js, 2026-10).
  - `@mkkellogg/gaussian-splats-3d@0.4.7` (stale since 2025-01).
  - Both render static splats at 60 fps on Apple silicon WebGL2.
- **Animatable avatars are early:**
  - LAM (Alibaba, Apache-2.0) generates a FLAME-rigged photoreal **head** from one image. It claims 110+ FPS on mobile in its WebGL renderer (`gaussian-splat-renderer-for-lam@0.0.9-alpha.2`) and is driven by ARKit-style blendshapes from audio.
  - GaussianAvatars/3DGS-body work is research code, mostly non-commercial licensed, photoreal and head-only or body-without-hands.
  - No anime-styled, rigged, full-body splat avatar pipeline exists with toon shading, clean silhouettes for a transparent window, spring-bone hair or expression authoring.
- **Verdict:** rejected for v1. Revisit in about 12 months as an optional "photoreal" mode. Live2D and VRM have far better tooling, file size (2–20 MB versus 30–100 MB splats) and artist ecosystems.

## 5. Legal model sources

- **VRoid Hub:**
  - Each model carries license metadata, which three-vrm exposes as `vrm.meta`.
  - VRM 1.0 fields: `avatarPermission` (onlyAuthor / onlySeparatelyLicensedPerson / everyone), `commercialUsage` (personalNonProfit / personalProfit / corporation), `allowRedistribution`, `modification` (prohibited / allowModification / allowModificationRedistribution), `creditNotation`, `allowExcessivelyViolent/SexualUsage`, `allowPoliticalOrReligiousUsage`, `allowAntisocialOrHateUsage`, `otherLicenseUrl`.
  - VRM 0.x fields: `allowedUserName`, `commercialUssageName`, `licenseName`, etc.
  - Hub-hosted models are usually *view/use only via VRoid Hub API or download* and most forbid redistribution. **Never bundle a Hub model unless `allowRedistribution` is true.** For user-imported models, read `vrm.meta` and show a warning if `avatarPermission != everyone`.
- **VRoid Studio sample models** (AvatarSample_A…):
  - Several are CC0, mainly older ones. Newer ones link to pixiv's conditions-of-use page, which returned 403 to my fetch, so I could not verify them.
  - The VRoid guidelines say to check each sample's conditions.
  - Don't bundle them until each file's embedded meta is checked.
- **Booth.pm norms:**
  - Most avatars use the VN3 license or custom 利用規約 terms. Use as *your* avatar is allowed; redistribution of the model data, even modified, is prohibited.
  - Commercial use is often restricted to streaming. They are **not** suitable for bundling in an app. A user may import their own purchase.
- **Live2D samples:** see §2 (Original Characters OK for small publishers; never ship Collaboration characters).

### Recommended bundled models (4)

| Model | Type | Download | Terms (verified) |
|---|---|---|---|
| **Hiyori Momose** | Live2D (Cubism 3, runtime model3.json; Idle/TapBody motions) | https://github.com/Live2D/CubismWebSamples/tree/develop/Samples/Resources/Hiyori (page: https://www.live2d.com/en/learn/sample/momose-hiyori/) | Free Material License, Original Character; commercial use OK for General Users and Small-Scale (<¥10M); no design changes; credit line required |
| **Haru** | Live2D (Cubism 4; many expressions) | https://github.com/Live2D/CubismWebSamples/tree/develop/Samples/Resources/Haru (page: https://www.live2d.com/en/learn/sample/haru/) | Same as above; no extra per-character restriction. Alternate: Mao (`/Resources/Mao`) |
| **VRM1_Constraint_Twist_Sample** (anime girl, pixiv) | VRM 1.0 | https://github.com/vrm-c/vrm-specification/raw/master/samples/VRM1_Constraint_Twist_Sample/vrm/VRM1_Constraint_Twist_Sample.vrm | VRM Public License 1.0; meta: `avatarPermission: everyone`, `commercialUsage: corporation`, `allowRedistribution: true`, `modification: allowModificationRedistribution`, `creditNotation: unnecessary` (still credit "(c) 2022 pixiv Inc."); antisocial/hate use not allowed |
| **Seed-san** (VirtualCast) | VRM 1.0 | https://github.com/vrm-c/vrm-specification/raw/master/samples/Seed-san/vrm/Seed-san.vrm | VRM Public License 1.0; meta: everyone / corporation / redistribution true / modification+redistribution; `creditNotation: required` → credit "Seed-san model by VirtualCast, Inc." |

## 6. Lip sync

| Approach | Version / license | Quality | Latency | Hindi | Verdict |
|---|---|---|---|---|---|
| **TTS-native timing**: phoneme durations from Piper/Kokoro-style VITS, or viseme/char-alignment events from cloud TTS | depends on TTS | Best (exact) | Zero extra | Yes if the TTS phonemizes Hindi | **Chosen (primary)**: map phonemes → visemes in the TTS layer |
| **Forced alignment**: wav2vec2 phoneme CTC + Viterbi against the phonemized transcript | `facebook/wav2vec2-xlsr-53-espeak-cv-ft` (Apache-2.0, multilingual Common Voice, eSpeak IPA); `facebook/wav2vec2-lv-60-espeak-cv-ft` (Apache-2.0, stronger encoder) | Very good, ±20–40 ms | Runs on the finished TTS chunk; ~300M params via ONNX/CoreML in the Rust sidecar (`ort`) is well under real time on M-series | Works (IPA output; phonemize Hindi with eSpeak-NG `hi`) | **Chosen (fallback when the TTS gives no timing)** |
| Rhubarb Lip Sync | v1.14.0 (2025-04), MIT; macOS zip | Good for English (PocketSphinx); "phonetic" mode for other languages is weaker | Batch: needs the whole WAV, takes seconds per utterance, no streaming | Phonetic only | Rejected for runtime (batch + English-centric); usable for authoring idle/voice lines |
| **wLipSync** (uLipSync MFCC port, AudioWorklet + WASM) | `wlipsync@1.3.1` (2026-08), MIT | Decent vowel shapes (A/I/U/E/O) | Real-time, ~10 ms | Language-agnostic (vowel formants) | **Chosen (real-time fallback / mic / streaming audio)**; needs a profile calibrated in Unity uLipSync (sample profiles ship with uLipSync) |
| Volume RMS → MouthOpenY | built in (`model.speak`) | Flapping only | Real-time | n/a | Last resort |
| `facebook/mms-1b-all` | CC-BY-NC-4.0 | — | — | — | Rejected (non-commercial) |

**Notes:**
- eSpeak-NG is **GPL-3.0**. Run it as a separate process or phonemize server-side rather than linking it into the app, or use a permissively licensed G2P such as a Hindi rule-based G2P we write ourselves.
- The CTC vocab doesn't cover every Hindi phone (retroflex/aspirated stops). Map missing phones to the nearest one; only vowels and lip closure matter for visemes.

**Viseme mapping:** VRM uses `aa/ih/ou/ee/oh`. Live2D uses two parameters, `ParamMouthOpenY` (0..1) and `ParamMouthForm` (-1 = pursed, 1 = wide):

```ts
const VISEME = { // [open, form]
  aa: [1.0, 0.0], ih: [0.35, 0.8], ou: [0.4, -0.9], ee: [0.6, 0.6], oh: [0.75, -0.5],
  closed /* p b m */: [0, 0], fv: [0.15, 0.3], rest: [0.05, 0],
} as const
// Per frame: find the active phone at audio.currentTime, crossfade 40–60 ms, spring-damp,
// add ~5% jitter; mouth.open/form → Live2D params (§1) or expressionManager weights (§3).
```

## Recommendation table

| Option | Version | License | Apple silicon / WKWebView | Notes | Decision |
|---|---|---|---|---|---|
| untitled-pixi-live2d-engine | 1.4.0 | MIT | WebGL ✔ | Cubism 2–5, parallel motions, Pixi 8 pipe, `speak()` | **Chosen** |
| pixi.js | 8.23.0 | MIT | WebGL2 ✔ (WebGPU optional) | `backgroundAlpha: 0` | **Chosen** |
| easy-live2d | 1.1.0 | MIT | WebGL2 only | Official Framework R5; Cubism 5 only | Backup |
| pixi-live2d-display / -lipsyncpatch | 0.4.0 / 0.5.0-ls-8 | MIT | ✔ | Pixi 6 / Pixi 7 only | Rejected |
| @naari3 / @jannchie forks | 1.2.5 / 1.4.0 | MIT | ✔ | Low adoption; no parallel motions | Rejected |
| live2d-motionsync | 0.0.4 | MIT + Live2D terms | ✔ | Cubism 4 + motionsync3 models + Pixi 6 | Rejected |
| Cubism Core for Web | SDK 5-r.5 | Live2D PSLA | ✔ | Bundle in app, not in repo; <¥10M exempt | **Required** |
| @pixiv/three-vrm (+animation) | 3.5.5 | MIT | WebGL2 ✔; WebGPU via MToonNodeMaterial (exp.) | Expressions, look-at, spring bones, VRMA | **Chosen (3D mode)** |
| three | 0.187.0 | MIT | ✔ | Pin; postprocessing needs <0.188 | **Chosen** |
| postprocessing / n8ao | 6.39.6 / 2.1.0 | Zlib / ISC | WebGL ✔, alpha kept | Subtle bloom only (halo on alpha) | **Chosen** |
| Gaussian avatars (Spark, LAM) | 2.4.0 / alpha | MIT / Apache | ✔ | Photoreal heads only, no anime toolchain | Rejected (v1) |
| wav2vec2-xlsr-53-espeak-cv-ft | HF (2021) | Apache-2.0 | ONNX/CoreML in sidecar | Multilingual phoneme alignment | **Chosen** |
| wlipsync | 1.3.1 | MIT | AudioWorklet ✔ (tauri:// is a secure context) | Real-time MFCC vowels | **Chosen (fallback)** |
| Rhubarb Lip Sync | 1.14.0 | MIT | macOS binary | Batch, English-centric | Rejected (runtime) |
| Hiyori, Haru | CubismWebSamples develop | Free Material License | — | Credit; <¥10M publisher | **Chosen** |
| VRM1_Constraint_Twist_Sample, Seed-san | vrm-specification samples | VRM Public License 1.0 | — | Redistribution allowed | **Chosen** |
| Natori, Tsumiki | — | Collaboration (no commercial/distribution) | — | — | Rejected |
| VRoid VRMA 7-pack | BOOTH 5512385 | pixiv terms (credit; no extractable redistribution) | — | First-run download or ask pixiv | Conditional |

## Sources

- https://www.npmjs.com/package/untitled-pixi-live2d-engine · https://github.com/Untitled-Story/untitled-pixi-live2d-engine
- https://www.npmjs.com/package/easy-live2d · https://github.com/Panzer-Jack/easy-live2d
- https://github.com/guansss/pixi-live2d-display · https://www.npmjs.com/package/pixi-live2d-display-lipsyncpatch · https://www.npmjs.com/package/@naari3/pixi-live2d-display · https://www.npmjs.com/package/@jannchie/pixi-live2d-display
- https://www.npmjs.com/package/live2d-motionsync · https://github.com/liyao1520/live2d-motionSync
- https://www.live2d.com/en/sdk/license/ · https://www.live2d.com/eula/live2d-proprietary-software-license-agreement_en.html
- https://www.live2d.com/eula/live2d-free-material-license-agreement_en.html · https://www.live2d.com/eula/live2d-sample-model-terms_en.html
- https://www.live2d.com/en/learn/sample/ · https://www.live2d.com/en/learn/sample/momose-hiyori/ · https://www.live2d.com/en/sdk/download/web/
- https://github.com/Live2D/CubismWebSamples (LICENSE.md, CHANGELOG.md 5-r.5) · https://docs.live2d.com/en/cubism-sdk-manual/cubism-sdk-for-unity
- https://www.npmjs.com/package/@pixiv/three-vrm · https://github.com/pixiv/three-vrm/tree/dev/packages/three-vrm-materials-mtoon
- https://www.npmjs.com/package/postprocessing · https://www.npmjs.com/package/n8ao · https://discourse.threejs.org/t/unrealbloompass-makes-background-black/38994
- https://github.com/vrm-c/vrm-specification/tree/master/samples · https://vrm.dev/licenses/1.0/
- https://booth.pm/ja/items/5512385 (VRoid VRMA 7-pack) · https://vroid.com/en/studio/guidelines
- https://helpx.adobe.com/creative-cloud/faq/mixamo-faq.html · https://community.adobe.com/t5/mixamo-discussions/mixamo-faq-licensing-royalties-ownership-eula-and-tos/td-p/13234775
- https://www.npmjs.com/package/@sparkjsdev/spark · https://github.com/aigc3d/LAM
- https://huggingface.co/facebook/wav2vec2-xlsr-53-espeak-cv-ft · https://huggingface.co/facebook/wav2vec2-lv-60-espeak-cv-ft · https://huggingface.co/facebook/mms-1b-all
- https://github.com/DanielSWolf/rhubarb-lip-sync (LICENSE.md, v1.14.0) · https://github.com/mrxz/wLipSync · https://github.com/hecomi/uLipSync
