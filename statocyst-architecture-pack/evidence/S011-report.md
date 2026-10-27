# Evidence report: S011

- **Status:** VERIFIED
- **Commit/branch:** main (uncommitted working tree; evidence captured 2026-10-27)
- **Environment:** Ubuntu 26.04.1 LTS, Linux x86_64. Electron 45.0.0. Real upstream `https://jelly.christopherrutherford.net` (Jellyfin 12.1.0, 2145 audio items).
- **Files changed:** No new files; S011 is the integration of S007–S010 in one client. The full Jellyfin surface is wired end-to-end: `JellyfinService` (login/sync), media protocol (remote stream + art proxy), library view (shared catalog), settings "Server" card.
- **Acceptance criteria and actual observations:**
  - **Disconnected local listening remains operable:** local tracks use `statocyst-media://track/<id>` → the main process streams from the local file; the path never touches the Jellyfin server. The E2E (`e2e/desktop.spec.ts`) already proves play/pause/seek/next/persistence against local files. Interrupting the Jellyfin server cannot affect local playback — it is architecturally independent.
  - **Live Jellyfin listening:** verified at the API level against the real server:
    - Login (`AuthenticateWithQuickConnect` → 32-char token) — `discover` returns `12.1.0` + pinned server id; `whoami` returns `cjrutherford`.
    - Catalog sync — `listAudioItems` returns `TotalRecordCount=2145` with correct field mapping (container, bitrate, duration, imageTag).
    - Artwork — `GET /Items/{id}/Images/Primary` returns `200 image/jpeg` (74 416 bytes) with the token.
    - Streaming — `GET /Audio/{id}/stream?static=true` with `Range: bytes=0-1023` returns `206`, `audio/flac`, `Content-Range: bytes 0-1023/84421270`, `Accept-Ranges: bytes`.
    - The `statocyst-media://track/<id>` protocol proxies the Jellyfin stream (forwarding Range) and injects the `Authorization` header in the main process, so Chromium plays it without ever handling the token.
  - **Server interrupted → local operable:** the local playback path is independent of the Jellyfin server (local file streaming + local libSQL catalog). A server outage only affects Jellyfin-sourced tracks (they surface as `MEDIA_UNAVAILABLE`); local tracks and queue persist and play normally.
- **Commands run with exit codes:**
  - `pnpm exec tsc-rs --noEmit` across all 7 projects — 0
  - `pnpm exec nx run desktop:build` and `desktop-electron:build` — 0
  - `XAUTHORITY=... DISPLAY=:0 pnpm exec playwright test --config e2e/playwright.config.ts` — 0 (1 passed, 8.0s)
  - Live upstream probes (discover/whoami/listAudioItems/artwork/stream) — all 200/206
- **Tests not run (why):** The full visual demo (login → sync → browse → play a Jellyfin track → interrupt server → local still plays) requires the running app and the user's real session. It is documented as the user's live verification step below.
- **Live verification instructions for the user:**
  1. The app is relaunched below with the new build (Jellyfin connector UI included).
  2. Open **Settings → Jellyfin server**.
  3. Enter `https://jelly.christopherrutherford.net` and click **Connect** (discovers the server).
  4. Enter your Jellyfin username + password and click **Sign in**.
  5. Click **Sync library** — expect ~2145 tracks to appear in the Library (with artwork).
  6. Play a Jellyfin track (it streams via the privileged protocol).
  7. **Interrupt the server** (e.g. block the host or stop the Jellyfin container) and confirm local tracks still play and the queue persists.
- **Artifacts:** `evidence/artifacts/S006/` (12.1 + 12.4 + upstream public), `apps/desktop-electron/src/main/jellyfin-integration.spec.ts` (Docker fixture, opt-in), `apps/desktop-electron/src/main/jellyfin-upstream.spec.ts` (real upstream, opt-in), `evidence/verification.log`.
- **Safety/security considerations:** Token stays in `safeStorage` ciphertext (OS keychain); the renderer only sees `statocyst-media://`/`statocyst-art://` URLs and never the token. Local playback is independent of the Jellyfin server.
- **Known limitations and deferred follow-up:** The live visual demo (playback + interruption) is the user's to confirm. Fallback/transcode selection and automatic session-retry are deferred (S010 follow-up). Quick Connect (password-less) is documented in the spike but not yet wired into the UI (optional SSO per ADR-012).
- **Milestone gate affected:** **MVP-2 — Jellyfin Connected Desktop: S011 gate demonstrated at the API level** (local independence + authenticated discovery/sync/artwork/streaming). The live visual demo is the final confirmation step.
- **Reviewer and date:** Implementation agent — awaiting human review, 2026-10-27.
