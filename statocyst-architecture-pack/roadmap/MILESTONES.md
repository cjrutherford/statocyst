# Milestone gates — amendment to earlier MVP plan

## MVP-1 — Standalone Desktop Player (S000–S005)
**Status: VERIFIED (2026-10-27), reference OS: Ubuntu 26.04.1 LTS / Xwayland.** Evidence: `evidence/S000-report.md`–`evidence/S005-report.md`, `evidence/verification.log`, `evidence/screenshots/`.

A local file can be selected and played with real controls and a persistent queue, with no Jellyfin. This is **player first**. Desktop reference OS should be chosen by agent based on available build machine and documented, not assumed to represent all desktop OSes. Embedded libSQL must have a working local persistence path; if it does not, architecture is blocked, not silently replaced.

## MVP-2 — Jellyfin Connected Desktop (S006–S011)
Connect to stock Jellyfin with standard auth, safely store credentials, browse paginated catalog, stream real music, handle server down and restore local mode. No optional plugin needed.

## MVP-3 — Capacitor Android Mobile (S012–S017)
Angular app runs as Capacitor Android client. Native Media3 owns background playback; local catalog/queue and controls survive UI teardown. Android libSQL spike gate prior to dependent implementation.

## MVP-4 — Android Auto (S018–S023)
Native MediaLibraryService provides browser hierarchy and play commands without booting WebView. Native service reads locally persisted data, supports offline state appropriately; instrumented and automotive test evidence.

## Polish / Daily Driver (S024–S029)
Verified offline downloads, adaptive cache, UI accessibility, logs, reconnect, packaging and recovery. These features are **not implied** by merely completing MVP-4.

## Follow-on roadmap (plan separately)
Intelligence, federation, multi-device enhanced sync, extensibility, iOS/CarPlay, localization expansion and mature release infra. Design intent already approved, implementation remains gated.

## Criteria for progressing
Each milestone: all slices VERIFIED, meaningful end-to-end demo on real target runtime, no unresolved critical security/data-loss defect, evidence manifest completed, explicit release readiness decision. Scope changes need record in ADR/deferred register.
