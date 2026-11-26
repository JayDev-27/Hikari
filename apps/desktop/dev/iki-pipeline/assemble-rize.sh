#!/usr/bin/env bash
# Rebuild Rize from her local PSD and the measured full-body landmarks.
set -euo pipefail
P="$(cd "$(dirname "$0")" && pwd)"
R="$(cd "$P/../../../.." && pwd)"
export IKI_REPO="$(cd "${IKI_REPO:?set IKI_REPO to a built Iki checkout}" && pwd)"
cd "$R/characters/rize"
mkdir -p iki-char/{cut,layers,final,renders}
if [[ "${1:-}" != "--reuse-cut" ]]; then
  python3 "$P/prepare-rize.py" source/Rize.psd iki-char "$P/rize.landmarks.json"
  node --input-type=module - "$P/rize.landmarks.json" <<'JS'
import { readFileSync, writeFileSync } from 'node:fs';
const { glasses, sclera, ...landmarks } = JSON.parse(readFileSync(process.argv[2], 'utf8'));
writeFileSync('iki-char/cut.json', JSON.stringify({
  imagePath: 'iki-char/cut-picture.png', outputDir: 'iki-char/cut', landmarks,
  mouthKeyed: 'iki-char/mouth-keyed.png', mouthInterior: 'iki-char/mouth-interior.png',
}));
JS
  node "$P/call.mjs" "$PWD" cut_layers_from_illustration iki-char/cut.json | tee iki-char/cut.log
  rg -q '^CUT pass$' iki-char/cut.log
  if [[ "${1:-}" == "--cut-only" ]]; then exit; fi
fi
cd iki-char
node "$P/split-arms.mjs" cut/body.png "$P/rize.arms.json" layers
for f in cut/*.png; do
  b="$(basename "$f")"
  case "$b" in preview*|body.png) ;; *) cp "$f" "final/$b";; esac
done
cp layers/{body,arm_L,arm_R}.png final/
for f in final/{hair_back,hair_side_L,hair_side_R}.png; do
  node "$P/strip-neutral.mjs" "$f" 562 final/body.png plum
done
node "$P/fill-holes.mjs" final/body.png 425,521,675,630 40
node "$P/despill-layer.mjs" final/{lip_upper,lip_lower,mouth_inner,mouth_teeth,mouth_tongue}.png
node "$P/defringe.mjs" picture.png final/{body,arm_L,arm_R,hair_back,hair_front,hair_side_L,hair_side_R}.png
node "$P/strip-pale.mjs" --plum final/{hair_back,hair_front,hair_side_L,hair_side_R}.png
for f in final/{hair_back,hair_front,hair_side_L,hair_side_R,arm_L,arm_R,body}.png; do
  node "$P/despeckle.mjs" "$f" 35
done
node "$P/restore-visible.mjs" final picture.png 306,516,755,1064 layers/body.png
node "$P/repaint-under-hair.mjs" final 284,518,779,1050 2 '313,642,468,638;613,641,736,627;466,817,489,826;606,822,625,806'
python3 "$P/refine-rize-layers.py" .
cd ..
node --input-type=module <<'JS'
import { readdirSync, writeFileSync } from 'node:fs';
const dir = 'iki-char/final';
const layers = readdirSync(dir).filter((name) => name.endsWith('.png')).map((name) => ({path: `${dir}/${name}`}));
const rigPlan = {
  turn: { amount: 0.82, featureLead: 0.65, farEar: 0.3 },
  hair: { outlineFollow: 0.72, sway: 0.65 },
};
writeFileSync('iki-char/rig.json', JSON.stringify({ layers, rigPlan, outputPath: 'iki-char/rize-rigged.iki' }));
JS
node "$P/call.mjs" "$PWD" auto_rig_from_layers iki-char/rig.json | tee iki-char/rig.log
if rg -q '^INVALID' iki-char/rig.log; then exit 1; fi
test -s iki-char/rize-rigged.iki
node "$P/add-legs.mjs" iki-char/rize-rigged.iki 1220 3318
node "$P/extend-arms.mjs" iki-char/rize-rigged.iki 150
node "$P/pose-rize.mjs" iki-char/rize-rigged.iki "$P/rize.landmarks.json"
mkdir -p iki-char/armpits
node --input-type=module <<'JS'
import { writeFileSync } from 'node:fs';
const boxes = { R: { x: 240, y: 635, w: 178, h: 320 }, L: { x: 640, y: 635, w: 180, h: 320 } };
const poses = Object.entries(boxes).flatMap(([side, crop]) => [0, 18].map(lift => ({
  name: `before-${side}-${lift}`, crop, values: { [`ParamArm${side}`]: lift },
})));
writeFileSync('iki-char/armpits.json', JSON.stringify({
  modelPath: 'iki-char/rize-rigged.iki', outDir: 'iki-char/armpits', poses,
}));
JS
node "$P/call.mjs" "$PWD" render_poses iki-char/armpits.json > iki-char/armpits-before.log
cp iki-char/rize-rigged.iki iki-char/rize-before-armpits.iki
node "$P/armpit-patch.mjs" iki-char/rize-rigged.iki iki-char/armpits/before-R-0.png iki-char/armpits/before-R-18.png 240,635,178,320 706 750 R 161,158,168
node "$P/armpit-patch.mjs" iki-char/rize-rigged.iki iki-char/armpits/before-L-0.png iki-char/armpits/before-L-18.png 640,635,180,320 714 760 L 169,165,174
cp iki-char/rize-rigged.iki iki-char/rize-before-edges.iki
node "$P/despeck-edges.mjs" iki-char/rize-rigged.iki
# Forearms fold inward to 170° (hand-to-face think_chin / facepalm); clean skin under the eyes and
# glasses (closed lids, head turns) and on the neck under the jaw (head turns).
node "$P/elbow-in.mjs" iki-char/rize-rigged.iki 170
node "$P/fill-under.mjs" iki-char/rize-rigged.iki face '^(eye|iris|lash|lash_lower)_[LR]$|^glasses$' 6
node "$P/fill-under.mjs" iki-char/rize-rigged.iki body '^face$' 0
# The open book she holds in signature-book (from her Live2D atlas: characters/rize/source/book.png), placed
# behind both forearms, with the lower corners inside her two open grips.
node "$P/add-prop.mjs" iki-char/rize-rigged.iki source/book.png book ParamRizeBook 515,1658,445 2.8 bodyWarp -4
mv iki-char/rize-rigged.iki iki-char/Rize.iki
