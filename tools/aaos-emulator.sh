#!/usr/bin/env bash
# Boot the Android Automotive OS emulator used for the Compose car surface.
#
# Requires Android command-line tools in $ANDROID_HOME/cmdline-tools/latest.
# The first run downloads the automotive Play Store system image.
set -euo pipefail

SDK="${ANDROID_HOME:-$HOME/Android/Sdk}"
PACKAGE="system-images;android-35-ext15;android-automotive-playstore;x86_64"
AVD="StatocystAAOS"
SDKMANAGER="$SDK/cmdline-tools/latest/bin/sdkmanager"
AVDMANAGER="$SDK/cmdline-tools/latest/bin/avdmanager"
EMULATOR="$SDK/emulator/emulator"

if [[ ! -x "$SDKMANAGER" || ! -x "$AVDMANAGER" || ! -x "$EMULATOR" ]]; then
  echo "Android SDK tools not found under $SDK." >&2
  echo "Install Android command-line tools, platform-tools and the emulator first." >&2
  exit 1
fi

if ! "$SDKMANAGER" --sdk_root="$SDK" --list_installed 2>/dev/null | grep -q "${PACKAGE}"; then
  echo "Installing $PACKAGE ..."
  yes | "$SDKMANAGER" --sdk_root="$SDK" "$PACKAGE"
fi

if ! "$EMULATOR" -list-avds 2>/dev/null | grep -qx "$AVD"; then
  echo "Creating $AVD ..."
  echo no | "$AVDMANAGER" create avd \
    -n "$AVD" \
    -k "$PACKAGE" \
    -d automotive_1024p_landscape
fi

exec "$EMULATOR" -avd "$AVD" \
  -no-window -no-audio -no-boot-anim -no-snapshot \
  -gpu swiftshader_indirect "$@"
