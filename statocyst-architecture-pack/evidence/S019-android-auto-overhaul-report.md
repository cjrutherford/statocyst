# Slice 19 (gap closure): MusicBrainz cover and artist images

Version 18 / 1.2.0. Status: DONE, with live in-app lookups not exercised (see Not verified).

## What changed
- **Opt-in** setting `external_art_enabled` (default off) with a Settings toggle ("Fetch missing artwork online") that states what leaves the device: artist and album names, to MusicBrainz, the Cover Art Archive and Wikimedia Commons. Nothing else is sent.
- External art only fills gaps: Jellyfin art is used first; local tracks, radio and artists fall back to MusicBrainz art.
- `artwork/MusicBrainzClient.kt`: release-group search (score >= 90) then `coverartarchive.org/release-group/<mbid>/front-250`; artist search (score >= 95 and exact case-insensitive name) then MB `url-rels` (`image`, or `wikidata` -> P18 -> Commons `Special:FilePath`). Redirects are followed only to https hosts under coverartarchive.org, archive.org, wikimedia.org. 6 MB cap, 1.1 s shared rate gate, descriptive User-Agent `Statocyst/<version> (+<package>)`.
- `artwork/ExternalArtwork.kt`: disk cache `cacheDir/ext-art` (48 MB prune), MIME sniffing (non-images rejected), `.miss` markers (7 days for not-found, 15 min for service errors), at most 8 lookups waiting.
- Served to Android Auto and system UI through the existing exported `ArtworkProvider` (`/cover`, `/artist`, no credentials in URIs) and to the WebView via `/__media/ext`. The provider returns nothing while the setting is off.
- Web: `Track.artistArtworkUrl`, bridge `getExternalArtwork` / `setExternalArtwork`, artists grid prefers the artist photo, library reloads after toggling.

## Evidence
- Unit: 73/73 (9 new in `ExternalArtworkTest` using the socket `FakeHttpServer`: cover found, redirect followed, cache hit makes no requests, low score cached as a week-long miss, 503 retried after 15 min not a week, non-image bytes rejected, redirect to a disallowed host not fetched, Wikidata -> Commons artist photo, name mismatch rejected, placeholder names never queried).
- Instrumented: 18/18 on emulator-5554 (4 new in `ExternalArtProviderTest`: no URIs while off, provider serves nothing while off even for a cached file, cached cover served through a token-free content URI with the right MIME, placeholder names get no URI).
- Typecheck of desktop, desktop-electron and contracts passes.
- Live API shapes checked with two read-only requests: the MB release-group search returned `release-groups[].id/score` as parsed, and the Cover Art Archive answered 307 to an `archive.org` image URL, which the allowlist covers.
- Release APK `apksigner verify` passes; published and public bytes match. SHA256 `efd4f5b9b2588fac28be638b908488ecbe0737b74c4281b8b14720b406979c72`. Release build installed on the emulator and launched with no crash.

## Not verified
- End-to-end in the running app with the toggle on (real MusicBrainz lookups rendering in Now Playing, the Library artists grid, or the car display).
- The Settings toggle was not exercised in the UI (typecheck only; the desktop app has no unit-test target).
- Artist-photo coverage depends on MusicBrainz having a Wikidata or image relation; many artists will have none and keep the initial letter.

## Design note
`ArtworkProvider` is exported so the Auto host can read it. While the setting is on, another app could ask it for covers and trigger rate-limited, cached lookups. The cost is bounded (rate gate, 8 waiting, caches), but it is a known trade-off.
