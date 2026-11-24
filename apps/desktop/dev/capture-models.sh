#!/bin/bash
# Launch the stage once per character and capture the stage window (by window id,
# so other apps covering it don't matter). Used to check models fit the window.
#   dev/capture-models.sh <out-dir> [ids…]   (default: hiyori haru mao rice)
cd "$(dirname "$0")/.." || exit 1
out=${1:?out dir}; shift
ids=("$@"); [ ${#ids[@]} -eq 0 ] && ids=(hiyori haru mao rice)
mkdir -p "$out"
[ -f "$HOME/.cargo/env" ] && . "$HOME/.cargo/env"
helper=$(mktemp -d)/wid
cat > "$helper.swift" <<'EOF'
import CoreGraphics
let list = CGWindowListCopyWindowInfo([.optionAll], kCGNullWindowID) as! [[String: Any]]
for w in list where (w[kCGWindowOwnerName as String] as? String) == "desktop" && (w[kCGWindowName as String] as? String) == "Hikari" {
  print(w[kCGWindowNumber as String]!)
}
EOF
swiftc -O "$helper.swift" -o "$helper" 2>/dev/null || exit 1
for id in "${ids[@]}"; do
  pkill -f "target/(debug|release)/desktop" 2>/dev/null
  # Wait until the previous instance's window is gone, or we'd capture a stale id.
  for _ in $(seq 1 30); do [ -z "$("$helper")" ] && break; sleep 0.5; done
  log=$(mktemp -t hikari-cap)
  VITE_CHARACTER=$id VITE_DEBUG_OVERLAY=0 pnpm tauri dev >"$log" 2>&1 &
  runner=$!
  wid=""
  for _ in $(seq 1 90); do wid=$("$helper" | head -1); [ -n "$wid" ] && break; sleep 1; done
  sleep 6 # model load + first idle frames
  # Re-read the id: the stage is converted to an NSPanel after it first appears,
  # which can replace the window (and its id).
  wid=$("$helper" | tail -1)
  if [ -n "$wid" ]; then
    screencapture -x -o -l "$wid" "$out/$id.png" && echo "captured $id → $out/$id.png"
  else
    echo "no stage window for $id"
  fi
  grep -E "ERROR" "$log" | head -3
  pkill -f "target/debug/desktop" 2>/dev/null
  kill "$runner" 2>/dev/null; wait "$runner" 2>/dev/null
done
