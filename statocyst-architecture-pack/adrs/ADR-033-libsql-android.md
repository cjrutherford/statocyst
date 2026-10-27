# ADR-033 — libSQL on Android: mandatory gate BLOCKED (proposal)

**Status:** BLOCKED (proposal; awaiting user decision)  
**Date:** 2026-10-27  
**Relates to:** ADR-002 (embedded libSQL), S012, S015, MVP-3.

## Finding

The MVP-3 (Capacitor Android) data layer assumes embedded libSQL is available on
Android (ADR-002: "Embedded libSQL across runtimes, validate native support").

Investigation on 2026-10-27 (Ubuntu 26.04 LTS, Android SDK 36, NDK 27.1,
JDK 17/21 via Android Studio) found **no pre-built libSQL Android library**:

- Maven Central: zero artifacts for `libsql`, `turso`, `libsql-android`.
- No `libsql*.so` / `*.aar` / `*.jar` present anywhere on the machine.
- The `@libsql/client` package in this repo is a Node.js client wrapping a
  native Linux `.so`; it cannot run on Android.
- Building from source would require the Rust toolchain (not installed) plus
  NDK cross-compilation for `aarch64-linux-android`/`x86_64-linux-android`,
  then JNI bindings — a major, uncertain engineering effort.

## Options (user decision required)

1. **Cross-compile libSQL from source** (Rust + NDK). Large effort, uncertain
   success; keeps the single-database architecture. Requires installing Rust,
   the Android targets, and writing JNI bindings.
2. **Revisit ADR-002 for Android only**: use Android's built-in SQLite (Room /
   SQLiteOpenHelper) as the Android persistence layer, while keeping libSQL on
   desktop. This silently diverges runtimes and needs an explicit ADR amendment
   (per ADR-002: "never silently swap").
3. **Use the Android Room/SQLiteOpenHelper stack** as the Android data layer,
   sharing the *schema* and repository contracts (from `libs/persistence`) but
   with an Android-specific provider. The Angular/capacitor bridge would talk
   to a native SQLite provider instead of libSQL.

## Recommendation

Per the architecture pack ("If any mandatory gate fails, write a blocking ADR
proposal. Never silently swap the user's libSQL decision"), S012 is marked
BLOCKED and S015/S016/S017 are blocked on it. The user should choose between
options 1–3 before MVP-3 proceeds.

The Capacitor shell (S013) is unaffected and already packages an APK.
