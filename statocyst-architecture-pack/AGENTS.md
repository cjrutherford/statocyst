# Statocyst coding agent instructions

1. Read `PRODUCT_CONTRACT.md`, `DECISION_REGISTER.md`, relevant ADRs and `roadmap/MILESTONES.md` before work.
2. Work on **one assigned slice**. Do not run ahead. Do not implement a later MVP as a distraction.
3. Preserve the exact user MVP ordering: player first, Jellyfin connected second, Capacitor mobile third, Android Auto fourth, then polish.
4. Keep upstream source, personal overrides and credentials separate. Keep API and runtime assumptions in a risk register until verified.
5. Test actual touched code. Never claim success from a proposed file, mock-only test, or build that was not run.
6. When native or server API access is unavailable, mark the gate BLOCKED and write a reproduction recipe. Do not falsely mark complete.
7. Prefer small changes, explicit interfaces, stable data models and additive migrations. Do not add unrequested dependencies.
8. Record evidence in `evidence/Sxxx-report.md` from template. Include command, exit code, environment, relevant logs and linkable artifacts.
9. If an ADR conflicts with tested reality, document findings and propose a new ADR; do not silently rewrite accepted design intent.
10. After completion, update roadmap status and deferred work separately. Completion means exit gate passed, not that an agent generated code.

## Standard report states
`PLANNED`, `IN_PROGRESS`, `BLOCKED`, `IMPLEMENTED_UNVERIFIED`, `VERIFIED`, `DEFERRED`.
