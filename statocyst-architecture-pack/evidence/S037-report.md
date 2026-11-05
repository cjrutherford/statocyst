# Evidence report: S037 (partial) — Downloads visibility

**Status:** PARTIAL / IMPLEMENTED_UNVERIFIED
**Date:** 2026-11-05
**Branch:** feature/rural-offline-parity

## Landed
- Settings → Storage download rows show size and quality profile (`24.3 MiB · saver`).
- Offline rows show `Pinned · saver/balanced/original`.
- The renderer retains the per-track profile from `listDownloads`, so the UI can audit
  what each pin actually costs.

## Still open — the core of S037
- WorkManager with unmetered/charging constraints and rescheduling after Android 15's
  6-hour dataSync cap and after reboot.
- Foreground service only while transferring.
- Per-item pause/resume/retry/delete on a dedicated Downloads screen with undo.
- The current floating status card remains the primary progress surface.
