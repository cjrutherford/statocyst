# Evidence report: S047 — Podcast downloads and offline behavior

**Status:** IMPLEMENTED_UNVERIFIED (pinned offline playback verified; unpinned-error/Range/quota pend S053)
**Date:** 2026-11-08
**Depends on:** S044, S046

## Landed

### Host download/cache

- `DownloadService` now resolves a source in this order:
  1. direct audio via `resolveDirectAudio` (podcast enclosure URL);
  2. Jellyfin stream URL + authorization header;
  3. local/demo file copy.
- `main.ts` provides one `resolveDirectAudio` that revalidates a podcast `media_item.path`
  through `checkHttpUrl` with the local-network setting before any download.
- Podcast pins reuse the existing `.part` → SHA-256 → rename → verified manifest flow,
  quota, Wi-Fi policy, progress events and protected-download eviction rules.
- `CacheManager.prefetch` accepts podcasts and uses the same direct-URL path, so lookahead
  caching is no longer Jellyfin-only.
- Protocol precedence is unchanged: verified download → rolling cache → remote. Podcast
  remote streams are already proxied by S046.
- `removeFeed(deleteDownloads: true)` still removes database rows via cascade; physical
  file cleanup is handled by `DownloadService.remove` when the user removes a pin.

### UI

- Podcast episode rows get a download/remove pin action, disabled while a transfer is in
  progress and using the existing downloads store/queue.
- Offline view now loads downloaded podcast episodes across subscriptions and shows them
  in a separate “Podcast episodes” section with play and remove-download actions.
- The offline empty state only appears when there are neither music tracks nor podcast
  pins.

## Commands and results

| Command | Result |
| --- | --- |
| `pnpm exec tsc-rs --noEmit -p apps/desktop/tsconfig.json` | exit 0 |
| `pnpm exec tsc-rs --noEmit -p apps/desktop-electron/tsconfig.json` | exit 0 |
| `pnpm exec vitest run --config apps/desktop-electron/vitest.config.ts` | 48 passed, 2 skipped |
| `pnpm exec nx build desktop --skip-nx-cache` | success |
| `node tools/build-electron.mjs` | exit 0 |
| `pnpm exec playwright test --config e2e/playwright.config.ts e2e/podcasts.spec.ts` | 1 passed (19 s) |

New host test:

- `DownloadService podcast enclosures`: serves an enclosure from a real local HTTP server,
  downloads it as a verified pin, compares the file bytes with the source and confirms the
  verified-download lookup.

Playwright offline proof:

1. Play a podcast episode from the local feed server.
2. Pin the episode; wait for the “Remove download” state.
3. Stop the HTTP fixture server.
4. Reload the episode via `playEntry`; position advances from the local download with the
   server gone.

Logs:

- `/tmp/statocyst-s047-download-test.log`
- `/tmp/statocyst-s047-electron-test.log`
- `/tmp/statocyst-s047-e2e.log`
- `/tmp/statocyst-s047-desktop-tsc.log`
- `/tmp/statocyst-s047-electron-tsc.log`

## Not verified / next

- An unpinned episode while fully offline should show “Download to listen offline”; the
  protocol returns unavailable and the engine reports an error, but S053 should exercise
  the exact copy/queue behavior.
- Range/seek on a pinned podcast file and quota/Wi-Fi-only accounting use the shared
  download path but are not separately asserted for podcasts yet.
- Feed removal with “delete downloads” physical cleanup is not wired to the host dialog;
  S053 should connect the confirmation and remove files, or document the current
  rows-only behavior.
