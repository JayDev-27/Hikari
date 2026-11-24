# Iki characters in Hikari: what went wrong, what works, how to ask for it

Hikari can render characters made with [Iki](https://github.com/zeikar/iki) (an open, MIT-licensed
alternative to Live2D whose auto-rigger turns role-separated layers into a rigged `.iki` model).
Makima is the first one (`characters/makima/model/Makima.iki`, `renderer: "iki"`). This page records
what failed on the way to a model that matches her reference, the pipeline that finally did, and how a
user or an AI agent should drive it.

## The short version

- **Cut, don't generate.** When a finished picture of the character exists, cut every part out of
  that picture (`cut_layers_from_illustration`). Image-model parts never match a reference: every
  generated version of Makima's hair was "close" and wrong.
- **Measure, don't eyeball.** Compare against the reference at the same scale (overlay, pixel diff)
  and at full size. Thumbnails hid a missing neck, small hands and a broken braid.
- **Check motion, not just the rest pose.** Render turns, tilts and the extreme combined pose; hidden
  parts of a single picture show up only when something moves.

## What went wrong (in order) and why

| Symptom the user saw | Real cause | Fix |
|---|---|---|
| "Looks like a ghost" | Generated eyes too small and thin-lashed; head proportions guessed | Redrew eyes; later replaced by the cut face |
| Arms attached to the neck | Iki's arm check assumes the shoulder row is 12 % down the body box; with a long neck that row is the collar, and its advice ("move the arm 197 px toward the body") was followed literally | Measured the real shoulder joints; reported upstream (see PR below) |
| Hair "fucked up", left side too big | Generated back hair was lopsided; side locks doubled a side curtain | Stopped generating hair; cut her real hair from the reference |
| Head too big / then too small | Face width misread (hair edge taken for the ears), then over-corrected | Measured the face from skin pixels; finally the whole figure is cut at one scale |
| Green fringe on the lips | The chroma-key leaves anti-aliased green under the key threshold | Despill the lip layers (clamp g to max(r, b)); reported upstream |
| No neck, small hands, short legs | Generated body and arm parts at their own proportions | Body, legs and arms cut from the reference too; arms split into movable layers |
| White border around trousers, shoes, hair | Edge pixels of the picture are part backdrop (light grey-blue); on a dark desktop that reads as a white rim | `defringe.mjs` unmixes each edge pixel against what the picture shows just outside it (backdrop, braid or shirt) |
| Left arm always up, right always bent | Renderer bug: gesture/lean offsets were added to the previous frame's value; iki's idle never resets the arm parameters, so they crept to their limits | `gestures.ts` restores each parameter's base before `IkiMotion.update` and adds offsets after (unit-tested over 600 frames) |
| Gestures felt robotic | Linear in/out, identical every time, dead-straight idle arms | Critically damped springs, smootherstep envelopes, ±10 % variation, relaxed elbows with slow sway, arms reacting to the weight shift, talking emphasis |
| Legs never move | Iki plants the legs by design (no leg rig) | Added `ParamLegShift`: a per-vertex warp on the body mesh (hips shift, relaxed knee bends, feet planted), animated by Hikari |
| Wave was a sideways swing, not a raised hand | Iki's auto-rig stops the shoulder at 32 and lets the elbow fold only toward the body | `extend-arms.mjs` keeps the same slope but lets the shoulder go to 150 and the elbow open to −170. `wave-raised` is her reference pose (shoulder 22, elbow about −158 with a forearm sway: elbow low beside the waist, forearm upright, hand at chin height; the forearm folds first). It replaces `wave` on models with those ranges (`resolveGesture`). With the shoulder barely lifted, no shoulder kink shows |
| Pale "ear" above the shoulder and dark ticks on the shirt when an arm lifts | split-arms leaves a torso corner above each sleeve root; tiny hair-tip and outline fragments sit on the cloth beside the parts that cover them at rest | `trim-shoulders.mjs` clips the torso above each shoulder outline (measured on the picture) and inks it; `despeck-dark.mjs` recolours dark bits of 12 px or less ringed by light cloth on the body and sleeves |
| Same gesture restarted by a burst of identical cues | `playMotion` restarted on every call | A gesture already playing is not restarted until 85 % of it has run. Verified in the app: three `wave` cues 0.4 s apart gave one start and two skips |
| Flecks and a light strip at the neck during 15–20° head tilts | The body under the side locks held smears, stray hair outlines, pinholes and a broken shoulder outline; tilts uncover it | `restore-visible.mjs` makes the visible body beside the locks equal to the picture (braid and backdrop transparent). `repaint-under-hair.mjs` repaints only what the front hair hides: harmonic fill, silhouette clipped to the cut, pinholes and islands removed, and hidden collar/shoulder lines measured on the picture and inked. Only layers drawn in front of the body count as hiding it; `hair_back` is behind it |

