#!/bin/bash
# A/V sync regression check (§2.5: lips within ±40 ms of the audio heard).
# Launches the dev app with VITE_AVSYNC=1, which plays a calibrated burst turn
# (audible: ~6 s of short "a" buzzes) and logs an AVSYNC {json} line; prints it,
# quits the app, and exits 0 on pass / 1 on fail / 2 on no result.
#   pnpm -F desktop avsync
cd "$(dirname "$0")/.." || exit 2
log=$(mktemp -t hikari-avsync)
pkill -f "target/(debug|release)/desktop" 2>/dev/null
# shellcheck disable=SC1091
[ -f "$HOME/.cargo/env" ] && . "$HOME/.cargo/env"
VITE_AVSYNC=1 pnpm tauri dev >"$log" 2>&1 &
runner=$!
result=""
for _ in $(seq 1 120); do
  result=$(grep -m1 -o 'AVSYNC {.*}' "$log")
  [ -n "$result" ] && break
  grep -q "avsync probe failed" "$log" && break
  sleep 1
done
pkill -f "target/debug/desktop" 2>/dev/null
kill "$runner" 2>/dev/null
wait "$runner" 2>/dev/null
if [ -z "$result" ]; then
  echo "no AVSYNC result; log: $log"
  grep -E "ERROR|probe failed" "$log" | tail -5
  exit 2
fi
echo "$result"
rm -f "$log"
case "$result" in *'"pass":true'*) echo "✓ A/V sync within tolerance"; exit 0 ;; *) echo "✗ A/V sync out of tolerance"; exit 1 ;; esac
