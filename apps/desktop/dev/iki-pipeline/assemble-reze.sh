#!/usr/bin/env bash
# Reze, whole figure from her PSD. See docs/IKI.md for the measured source and cut review.
set -euo pipefail
P="$(cd "$(dirname "$0")" && pwd)"
R="$(cd "$P/../../../.." && pwd)"
export IKI_REPO="$(cd "${IKI_REPO:?set IKI_REPO to a built Iki checkout}" && pwd)"
cd "$R/characters/reze"
mkdir -p iki-char/{cut,layers,final,renders}
if [[ "${1:-}" != "--reuse-cut" ]]; then
  python3 "$P/prepare-reze.py" source/Reze.psd iki-char
  node "$P/align-reze.mjs" iki-char
  node --input-type=module - "$P/reze.landmarks.json" <<'JS'
import { readFileSync, writeFileSync } from 'node:fs';
writeFileSync('iki-char/cut.json', JSON.stringify({
  imagePath: 'iki-char/picture.png', outputDir: 'iki-char/cut',
  landmarks: JSON.parse(readFileSync(process.argv[2], 'utf8')),
  mouthKeyed: 'iki-char/mouth-keyed.png', mouthInterior: 'iki-char/mouth-interior.png',
}));
JS
  node "$P/call.mjs" "$PWD" cut_layers_from_illustration iki-char/cut.json | tee iki-char/cut.log
  rg -q '^CUT pass$' iki-char/cut.log
fi
python3 "$P/cut-reze-offer.py" source/Flower-offer.png iki-char/offer.png
cd iki-char
node "$P/split-arms.mjs" cut/body.png "$P/reze.arms.json" layers
for f in cut/*.png; do
  b="$(basename "$f")"
  case "$b" in preview*|body.png) ;; *) cp "$f" "final/$b";; esac
done
cp layers/{body,arm_L,arm_R}.png final/
node "$P/strip-neutral.mjs" final/hair_back.png 552 final/body.png
node "$P/strip-neutral.mjs" final/hair_side_L.png 550 final/body.png
node "$P/strip-neutral.mjs" final/hair_side_R.png 553 final/body.png
node "$P/fill-holes.mjs" final/body.png 380,480,700,615 40
node "$P/despill-layer.mjs" final/lip_upper.png final/lip_lower.png final/mouth_inner.png
node "$P/defringe.mjs" picture.png final/{body,arm_L,arm_R,hair_back,hair_front,hair_side_L,hair_side_R}.png
node "$P/strip-pale.mjs" final/{hair_back,hair_front,hair_side_L,hair_side_R}.png
for f in final/{hair_back,hair_front,hair_side_L,hair_side_R,arm_L,arm_R,body}.png; do
  node "$P/despeckle.mjs" "$f" 80
done
node "$P/refine-reze-eyes.mjs" picture.png final
node "$P/restore-visible.mjs" final picture.png 410,490,675,591 cut/body.png
node "$P/repaint-under-hair.mjs" final 407,485,685,584 2 '468,516,482,510;610,507,619,517;!442,554,461,531;!615,517,631,524'
python3 "$P/refine-reze-layers.py" .
cd ..
node --input-type=module <<'JS'
import { readdirSync, writeFileSync } from 'node:fs';
const dir = 'iki-char/final';
const layers = readdirSync(dir).filter((name) => name.endsWith('.png')).map((name) => ({path: `${dir}/${name}`}));
const rigPlan = {
  turn: { amount: 0.82, featureLead: 0.65, farEar: 0.3 },
  hair: { outlineFollow: 0.65, sway: 0.75 },
};
writeFileSync('iki-char/rig.json', JSON.stringify({ layers, rigPlan, outputPath: 'iki-char/reze-rigged.iki' }));
JS
node "$P/call.mjs" "$PWD" auto_rig_from_layers iki-char/rig.json | tee iki-char/rig.log
if rg -q '^INVALID' iki-char/rig.log; then exit 1; fi
test -s iki-char/reze-rigged.iki
node "$P/add-legs.mjs" iki-char/reze-rigged.iki 1430 3190
node "$P/extend-arms.mjs" iki-char/reze-rigged.iki 150
node "$P/refine-reze-head.mjs" iki-char/picture.png iki-char/reze-rigged.iki
node "$P/refine-reze-contact.mjs" iki-char/reze-rigged.iki
node "$P/pose-reze.mjs" iki-char/reze-rigged.iki
# Armpit: paint what the raised right arm uncovers (rest stays exactly the picture). 9° = armLiftMax.
mkdir -p iki-char/armpit
C='{"x":230,"y":620,"w":200,"h":220}'
node "$P/call.mjs" "$PWD" render_poses "{\"modelPath\":\"iki-char/reze-rigged.iki\",\"outDir\":\"iki-char/armpit\",\"poses\":[{\"name\":\"rest\",\"values\":{},\"crop\":$C},{\"name\":\"lifted\",\"values\":{\"ParamArmR\":9,\"ParamElbowR\":-158},\"crop\":$C}]}" >/dev/null
node "$P/armpit-patch.mjs" iki-char/reze-rigged.iki iki-char/armpit/rest.png iki-char/armpit/lifted.png 230,620,200,220 722 750
mv iki-char/reze-rigged.iki iki-char/Reze.iki
