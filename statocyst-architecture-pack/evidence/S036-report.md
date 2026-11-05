# Evidence report: S036 (partial) — Plan-ahead prefetch and collection coverage

**Status:** PARTIAL / IMPLEMENTED_UNVERIFIED
**Date:** 2026-11-05
**Branch:** feature/rural-offline-parity

## Landed
- `PREFETCH_AHEAD` on Android rises from 2 to 5, so a dead spot between songs is less
  likely to hit an uncached track. Prefetch remains single-threaded and budget-aware.
- Album/artist detail reports offline coverage (`12 of 14 offline`) next to the size.
- Existing per-collection actions (album/artist Download all, playlist/favorites download)
  now inherit the S031 quality profile and the S032 Wi-Fi/quota policy.

## Still open
- The size/quality sheet before a bulk download (currently the Settings default applies).
- Bitrate-aware horizon (next N minutes vs whole album) and charging/Wi-Fi triggers.
- Artwork prefetch alongside pins.
- The exact gate: a 12-track album made offline in one action, with size shown first and
  covers rendering offline. Not yet demonstrated on a device.
