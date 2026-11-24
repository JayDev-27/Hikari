#!/usr/bin/env bash
# Makima, whole figure from her reference: cut head/hair/face + cut torso/legs + split arms; clean; rig lossless; render.
set -e
P="$(cd "$(dirname "$0")" && pwd)"            # this folder
R="$(cd "$P/../../../.." && pwd)"             # repo root
# needs IKI_REPO (an iki checkout, built); see README.md
cd $R/characters/makima/iki-char/full
node $P/split-arms.mjs cut/body.png arms.json layers >/dev/null
rm -rf final && mkdir -p final
for f in cut/*.png; do b=$(basename $f); case $b in preview*|body.png) ;; *) cp $f final/$b;; esac; done
cp layers/body.png layers/arm_L.png layers/arm_R.png final/
node $P/strip-neutral.mjs final/hair_back.png 520 final/body.png
node $P/strip-neutral.mjs final/hair_side_L.png 600 final/body.png
node $P/strip-neutral.mjs final/hair_side_R.png 600 final/body.png
node $P/fill-holes.mjs final/body.png 380,520,800,800 40
node $P/fill-under-hair.mjs final 360,430,760,760 24
node $P/despill-layer.mjs final/lip_upper.png final/mouth_inner.png >/dev/null
node $P/defringe.mjs picture.png final/body.png final/arm_L.png final/arm_R.png final/hair_back.png final/hair_front.png final/hair_side_L.png final/hair_side_R.png
node $P/strip-pale.mjs final/hair_back.png final/hair_front.png final/hair_side_L.png final/hair_side_R.png >/dev/null
node $P/despeckle.mjs final/hair_back.png 300 >/dev/null
for f in final/hair_front.png final/hair_side_L.png final/hair_side_R.png final/arm_L.png final/arm_R.png final/body.png; do node $P/despeckle.mjs $f 80 >/dev/null; done
# Make the body match the picture wherever the picture shows it beside the locks (fixes notches, cloth over the braid).
node $P/restore-visible.mjs final picture.png 400,520,770,680
# Repaint the body under the locks (a head tilt uncovers it); the hidden collar edges and shoulder lines
# are measured on the picture ("!" = shoulder silhouette, air above).
node $P/repaint-under-hair.mjs final 340,540,780,780 5 "447,568,457,642;!430,589,446,581;658,580,650,630;!680,595,658,581"
# Small dark specks left on the shirt and sleeves (they stay behind when a lock or an arm moves).
# Clip the torso corners that stick up above the shoulders when an arm lifts (shoulder outlines from the picture).
node $P/trim-shoulders.mjs final/body.png "244,658,300,637;800,639,860,657"
# The neck fill sticks out past its hidden right edge (x 622) beside the right lock; backdrop shows between strands.
node $P/clear-box.mjs final/body.png 624,405,665,515
node $P/strip-backdrop.mjs final/hair_side_L.png final/hair_side_R.png final/hair_front.png final/hair_back.png
node $P/despeck-dark.mjs final/body.png 250,540,850,1400
node $P/despeck-dark.mjs final/arm_L.png 0,540,1100,1250
node $P/despeck-dark.mjs final/arm_R.png 0,540,1100,1250
cd $R/characters/makima
python3 -c "
import json,glob
json.dump({'layers':[{'path':p} for p in sorted(glob.glob('iki-char/full/final/*.png'))],'outputPath':'iki-char/full/makima.iki'},open('iki-char/full/rig.json','w'))"
node $P/call.mjs "$PWD" auto_rig_from_layers iki-char/full/rig.json 2>&1 | grep -E "INVALID|^FOLDS:|error" || true
echo assembled
node $P/add-legs.mjs iki-char/full/makima.iki 1480 3390
node $P/extend-arms.mjs iki-char/full/makima.iki 150
