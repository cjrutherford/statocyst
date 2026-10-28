# S021 — artwork CSP fix and download progress (1.3.1, versionCode 20)

Reported: "it doesn't seem that the downloads are processing or artwork being loaded" (1.3.0).

## Root causes found (reproduced on the emulator against jelly.christopherrutherford.net, Quick Connect)

1. **Artwork never rendered in the WebView.** `index.html` CSP had `img-src 'self' data: statocyst-art: https:`; the
   loopback artwork URLs (`http://127.0.0.1:<port>/__media/art|ext`) introduced in 1.1.0 were refused
   ("Refused to load the image ... violates img-src"). Affected Jellyfin artwork and the opt-in MusicBrainz art.
   Fix: add `http://127.0.0.1:*` to `img-src`. Verified: `Image` load of a Jellyfin art URL = 300px, covers visible in Library.
2. **Download card sat at "0%" for the first track(s).** With any queued track whose size was not yet known the
   percent fell back to finished-track count, so large FLAC downloads showed 0% for minutes. Fix: percent is now the
   sum of per-track fractions (done = 1, in flight = bytes/total, unknown = 0). Verified: card showed 5% with titles.
3. **External art fragility.** Wikidata `Special:EntityData` (~135 KB) replaced by `wbgetclaims` (~1 KB); a transient
   503 is retried up to 3 times (429 is not retried; its Retry-After is honoured through the existing 15-minute
   back-off). Lookup failures are now logged to logcat (tag `ExternalArtwork`) with status, Retry-After and body start.

## What worked already
Queue, foreground service, Range resume and the plugin/web path worked: local fixtures (3/3) and real Jellyfin FLAC
downloads (2 finished, 3rd cancelled by me) completed on the emulator. So the "not processing" symptom was the 0% card.

## Verification
- Unit tests 94/94 (added `aBriefServiceErrorIsRetriedWithinTheLookup`; updated Wikidata fake).
- Instrumented 20/20 on the final run. `MediaLibraryServiceBrowseTest.radioFolderAndVoiceBuildASimilarQueue`
  failed once in a full-class run (timeout), then passed 3/3 alone and in the next full run; an unrelated test
  flaked once earlier in slice 20. Not caused by this change as far as I can tell, but cause not proven.
- Web typecheck passes. Release APK installed on the emulator, launches, no FATAL, bundle CSP contains the fix.
- Published: https://nirvana.tail5a4a0.ts.net/statocyst-android.apk
  SHA-256 `039574087f1dce980b094e4c14dd014a2a6c3d7af9d6ff1f05edf14dbf439089` (local == public).

## Not verified
- Artist photos from Wikimedia: the emulator's IP was rate-limited (429, Retry-After 100) by my own test traffic,
  so the end-to-end artist-photo fetch was not re-confirmed after the `wbgetclaims` change. Cover Art Archive
  covers worked end to end (JPEG returned through the content provider).
- Screen-off / background downloads and a full playlist on a real device.
- The emulator was signed in to the user's Jellyfin for testing; the release reinstall removed that session.
