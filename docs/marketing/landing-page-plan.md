# Statocyst landing page — plan

Status: **first draft built**; direction approved, implementation under review
Owner: marketing / web
Preview: `site/design-preview.html`
Production page: `site/index.html` → `_site/`

## 1. Objective

Give a first-time visitor one clear action — download the current release — and enough
visual proof that Statocyst is a real, polished player on every screen they care about:
desktop, phone/tablet, and the car.

The page is a static site on GitHub Pages for now. It should not require a build step,
a backend, cookies, or a third-party analytics script.

Primary audience:

- people who already keep a local music library or run Jellyfin;
- podcast listeners who want one player instead of three;
- Android Auto drivers who want their own library in the car;
- self-hosters who value an MIT licence, checksums, and no account.

Secondary audience: people evaluating the project from GitHub who need a reason to
click **Releases** instead of bouncing off the README.

## 2. Positioning

**One line:** Your music. Every depth.

**Short version:** A local-first music and podcast player for the files you own and the
Jellyfin library you built — on desktop, phone, tablet, and in the car. One queue.
No cloud account. Nothing leaves the device unless you ask it to.

**Proof points, in order:**

1. Local files and Jellyfin play without a network.
2. The queue survives restarts and resumes where you left off.
3. Podcasts and video podcasts live beside music, with their own persisted queue.
4. Android Auto browses the indexed catalog without starting the WebView.
5. The source is MIT; releases include SHA-256 checksums.
6. Honest limits: unsigned builds, Linux is the reference desktop, and the car head-unit
   view is a constructed preview until a DHU run is recorded.

Do not claim gapless, bit-perfect output, cloud sync, CarPlay, or a signed installer.

## 3. Design direction — “Low tide at midnight”

The app already owns a bathypelagic visual language: abyss navy, sonar cyan, violet
bloom, rising motes, caustic sheets. The landing page extends it rather than inventing a
second brand.

The page is a water column read top to bottom:

| Zone | Surface | Twilight | Midnight |
| --- | --- | --- | --- |
| Background | sand light bleeding into deep teal | abyss 900 | abyss 950 |
| Purpose | hero, promise, download intent | features and screen proof | downloads, honesty, footer |
| Accent | pearl + wet sand | cyan + violet | sea glass + foam |

**Why sand?** A dark sand beach gives the cold neon water a warm edge and keeps the page
from becoming another purple-on-black developer site. Sand appears only at the shore:
the hero horizon and the download/footer shelf. It never becomes a generic beige section.

**Signature details**

- Depth markers instead of section numbers: `SURFACE / 0 m`, `TWILIGHT / −200 m`,
  `MIDNIGHT / −1000 m`.
- Device screenshots framed as thick glass floats, not browser screenshots dropped on a
  dark background.
- A thin foam scallop separating the sand shelf from the water.
- Bubbles are sparse and slow: 12–18 motes, 18–40 s cycles, never in front of text.
- Cyan and violet are reserved for live or interactive things: play state, links,
  progress, focus. Static decoration stays muted.

## 4. Information architecture

1. **Sticky top bar** — symbol, wordmark, `Screens`, `Features`, `Download`, GitHub link.
2. **Hero** — headline, one-paragraph promise, auto-detected download button, secondary
   `See every screen`, version/licence/checksum microcopy. Desktop screenshot with a
   phone overlapping its lower-left corner.
3. **Truth strip** — four facts: local playback, Jellyfin, queue persistence, Android Auto.
4. **Screen system** — Desktop / Tablet / Phone. Real stills only. The car head unit is
   handled in its own section below.
5. **Feature sections** (three alternating bands):
   - *A library that stays yours* — import, local metadata, no account.
   - *One queue, all the way down* — restart recovery, resume, queue editing.
   - *The same library in your pocket* — Jellyfin login, sync, Android media session.
6. **Clips** — three real Android transition studies (Library into Playlists, Queue and
   Now playing), with a play/pause control and reduced-motion fallback.
7. **Android Auto section** — driver-safe browse, voice, no WebView cold start, with the
   labelled constructed head-unit preview; the real in-app setup capture stays available.
8. **Built in the open** — MIT, source, checksums, release notes, honest limitations.
9. **Download shelf** — sand background, platform cards, latest version, asset names,
   checksums, install notes for unsigned builds.
10. **Footer** — GitHub, releases, privacy, licence, “Named after the jellyfish’s balance
   organ.”

## 5. Asset plan

### Existing and usable now

