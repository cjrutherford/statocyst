#!/usr/bin/env bash
# Snapshot media-session / Android Auto state from a connected device or emulator.
# Usage: tools/android-auto-check.sh [outfile]   (default evidence/android-auto-check.txt)
set -uo pipefail
cd "$(dirname "$0")/.."
ADB="${ADB:-$HOME/Android/Sdk/platform-tools/adb}"
OUT="${1:-evidence/android-auto-check.txt}"
PKG=net.christopherrutherford.statocyst
"$ADB" get-state >/dev/null 2>&1 || { echo "no adb device connected" >&2; exit 2; }
{
  echo "== $(date -Is) =="; "$ADB" shell getprop ro.product.model; "$ADB" shell getprop ro.build.version.release
  echo "== package =="; "$ADB" shell dumpsys package $PKG | rg -m4 "versionCode|versionName"
  echo "== media_session =="; "$ADB" shell dumpsys media_session | rg -A25 "$PKG" | head -80
  echo "== notifications =="; "$ADB" shell dumpsys notification --noredact | rg -B2 -A12 "$PKG" | head -60
  echo "== logcat (statocyst/media3) =="; "$ADB" logcat -d -t 400 | rg -i "statocyst|media3|MediaSession|PlaybackService" | rg -v "WindowManager|Zygote|ActivityThread|GraphicsEnv|nativeloader" | cut -c1-220 | tail -60
} > "$OUT" 2>&1
echo "wrote $OUT"
