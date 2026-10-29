#!/usr/bin/env bash
# Build the debug APK and publish it to release/ (served by the tailnet Funnel).
# Usage: tools/android-publish.sh [--no-web] [--release]
#   --no-web   skips the Angular build
#   --release  builds the release-signed APK (needs android/keystore.properties)
#              and publishes it as statocyst-android.apk instead of the debug APK
set -euo pipefail
cd "$(dirname "$0")/.."
export JAVA_HOME="${JAVA_HOME:-/opt/android-studio/jbr}"
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Android/Sdk}"
NOWEB=0; RELEASE=0
for a in "$@"; do
  case "$a" in
    --no-web) NOWEB=1 ;;
    --release) RELEASE=1 ;;
    *) echo "unknown option: $a" >&2; exit 2 ;;
  esac
done
if (( RELEASE )); then
  [[ -f android/keystore.properties ]] || { echo "android/keystore.properties missing" >&2; exit 2; }
  TASK=assembleRelease; APK=android/app/build/outputs/apk/release/app-release.apk; NAME=statocyst-android.apk
else
  TASK=assembleDebug; APK=android/app/build/outputs/apk/debug/app-debug.apk; NAME=statocyst-android-debug.apk
fi
URL="https://nirvana.tail5a4a0.ts.net/$NAME"

if (( ! NOWEB )); then
  node node_modules/.bin/nx build desktop --skip-nx-cache 2>&1 | tail -5
fi
node node_modules/@capacitor/cli/bin/capacitor sync android 2>&1 | tail -3
(cd android && ./gradlew $TASK --console=plain 2>&1 | tail -15)

cp "$APK" "release/$NAME"
(cd release && sha256sum statocyst-android*.apk > SHA256SUMS)
AAPT2=$(ls -d "$ANDROID_HOME"/build-tools/*/aapt2 | sort -V | tail -1)
"$AAPT2" dump badging "$APK" 2>/dev/null | head -1 || true
if (( RELEASE )); then
  APKSIGNER=$(ls -d "$ANDROID_HOME"/build-tools/*/apksigner | sort -V | tail -1)
  "$APKSIGNER" verify --print-certs "$APK" | head -3
fi
LOCAL=$(sha256sum "release/$NAME" | cut -d' ' -f1)
REMOTE=$(curl -fsS "$URL" | sha256sum | cut -d' ' -f1)
echo "local  sha256: $LOCAL"; echo "public sha256: $REMOTE"
[[ "$LOCAL" == "$REMOTE" ]] && echo "PUBLISHED OK: $URL" || { echo "PUBLIC BYTES MISMATCH" >&2; exit 1; }
