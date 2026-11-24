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
| `hair-iou.mjs`, `hair-tol.mjs` | Hair-mask IoU, 2 px tolerance metric, largest mismatch blob, diff map |

`makima.landmarks.json` and `makima.arms.json` are the final landmarks (1.62× picture, chin at 550, 517)
and arm outlines.
