# Evidence report: S039 — CarPlay audio

**Status:** IMPLEMENTED_UNVERIFIED / BLOCKED (entitlement + head unit)
**Date:** 2026-11-05
**Branch:** feature/rural-offline-parity

## What changed
- `ios/App/App/CarPlay/CarPlaySceneDelegate.swift`: `CPTemplateApplicationScene` delegate,
  `CPTabBarTemplate` root with Library / Albums / Artists / Playlists / Downloaded, a More
  tab when the host caps tabs, `CPNowPlayingTemplate` push, and offline/empty states.
- `CarPlaySceneDelegate` reads `StatocystDatabase.shared` via `Duplicates.collapse` for the
  same visible rows as the phone; playlists use the new read-only `getAllPlaylists()` /
  `getAllPlaylistTracks()` accessors. Track taps build `PlaybackQueueSlot`s and call
  `PlaybackManager.shared.setQueue`; transport stays with `MPRemoteCommandCenter`.
- `CarPlayBrowse.swift` is a pure browse/grouping model; `CarPlayArtwork.swift` resolves
  sidecar, embedded, and Jellyfin artwork without the WebView.
- `App.entitlements` adds `com.apple.developer.carplay-audio`.
- `Info.plist` adds the CarPlay scene role; `AppDelegate` branches the scene configuration
  to `CarPlaySceneDelegate` for that role.
- `project.pbxproj` registers the three Swift files, the CarPlay group, the entitlement
  file, and `CODE_SIGN_ENTITLEMENTS` on Debug and Release.

## Verification
| Check | Result |
| --- | --- |
| Info.plist / App.entitlements parse | PASS (plistlib) |
| pbxproj braces/parens, unique IDs, source membership | PASS (scripted check) |
| Swift syntax parse (tree-sitter) | PASS |
| iOS Debug/Release build | CI (macos-15) required |
| Real CarPlay head unit | BLOCKED |

## Blocker
`com.apple.developer.carplay-audio` must be approved for the App ID and included in a
provisioning profile. The unsigned/adhoc IPA path used for sideloading cannot embed it, so
the CarPlay scene stays dormant there. Browse, Now Playing, audio focus, Siri and hardware
controls on a real head unit remain BLOCKED until that approval exists.

## Evidence still needed
- CI macOS build compiles/links the CarPlay framework and the new files.
- A physical or CarPlay-simulator session: browse, play, artwork, Now Playing, disconnect
  and reconnect, offline empty state.
