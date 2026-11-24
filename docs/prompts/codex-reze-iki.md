# Codex prompt: Reze as an Iki model

Paste the block below into Codex, started at the repo root. It encodes what worked for Makima
(`docs/IKI.md`) and the mistakes that cost the most time, so Codex doesn't repeat them.

```text
Goal: Reze becomes an Iki model (renderer "iki") that matches her reference picture and moves naturally, the
way Makima does now. Read docs/IKI.md, apps/desktop/dev/iki-pipeline/README.md, CLAUDE.md and DECISIONS.md
(Makima entries) first, then follow them. You are Person A: work only in apps/desktop/ and characters/.

Reference
- The ground truth is Reze's own art: characters/reze/source/Reze.psd (flatten it to one full-body picture).
  If it is not a full front-facing body with both hands and both feet visible, stop and ask me for a
  full-body reference. Don't generate one.
- Cut, don't generate. Every part (hair, face, eyes, irises, lashes, mouth, neck, torso, arms, legs) is cut from
  that picture with iki's cut_layers_from_illustration. Generate nothing an image model would draw. The only
  invented pixels are fills under parts that hide others, and they must match the surrounding paint.

Pipeline (copy assemble-makima.sh to assemble-reze.sh and adapt it; keep the Makima files unchanged)
1. One aligned picture: scale the whole figure, hands and feet included, to fit 1100 px wide on a 1100×4096
   canvas, with her chin at x 550. Record the scale and anchor.
2. Landmarks from zoomed grids (view_illustration_grid, zoom 2–6) into reze.landmarks.json: parting, bangs edge,
   each lock to its real tip, skull, shellLower, eye boxes, irises, nose, mouth corners. Mark hair-coloured
   clothing (choker, dark top, ribbon) with bodyOnly. Body seeds on arms, hands and legs.
3. Cut with mouthKeyed/mouthInterior. Read every CHECK line and preview-labels.png (three rounds at most).
4. split-arms.mjs with reze.arms.json, then strip-neutral / fill-holes / despill-layer / defringe (against the
   picture) / strip-pale / despeckle, as in assemble-makima.sh.
5. restore-visible.mjs, then repaint-under-hair.mjs around the neck and shoulders. Only layers drawn in front
   of the body (hair_side_L/R, hair_front) hide it; hair_back is drawn behind it. Measure hidden collar and
   shoulder outlines on the picture and pass them as segments.
6. Rig losslessly (auto_rig_from_layers without quantizeColors), add-legs.mjs, extend-arms.mjs 150.
7. Ship to characters/reze/model/Reze.iki. Set character.json to renderer "iki" and modelPath "model/Reze.iki".
   Keep the Live2D config as characters/reze/source/character.live2d.json. Run
   node apps/desktop/scripts/sync-packs.mjs.

Motion and personality (apps/desktop/src/avatar/iki/gestures.ts; reuse the springs, envelopes and idle life)
- Add Reze signature moves to GESTURES and signatureMotions, each tested in gestures.test.ts (start and end at
  rest, inside the rig's ranges):
  "signature-flower" (offers a flower: right forearm raised in front of the chest, head tilted, soft smile),
  "signature-wave-shy" (small raised-hand wave close to the body, eyes half closed),
  "signature-lean" (weight on one leg via ParamLegShift, hands behind the back, playful head tilt).
- Keep every arm pose inside the stage window: a level arm runs past it, so stay below about 30° out to the
  side unless the hand is raised close to the body.
- Expressions only for what the picture can show (no brows visible means no angry or sad).

Verification (do every item; show me the images, not adjectives)
- reference | model | 50 % overlay at the same scale and full size, for hair, face, hands and feet. Hair: under
  0.5 % of hair pixels off by more than 2 px (hair-iou.mjs / hair-tol.mjs).
- render_poses: turns ±30°, tilts ±20°, the combined extreme pose, every gesture at its peak. 3–4× crops of the
  neck, shoulders, lock tips and armpits. No holes, seams, white blocks or stray strokes. Render on a dark
  backdrop too, to catch light edge halos.
- In the app: restart pnpm dev (hot reload keeps the old avatar code), send gesture cues with a small scripted
  WebSocket core on ws://127.0.0.1:8765/ws, capture the window with screencapture and show frame strips.
  Repeated cues must not restart a gesture.
- pnpm -F desktop test, typecheck and lint pass. Record decisions in DECISIONS.md and steps in docs/IKI.md.
- Don't commit model weights or franchise art to a public place without asking me. Don't commit at all unless
  I say so.

Stop only when every check above passes. If one can't pass because of the source art, say exactly which, show
the crop, and say what art would fix it.
```

Tips when steering it: one region at a time ("now only the hair"), name the defect and where ("a light strip
under her left lock at a 20° tilt"), and say what is already right so it stays untouched.
