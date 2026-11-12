# Statocyst

Local-first, Jellyfin-oriented music player. This repository is the **MVP-1 standalone desktop player**: import local audio, play it through Chromium's audio transport, and keep an authoritative queue that survives restarts.

Reference OS for verified evidence: **Ubuntu 26.04.1 LTS under Xwayland**. macOS and Windows are not claimed.

## Stack

| Layer | Choice |
| --- | --- |
| Workspace | Nx 24, pnpm 10 |
| Renderer | Angular 22 standalone, zoneless signals |
| Host | Electron 45 (sandboxed renderer, typed preload bridge) |
| Persistence | Embedded libSQL (`@libsql/client`) with WAL + migration ledger |
| Metadata | `music-metadata` |
| Types | TypeScript 6 compiler API + `tsc-rs` for typecheck targets |
| Tests | Vitest (unit/integration), Playwright Electron (E2E) |
| Packaging | electron-builder (`dir` target on Linux) |

## Requirements

- Node 24 LTS (`fnm use lts-latest` or equivalent)
- pnpm 10 (`corepack enable`)
- `ffmpeg` on `PATH` for the landing-page screenshot update pass
- Linux with X11/Xwayland for the Electron window; the current dev script passes `--no-sandbox` because the SUID sandbox is unavailable in the reference environment

## Run

```bash
pnpm install
pnpm dev          # build renderer + host bundles, then launch Electron
pnpm start        # same via the Nx serve target
```

Data defaults to Electron's `userData` directory. Set `STATOCYST_DATA_DIR=/tmp/statocyst` to isolate a run. Other knobs: `STATOCYST_DEMO_DIR`, `STATOCYST_LOG_CONSOLE=1`, `STATOCYST_RENDERER_URL`, `STATOCYST_DEVTOOLS=1`.

## Verify

```bash
pnpm typecheck    # tsc-rs for every project
pnpm test         # contracts, playback-core, persistence, media-library, host range tests
pnpm exec nx build desktop
node tools/build-electron.mjs

# E2E (needs an X display; evidence is written under evidence/)
XAUTHORITY=... DISPLAY=:0 pnpm exec playwright test --config e2e/playwright.config.ts
```

The E2E test imports the bundled demo (4 tracks), asserts artwork decoding, byte-range media responses, real playback position advance, pause/seek/skip, queue move/remove, settings diagnostics, and restart recovery at the restored position.

## Package

```bash
pnpm package       # electron-builder --dir -> release/linux-unpacked/statocyst
XAUTHORITY=... DISPLAY=:0 node tools/smoke-packaged.mjs
```

The packaged smoke test verifies `app.asar`, the unpacked libSQL native module, demo import, artwork, and playback.

## Landing page

The static marketing page lives in `site/`. The build first runs a screenshot update
pass (real captures → WebP, clip posters, OG image, and two constructed Android Auto
previews), then bakes the latest stable GitHub release into the download shelf:

```bash
pnpm site:screenshots                 # screenshot update pass only
node tools/build-site.mjs --offline   # use the checked-in release snapshot
node tools/build-site.mjs             # use the GitHub API, fall back locally
node tools/build-site.mjs --strict    # CI mode: fail if the API or an asset is missing
node tools/build-site.mjs --no-screenshots  # skip the screenshot pass
python3 -m http.server -d _site 4173  # preview at http://127.0.0.1:4173/
```

Screenshots come from `evidence/`; the Android Auto now-playing and browse previews are
generated from the app's own artwork and type because no DHU capture exists yet. Every
other screen is a real capture. The Pages workflow (`.github/workflows/pages.yml`) uploads `_site/`. The design
direction board is `site/design-preview.html`; it is not part of the deployed site.

## Layout

```
apps/desktop/                 Angular renderer (views, stores, audio engine)
apps/desktop-electron/        Electron main + preload
libs/contracts/               Shared playback contract, schemas, fixtures, bridge types
libs/playback-core/           Pure queue state machine
libs/persistence/             libSQL adapter, migrations, catalog/queue storage
libs/media-library/           Bounded local scan and metadata extraction
e2e/                          Playwright acceptance test
tools/                        Build, dev, fixture generation, packaged smoke
evidence/                     Screenshots, Playwright report, verification log
statocyst-architecture-pack/  Planning pack, slice reports, roadmap
```

## Evidence

MVP-1 slice reports and the roadmap live in `statocyst-architecture-pack/evidence/S000-report.md`–`S005-report.md` and `statocyst-architecture-pack/roadmap/MILESTONES.md`. Screenshots are in `evidence/screenshots/`.

## Known limitations

- Linux is the only validated desktop target; no signed installer or auto-update.
- Local playback uses Chromium `<audio>` (MP3/FLAC/OGG/WAV demo verified), not a native media backend; gapless/crossfade are deferred.
- Custom `statocyst-media:`/`statocyst-art:` schemes must be registered before the first `BrowserWindow`; `schemes.ts` is imported first in the host entrypoint.
- Jellyfin, mobile, Android Auto, sync and recommendations are intentionally not implemented.
- Fixture audio under `fixtures/audio` is generated by `pnpm fixtures` and gitignored; the reproducible demo media lives in `resources/demo`.
