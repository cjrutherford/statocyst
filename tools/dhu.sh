#!/usr/bin/env bash
# Download (once) and launch Google's Desktop Head Unit against a phone/emulator running Android Auto.
# Usage: tools/dhu.sh [adb-serial]
# Needs a desktop session (DISPLAY/Wayland) and libc++ (Debian/Ubuntu: sudo apt install libc++1).
# Phone setup: Android Auto settings -> tap Version 10x -> developer settings -> overflow menu -> "Start head unit server".
set -euo pipefail
cd "$(dirname "$0")/.."
ADB="${ANDROID_HOME:-$HOME/Android/Sdk}/platform-tools/adb"
SERIAL_ARGS=()
[[ -n "${1:-}" ]] && SERIAL_ARGS=(-s "$1")
DIR="tools/.cache/dhu"
ZIP_URL="https://dl.google.com/android/repository/desktop-head-unit-linux-x64_r02.1.zip"
if [[ ! -x "$DIR/desktop-head-unit" ]]; then
  mkdir -p "$DIR"
  curl -fSL "$ZIP_URL" -o "$DIR/dhu.zip"
  (cd "$DIR" && unzip -qo dhu.zip && chmod +x desktop-head-unit)
fi
"$ADB" "${SERIAL_ARGS[@]}" forward tcp:5277 tcp:5277
echo "Forwarded tcp:5277. Make sure 'Start head unit server' is running on the phone, then:"
exec "$DIR/desktop-head-unit" "${@:2}"
