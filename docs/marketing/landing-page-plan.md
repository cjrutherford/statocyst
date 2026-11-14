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

- people who already keep a local music library (they may never have heard of Jellyfin);
- people who run Jellyfin and need to know that a stock server works without a plugin;
- podcast listeners who want one player instead of three;
- Android Auto drivers who want their own library in the car;
- self-hosters who value an MIT licence, checksums, and no account.

Secondary audience: people evaluating the project from GitHub who need a reason to
click **Releases** instead of bouncing off the README.

**Reading level and vocabulary.** Assume the reader knows how to listen to music and
nothing else. They may not know what Jellyfin, local-first, open source, a queue, an APK,
an IPA or a checksum is. The page must define each term before asking the reader to act on
it. The detailed rules live in `docs/marketing/copy-guide.md`.

## 2. Positioning

**One line:** Your music. Every depth.

**What the line means:** “Depth” is reach across screens and sources — desktop, tablet,
phone, car and offline — not audio fidelity, bit depth, bass or “deep cuts”. Say that in
plain words near the headline and again in the water-theme section. Never let the tagline
stand alone in a social card or store listing without a clarifier.

**Short version:** Statocyst is a music and podcast player for the library you already
own. Play audio files from your device, or connect a Jellyfin server you run yourself.
Desktop, tablet, phone and Android Auto. One active queue, saved through restarts. No
account with us, no ads, no tracking.

**Definitions the page must carry:**

- **Statocyst** — the balance organ in a jellyfish; a small stone in a fluid-filled sac
  that tells the animal which way is up.
- **Local-first** — the library index, queue, favourites and history live on the device;
  there is no developer-run cloud library or account.
- **Jellyfin** — free, open-source media-server software the user runs on their own
  hardware. Optional; a stock server needs no plugin.
- **Queue** — the ordered list of what plays next, plus the current track and position.
  Music and podcasts each keep a queue; one is active at a time.
- **Open source / MIT** — the source is public and may be used, copied, modified and shared
  with the copyright notice kept. Explain the practical consequence, not just the licence
  name.
- **Manual install, APK, IPA, AppImage, .deb, checksum** — define these where the download
  action is, not in a footnote.

**Proof points, in order:**

1. Local files play without a network. Jellyfin streams from the user’s own server when
   the network is available; downloaded copies play offline.
2. The queue survives restarts and resumes where you left off.
3. Podcasts and video podcasts live beside music, with their own persisted queue.
4. Android Auto browses the indexed library without opening the phone app.
5. The source is MIT; releases include SHA-256 checksums.
6. Honest limits: unsigned builds, Linux is the reference desktop, and the car head-unit
   view is a constructed preview until a DHU run is recorded.

Do not claim gapless, bit-perfect output, cloud sync, CarPlay, or a signed installer. Do not
say “nothing leaves your device” without naming the Jellyfin, podcast-search and optional
artwork-lookup exceptions.

## 3. Design direction — “Low tide at midnight”

The app already owns a deep-water visual language: abyss navy, sonar cyan, violet bloom,
rising motes, caustic sheets. The landing page extends it rather than inventing a second
brand. The page does not assume the metaphor is self-explanatory; the “Why water” section
names the jellyfish organ, explains the depth markers and says plainly that “depth” is not
an audio-quality claim.

The page is a water column read top to bottom:

| Zone | Surface | Twilight | Midnight |
| --- | --- | --- | --- |
| Background | sand light bleeding into deep teal | abyss 900 | abyss 950 |
| Purpose | hero, glossary, theme, screens | features, podcasts, clips | car, ownership, limits, beta |
| Accent | pearl + wet sand | cyan + violet | sea glass + foam |

**Why sand?** A dark sand beach gives the cold neon water a warm edge and keeps the page
from becoming another purple-on-black developer site. Sand appears only at the shore:
the hero horizon and the download/footer shelf. It never becomes a generic beige section.

**Signature details**

- Depth markers instead of section numbers: `SURFACE / 0 m`, then `TWILIGHT / −200 m` to
  `−600 m`, `MIDNIGHT / −800 m` to `−1100 m`, then `LOW TIDE / 0 m` at the download shelf.
  The page explains that these are a reading aid, not an audio measurement.
- Device screenshots framed as thick glass floats, not browser screenshots dropped on a
  dark background.
- A thin foam scallop separating the sand shelf from the water.
- Bubbles are sparse and slow: 12–18 motes, 18–40 s cycles, never in front of text.
- Cyan and violet are reserved for live or interactive things: play state, links,
  progress, focus. Static decoration stays muted.

## 4. Information architecture

1. **Sticky top bar** — symbol, wordmark, `Start here`, `Screens`, `Features`, `Car`,
   `Open source`, `Download`, GitHub link.
2. **Hero** — headline, one-paragraph promise that defines the product without assuming
   Jellyfin, auto-detected direct download button, a link to other platforms and install
   notes, secondary `New here? Start with plain English`, version/licence/checksum
   microcopy, and a one-line explanation of “every depth”. Desktop screenshot with a phone
   overlapping its lower-left corner.
