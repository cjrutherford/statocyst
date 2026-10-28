#!/usr/bin/env bash
# Build the debug APK and publish it to release/ (served by the tailnet Funnel).
# Usage: tools/android-publish.sh [--no-web]   (--no-web skips the Angular build)
set -euo pipefail
cd "$(dirname "$0")/.."
export JAVA_HOME="${JAVA_HOME:-/opt/android-studio/jbr}"
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Android/Sdk}"
URL="https://nirvana.tail5a4a0.ts.net/statocyst-android-debug.apk"

if [[ "${1:-}" != "--no-web" ]]; then
  node node_modules/.bin/nx build desktop --skip-nx-cache 2>&1 | tail -5
fi
node node_modules/@capacitor/cli/bin/capacitor sync android 2>&1 | tail -3
(cd android && ./gradlew assembleDebug --console=plain 2>&1 | tail -15)

APK=android/app/build/outputs/apk/debug/app-debug.apk
cp "$APK" release/statocyst-android-debug.apk
(cd release && sha256sum statocyst-android-debug.apk > SHA256SUMS)
AAPT2=$(ls -d "$ANDROID_HOME"/build-tools/*/aapt2 | sort -V | tail -1)
"$AAPT2" dump badging "$APK" 2>/dev/null | head -1 || true
LOCAL=$(cut -d' ' -f1 release/SHA256SUMS)
REMOTE=$(curl -fsS "$URL" | sha256sum | cut -d' ' -f1)
echo "local  sha256: $LOCAL"; echo "public sha256: $REMOTE"
[[ "$LOCAL" == "$REMOTE" ]] && echo "PUBLISHED OK: $URL" || { echo "PUBLIC BYTES MISMATCH" >&2; exit 1; }
