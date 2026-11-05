# ADR-034 — Promote iOS and CarPlay into the rural-offline programme

**Status:** Accepted (2026-11-05)
**Supersedes:** the "iOS/CarPlay is deferred" note in DEFERRED_FEATURES.md for this programme.

## Context
iOS exists in the tree but its offline path is materially weaker than Android's: no Range
resume, no retry, no progress, an in-memory queue, no playback recovery and no CarPlay.
The product now targets iOS parity, including CarPlay audio.

## Decision
1. iOS offline parity (S034) is in scope for the rural-offline release.
2. CarPlay audio (S039) is in scope, behind the Apple entitlement gate.
3. Android remains the reference implementation for transfer and recovery semantics.
4. The WebView is never required for CarPlay browse or playback.
5. Entitlement approval and physical head-unit validation are external gates; code may be
   `IMPLEMENTED_UNVERIFIED` but never `VERIFIED` without them.

## Consequences
- CI must build the CarPlay scene on macOS even without signing.
- The entitlement file and scene manifest are part of the app target.
- Any CarPlay browse tree must be driven by the same local database as the phone UI.
- If Apple declines the entitlement, the code stays dormant and the app remains a phone app.
