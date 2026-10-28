# S018 — Persisted shuffle order and token-free Jellyfin artwork

Build: versionCode 17 / 1.1.0, release-signed. https://nirvana.tail5a4a0.ts.net/statocyst-android.apk
SHA256 `2ffc79ce373782ef4c365de85cf4d06090c678864bcdee17f95e1adc601453aa` (public bytes equal local).

## Shuffle order
- Before: shuffle on/off was saved, but ExoPlayer's shuffled order was regenerated after a process restart, so "next" after a car reconnect could differ.
- Now `persistQueue` saves the order (playlist indices in play order, read from the timeline) in `QueueStore`; `load` discards it unless it is a valid permutation of the saved slots.
- On restore, `savedQueue()` remaps the order onto the slots that still resolve (dropped tracks are removed, the rest renumbered) and holds it as a pending order keyed by the queue's entry ids. When that exact queue appears in the player (direct restore or `onPlaybackResumption`), `setShuffleOrder(DefaultShuffleOrder(...))` applies it. A different queue never receives it.
- Pure logic is in `ShuffleOrders.kt`.

## Artwork
- Interpretation: "our own from an API" = the app serves the artwork itself. Jellyfin images are fetched by the app with the session header and cached, then handed out through an exported `ContentProvider` (`<package>.artwork`, `content://.../art/<itemId>?tag=<tag>`) built on the S13 `JellyfinArtwork` cache. No token or `api_key` appears in any URI.
- `SourceResolver.artworkUrl` now returns that content URI, used for both browse-tree items (what the head unit loads) and the playing item's metadata. The in-process notification bitmap loader reads it through `ContentDataSource`.
- The provider is read-only, accepts only validated item ids and tags, and serves nothing but Jellyfin album art.
- The WebView keeps its loopback route from S13.

## Evidence
- Unit tests 64/64 (new: `ShuffleOrdersTest` x5, `ArtworkProviderTest` x2).
- Instrumented tests 14/14 on emulator-5554 (new: `QueueStoreTest` order round trip; `ArtworkProviderTest` serves a cached PNG through the content URI with the right MIME type and rejects bad ids and writes; `MediaLibraryServiceBrowseTest.savedShuffleOrderIsReappliedWhenTheServiceRestarts` stops the service, seeds a saved shuffled queue, restarts it, and checks the controller sees the same play order and that it is persisted again).
- Release APK installed on the emulator: provider registered, `content read` of a bad id returns FileNotFoundException.

## Not verified
- Artwork has not been seen on a real head unit or the DHU; a head unit host must be allowed to read the exported provider, which is standard but not confirmed here.
- No real Jellyfin server was used; image fetching is covered by the fake-server tests from S13/S14.
- Shuffle order after `addMediaItems` growth (context tail) is saved but only the restart path was exercised end to end.
- The release build was not re-run on the DHU.