| Asset | Source | Use |
| --- | --- | --- |
| Desktop dark library | `evidence/screenshots/09-review-dark.png` | hero / desktop still |
| Desktop light library + player | `evidence/screenshots/03-library-playing.png` | light-mode proof |
| Desktop now playing | `evidence/screenshots/04-now-playing.png` | feature band |
| Desktop queue | `evidence/screenshots/05-queue.png` | queue feature |
| Phone dark now playing | `evidence/s015/phone-dark-2-nowplaying.png` | phone still |
| Phone dark library | `evidence/s015/phone-dark-1-library.png` | phone library |
| Tablet landscape library | `evidence/s015/tablet-landscape-1-library.png` | tablet still |
| Podcast discovery | `evidence/screenshots/s045-podcast-discovery.png` | podcast feature |
| Podcast show | `evidence/screenshots/s045-podcasts.png` | podcast feature |
| Android playback | `evidence/screenshots/s029-android-playback.png` | mobile proof |
| Mobile clips (6) | `release/s041-videos/*.mp4`, 390×844, 3.8–7.9 s | phone video cards |
| App icon / symbol | `resources/icons/statocyst-512.png`, branding pack | favicon, OG, car art |

### Gaps to fill before launch

1. **Desktop video** — 20–30 s capture at 1440×900: launch → library → play → queue →
   now playing → resume. Record with Playwright/Electron under Xvfb; export H.264 MP4 +
   WebM, muted, with a poster frame.
2. **Car stills and video** — the only car-related capture in the repo is the settings
   page (`s011-car-settings.png`), not the head-unit UI. Capture through Google’s Desktop
   Head Unit (`tools/dhu.sh`) against the emulator; save browse, now playing, and queue.
   Until that run exists, the page uses a clearly labelled **reconstructed Android Auto
   preview**, not a fake screenshot.
3. **Tablet video** — optional; a still is sufficient for v1.
4. **Podcast video still** — capture a 16:9 video-podcast frame from the current build.
5. **OG image** — 1200×630: symbol, wordmark, “Your music. Every depth.”, sand/abyss
   horizon. Generate from the same tokens as the page.
6. **Favicons** — 32, 180, 192, 512 and `site.webmanifest`.

### Encoding rules

- Screenshots: AVIF + WebP + PNG fallback, 2× for hero only.
- Video: H.264 MP4 (broad support) + WebM/VP9; no audio track; 8–12 s loops; poster JPG.
- Strip EXIF and any local paths from screenshots.
- Keep each loop under 2 MB; lazy-load everything below the hero.
- Do not upscale the 390×844 clips. Display them at phone size.
- Self-host WOFF2 subsets for Space Grotesk, Inter and JetBrains Mono; preload the
  display weight and use `font-display: swap`. Do not call a font CDN from the page.

## 6. Release downloads

The page should never go stale.

- On load, `fetch` the GitHub API endpoint
  `https://api.github.com/repos/cjrutherford/statocyst/releases/latest`.
- Map assets by suffix:
  - Linux: `.AppImage`, `.deb`
  - macOS: `mac-arm64.dmg`, `mac-arm64.zip`
  - Windows: `win-x64.exe`
  - Android: `.apk`, `.aab`
  - iOS: `.ipa`
  - checksums: `SHA256SUMS*`
- Render the version, publish date, asset names, and sizes from the response.
- If the API fails or is rate-limited, fall back to the static links for `v2.2.0`.
- Detect the visitor’s platform and promote that card, but keep every platform visible.
- Link `All releases` to `https://github.com/cjrutherford/statocyst/releases`.
- Add install notes: unsigned macOS app (right-click → Open), Windows SmartScreen,
  Linux AppImage `chmod +x`, Android sideload, iOS sideload, and Android Auto
  “Unknown sources” setup.

Do not proxy or mirror release binaries. Always link to GitHub release assets.

## 7. Build and repository layout

Static, no framework, no bundler:

```
site/
  index.html
  styles.css
  main.js
  assets/
    branding/       symbol, wordmark, favicons, og.png
    screens/        avif/webp/png stills
    video/          mp4/webm loops + posters
  design-preview.html   (this review artifact; remove before launch or keep under /design)
.github/workflows/pages.yml
```

Use relative URLs so the site works at `https://cjrutherford.github.io/statocyst/` and
on a future custom domain. No absolute `/assets` paths.

The GitHub Pages workflow runs `tools/build-site.mjs` and uploads `_site/` as the artifact on
pushes to `main`, with `actions/configure-pages`, `actions/upload-pages-artifact`, and
`actions/deploy-pages`. It also runs when the Release workflow completes, because a
release created with the default `GITHUB_TOKEN` does not trigger another workflow.
Keep the existing release workflow untouched.

## 8. Quality gates

