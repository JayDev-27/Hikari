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
