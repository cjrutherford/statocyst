# Mandatory feasibility gates

- **libSQL desktop:** embedded storage URI, transactions, WAL behavior, vector syntax, migration recovery under packaged Electron process.
- **libSQL Android:** Gradle dependency/API existence and stability, supported ABIs, native database open, vector columns/indexes/queries, concurrency with headless service and Capacitor bridge, device restart.
- **libSQL iOS (future):** supported Swift binding or proven native bridge, vector operations, distribution/licensing, local lifecycle.
- **Jellyfin stock API:** verify standard auth, paging, item filters/delta semantics, favorite/play reporting, media stream and transcode options against pinned test server versions.
- **Android Auto:** supported Media3 API/service declarations, cold-start browse, audio focus, media session, emulator/head-unit + physical phone evidence.
- **Distribution:** Electron dependency license/packaging, Android signing and Apple entitlements when targeted.

If any mandatory gate fails, write a blocking ADR proposal. Never silently swap the user's libSQL or native-playback decisions.

# Post Slice Closeout Requirements

* Do open the appropriate interface on my behalf when complete so that I may review. This is fine for emulator and browser only, but real world android devices I need an apk to install/upate.
* do as much testing on your own before completion. do not rely solely on tests, but e2e should document user flows.
