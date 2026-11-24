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