3. **Truth strip** — four plain facts: local playback, own media server, saved queue,
   Android Auto.
4. **Start here** — six short answers: the product, local-first, Jellyfin, the queue,
   “every depth”, open source. This is the page’s glossary and the first thing a newcomer
   should read.
5. **Why water** — the name (jellyfish balance organ), why the theme exists, how the depth
   markers work, and what the colours mean. The page explains the metaphor instead of
   trusting it to land.
6. **Screen system** — Desktop / Tablet / Phone. Real stills only. The car head unit is
   handled in its own section below.
7. **Feature sections** (three alternating bands):
   - *A library that stays yours* — import, local metadata, no account.
   - *One queue, all the way down* — restart recovery, resume, queue editing.
   - *The same library in your pocket* — Jellyfin login, sync, Android media session.
8. **Podcasts** — real discovery and episode-settings captures; directory search,
   subscriptions, resume, skip controls, offline pinning and video episodes.
9. **Clips** — three real Android transition studies (Library into Playlists, Queue and
   Now playing), with a play/pause control and reduced-motion fallback.
10. **Android Auto section** — driver-safe browse, voice, no phone-app cold start, with the
    labelled constructed head-unit preview; the real in-app setup capture stays available.
11. **Open source and ownership** — MIT explained in plain words, checksum explained,
    “no account” explained, source, release notes, honest limitations.
12. **Beta testers** — Google Play and App Store preparation, with “closed beta” and
    “TestFlight” defined; a GitHub issue form collects platform, device, library and car
    testing details.
13. **Download shelf** — sand background, platform cards, latest version, asset names,
    checksums, and install notes that define DMG, AppImage, .deb, APK and IPA.
14. **Footer** — GitHub, releases, privacy, licence, “Named after the jellyfish’s balance
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
- The hero and shelf primary buttons link **directly to the detected platform asset**;
  they must not pretend to download while only scrolling to the shelf. The platform rows
  and the release page remain the fallback if a browser blocks or stalls the asset.
- For iOS, both primary buttons open the iOS install notes, not the IPA. An IPA is not a
  one-tap install, and a stalled IPA download is worse than clear sideloading steps.
- Link `All releases` to `https://github.com/cjrutherford/statocyst/releases`.
- Add install notes: unsigned macOS app (right-click → Open), Windows SmartScreen,
  Linux AppImage `chmod +x`, Android sideload, iOS sideload, and Android Auto
  “Unknown sources” setup.
- Android note: Chrome on Android can finish the APK but leave the download UI at 100%.
  Tell the reader to check Files → Downloads for the complete APK before retrying, and
  offer Firefox or the release page as a fallback. Show the short warning under the hero
  button and the fuller guidance at the shelf. This is a Chrome finalization bug, not a
  corrupt Statocyst file.

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
- Plain-language gate: no undefined jargon; Jellyfin defined before the first download
  ask; “depth” explained wherever the tagline appears alone; offline claims limited to
  local files and downloaded copies; open source explained as a practical right.
  Use `docs/marketing/copy-guide.md` as the checklist.

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
- `site/captures/` — raw PNGs captured from the current 2.2.0 Electron build.
- `site/assets/` — WebP screen captures, three real Android transition clips with posters,
  brand marks, favicons and the 1200×630 OG image (`tools/make-site-og.py`).
- `tools/update-site-screenshots.mjs` — the screenshot update pass: converts the current
  captures in `site/captures/` to WebP, refreshes clip posters, and generates the
  constructed car previews.
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

- Hero, screens and features are current 2.2.0 captures written by
  `tools/capture-site-screenshots.mjs` to `site/captures/`.
- The three clips are real Android captures of the app’s foam transition: Library into
  Playlists, Queue and Now playing. Their top debug captions were cropped out; the page
  labels them as transition studies rather than pretending they are standalone screen tours.
- The car section uses two **constructed Android Auto previews**, generated from the app’s
  own icon, demo cover, type and queue: a now-playing screen and a browse screen. They
  follow the standard Android Auto media surface and the app's real Media3
  `MediaLibraryService` browse tree and shuffle/repeat/heart actions — not the Car App
  Library templates, which Statocyst does not use. They are explicitly labelled
  “constructed”; a DHU capture is still pending.
- Desktop, phone and tablet stills are recaptured from the current 2.2.0 Electron build.
  The phone and tablet stills are the renderer at those widths, not native Android
  emulator captures; a native Android recapture is a follow-up.
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
- A second pass on the mobile hero density, if it still feels cramped at 320–390 px.

## 13. Post-review P0 pass

Fable 5.2's recovered review notes (it hit the provider limit before writing a final
report) drove this pass:

- Added `tools/capture-site-screenshots.mjs` and `site/captures/`; the page now uses
  current **2.2.0** captures instead of the v0.1.0/v0.3.3 evidence images. The phone and
  tablet stills are current renderer layouts at those widths, not native emulator captures.
