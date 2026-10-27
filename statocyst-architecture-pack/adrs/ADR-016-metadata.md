# Metadata overlays

**Status:** Accepted design intent; implementation unverified unless evidence is linked.  
**Date:** 2026-10-26

## Decision
Personal overrides, labels and groupings in local overlay without overwriting source. Remote changes require verified write capability, explicit consent and audit.

## Required implementation controls
- Before implementing, identify platform-dependent and API-dependent assumptions.
- Attach evidence for all acceptance criteria in the relevant slice.
- Document incompatible requirements and obtain a new ADR decision; never silently substitute another architecture.
- Respect earlier accepted decisions, especially stock Jellyfin compatibility, offline usability, security and user control.

## Verification
See `verification/TEST_MATRIX.md` and the slice-specific exit gate. No passing tests are asserted by this document.
