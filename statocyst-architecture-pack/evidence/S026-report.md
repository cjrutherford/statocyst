# Evidence report: S026

- **Status:** IMPLEMENTED_UNVERIFIED
- **Commit/branch:** main (uncommitted working tree; evidence captured 2026-10-28)
- **Environment:** Ubuntu 26.04 LTS, Node 24, Electron 45, Angular 22, Vitest 4.
- **Files changed:**
  - `libs/jellyfin-client/src/lib/endpoints.ts` (new) — `rankEndpoints`, `selectEndpoint`, `nextEndpoint`; LAN → VPN → WAN priority; rejects invalid/insecure/duplicate candidates; plain HTTP only for loopback.
  - `libs/jellyfin-client/src/lib/stream-url.ts` (new) — `buildAudioStreamUrl` for direct (`/Audio/{id}/stream?static=true`) and capped transcode (`/Audio/{id}/universal`); refuses HTTPS→HTTP downgrade and requires a bitrate ceiling for transcodes.
  - `libs/playback-core/src/lib/quality.ts` (new) — `decideQuality` policy and `RollingThroughput` estimator (8 s window, 1.15 headroom, 3 s critical buffer).
  - `libs/jellyfin-client/src/lib/endpoints.spec.ts`, `stream-url.spec.ts`, `libs/playback-core/src/lib/quality.spec.ts` (new) — 22 new tests.
  - `libs/contracts/src/lib/bridge.ts` — `EngineEvent` gains `{ type: 'health'; bufferSeconds }`.
  - `apps/desktop/src/app/core/audio-engine.service.ts` — reports buffer-ahead seconds from the `<audio>` element every 2 s.
  - `apps/desktop-electron/src/main/playback-service.ts` — stores buffer health and exposes `bufferHealth()`.
  - `apps/desktop-electron/src/main/protocol.ts` — proxies remote audio through the shared stream-URL builder, honours `mode`/`maxBitrateKbps`, and measures real bytes with `RollingThroughput`.
  - `apps/desktop-electron/src/main/main.ts` — decides quality per Jellyfin track from the user preference, measured throughput, buffer health and source bitrate; logs `playback.quality.transcode` with the reason.
  - `apps/desktop-electron/src/main/cache-manager.ts`, `download-service.ts` — use the shared direct-stream URL builder.
- **Acceptance criteria and actual observations:**
  - **Network disruption fixture:** `decideQuality` tests simulate throughput below the source rate (600 kbit/s vs 1.411 Mbit/s) → transcode (`throughput-low`); critical buffer + low throughput → transcode (`buffer-critical`); healthy throughput with a near-empty buffer → direct (no knee-jerk transcode).
  - **No HTTPS downgrade:** `selectEndpoint` tests reject a plain-HTTP LAN candidate in favour of an HTTPS WAN endpoint and return `null` when all candidates are insecure. `buildAudioStreamUrl` throws instead of constructing an insecure URL. Streaming now goes through that single builder.
  - **No needless forced transcode:** direct play is retained whenever measured throughput ≥ 1.15 × source bitrate; `lossless` preference keeps direct play under a thin margin while the buffer is healthy; unmeasured throughput with a healthy buffer stays direct.
  - **User quality controls:** Settings exposes Lossless first / Adaptive (S025), and Adaptive is the mode that permits the measured-throughput transcode path.
  - **Bounded measurement:** throughput is the average of proxied bytes over an 8-second window; no synthetic or latency-only signal is used.
- **Commands run with exit codes:**
  - `vitest run --root libs/jellyfin-client` — 0 (25 passed).
  - `vitest run --root libs/playback-core` — 0 (29 passed).
  - `vitest run --config apps/desktop-electron/vitest.config.ts` — 0 (19 passed, 2 skipped).
  - `tsc-rs --noEmit` (desktop, desktop-electron) — 0.
  - `nx build desktop` — 0; `nx build desktop-electron` — 0.
- **Tests not run (why):** No live Jellyfin server was available in this environment, so the end-to-end adaptive switch is exercised by the pure policy fixtures rather than a real server.
- **Safety/security considerations:** URLs are constructed in one place, which enforces HTTPS; tokens still travel only in the `Authorization` header (never in the URL). Transcode URLs use the capped `universal` endpoint so a transcode cannot silently request a higher bitrate.
- **Known limitations and deferred follow-up:** `rankEndpoints`/`nextEndpoint` exist and are tested, but the connection flow still stores a single server URL; automatic multi-endpoint failover needs a server-profile migration and is deferred. Transcode target is fixed at 192 kbit/s MP3; per-codec capability probing is future work.
- **Milestone gate affected:** **Polish — S026: measured throughput/buffer policy, validated endpoint alternatives and lossless preference implemented; HTTPS downgrade is impossible by construction.**
- **Reviewer and date:** Implementation agent — awaiting human review, 2026-10-28.

## Android parity verification (2026-10-28)

- **Environment:** Android SDK 36.1 emulator `Medium_Phone_API_36.1` (Android 16, API 36).
- **Android scope:** the native player streams the Jellyfin `/Audio/{id}/stream` URL directly over HTTPS; there is no transcode path on Android, so "no needless forced transcode" holds by construction (direct play only). The reverse proxy in front of this server rejects `/Users/*` but passes `/Audio/*`, so playback works while sync is proxy-gated.
- **HTTPS downgrade:** `JellyfinClient` uses the URL exactly as stored; `network_security_config.xml` permits cleartext only for `127.0.0.1`/`localhost`, so a remote `http://` URL cannot be loaded by the WebView even if one were entered.
- **Quality control:** the Settings card exposes Lossless first / Adaptive radios; on Android the selection is stored and surfaced but the stream stays direct (adaptive transcode is desktop-only today).
- **Gate status:** the desktop network-disruption fixtures (22 unit tests) are the fixture evidence; the Android live path is direct-play only and was demonstrated streaming a remote FLAC with seek.
- **Residual:** live adaptive switch on a real server, multi-endpoint failover and per-codec probing remain deferred (see the desktop report).
