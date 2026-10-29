# S011 — DHU harness and controller policy hardening

Version: versionCode 12 / 0.3.1, APK SHA256 `ef4ba3f21cfca8be4e1181c587e0ef426fc01c1752d854065ca767b8ae6f8c52` (public bytes verified).

## Changes
- `media/BrowseAccess.kt`: prefs-backed user allowlist and a most-recent-first list of denied controller packages (max 10).
- `ControllerPolicy.mayBrowse(..., userAllowed)`; `PlaybackService.mayBrowse` passes the allowlist and records every denial.
- Plugin `getBrowseAccess` / `setBrowseAllowed`; bridge contract (optional, Android only).
- Settings -> "Car and Android Auto" -> "Head units and controllers": blocked packages with **Allow**, allowed ones with **Remove**.
- `tools/dhu.sh`: downloads Google's Desktop Head Unit r02.1 into `tools/.cache/dhu` (git-ignored), forwards `tcp:5277`, launches it.

## Evidence
- Unit tests 39/39 (new: `userAllowedPackageMayBrowse`). Web build succeeds.
- Emulator: the new section renders ("None blocked..."); `s011-car-settings.png`.

## Not verified
- The Allow/Remove round trip with a real denied package: no untrusted controller was available to trigger a denial on the emulator.
- DHU run: the DHU downloads and extracts, but it cannot start here: no desktop session (`DISPLAY` empty), missing `libc++.so.1`, and the emulator's Android Auto is only the system stub (`1.2.552680-stub`). The script is for the user's machine plus a phone with Android Auto ("Start head unit server").
