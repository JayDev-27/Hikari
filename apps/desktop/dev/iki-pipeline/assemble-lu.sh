#!/usr/bin/env bash
# Rebuild Lu Guang from the visible full-body PSD composite.
set -euo pipefail
P="$(cd "$(dirname "$0")" && pwd)"
R="$(cd "$P/../../../.." && pwd)"
export IKI_REPO="$(cd "${IKI_REPO:?set IKI_REPO to a built Iki checkout}" && pwd)"
cd "$R/characters/lu-guang"
mkdir -p iki-char/{cut,layers,final,renders,armpits}
if [[ "${1:-}" != "--reuse-cut" ]]; then
  python3 "$P/prepare-lu.py" 'source/Lu Guang.psd' iki-char
  node --input-type=module - "$P/lu.landmarks.json" <<'JS'
import { readFileSync, writeFileSync } from 'node:fs';
const { parting, spikes, ...landmarks } = JSON.parse(readFileSync(process.argv[2], 'utf8'));
writeFileSync('iki-char/cut.json', JSON.stringify({
  imagePath: 'iki-char/picture.png', outputDir: 'iki-char/cut', landmarks,
  mouthKeyed: 'iki-char/mouth-keyed.png', mouthInterior: 'iki-char/mouth-interior.png',
}));
JS
  node "$P/call.mjs" "$PWD" cut_layers_from_illustration iki-char/cut.json | tee iki-char/cut.log
  rg -q '^CUT pass$' iki-char/cut.log
  if [[ "${1:-}" == "--cut-only" ]]; then exit; fi
fi
cd iki-char
node "$P/split-arms.mjs" cut/body.png "$P/lu.arms.json" layers
for f in cut/*.png; do
  b="$(basename "$f")"
  case "$b" in preview*|body.png) ;; *) cp "$f" "final/$b";; esac
done
cp layers/{body,arm_L,arm_R}.png final/
for f in final/{hair_back,hair_side_L,hair_side_R}.png; do
  node "$P/strip-neutral.mjs" "$f" 475 final/body.png
done
node "$P/fill-holes.mjs" final/body.png 468,424,634,561 32
node "$P/despill-layer.mjs" final/{lip_upper,lip_lower,mouth_inner,mouth_teeth,mouth_tongue}.png
node "$P/defringe.mjs" picture.png final/{body,arm_L,arm_R,hair_back,hair_front,hair_side_L,hair_side_R}.png
node "$P/strip-pale.mjs" --below 475 final/{hair_back,hair_front,hair_side_L,hair_side_R}.png
for f in final/{hair_back,hair_front,hair_side_L,hair_side_R,arm_L,arm_R,body}.png; do
  node "$P/despeckle.mjs" "$f" 32
done
node "$P/restore-visible.mjs" final picture.png 433,419,668,578 layers/body.png
node "$P/repaint-under-hair.mjs" final 423,410,675,579 2
python3 "$P/refine-lu-layers.py" .
cd ..
node --input-type=module <<'JS'
import { readdirSync, writeFileSync } from 'node:fs';
const dir = 'iki-char/final';
const layers = readdirSync(dir).filter(name => name.endsWith('.png')).map(name => ({path: `${dir}/${name}`}));
const rigPlan = {
  turn: { amount: 0.74, featureLead: 0.62, farEar: 0.27 },
  hair: { outlineFollow: 0.85, sway: 0.46 },
};
writeFileSync('iki-char/rig.json', JSON.stringify({ layers, rigPlan, outputPath: 'iki-char/lu-rigged.iki' }));
JS
node "$P/call.mjs" "$PWD" auto_rig_from_layers iki-char/rig.json | tee iki-char/rig.log
if rg -q '^INVALID' iki-char/rig.log; then exit 1; fi
test -s iki-char/lu-rigged.iki
node "$P/add-legs.mjs" iki-char/lu-rigged.iki 1506 2945
node "$P/extend-arms.mjs" iki-char/lu-rigged.iki 150
node "$P/pose-lu.mjs" iki-char/lu-rigged.iki
node --input-type=module <<'JS'
import { writeFileSync } from 'node:fs';
const boxes = { R: { x: 165, y: 713, w: 173, h: 316 }, L: { x: 767, y: 713, w: 178, h: 316 } };
const poses = Object.entries(boxes).flatMap(([side, crop]) => [0, 20].map(lift => ({
  name: `before-${side}-${lift}`, crop, values: { [`ParamArm${side}`]: lift },
})));
writeFileSync('iki-char/armpits.json', JSON.stringify({ modelPath: 'iki-char/lu-rigged.iki', outDir: 'iki-char/armpits', poses }));
JS
node "$P/call.mjs" "$PWD" render_poses iki-char/armpits.json > iki-char/armpits-before.log
cp iki-char/lu-rigged.iki iki-char/lu-before-armpits.iki
node "$P/armpit-patch.mjs" iki-char/lu-rigged.iki iki-char/armpits/before-R-0.png iki-char/armpits/before-R-20.png 165,713,173,316 851 951 R 166,163,156
node "$P/armpit-patch.mjs" iki-char/lu-rigged.iki iki-char/armpits/before-L-0.png iki-char/armpits/before-L-20.png 767,713,178,316 851 951 L 166,163,156
cp iki-char/lu-rigged.iki iki-char/lu-before-edges.iki
node "$P/despeck-edges.mjs" iki-char/lu-rigged.iki
# His study-photo signature: the right forearm folds inward to 140° (hand palm-up at mid-chest from the elbow
# alone, so the shoulder never lifts), holding a photo (Codex, source/photo.png). The photo rides the forearm: it
# is placed where it sits in the REST pose and turned 119° there, so at elbow 130° / arm 2° it is upright in his
# hand, tilted 9°, pinched between thumb and fingers (canvas centre 634,864, from render_poses). He is looking at
# it, so we see its back (source/photo-back.png, Codex, masked to the front print's outline source/photo.png).
# His irises glow blue while he reads it (ParamLuGlow), as his power does in the show.
node "$P/elbow-in.mjs" iki-char/lu-rigged.iki 140
node "$P/add-prop.mjs" iki-char/lu-rigged.iki source/photo-back.png photo ParamLuPhoto 99.4,1732.7,194 5.6 forearmDeformer_R 119
node "$P/eye-glow.mjs" iki-char/lu-rigged.iki ParamLuGlow '#3fb6ff'
# His clap: the right hand mirrored about the wrist (below the wristband, crop row 735) turns palm-down when the
# forearm lies level, so it claps onto his upturned left palm (ParamLuPalm, gestures.ts clap-palm-down).
node "$P/palm-swap.mjs" iki-char/lu-rigged.iki ParamLuPalm 0 --sides=R --start=735
mv iki-char/lu-rigged.iki iki-char/Lu.iki