Upstream: the lip-set green spill and the long-neck shoulder row are fixed in
[zeikar/iki#71](https://github.com/zeikar/iki/pull/71) (open), with agent pitfalls added to the plugin's skills.
Until it is merged, keep running `despill-layer.mjs` on the lip layers and place long-necked arms by measurement.

## The pipeline that works (Makima)

Scripts live in `apps/desktop/dev/iki-pipeline/` (set `IKI_REPO` to an Iki checkout with
`pnpm install && pnpm -r --filter './packages/*' build` done). Workdirs (`characters/<id>/iki-char/`)
are git-ignored.

1. **One aligned picture.** Scale the reference so the *whole* figure, hands included, fits the
   1100 px canvas (Makima: 1.62×, chin at x 550, y 517) and paint it on a 1100×4096 backdrop.
2. **Landmarks from zoomed grids** (`view_illustration_grid`, zoom 2–6): parting, bangs edge, each side
   lock traced to its real tip, skull, `shellLower`, eye boxes, irises, nose, mouth corners.
   Mark every hair-coloured garment with `bodyOnly`: the black tie and trousers, the collar and the
   shirt's outline where it touches hair. Body seeds on arms, hands and both legs.
   (`makima.landmarks.json` is the final set.)
3. **Cut** with `mouthKeyed` / `mouthInterior` (a talking mouth placed on her drawn lips). Read every
   `CHECK` line and `preview-labels.png`; three rounds at most.
4. **Split the arms** off the cut body (`split-arms.mjs`, outlines in `makima.arms.json`): everything
   outside the arm–torso gap is arm; the torso under each sleeve is filled from the nearest light
   shirt pixel so a raised arm shows cloth, not a hole.
5. **Clean**: despill the lip layers, strip shirt/backdrop slivers out of hair layers, drop specks
   under 80 px (`despill-layer.mjs`, `strip-pale.mjs`, `despeckle.mjs`).
6. **Rig losslessly** (`auto_rig_from_layers` without `quantizeColors`: palette compression flips
   edge pixels and costs ~1 % hair accuracy) and add the leg warp (`add-legs.mjs`).
7. **Verify** (next section), then copy to `characters/<id>/model/<Name>.iki`.

Her signature moves (`characters/makima/character.json` `signatureMotions`, played when idle): **signature-clasp**
(hands folded low in front, head inclined, calm smile, eyes half-lowered: her composed stance),
**signature-smile** (head tilted, eyes closing into the smile) and **signature-bang** (arm out and down to about 30°, a small recoil,
smile; the hand stays open because the picture has no finger-gun drawing). A level arm runs past the narrow
stage window, so the bang stays diagonal.

Hikari side: `src/avatar/iki/IkiAvatar.ts` frames the drawn figure (measured once at rest), drives
mouth, gaze, expressions and the model's clips, adds the idle weight shift, and plays procedural
arm gestures (wave, point, shrug, clap, cross arms, think, facepalm, bow) on
`ParamArmL/R` and `ParamElbowL/R` when the model has no clip for them. Iki's elbow bends only toward the
body. After `extend-arms.mjs` it also opens the other way (to −170), so the forearm stands up from a low elbow
beside the waist, as in her wave reference (`wave-raised`). Without the extension the wave falls back to an outward swing.

In-app check: hot module reload swaps `Stage.tsx` but keeps the running avatar object on its old code.
Restart `pnpm dev` before judging a gesture change in the window.

## Reze

The reference is the visible composite of `characters/reze/source/Reze.psd`. The 448×1528 art
is resized to 923×3148 and placed at (4, 48) on the transparent 1100×4096 canvas. The source chin
at about (265, 220) lands at (550, 501). The PSD stores opaque paint just under full opacity.
`align-reze.mjs` sets source alpha values of 250–254 to 255 so the cutter can fill behind the
paint, while retaining the softer edge pixels.

With `IKI_REPO` set to a built Iki checkout, run these commands from the Hikari root.

```sh
uv run --no-project --with psd-tools bash apps/desktop/dev/iki-pipeline/assemble-reze.sh
cp characters/reze/iki-char/Reze.iki characters/reze/model/Reze.iki
node apps/desktop/scripts/sync-packs.mjs
```

- The cut uses `reze.landmarks.json`. The hidden `Speaking mouth` layer provides the painted
  interior, and the closed smile comes from the visible composite. The local
  `source/Flower-offer.png` is the attached pose reference. The build cuts the reaching arm,
  hand, and white flower from it as one layer.
- `reze.arms.json` follows the source contours at the armholes, sides of the shirt, and left
  hand where it touches the shorts. The cleanup restores the visible collar from the transparent
  cut and interpolates under hair drawn in front of the body. The atlas trim removes excess
  hidden cheek and hair fill after rigging, keeping the cheek and ear mesh intact. The fringe
  and locks follow the face where their edges touch, and the shoulder joints follow the shirt
  near the armholes. The ties fade away toward the free ends.
- The right elbow reaches +170° as well as −170° for the shy wave. Click Reze's body to play
  the flower offer. She lifts her hand, brings the grip into view and extends the white flower
  toward the viewer as her smile deepens. During the lean, the leg shift reduces the idle
  weight shift and the forearms pass behind the shorts.
- At rest, run `hair-tol.mjs <rest-head-1x.png> <picture.png> 280 20 480 600 reze <diff.png>`.
  On the 1100×4096 render the measured box has 97,725 reference hair pixels and 42 beyond
  2 px (0.043%, limit 0.5%). The full-size blend, face, hands and feet comparisons, dark
  motion renders and native stage captures are in the local `characters/reze/iki-char/qa/`.
- In a fresh `VITE_CHARACTER=reze pnpm dev` session, send `avatar.gesture` cues from the local
  WebSocket core on port 8765 and capture the stage window with `screencapture`. The flower
  offer ran once with three repeated cues during playback. The desktop test suite, typecheck
  and lint passed.

## Rize

Rize uses her full-body `characters/rize/source/Rize.psd`. The visible composite is scaled 2×
and placed at (−8, 46) on an 1100×4096 canvas. The source chin at about (279, 249) lands at
(550, 544). The original Live2D pack settings are in `characters/rize/source/character.live2d.json`.

With `IKI_REPO` set to a built Iki checkout, run these commands from the Hikari root.

```sh
uv run --no-project --with psd-tools bash apps/desktop/dev/iki-pipeline/assemble-rize.sh
cp characters/rize/iki-char/Rize.iki characters/rize/model/Rize.iki
node apps/desktop/scripts/sync-packs.mjs
```

- `rize.landmarks.json` records both lenses and the bridge, all five long lock tips, and
  the boundaries between the curls and the apron. `rize.arms.json` splits the sleeves from
  the bodice. The source's painted speaking mouth supplies the keyed mouth and interior.
- `refine-rize-layers.py` moves the original thin loops onto their respective locks, fills
  the cloth under the curls, and keeps the source linework at the sleeve cuts. The lower
  curls lag the head turn so they stay close to her shoulders.
- The spectacle frame follows both eye warps through head turns and the same head rotation
  through tilts. The glasses gesture rotates Rize's original arm to the bridge and raises
  the frame by 7 canvas pixels on contact. The book gesture brings her empty hands together.
- Click Rize's body for the ghoul reveal. She blinks into dark sclera and red irises, then
  blinks back. Both states use the PSD eye paint, with render-time tint and the same eye masks.
- The shoulder patches use the sleeve palette and were drawn from 18° lifts. The runtime
  uses `armLiftMax: 18`. The exact rest render before and after adding both patches had
  zero differing pixels. The exact hair comparison measured 55 of 244,482 pixels beyond
  2 px (0.022%, limit 0.5%). On the dark backdrop, the marked light-edge counts before and
  after cleanup were 34 → 33 at the belt, 5 → 5 at the cuff, and 4 → 2 at the shoe trim.
- The local `characters/rize/iki-char/qa/` folder contains the source overlays, dark-backdrop
  crops and native stage strips. Restart `VITE_CHARACTER=rize pnpm dev` and use the scripted
  WebSocket core at `ws://127.0.0.1:8765/ws` to capture signatures and generic gestures.
  The final scripted windows had zero `takes clicks` transitions and stayed inside the
  stage. Three extra ghoul cues and a competing head tilt produced one reveal.

## Cheng Xiaoshi

The visible `characters/cheng-xiaoshi/source/Cheng Xiaoshi.psd` composite is scaled by
about 1.90× to 1094×2918 and placed at (4, 46) on the transparent 1100×4096 canvas.
The source chin lands at about (550, 461). The previous pack is in
`characters/cheng-xiaoshi/source/character.live2d.json`.

With `IKI_REPO` set to a built Iki checkout, run these commands from the Hikari root.

```sh
uv run --no-project --with psd-tools bash apps/desktop/dev/iki-pipeline/assemble-cheng.sh
cp characters/cheng-xiaoshi/iki-char/Cheng.iki characters/cheng-xiaoshi/model/Cheng.iki
node apps/desktop/scripts/sync-packs.mjs
```

- `cheng.landmarks.json` records the spike tips, the bangs over the eyelids and the painted
  neck boundary. Its `bodyOnly` polygons keep the jacket panels, lining, and trousers with the
  body. The PSD supplies the keyed mouth and the interior.
- `refine-cheng-layers.py` returns stationary strands and lid creases to the face or hair,
  reattaches the original chin ink to the face, carries the neck shade behind the jaw, and
  restores the source paint at both sleeve cuts. Sleeve roots follow the jacket seam. The
  patches use the jacket fold palette and cover lifts to 18°. The shoulder seam opens by 23°
  in the render, so the pack caps it at 18°.
- Click Cheng's body for the photo dive. `pose-cheng.mjs` places the painted palms at chest
  height using the actual arm pivots. A brief sleeve foreshortening keeps the hands apart
  as they approach. The other signatures are an open grin with a sheepish head bob and a
  close raised-hand wink. The 1.48× idle tempo and 0.78 spring damping give Cheng quicker
  weight shifts and a small overshoot. The raised wave spends 0.083 s on the way up and
  0.100 s on the way down in the forearm's horizontal range at 60 fps.
- The 1:1 hair comparison found 11 of 61,881 pixels beyond 2 px (0.018%, limit 0.5%).
  Adding both armpit patches changed zero pixels at rest. The light-edge counts on the
  dark backdrop went from 18 to 4 on the sleeve, 46 to 41 on the jacket lining, and 5 to 5
  on the trouser hem.
- Local overlays, 3× pose crops, 4× edge crops, and native stage strips are in
  `characters/cheng-xiaoshi/iki-char/qa/`, indexed in `verification.md`. Restart
  `VITE_CHARACTER=cheng-xiaoshi pnpm dev` and drive the gesture captures from the local
  WebSocket at `ws://127.0.0.1:8765/ws`. All 17 gestures stayed inside the 840×1280
  capture window with zero click-taking transitions in the scripted gesture and idle
  windows. Three repeat cues and a competing head tilt produced one clap. The idle clap
  reached the chest 18.92 s after connecting, and a separate body click played one clap.

## Verification that caught real defects

- **Overlay at matched scale** (`overlay.mjs`): reference | model | 50 % blend, chin and face centre
  aligned. It showed the oversized head, the low arms and the off-reference hair at a glance.
- **Hair pixel metric** (`hair-iou.mjs`, `hair-tol.mjs`): hair-coloured masks of a 1:1 render vs the
  reference, IoU plus "mismatches with no counterpart within 2 px" and the largest mismatched blob,
  with a red/blue diff map. Final Makima hair: 0.13–0.16 % of hair pixels beyond 2 px, largest blob
  15 px. (The eye/mouth exclusion boxes in `hair-tol.mjs` are canvas coordinates for that build;
  update them for another character.)
- **Motion poses with crops** (`render_poses` with `poses` + `crop`): ±30° turns, ±15–20° tilts,
  combined turn+nod+tilt, hair sway, every arm gesture's peak. Zoom 3–4× on the shoulders, lock
  tips and braid.
- **Bisect a stray fragment** with `render_poses`' `hideParts`: hide one part at a time until it goes.

## For AI agents driving Iki

- Before generating anything, ask whether a finished picture exists; if so, cut it.
- Never judge from a downscaled sheet; view crops at 1:1 or larger.
- Treat geometry-check advice as a hint: verify the row or pixel it names before moving a part
  (the shoulder-row check was wrong for long necks).
- Every `bodyOnly`/`shellLower` edit trades rest accuracy against motion: re-run both the pixel metric
  and the motion poses after each one. Hidden-at-rest regions (under a shoulder, behind a lock tip)
  are made-up fill; taper or remove them rather than leaving hard edges.
- A long braid passing behind a shoulder is hidden there in the picture: keep it whole in the back
  hair behind a body whose outline matches the picture there.
- Keep palette quantization off for the shipped model unless size matters more than edges.
- Record the transform (scale, anchor) and the landmarks: a later re-cut at another scale reuses them.

## How to ask for it (prompts that work)

Give the reference and a measurable bar, and keep the agent from stopping early:

```text
/goal Makima's hair matches the reference picture: at rest, under 0.5 % of hair pixels differ
by more than 2 px, and turns ±30°, tilts ±20° and the combined pose show no seams, holes or stray
fragments in 3× crops.
```

```text
Use characters/makima/source/Makima.psd as the reference. Cut every part from it with iki's
illustration cutter; generate only what the picture cannot show. Show me reference | model | overlay
at the same scale, at full size, after every change, and the motion poses zoomed on shoulders and hair.
```

Useful habits: one region at a time ("now only the hair", "now only the arms"); name the defect and
where ("the braid end pokes above her right shoulder at a 15° tilt"); ask for numbers, not adjectives;
say what is already right so it is not touched ("the head is perfect, don't change it").
