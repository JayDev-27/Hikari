#!/bin/bash
# Regenerate the menu-bar template icons (black + alpha; macOS tints them) from the vector flower in
# src/ui/HikariFlower.tsx, so the tray, the welcome window and the icon tiles all show the same flower.
#   bash apps/desktop/dev/make-tray-icon.sh      (needs Google Chrome for rendering)
set -euo pipefail
cd "$(dirname "$0")/.."
chrome="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
petal=$(sed -n 's/^  "\(M[^"]*\)";$/\1/p' src/ui/HikariFlower.tsx)
[ -n "$petal" ] || { echo "petal path not found in src/ui/HikariFlower.tsx" >&2; exit 1; }
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
for size in 22 44; do
  {
    echo "<!doctype html><style>html,body{margin:0;background:transparent}svg{display:block}</style>"
    echo "<svg width=\"$size\" height=\"$size\" viewBox=\"-1.2 -1.2 26.4 26.4\" xmlns=\"http://www.w3.org/2000/svg\" fill=\"#000\">"
    for r in 0 72 144 216 288; do echo "<path d=\"$petal\" transform=\"rotate($r 12 12)\"/>"; done
    echo "</svg>"
  } >"$tmp/t.html"
  "$chrome" --headless=new --hide-scrollbars --default-background-color=00000000 --force-device-scale-factor=1 \
    --window-size="$size,$size" --screenshot="$tmp/out.png" "file://$tmp/t.html" 2>/dev/null
  name=tray-template.png
  [ "$size" = 44 ] && name=tray-template@2x.png
  cp "$tmp/out.png" "src-tauri/icons/tray/$name"
  echo "wrote src-tauri/icons/tray/$name"
done
