# Connectivity and downloads

**Status:** Accepted design intent; implementation unverified unless evidence is linked.  
**Date:** 2026-10-26

## Decision
Adaptive network policy uses buffer health and throughput, not latency-only state. Rolling cache configurable (2 GiB illustrative default), user-selected protected downloads. Verified offline status only. Distinct LAN/VPN/WAN endpoint validation and secure fallback.

## Required implementation controls
- Before implementing, identify platform-dependent and API-dependent assumptions.
- Attach evidence for all acceptance criteria in the relevant slice.
- Document incompatible requirements and obtain a new ADR decision; never silently substitute another architecture.
- Respect earlier accepted decisions, especially stock Jellyfin compatibility, offline usability, security and user control.

## Verification
See `verification/TEST_MATRIX.md` and the slice-specific exit gate. No passing tests are asserted by this document.
