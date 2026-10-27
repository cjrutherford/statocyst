# Evidence report: S012

- **Status:** BLOCKED
- **Commit/branch:** main (uncommitted working tree; evidence captured 2026-10-27)
- **Environment:** Ubuntu 26.04.1 LTS, Linux x86_64. Android SDK 36, NDK 27.1.12297006, JDK 17 + 21 (Android Studio JBR). Emulator: `Medium_Phone_API_36.1`.
- **Files changed:** `statocyst-architecture-pack/adrs/ADR-033-libsql-android.md` (blocking ADR proposal).
- **Acceptance criteria and actual observations:**
  - **libSQL Android availability:** No pre-built libSQL Android library exists (Maven Central: 0 artifacts for `libsql`/`turso`/`libsql-android`; no `libsql*.so`/`*.aar`/`*.jar` on the machine; `@libsql/client` is a Node.js client wrapping a native Linux `.so`).
  - **Rust toolchain:** Not installed. Available via apt (`rustc 1.93.1` candidate) but cross-compiling libSQL for `aarch64-linux-android`/`x86_64-linux-android` plus JNI bindings is a major, uncertain engineering effort.
  - **NDK:** Available (27.1), but building libSQL from source is not a feasible "spike" within S012 scope.
- **Commands run with exit codes:**
  - Maven Central search for `libsql` / `turso` / `libsql-android` — 0 results.
  - `which cargo rustc` — not found.
  - `find` for `libsql*.so`/`*.aar`/`*.jar` — none.
- **Tests not run (why):** The gate cannot be demonstrated; the gate is BLOCKED by the absence of a libSQL Android SDK.
- **Known limitations and deferred follow-up:** S012, S015, S016, S017 are blocked. S013 (Capacitor shell) is unaffected and the APK builds/runs. See ADR-033 for options.
- **Milestone gate affected:** **MVP-3 — Android libSQL + Media3 feasibility: BLOCKED.** Awaits user decision on options 1–3 in ADR-033.
- **Reviewer and date:** Implementation agent — awaiting human decision, 2026-10-27.
