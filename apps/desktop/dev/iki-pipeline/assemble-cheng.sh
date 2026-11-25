#!/usr/bin/env bash
# Rebuild Cheng Xiaoshi from the visible composite of his full-body PSD.
set -euo pipefail
P="$(cd "$(dirname "$0")" && pwd)"
R="$(cd "$P/../../../.." && pwd)"
export IKI_REPO="$(cd "${IKI_REPO:?set IKI_REPO to a built Iki checkout}" && pwd)"
cd "$R/characters/cheng-xiaoshi"
mkdir -p iki-char/{cut,layers,final,renders,armpits}
if [[ "${1:-}" != "--reuse-cut" ]]; then
  python3 "$P/prepare-cheng.py" 'source/Cheng Xiaoshi.psd' iki-char
  node --input-type=module - "$P/cheng.landmarks.json" <<'JS'
import { readFileSync, writeFileSync } from 'node:fs';
const { spikes, ...landmarks } = JSON.parse(readFileSync(process.argv[2], 'utf8'));
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
node "$P/split-arms.mjs" cut/body.png "$P/cheng.arms.json" layers
for f in cut/*.png; do
  b="$(basename "$f")"
  case "$b" in preview*|body.png) ;; *) cp "$f" "final/$b";; esac
done
cp layers/{body,arm_L,arm_R}.png final/
for f in final/{hair_back,hair_side_L,hair_side_R}.png; do
  node "$P/strip-neutral.mjs" "$f" 485 final/body.png
done
node "$P/fill-holes.mjs" final/body.png 467,431,629,550 35
node "$P/despill-layer.mjs" final/{lip_upper,lip_lower,mouth_inner,mouth_teeth,mouth_tongue}.png
node "$P/defringe.mjs" picture.png final/{body,arm_L,arm_R,hair_back,hair_front,hair_side_L,hair_side_R}.png
node "$P/strip-pale.mjs" final/{hair_back,hair_front,hair_side_L,hair_side_R}.png
for f in final/{hair_back,hair_front,hair_side_L,hair_side_R,arm_L,arm_R,body}.png; do
  node "$P/despeckle.mjs" "$f" 32
done
node "$P/restore-visible.mjs" final picture.png 445,421,652,540 layers/body.png
node "$P/repaint-under-hair.mjs" final 440,413,662,520 2
python3 "$P/refine-cheng-layers.py" .
cd ..
node --input-type=module <<'JS'
import { readdirSync, writeFileSync } from 'node:fs';
const dir = 'iki-char/final';
const layers = readdirSync(dir).filter(name => name.endsWith('.png')).map(name => ({path: `${dir}/${name}`}));
const rigPlan = {
  turn: { amount: 0.80, featureLead: 0.65, farEar: 0.28 },
  hair: { outlineFollow: 0.83, sway: 0.5 },
};
writeFileSync('iki-char/rig.json', JSON.stringify({ layers, rigPlan, outputPath: 'iki-char/cheng-rigged.iki' }));
JS
node "$P/call.mjs" "$PWD" auto_rig_from_layers iki-char/rig.json | tee iki-char/rig.log
if rg -q '^INVALID' iki-char/rig.log; then exit 1; fi
test -s iki-char/cheng-rigged.iki
node "$P/add-legs.mjs" iki-char/cheng-rigged.iki 1420 2938
node "$P/extend-arms.mjs" iki-char/cheng-rigged.iki 150
node "$P/pose-cheng.mjs" iki-char/cheng-rigged.iki
node --input-type=module <<'JS'
import { writeFileSync } from 'node:fs';
const boxes = { R: { x: 210, y: 579, w: 154, h: 300 }, L: { x: 731, y: 579, w: 157, h: 300 } };
const poses = Object.entries(boxes).flatMap(([side, crop]) => [0, 18].map(lift => ({
  name: `before-${side}-${lift}`, crop, values: { [`ParamArm${side}`]: lift },
})));
writeFileSync('iki-char/armpits.json', JSON.stringify({
  modelPath: 'iki-char/cheng-rigged.iki', outDir: 'iki-char/armpits', poses,
}));
JS
node "$P/call.mjs" "$PWD" render_poses iki-char/armpits.json > iki-char/armpits-before.log
cp iki-char/cheng-rigged.iki iki-char/cheng-before-armpits.iki
node "$P/armpit-patch.mjs" iki-char/cheng-rigged.iki iki-char/armpits/before-R-0.png iki-char/armpits/before-R-18.png 210,579,154,300 691 733 R 164,154,140
node "$P/armpit-patch.mjs" iki-char/cheng-rigged.iki iki-char/armpits/before-L-0.png iki-char/armpits/before-L-18.png 731,579,157,300 692 733 L 164,154,140
cp iki-char/cheng-rigged.iki iki-char/cheng-before-edges.iki
node "$P/despeck-edges.mjs" iki-char/cheng-rigged.iki
# Forearms fold inward to 170° (hand-to-face think_chin / facepalm, the sheepish neck rub); clean
# neck under the jaw for head turns. (No eye-socket fill: his lid crease shows through the lashes.)
node "$P/elbow-in.mjs" iki-char/cheng-rigged.iki 170
node "$P/fill-under.mjs" iki-char/cheng-rigged.iki body '^face$' 0
# The clap: palm-side hands that swap in while the forearms fold up, so palms meet palms. The hand is a flat,
# fingers-together repaint of his own (Codex, source/clap-hand.png), mirrored and bent 50° so it stands straight up.
node "$P/palm-swap.mjs" iki-char/cheng-rigged.iki ParamChengPalm 50 source/clap-hand.png
# Folded elbows: the cut leaves a sliver of backdrop between torso and upper arm; with the forearm folded across
# the chest it shows as a white wedge inside each elbow. Measure it over the elbow folds he uses and paint the
# jacket behind it, shown only while the elbow is bent.
mkdir -p iki-char/elbows
node --input-type=module <<'JS'
import { writeFileSync } from 'node:fs';
const crop = { x: 100, y: 600, w: 900, h: 700 }, poses = [{ name: 'rest', crop, values: {} }];
for (const e of [90, 110, 124, 132, 150, 170]) for (const a of [0, 6]) for (const d of [0, 1])
  poses.push({ name: `f_${e}_${a}_${d}`, crop, values: { ParamElbowL: e, ParamElbowR: e, ParamArmL: a, ParamArmR: a, ParamChengClapDepth: d, ParamChengPalm: e >= 110 ? 1 : 0 } });
writeFileSync('iki-char/elbows.json', JSON.stringify({ modelPath: 'iki-char/cheng-rigged.iki', outDir: 'iki-char/elbows', poses }));
JS
node "$P/call.mjs" "$PWD" render_poses iki-char/elbows.json > iki-char/elbows.log
for side in L R; do node "$P/elbow-gap.mjs" iki-char/cheng-rigged.iki $side 100,600,900,700 720,1060 iki-char/elbows/rest.png iki-char/elbows/f_*.png; done
mv iki-char/cheng-rigged.iki iki-char/Cheng.iki