- Lighthouse (mobile): performance ≥ 95, accessibility ≥ 95, best practices ≥ 95.
- No layout shift from images or video posters; explicit dimensions everywhere.
- Keyboard-complete: skip link, visible focus, tabs implemented as buttons with
  `aria-selected`, no keyboard traps.
- `prefers-reduced-motion`: stop bubbles, caustics, parallax, and autoplay; show posters.
- Colour contrast: body text ≥ 4.5:1 on abyss and on sand; check muted text.
- Videos: `muted`, `playsinline`, `loop`, poster, pause when offscreen, no sound.
- Works with JavaScript disabled: downloads still visible via static links.
- Test at 360, 390, 768, 1024, 1440, and 1920 px.
- Validate HTML and check for 404s in all asset paths.

## 9. Measurement

No third-party analytics in v1. Use GitHub release asset download counts and repository
traffic insights as the signal. Add a privacy-friendly counter later only if the user
asks for it.

## 10. Delivery phases

| Phase | Output | Done when |
| --- | --- | --- |
| 0. Direction | this plan + `design-preview.html` | direction approved |
| 1. Shell | static hero, nav, download shelf, footer | responsive, no console errors |
| 2. Assets | optimised stills, desktop/phone loops, OG image | all `<img>`/`<video>` have dimensions and posters |
| 3. Content | feature bands, honesty section, install notes | copy reviewed against product contract |
| 4. Pages | `pages.yml`, relative paths, 404s checked | site reachable on github.io |
| 5. Car | DHU capture replaces the real setup-screen stand-in | real head-unit stills/loop in place |

## 11. Decisions taken

1. Keep the sand/abyss “low tide at midnight” direction and the sand release shelf.
2. Do not invent screens except the car head-unit view. That one is a clearly labelled
   constructed preview; every other screen is a real capture. A DHU capture is still pending.
3. Ship on the `github.io` project URL first; revisit a custom domain later.
4. Keep the design preview in the repo as `site/design-preview.html`.

## 12. First draft — implemented

The first draft is in `site/` and builds to `_site/`.

- `site/index.html` — production page with real captures, plus the one labelled car mock.
- `site/styles.css` — low-tide design system, self-hosted WOFF2 fonts, responsive layout.
- `site/main.js` — platform-aware download CTA, lazy clip playback, reduced-motion guard.
- `site/assets/` — WebP screen captures, three real Android transition clips with posters,
  brand marks, favicons and the 1200×630 OG image.
- `tools/update-site-screenshots.mjs` — the screenshot update pass: converts the real
  captures in `evidence/` to WebP, refreshes clip posters, rebuilds the OG image, and
  generates the constructed car preview.
- `tools/make-car-mock.mjs` — generates the two Android Auto SVGs
  (`car-head-unit-now-playing.svg`, `car-head-unit-browse.svg`) from the app icon, demo
  cover and self-hosted fonts.
- `tools/build-site.mjs` — runs the screenshot pass, fetches the latest stable GitHub
  release, and bakes asset URLs, names, sizes and checksums into `_site/index.html`; uses
  `site/release-fallback.json` offline and fails in `--strict` mode (CI). Add
  `--no-screenshots` to skip the visual pass.
- `.github/workflows/pages.yml` — builds on pushes to `main`, publishes, and rebuilds when
  a release is published.

### Capture policy in this draft

- Hero, screens and features are real captures from the repository.
- The three clips are real Android captures of the app’s foam transition: Library into
  Playlists, Queue and Now playing. Their top debug captions were cropped out; the page
  labels them as transition studies rather than pretending they are standalone screen tours.
- The car section uses two **constructed Android Auto previews**, generated from the app’s
  own icon, demo cover, type and queue: a MediaPlaybackTemplate now-playing screen and a
  SectionedItemTemplate browse screen. They follow the official Android Auto media
  templates and are explicitly labelled “constructed”; a DHU capture is still pending.
- CarPlay is **not implemented**, so no CarPlay screen is shown. Rendering one would imply
  a platform the app does not support; the approval for constructed car mocks is limited to
  the Android Auto surface.
- The real **Settings → Car and Android Auto** capture remains in `evidence/` as the
  reference for the in-app setup flow. The car mock is the only constructed screen; all
  other page screens are real captures.

### Still missing

- Desktop motion capture (the clip section is Android-only in this draft).
- A real head-unit still/video from the Desktop Head Unit to replace the constructed car
  previews.
- A CarPlay preview, only once CarPlay is actually implemented or explicitly labelled as a
  roadmap mock.
- A podcast/video-podcast visual that is not obscured by the bubble transition overlay.
- A second pass on the mobile hero density, if it still feels cramped at 320–390 px.
