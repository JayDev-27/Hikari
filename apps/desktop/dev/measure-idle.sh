#!/bin/bash
# Measure Hikari's idle CPU: the Tauri process plus the WebKit processes spawned for it
# (WebContent/GPU/Networking run as separate XPC services, not children of the app).
# Usage: dev/measure-idle.sh [seconds=20]
# Run while Hikari is idle (not speaking, cursor away from her).
secs=${1:-20}
app=$(pgrep -f "^(\./)?target/(debug|release)/desktop|/Hikari\.app/Contents/MacOS/" | head -1)
[ -z "$app" ] && { echo "Hikari is not running"; exit 1; }
start=$(ps -o lstart= -p "$app" | xargs)
start_s=$(date -j -f "%a %b %d %T %Y" "$start" +%s)
# WebKit XPC processes started within 15 s after the app (best-effort attribution).
pids="$app"
for p in $(pgrep -f "com.apple.WebKit"); do
  ls=$(ps -o lstart= -p "$p" 2>/dev/null | xargs) || continue
  s=$(date -j -f "%a %b %d %T %Y" "$ls" +%s)
  if [ $((s - start_s)) -ge -1 ] && [ $((s - start_s)) -le 15 ]; then pids="$pids $p"; fi
done
echo "pids: $pids"
# top: the first sample is cumulative since launch, so skip it.
top -l $((secs + 1)) -s 1 -stats pid,cpu,command $(printf -- "-pid %s " $pids) 2>/dev/null |
  awk -v app="$app" '
    /^PID/ { sample++; next }
    sample > 1 && $1 ~ /^[0-9]+$/ { t[$1] += $2; c[$1]++; tot += $2 }
    END {
      for (p in t) printf "  %-7s %-6s %5.1f%%\n", p, (p == app ? "app" : "webkit"), t[p] / c[p]
      printf "avg total CPU over %d s: %.1f%% (of one core)\n", sample - 1, tot / (sample - 1)
    }'