- Rebuilt both car previews around the standard Android Auto media surface and the real
  `MediaLibraryService` browse categories/actions. Removed the `MediaPlaybackTemplate` /
  `SectionedItemTemplate` claims.
- Fixed the Windows direct-download key (`data-win` vs `dataset.windows`).
- iOS now sends the hero CTA to the download shelf/install notes rather than an
  un-installable direct IPA.
- Replaced the invented “FLAC 24-bit · 44.1 kHz” chip with supported-format copy.
- Replaced the stress-fixture phone/tablet data with current demo captures.

Remaining follow-ups from the review are P1/P2: live native Android recapture, the hero
phone overlap, light/dark balance, download navigation, depth-marker sequence, podcast
visual, small-type/contrast pass, clip timing and autoplay state, and car disclaimer
redundancy.

## 14. Post-review P1 pass

- Added a real podcast section using current discovery and episode-settings captures.
- Added a beta-tester section and GitHub issue form for Google Play / App Store preparation.
- Added a Download nav item and routed the header and hero CTAs to the shelf instead of a
  surprise direct asset download.
- Changed the feature rows to dark-mode albums and queue captures to reduce the light-panel
  imbalance.
- Made the depth markers monotonic and returned the sand shelf to “Low tide / 0 m.”
- Reduced the hero phone size, removed the duplicate hero/feature phone image, raised small
  type, fixed the sand focus ring, made clips click-to-play, expanded the car tab targets and
  added a full-size car preview link.
- Removed the duplicate car disclaimer and fixed the callout specificity.
- Replaced internal-note/jargon copy and extended the beta meta description.

## 15. P2 polish pass

- Branded 1200×630 OG card (`tools/make-site-og.py`) with the symbol, wordmark, headline
  and current desktop capture; the screenshot pass no longer overwrites it with a raw crop.
- 96px header/footer mark instead of loading the 512px brand image above the fold.
- JSON-LD `SoftwareApplication` metadata, `robots.txt` and `sitemap.xml`.
- Removed the eager browse-SVG warm-up; car previews load only when needed.
- Added `role="group"` to labelled non-landmark blocks, made the car tabpanel focusable,
  and kept the figure caption last.
- Added a full-size car preview link for narrow screens.

## 16. Native Android recapture

The phone and tablet stills had been Electron renderer captures at those widths. They are
now native captures from `Medium_Phone_API_36.1` (Android 16, 1080 × 2400 at 420 dpi):

- Built the current debug APK (`assembleDebug` with the Android Studio JBR 21), installed it
  and seeded the four branded fixture tracks with `tools/android-seed-fixtures.py --demo`.
  The script now uses real file sizes and has a demo mode separate from its 12-row layout
  fixtures.
- Set the app to Settings → Appearance → Dark and the emulator to `cmd uimode night yes` so
  the status bar matches the dark theme, then captured the library (Sonar Bloom paused),
  now playing and the queue with `adb exec-out screencap`.
- Captured the tablet at 2048 × 1648 px / 320 dpi so the app laid out at 1024 × 768 dp, then
  cropped the 48 px status bar and 64 px navigation bar before downscaling. The delivered
  tablet still is exactly 1024 × 768.
- Updated the captions to “Android · library” and “Android tablet · landscape”, and the
  phone image aspect to 390 × 867.
- The recipe lives in the README under “Android stills”.

Remaining capture gap: the Android Auto previews are still constructed; a Desktop Head Unit
capture is the next honest upgrade.

## 17. Plain-language pass

The page had grown a private vocabulary: “every depth” assumed the reader had seen the
water theme, “local-first” and “Jellyfin” were used before they were defined, and “nothing
leaves your device” was too broad once a Jellyfin stream, a podcast search or the optional
artwork lookup was in play. This pass fixes the language, not the design.

- Added **Start here**, a six-card glossary that defines the product, local-first, Jellyfin,
  the queue, “every depth” and open source before the reader reaches the features.
- Added **Why water**, which explains the name (the jellyfish balance organ), the water
  column, the depth markers and the colour rules. It says explicitly that “depth” is not an
  audio-quality claim.
- Rewrote the hero, truth strip, features, podcasts, car, open-source, beta and download
  copy in plain language. Jellyfin is now defined as free, self-hosted media-server software
  and marked optional. “One queue” now says one active queue at a time, because music and
  podcasts keep separate queues.
- Moved the open-source explanation beyond the label: MIT, checksums and “no account” each
  get a plain-language paragraph. The limits are explained before the install steps.
- Replaced the hardcoded `2.2.0` in the screens copy with `{{VERSION}}` so the page does not
  go stale.
- Rewrote the install notes to define DMG, AppImage, .deb, APK and IPA, and to explain why
  the OS warns about unsigned builds.
- Updated the README, privacy policy, Play listing and social card to use the same
  definitions. The rules are in `docs/marketing/copy-guide.md`.

The guiding rule: **assume the reader knows how to listen to music, and nothing else.**
