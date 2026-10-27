# Statocyst — Architecture & Agent Execution Pack v1.0

Planning baseline dated 2026-10-26. **Specification, not implemented software.** Nothing in this packet asserts libSQL Android/iOS viability, Android Auto approval, Jellyfin endpoint semantics, or a passing build. All must be demonstrated by their spikes and tests.

## The staged MVP contract (supersedes the previous sequence)

1. **MVP-1: Standalone Player** — play a user-selected local audio file on desktop, with a real persistent queue and controls, no Jellyfin required.
2. **MVP-2: Jellyfin Connected** — authenticate against *stock* Jellyfin, synchronize/browse a music catalog, and play server audio on desktop.
3. **MVP-3: Capacitor Mobile** — use the Angular UI on Android through Capacitor, with Media3 owning native playback and background session lifecycle.
4. **MVP-4: Android Auto** — headless MediaLibraryService exposes browsable local catalog and queue, with real-device/automotive validation.
5. **Polish / Daily Driver** — offline downloads, adaptive cache, reconnection, UX, accessibility, diagnostics, reliable packaging and resilience.
6. **Progressive expansion** — Statolith recommendations, multi-server federation, richer synchronization, extensions, iOS/CarPlay, etc.

Each MVP is a **vertical slice and independently demonstrated stage**, never implied by a mock or compilation alone. Scope of MVP-1 is desktop; Android-native and libSQL feasibility spikes may be conducted early to de-risk the plan but are not blockers to desktop local playback except for explicit architecture-risk escalation.

## Navigation
- `PRODUCT_CONTRACT.md`: outcomes, invariants, non-goals and MVPs.
- `DECISION_REGISTER.md`: all 30 user-accepted decisions, and the final staged-MVP amendment.
- `adrs/`: consolidated architecture decisions, clearly flagging implementation validation gates.
- `roadmap/MILESTONES.md`: milestone-by-milestone completion conditions.
- `slices/`: bounded agent work packets, one at a time.
- `AGENTS.md`: execution contract for coding agents.
- `contracts/`: initial language-neutral playback, queue and capability contracts.
- `sql/`: **illustrative pre-implementation database sketch**; not ready to run as a migration.
- `spikes/`: cross-platform and external API validation checklist.
- `verification/`: verification matrix and reproducible evidence format.
- `DEFERRED_FEATURES.md`: advanced features kept out of early MVPs.

## Governance
An ADR is accepted as a *design intent*, not proof its implementation works. Do not silently replace embedded libSQL with another database; if unsupported, stop, report evidence, and request a formal architecture amendment. Keep product claims narrower than verified evidence.
