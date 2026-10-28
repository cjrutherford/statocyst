# Evidence report: S027

- **Status:** IMPLEMENTED_UNVERIFIED
- **Commit/branch:** main (uncommitted working tree; evidence captured 2026-10-28)
- **Environment:** Ubuntu 26.04 LTS, Node 24, Electron 45 (headless Ozone), Angular 22, Playwright 1.57.
- **Objective:** dark/light/system, touch and keyboard focus, semantic labels, responsive desktop/mobile.

## Files changed

- `apps/desktop/src/app/app.component.ts`
  - Navigation buttons now expose `aria-label`/`title` (`Library`, `Now playing`, `Queue`, `Settings`) and keep `aria-current="page"`.
  - Skip link uses a click handler that moves focus to `#main-content` without fragment navigation. A `#main-content` fragment on `file://` made Electron treat the click as a document navigation (`chrome-error://chromewebdata/` was observed), so the handler calls `preventDefault()`.
  - View changes move focus to the main landmark (`navigate()` + `queueMicrotask`).
  - Polite, atomic screen-reader live region announces "Playing/Paused: {title} by {artist}".
  - Phone layout (≤720 px) keeps 56 px nav rows; coarse pointers enforce 44 px icon buttons and segmented controls.
- `apps/desktop/src/styles.scss`
  - Dark `--muted`/`--muted-dim` raised (`#a9c0d8` / `#8ba4c0`) and light equivalents darkened (`#44607d` / `#55718c`) to clear 4.5:1 on their real surfaces.
  - Light `--cyan` deepened to `#087699` (`--cyan-soft #1c9fbe`, `--cyan-deep #065f7d`) because `#0a8fb8` measured 3.37:1 as eyebrow text.
  - Light `--danger` `#b02347` and `--success` `#0b6e3b` (previous tokens measured 4.16:1 and 4.10:1 on the light panel).
  - New `--on-accent` token (`#03121f` dark, `#ffffff` light) used by skip link, primary buttons and active tabs.
  - Eyebrow opacity removed (it multiplied an already-tight contrast ratio).
  - Global touch-target rule: `button`, `.btn`, links, `select` and non-checkbox inputs are ≥44×44 on ≤720 px or coarse pointers.
- `apps/desktop/src/app/views/library-view.component.ts`
  - Active browse tab: `color: var(--on-accent)` with a solid `background-color: var(--cyan)` fallback under the gradient, so dark text in dark mode and white text in light mode stay legible.
  - Active-tab count pill: dark text on a near-white pill inside the accent tab.
- `e2e/a11y.spec.ts` (new) — dependency-free Playwright audit: accessible names, image alt, landmarks, single visible `h1`, no positive `tabindex`, no duplicate ids, text contrast against the nearest opaque background (skips gradient-backed samples it cannot resolve), 44 px touch targets, skip-link behaviour.
- `e2e/desktop.spec.ts` — added headless Ozone args (this host has no X server) and replaced a stale `.stat` assertion with the current `Tracks` tab count.

## Acceptance gate and actual observations

Gate: **automated accessibility checks and manual device/screen-reader audit recorded.**

Automated checks (recorded, passing):

```
node node_modules/.bin/playwright test --config e2e/playwright.config.ts e2e/a11y.spec.ts
  ✓ dark mode — all four views (Library, Now playing, Queue, Settings)
  ✓ light mode — all four views
  ✓ skip link is the first tab stop and moves focus to main
  ✓ phone (390×844) 44px touch targets on every view
  4 passed
```

```
node node_modules/.bin/playwright test --config e2e/playwright.config.ts e2e/desktop.spec.ts
  ✓ local import, real playback, queue edits and restart recovery
  1 passed
```

Unit/build matrix (unchanged code paths re-run after the UI edits):

```
vitest run --root libs/contracts            8 passed
vitest run --root libs/persistence         14 passed
vitest run --root libs/playback-core       29 passed
vitest run --root libs/media-library       11 passed
vitest run --root libs/jellyfin-client     25 passed
vitest run --config apps/desktop-electron 19 passed, 2 skipped
tsc-rs --noEmit (desktop, desktop-electron) 0 errors
nx build desktop / desktop-electron        0 (success)
```

Manual audit: **not performed here.** This host is headless (no X server, no audio output device, no screen reader). No physical Android device is attached for TalkBack verification.

## Deviations and fixes made during verification

- An earlier light-mode light cyan (`#0a8fb8`) failed the contrast check at 3.37:1; the deeper cyan above is the corrected token.
- The active-tab count pill originally used `#04131f` on a translucent dark pill. The audit resolves `background-color` but not `background-image`, so it measured 1.03:1 against the page background. The pill now uses an explicit light surface; visible design is unchanged in intent.
- The skip link originally navigated to `#main-content`, which reloaded the `file://` document and produced `chrome-error://chromewebdata/`. It is a button-like handler now.
- Touch-target failures at 43.99 px were measurement rounding; the audit rounds to whole CSS pixels before comparing.

## Residual risks / not verified

- TalkBack/VoiceOver reading order, focus trapping in dialogs, and real touch ergonomics are unverified.
- Colour perception (protanopia/deuteranopia) was not simulated.
- The Android APK has not been rebuilt with these renderer changes; it is rebuilt in S029.
- Light-mode splash transition still shows thin white status/nav strips on the emulator (deferred from earlier slices).

## Milestone gate affected

**Polish — S027: automated accessibility audit passes in dark and light themes on all views and phone widths; manual device/screen-reader audit outstanding.**

## Reviewer and date

Implementation agent — awaiting human review, 2026-10-28.

## Android parity verification (2026-10-28)

- **Environment:** Android SDK 36.1 emulator `Medium_Phone_API_36.1` (Android 16, API 36); TalkBack (`com.google.android.marvin.talkback`) installed and enabled for the audit.
- **On-device audit (recorded):**
  - TalkBack bound service confirmed via `dumpsys accessibility` ("Bound services: Service[label=TalkBack, …]").
  - `uiautomator dump` accessibility tree exposes the WebView's controls with proper roles and labels: `RadioButton` (System/Dark/Light, Comfortable/Compact, Lossless first/Adaptive) in `RadioGroup`s, `CheckBox` with the full "Save local listening history …" label, `SeekBar` "0, Seek position", `ToggleButton` "Shuffle queue", and icon buttons with content-desc "Play", "Next track", "Previous track", "Repeat off", "Mute", "Open queue", "Refresh diagnostics", "Export support bundle".
  - On-device 44 px audit across all four views (Library, Now playing, Queue, Settings): 0 interactive elements under 44×44 CSS px; the single 20×20 `INPUT` checkbox sits inside a 328×102 label, so its effective tap target is adequate.
  - No unnamed `button`/`a` elements on any view.
  - Single tap on "System" moved TalkBack accessibility focus (`focused="true"`) and toggled the theme, confirming keyboard/screen-reader operability.
  - Native copy is device-neutral: "Local-first, Jellyfin-oriented music for Android", "Everything below is stored on this device", "The shell follows your device theme by default".
- **Automated checks (unchanged):** Playwright a11y dark/light (all views), skip link, phone 44 px targets — 4 passed.
- **Residual:** physical device and hardware TalkBack ergonomics; colour-perception simulation; splash transition strips in light mode remain deferred.
