# Native playback

**Status:** Accepted design intent; implementation unverified unless evidence is linked.  
**Date:** 2026-10-26

## Decision
Per-runtime authoritative playback engine and single queue. Media3 for Android, native-backed/Electron engine for desktop, eventual AVFoundation for iOS. Shared behavioral fixtures, not executable cross-language code.

## Required implementation controls
- Before implementing, identify platform-dependent and API-dependent assumptions.
- Attach evidence for all acceptance criteria in the relevant slice.
- Document incompatible requirements and obtain a new ADR decision; never silently substitute another architecture.
- Respect earlier accepted decisions, especially stock Jellyfin compatibility, offline usability, security and user control.

## Verification
See `verification/TEST_MATRIX.md` and the slice-specific exit gate. No passing tests are asserted by this document.
