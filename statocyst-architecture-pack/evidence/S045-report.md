# Evidence report: S045 — Podcast library and discovery UI

**Status:** IMPLEMENTED_UNVERIFIED (E2E flow verified; a11y/10k/performance and mobile gates pending S053/S048+)
**Date:** 2026-11-08
**Depends on:** S044, S046

## Landed

### Navigation and store

- New `View = 'podcasts'` and sidebar destination with an unplayed badge.
- `PodcastsStore`:
  - feeds, selected show, episodes, Continue Listening and New Episodes;
  - add by URL, refresh one/all, per-show settings, played/unplayed;
  - keyless Apple/Fyyd directory search, source labels and one-tap subscribe;
  - discovery landing (top chart, categories, category rows) and a downloaded-episode pool;
  - change-event subscription and reload.
- `PodcastPlaybackStore` mirrors the podcast context, plays an episode with the show/list
  as context, and exposes play/pause, seek, skip, rate, enqueue and queue removal.

### Podcasts view

- Home: **Subscribed**, **Downloaded** and **Discovery** tabs.
- Subscribed: Continue Listening shelf, New Episodes shelf, subscription grid, refresh
  status, unplayed/failed badges, empty state.
- Downloaded: verified pinned podcast episodes with play, remove download, mark played and
  open-show actions.
- Discovery: Top podcasts row from Apple's keyless iTunes top-podcast chart resolved through
  iTunes lookup, a category grid (27 categories in the emulator run) and category rows
  derived from the chart's own genres, plus secondary Apple/Fyyd search. One-tap subscribe;
  no feed/site URL field, OPML import or user API-key form.
- Show detail: cached feed artwork, description, Play latest, Refresh, show settings
  (interval, default speed, skip intro/outro, episode sort, auto-queue), unsubscribe with
  an inline two-step confirm.
- Episode list: filters (all/unplayed/in progress), play/pause, progress bar, played check,
  mark played/unplayed, add to podcast queue, show notes and safe external links.
- Feed and episode artwork use the host's local artwork cache; remote feed images are not
  hotlinked. Subscribe passes the directory cover as a fallback so feeds without their own
  image still get artwork, and missing covers on older subscriptions are repaired when the
  same show appears in a directory result.
- Verified on the Android emulator: a real subscription renders covers in the subscription
  grid, episode rows, show detail and the now-playing bar.
- Discovery and search payloads persist for 30/15 minutes; directory images are cached by the
  host (300 px Apple variants) and rendered from local artwork URLs, not remote hotlinks.
- Motion follows the shared vocabulary: Podcasts tab switches use the same `foamChange`
  bubble wipe as Settings (with arrow/Home/End tab keys), sections use `rise`, cards use
  `card-in` with a 24 ms stagger, and the global reduced-motion override degrades both.
- Music separation: the podcast view is independent of the music library/albums/radio;
  the music store ignores podcast events.

### Player bar and settings

- Player bar switches to podcast mode when the podcast context is active: podcast tag,
  episode metadata, play/pause/previous/next, ±15/30 s skip, speed cycle, global volume.
- Clicking the podcast track opens the Podcasts view; music mode keeps Now Playing/Queue.
- General Settings adds podcast refresh-on-launch and allow-local-network toggles.
- `app.openExternal` bridge method opens allow-listed HTTP(S) links through the OS shell.

### Privacy

- Feed artwork is cached by the host and served through `statocyst-art://feed/<id>`; the
  show view no longer hotlinks publisher images. Track artwork prefers a local cached path
  before a remote Jellyfin image.
- External links are validated and opened outside the app.

## Commands and results

| Command | Result |
| --- | --- |
| `pnpm exec tsc-rs --noEmit -p apps/desktop/tsconfig.json` | exit 0 |
| `pnpm exec tsc-rs --noEmit -p apps/desktop-electron/tsconfig.json` | exit 0 |
| `pnpm exec nx build desktop --skip-nx-cache` | success |
| `node tools/build-electron.mjs` | exit 0 |
| `pnpm exec playwright test --config e2e/playwright.config.ts e2e/podcasts.spec.ts` | 1 passed (17 s) |

The Playwright flow (`e2e/podcasts.spec.ts`) starts a real local feed/audio server and:

1. enables local-network feeds through the bridge;
2. opens Podcasts → Discover → searches the mock directory for `deep` and subscribes to the
   result in one tap;
3. asserts the show heading and two episodes;
4. plays the first episode, waits for real position advance and the active podcast context;
5. marks it played and sees the unplayed state flip;
6. switches to Library and confirms the podcast player bar persists;
7. returns to Podcasts, changes the default speed to 1.5 and confirms it persists;
8. unsubscribes through the inline confirmation and sees the empty state.

Screenshot:

- `evidence/screenshots/s045-podcasts.png`

Logs:

- `/tmp/statocyst-s045-desktop-tsc.log`
- `/tmp/statocyst-s045-electron-tsc.log`
- `/tmp/statocyst-s045-desktop-build.log`
- `/tmp/statocyst-s045-electron-build.log`
- `/tmp/statocyst-s045-e2e.log`

## Not verified / next

- No keyboard/screen-reader audit or 10k-episode windowing measurement yet; S053 owns the
  full accessibility/performance gate.
- Mobile podcast UI is gated by S048/S050 (bridge absent today, so the view shows a
  desktop-host explanation).
- Podcast Now Playing is represented by the player bar and Podcasts view; a dedicated
  immersive Now Playing podcast layout is deferred to polish.
- Download/pin controls are S047.
