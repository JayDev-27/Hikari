# Iki pipeline (dev)

Tools that built `characters/makima/model/Makima.iki` from her reference picture. The why and the full
procedure are in [`docs/IKI.md`](../../../../docs/IKI.md).

Needs an Iki checkout built once (`pnpm install && pnpm -r --filter './packages/*' build`) and
`IKI_REPO=/path/to/iki` (default `../iki` from the working directory). Run from the character folder
(`characters/<id>`); iki's MCP tools only write inside their working directory.

| Script | What it does |
|---|---|
| `call.mjs <cwd> <tool> <args.json\|json>` | Calls one tool on iki's MCP server over stdio (`--list` lists them) |
| `refs.mjs` / `crop.mjs` | Reference crops and plain crops |
| `overlay.mjs` | Reference \| model \| 50 % blend at a matched scale (chin aligned) |
| `split-arms.mjs <cut-body> <arms.json> <out>` | Splits painted arms off the cut body into `arm_L/R`, fills the torso under the sleeves |
| `despill-layer.mjs`, `despill.mjs` | Remove chroma-key green spill from lip layers / the keyed mouth |
| `strip-pale.mjs` | Remove shirt/backdrop-coloured slivers from hair layers |
| `despeckle.mjs <png> [minPx]` | Drop isolated fragments |
| `add-legs.mjs <model.iki> <hipY> <footY>` | Adds `ParamLegShift` (hip shift, relaxed knee, planted feet) to the body mesh |
| `defringe.mjs <picture> <layer>…` | Unmix each edge pixel against what the picture shows just outside it (backdrop, braid, shirt): removes the light halo ("white border") and coloured rims |
| `strip-neutral.mjs <hair.png> <minY> <body.png>` | Moves dark collar strokes that touch the body (within 2 px) from hair layers into the body; drops other shirt-coloured strokes |
| `restore-visible.mjs <final> <picture> <box>` | Body = picture wherever the picture shows body beside the locks; backdrop and hair (braid behind the body) made transparent, outline edges unmixed |
| `repaint-under-hair.mjs <final> <box> [dilate] ["x1,y1,x2,y2;!…"]` | Repaints the body under the hair drawn in front of it (harmonic fill, clean silhouette, pinholes and islands removed) and inks the hidden collar/shoulder outlines given as segments (`!` = silhouette edge, air above) |
| `trim-shoulders.mjs <body> "x1,y1,x2,y2;…"` | Clips the torso corner above each shoulder outline (it shows as a pale "ear" when an arm lifts) and inks the outline |
| `clear-box.mjs <layer> <box>`, `strip-backdrop.mjs <layer>…` | Clear fill that sticks out past a hidden outline; drop light bluish backdrop kept between hair strands |
| `despeck-dark.mjs <layer> <box> [maxPx=12]` | Recolours small dark specks (≤ maxPx, ringed by light cloth) with the surrounding cloth; long outlines are untouched |
| `extend-arms.mjs <model.iki> [max=150] [elbowMin=-170]` | Extends shoulder rotation to `max` and lets the elbow open to `elbowMin` (same slope), for a raised-hand wave |
| `fill-holes.mjs`, `fill-under-hair.mjs` | Close holes in the body under hair; grow collar/neck under the locks so head motion reveals cloth, not gaps |
| `assemble-makima.sh` | The whole Makima build: split arms, clean, defringe, rig lossless, add the leg warp, extend the arm ranges |
| `hair-iou.mjs`, `hair-tol.mjs` | Hair-mask IoU, 2 px tolerance metric, largest mismatch blob, diff map |

`makima.landmarks.json` and `makima.arms.json` are the final landmarks (1.62× picture, chin at 550, 517)
and arm outlines.

`assemble-reze.sh` rebuilds Reze from her local PSD with the Reze landmarks and arm outlines.
It uses Python with `psd-tools` and Pillow to flatten the visible layers and extract the source
mouth interior. It cuts the white flower and reaching hand from `source/Flower-offer.png`.
Use `--reuse-cut` after reviewing an existing cut in `iki-char/cut/`.
See [Reze's build and verification](../../../../docs/IKI.md#reze).
