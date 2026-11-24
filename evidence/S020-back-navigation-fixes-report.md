# S020 — Back navigation and transient-state review fixes

State: `IMPLEMENTED_UNVERIFIED` (focused tests, typecheck, production build, Capacitor sync and Android debug assemble passed; runtime UI remains unverified).
Date: 2026-11-22.

## Changes

- System Back now resolves a pending destination before checking the active view, so a fast destination tap followed by Back returns to its origin rather than exiting from the stale root.
- Scroll restoration and focus continuations check both the active destination and navigation generation.
- Library context menus close when leaving Library. The body-mounted layer is also removed by the existing `ngOnDestroy` cleanup.
- Podcast Back dismisses settings or an expanded episode before closing a selected feed.
- Library detail history is a signal, so the computed Back label updates after history changes.
- Re-selecting the currently visible destination invalidates a pending navigation operation.
- Delayed library detail scroll restoration now checks that Library is active and its navigation generation is current.
- Both Now Playing minimize actions use the app shell Back dispatcher, which also restores destination scroll and focus.
- Added regression checks for tap-to-Back, same-destination cancellation, transient priority, stale scroll operations, and reactive library labels.

## Verification

- `pnpm nx run desktop:test --output-style=static` — exit 0; 4 files, 11 tests passed. Log: `/tmp/statocyst-desktop-tests-delivery.log`.
- `pnpm nx run desktop:typecheck --skip-nx-cache --output-style=static` — exit 0. Log: `/tmp/statocyst-desktop-typecheck-delivery.log`.
- `pnpm android:sync` — exit 0; final production renderer copied into Android assets. Log: `/tmp/statocyst-android-sync-delivery.log`.
- `JAVA_HOME=/opt/android-studio/jbr ANDROID_HOME=/home/cjrutherford/Android/Sdk ./gradlew assembleDebug` — exit 0 (JDK 21). Log: `/tmp/statocyst-android-assemble-delivery.log`.
- Debug APK: `android/app/build/outputs/apk/debug/app-debug.apk`, 26,195,305 bytes, SHA256 `a3e525f0ed1ec20e9ecac42f87c2352241a19b475dfcf05a698c2b7e338c3b36`.

## Not verified

- Runtime UI remains unverified: the prior T3 `device_list` reported `Device support failed during installing device support`; `device_open` returned `No android devices were found on host local`. Per task instruction there were no further device retries or adb UI actions.
- The earlier APK was installed on the headless `Medium_Phone_API_36.1` emulator before these final code changes. This final APK was assembled but not installed, so no runtime claim is made for the final bits.
- Search → artist → album, system Back, context retention, Now Playing/Queue origin, keyboard/menu Back priority, root exit, and playback were not exercised in the UI.
