#!/usr/bin/env bash
# Captures Library / Now Playing / Queue / Settings for a matrix of display sizes, font scales and
# themes on a connected debug device, then restores the display settings.
# Usage: tools/android-device-matrix.sh [outdir]   (default evidence/s015)
# Needs a seeded library with a restored queue: run tools/android-seed-fixtures.py and play a track once.
set -uo pipefail
cd "$(dirname "$0")/.."
ADB="${ADB:-$HOME/Android/Sdk/platform-tools/adb}"
PKG=net.christopherrutherford.statocyst
OUT="${1:-evidence/s015}"
mkdir -p "$OUT"

# name  size  density  font_scale  night
CONFIGS=(
  "phone-default    1080x2400 420 1.0 no"
  "phone-small      720x1280  320 1.0 no"
  "phone-font13     1080x2400 420 1.3 no"
  "phone-small-f13  720x1280  320 1.3 no"
  "phone-dark       1080x2400 420 1.0 yes"
  "tablet-portrait  1600x2560 320 1.0 no"
  "tablet-landscape 2560x1600 320 1.0 no"
)

restore() {
  "$ADB" shell wm size reset; "$ADB" shell wm density reset
  "$ADB" shell settings put system font_scale 1.0; "$ADB" shell cmd uimode night no >/dev/null
}
trap restore EXIT

tap() { # fractions of the current screen
  read -r W H < <("$ADB" shell wm size | tail -1 | sed 's/.*: //; s/x/ /')
  "$ADB" shell input tap "$(python3 -c "print(int($W*$1))")" "$(python3 -c "print(int($H*$2))")"
}
shot() { "$ADB" exec-out screencap -p > "$OUT/$1-$2.png"; }

for cfg in "${CONFIGS[@]}"; do
  read -r name size dpi font night <<<"$cfg"
  "$ADB" shell wm size "$size"; "$ADB" shell wm density "$dpi"
  "$ADB" shell settings put system font_scale "$font"; "$ADB" shell cmd uimode night "$night" >/dev/null
  "$ADB" shell am force-stop "$PKG"; "$ADB" shell am start -n "$PKG/.MainActivity" >/dev/null
  sleep 9
  shot "$name" 1-library
  if [[ "$name" == *landscape ]]; then
    # Desktop-style layout: sidebar navigation and a bottom player bar.
    tap 0.06 0.965; sleep 4; shot "$name" 2-nowplaying
    tap 0.03 0.31; sleep 4; shot "$name" 3-queue
    tap 0.03 0.373; sleep 4; shot "$name" 4-settings
  else
    tap 0.22 0.86; sleep 4; shot "$name" 2-nowplaying
    tap 0.69 0.976; sleep 4; shot "$name" 3-queue
    tap 0.89 0.976; sleep 4; shot "$name" 4-settings
  fi
done
echo "captured to $OUT"
