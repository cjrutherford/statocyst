# S022 — Pulled artwork overrides Jellyfin artwork (1.3.2, versionCode 21)

Request: "let's have the pulled artwork override the jellyfin provided ones".

## Change
When "Fetch missing artwork online" is on, MusicBrainz / Cover Art Archive / Wikimedia
artwork is now served in preference to the Jellyfin image. Jellyfin art is the fallback
when nothing is found online (or the lookup is skipped), so a cover never disappears.

- `ExternalArt.coverUri/artistUri` take an optional Jellyfin `id`/`tag` fallback, carried as
  validated query params (still token-free).
- `ArtworkProvider` (Android Auto, system UI) and `LocalMediaServer` `/__media/ext` (WebView)
  serve the external file first, then the Jellyfin image named by `id`/`tag`.
- `SourceResolver.artwork` (browse tree, now-playing) and `StatocystPlugin.artworkFor` (Library)
  issue the external URI first, with the Jellyfin item as fallback. With the setting off nothing changes.
- Artist nodes in the Auto browse tree now prefer the artist photo over an album cover.

## Verification
- Unit tests pass.
- Instrumented `ExternalArtProviderTest` (22 tests in the run, 0 failures) including two new cases:
  a cached pulled cover is served even when a Jellyfin fallback is attached; an invalid fallback id is dropped.
- Release APK published: SHA-256 fefaa28a3b553ef39e7382f7962d403ce91287cf6ff936f173aa09bb02dafbd7 (local == public), installed on the emulator.

## Not verified
- The Jellyfin-fallback path (external miss -> Jellyfin image) has no automated test and was not
  exercised against a live Jellyfin session in this slice.
- The first load of a large Jellyfin library now waits on MusicBrainz's 1.1 s rate gate per album
  (max 8 waiting; extra callers fall straight to the Jellyfin image). Covers upgrade as lookups complete and stay cached.
