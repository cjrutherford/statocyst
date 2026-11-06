# Evidence report: S038 (partial) — Mobile shell polish

**Status:** PARTIAL / IMPLEMENTED_UNVERIFIED
**Date:** 2026-11-05
**Branch:** feature/rural-offline-parity

## Landed
- A shell-level offline chip (`Offline — downloaded music only`) appears on the
  `online`/`offline` events and navigates to the Offline view.
- Library rows use `content-visibility: auto` so a 2k-row list does not layout every
  off-screen row at once.

## Still open
- Real virtualization / paging for very large libraries — landed under S040
  (`perf/capacitor-native-parity`), pending physical-device verification.
- Swipe actions, a sticky download action with size, and a compact phone player bar.
- First-run connect + "pin an album for the commute".
- Undo for remove-download and remove-track.
