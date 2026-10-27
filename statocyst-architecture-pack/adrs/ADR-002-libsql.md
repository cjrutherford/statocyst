# Embedded libSQL

**Status:** Accepted design intent; implementation unverified unless evidence is linked.  
**Date:** 2026-10-26

## Decision
Embedded libSQL selected for persistent local catalog. Desktop owner is Electron main process; native Android owns database provider. Angular accesses typed bridge only. Early gate: persisted WAL/read concurrency/migrations/vectors on supported binaries. Native integration is NOT demonstrated.

## Required implementation controls
- Before implementing, identify platform-dependent and API-dependent assumptions.
- Attach evidence for all acceptance criteria in the relevant slice.
- Document incompatible requirements and obtain a new ADR decision; never silently substitute another architecture.
- Respect earlier accepted decisions, especially stock Jellyfin compatibility, offline usability, security and user control.

## Verification
See `verification/TEST_MATRIX.md` and the slice-specific exit gate. No passing tests are asserted by this document.
