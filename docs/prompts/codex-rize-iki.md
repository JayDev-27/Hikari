# Codex prompt: Rize Kamishiro as an Iki model

Paste the block below into Codex, started at the repo root. It carries what worked for Makima and
Reze (`docs/IKI.md`, `DECISIONS.md`) and the defects that cost the most time, so Codex doesn't repeat
them.

```text
Goal: Rize Kamishiro becomes an Iki model (renderer "iki") that matches her own art and moves like a
person, not a robot, the way Makima and Reze do now. Read docs/IKI.md, apps/desktop/dev/iki-pipeline/
README.md, CLAUDE.md and the Makima and Reze entries in DECISIONS.md first, then follow them. You are
Person A: work only in apps/desktop/ and characters/.

Reference
- Ground truth is her own art: characters/rize/source/Rize.psd. Flatten it to one full-body picture.
  If it is not a front-facing full body with both hands and both feet visible, stop and ask me for a
  full-body reference. Don't generate one.
- Cut, don't generate. Every part is cut from that picture with cut_layers_from_illustration. The only
  invented pixels are fills under parts that hide others, matching the surrounding paint.
- Her glasses: they sit over the eyes and must stay over them while she blinks and turns her head.
  Keep them as their own layer above the eyes, deformed with the head (add the part in a
  pose-rize.mjs the way pose-reze.mjs adds Reze's parts). Check them at every head turn and tilt: no
  lens edge may slide off the eyes or cut through a lash.
- Long hair: mark every lock to its real tip in the landmarks; check each tip at full turns.

Pipeline (copy assemble-reze.sh to assemble-rize.sh and adapt it; keep the Makima and Reze files)
1. One aligned picture: the whole figure, hands and feet included, fitted to 1100 px wide on a
   1100x4096 canvas, chin at x 550. Record the scale and anchor.
2. Landmarks from zoomed grids (view_illustration_grid, zoom 2-6) into rize.landmarks.json: parting,
   bangs edge, each lock to its tip, skull, shellLower, eye boxes, irises, nose, mouth corners, the
   glasses' frame. Mark dark clothing and any outline touching the hair with bodyOnly before the first
   cut. Body seeds on arms, hands and legs.
3. Cut with mouthKeyed/mouthInterior. Read every CHECK line and preview-labels.png (three rounds at most).
4. split-arms.mjs with rize.arms.json, then strip-neutral / fill-holes / despill-layer / defringe
   (against the picture) / strip-pale / despeckle, as in assemble-makima.sh.
5. restore-visible.mjs, then repaint-under-hair.mjs around the neck and shoulders (only hair_side_L/R
   and hair_front are drawn in front of the body; hair_back is behind it).
6. Rig losslessly (auto_rig_from_layers without quantizeColors), add-legs.mjs, extend-arms.mjs 150.
7. armpit-patch.mjs for each arm if the picture has no torso under the arm (render rest and the largest
   lift with render_poses; the patch collapses to nothing at rest, so the rest pose must stay
   pixel-identical: prove it with a diff of 0). If even the patched armpit opens past some lift, set
   armLiftMax in character.json to the largest clean angle.
8. despeck-edges.mjs last: it takes the source backdrop out of dark paint's edges (the "white border"
   on dark clothes and hair). Any part painted from a second picture gets tone-part.mjs with the
   measured median-skin ratio.
9. Ship to characters/rize/model/Rize.iki. Set character.json renderer "iki", modelPath "model/Rize.iki";
   keep the Live2D config as characters/rize/source/character.live2d.json. Run
   node apps/desktop/scripts/sync-packs.mjs.

Motion and personality (apps/desktop/src/avatar/iki/gestures.ts; reuse the springs, envelopes and idle life)
- Rize is languid and elegant: slow ease-in/ease-out, small amplitudes, a knowing smile, weight on one
  leg (ParamLegShift), head tilted. Nothing snaps.
- Her character.json already names "signature-glasses" and "signature-book"; implement both as GESTURES
  entries with those names (so signatureMotions keeps working), plus one more of hers:
  "signature-glasses": one hand rises close to the face and pushes the glasses up at the bridge, a slow
    smile after;
  "signature-book": hands together low in front as if holding a closed book, head inclined, eyes half
    lowered (paint a book only if the reference shows one; otherwise the hands alone);
  one more you can justify from her art (for example a fingertip to the lips with a slow head tilt).
  Each starts and ends at rest, stays inside the rig's ranges, and has a test in gestures.test.ts.
- Arms: keep every pose inside the stage window. The generic wave becomes wave-raised when the rig
  allows (elbow folds first, then the shoulder; down: shoulder first, then the elbow). The forearm may
  pass horizontal for at most ~0.12 s each way (there is a test that measures this).
- Expressions only for what the picture can show.

Verification (do every item; show me the images, not adjectives)
- reference | model | 50 % overlay at the same scale, full size, for hair, face, glasses, hands, feet.
  Hair: under 0.5 % of hair pixels off by more than 2 px (hair-iou.mjs / hair-tol.mjs).
- render_poses: turns ±30°, tilts ±20°, the combined extreme pose, every gesture at its peak; 3-4x crops
  of the neck, shoulders, armpits, lock tips and the glasses at each. Dark backdrop too.
- Edges: count light pixels on dark outlines over the app backdrop (43,43,51) before and after
  despeck-edges, and show 4x crops of the dark clothes' edges at three heights.
- In the app: restart pnpm dev (hot reload keeps the old avatar code); drive every gesture with a small
  scripted WebSocket core on ws://127.0.0.1:8765/ws (space signatures past their length: a signature
  blocks other cues until 90 % done; the idle signature fires ~18 s after connecting); capture with
  screencapture -l and show one frame strip per gesture. Count "takes clicks" lines in the dev log for
  the capture window: a click on her plays a gesture, so a run with hovers is not a clean run.
  Check: both hands rest at her sides when idle; repeated cues do not restart a gesture; nothing
  leaves the window.
- pnpm -F desktop test, typecheck and lint pass. Record decisions in DECISIONS.md, steps in docs/IKI.md.
- Don't commit or push unless I say so. Ask before putting model files or franchise art anywhere public.

Stop only when every check passes. If one can't because of the source art, say exactly which, show the
crop, and say what art would fix it.
```

Tips when steering it: one region at a time ("now only the glasses"), name the defect and where ("the
left lens slides off the eye at a 25° turn"), and say what is already right so it stays untouched.
