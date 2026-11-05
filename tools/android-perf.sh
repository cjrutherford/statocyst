#!/usr/bin/env bash
# Captures cold-start and scroll frame data for the Capacitor Android build on a
# connected physical device. Use a Pixel 10 Pro as the S040 reference device.
#
# Usage: tools/android-perf.sh [outdir]   (default evidence/s040)
# Prerequisites: a debug or release build is installed, the library is seeded,
# and the device is unlocked. The script does not change app data.
set -uo pipefail
cd "$(dirname "$0")/.."

ADB="${ADB:-$HOME/Android/Sdk/platform-tools/adb}"
PKG=com.hopefulaspirationsindustries.statocyst
OUT="${1:-evidence/s040}"
mkdir -p "$OUT"

if ! "$ADB" get-state >/dev/null 2>&1; then
  echo "No adb device. Connect the reference Pixel 10 Pro and enable USB debugging." >&2
  exit 2
fi

model=$("$ADB" shell getprop ro.product.model | tr -d '\r')
android=$("$ADB" shell getprop ro.build.version.release | tr -d '\r')
webview=$("$ADB" shell dumpsys webviewupdate 2>/dev/null \
  | sed -n 's/.*Current WebView package.*: //p' | head -1 | tr -d '\r')
{
  echo "device: $model"
  echo "android: $android"
  echo "webview: ${webview:-unknown}"
  echo "package: $PKG"
  echo "captured: $(date -Is)"
} | tee "$OUT/device.txt"

# Cold start: force-stop so the process, WebView and JS bundle are cold.
"$ADB" shell am force-stop "$PKG"
sleep 1
cold=$("$ADB" shell am start -W -n "$PKG/.MainActivity" 2>&1 | tr -d '\r')
printf '%s\n' "$cold" | tee "$OUT/cold-start.txt"
total=$(printf '%s\n' "$cold" | sed -n 's/^TotalTime: //p' | head -1)

# Let the library and WebView settle before measuring frames.
sleep 6

# Reset frame stats, then perform a repeatable vertical scroll gesture.
"$ADB" shell dumpsys gfxinfo "$PKG" reset >/dev/null
read -r W H < <("$ADB" shell wm size | tail -1 | sed 's/.*: //; s/x/ /')
x=$((W / 2))
for _ in 1 2 3 4 5 6; do
  "$ADB" shell input swipe "$x" "$((H * 72 / 100))" "$x" "$((H * 28 / 100))" 280
  sleep 0.2
  "$ADB" shell input swipe "$x" "$((H * 28 / 100))" "$x" "$((H * 72 / 100))" 280
  sleep 0.2
done
sleep 1

# Keep the section that starts at the package's frame summary.
{
  echo "cold_start_total_ms: ${total:-unknown}"
  echo
  "$ADB" shell dumpsys gfxinfo "$PKG" 2>/dev/null \
    | sed -n '/Total frames rendered/,/Dropped frames/p'
} | tee "$OUT/frames.txt"

"$ADB" shell dumpsys meminfo "$PKG" 2>/dev/null \
  | sed -n '/App Summary/,/TOTAL PSS/p' | tee "$OUT/meminfo.txt"

echo "wrote $OUT/{device,cold-start,frames,meminfo}.txt"
echo "Run this with the same build before and after a change; compare TotalTime and Janky frames."
