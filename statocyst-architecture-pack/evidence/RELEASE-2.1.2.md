# Statocyst 2.1.2 — Desktop mini-player layout fix

**Release date:** 2026-11-08
**Version:** `2.1.2` (`versionCode 31`)

## Fixed

- The desktop mini-player is back at the bottom of the window. `.main` is now explicitly
  placed in grid row 1, so the explicitly placed foam overlay and player can no longer push
  the content into an implicit third row.
- The bubble/foam transition now covers the full content area above the mini-player instead
  of collapsing to a zero-height row.
- Added an Electron regression test asserting:
  - the player starts at or below the content bottom;
  - the player stays inside the viewport;
  - the foam overlay starts at the content top, matches its height and ends at the player.

## Verification

- Reproduced with the packaged Electron renderer before the fix:
  `grid-template-rows: 0px 99px 541px`, player at `y=0`, foam height `0`.
- After the fix: `grid-template-rows: 541px 99px`, player at `y=541`, foam height `541`.
- `e2e/desktop.spec.ts` layout regression test passes.
- Podcast Electron E2E passes.
- CI runs web, Android unit/instrumented and iOS build jobs on the release commit.
