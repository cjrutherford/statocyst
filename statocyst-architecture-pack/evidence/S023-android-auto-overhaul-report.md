# S023 — Artist → album → song browsing (1.4.0, versionCode 22)

Request: a specific album view instead of a filtered list of songs; artist -> album -> song.

## Change (`apps/desktop/src/app/views/library-view.component.ts`)
- Artists tab: tapping an artist opens an artist page (header, Play / Shuffle / Download all, grid of that artist's albums).
- Albums tab and artist page: tapping an album opens an album page (cover, title, artist link, year/track count/duration, Play / Shuffle / Download, numbered track list). Tapping a track plays it with the album as the queue; the "more" menu and right-click use the same queue.
- Back button returns one level (album -> artist, or album/artist -> grid); switching tabs resets.
- Albums are matched on album + artist, so two artists' albums with the same title no longer merge (the old filter matched title only).
- The "Showing: <name>" filter bar and album/artist filter signals were removed; the Tracks tab is the plain searchable list.

## Verification
- `nx build desktop` succeeds (typechecks the template).
- Browser run against the production bundle with a stubbed bridge (5 albums, 2 artists, one title shared by both artists): artist page, album page and back navigation render; clicking track 3 sent `play` with that track and the 6-track album as context; the same-titled album by the other artist was not mixed in.
- Release APK 1.4.0 / v22 published, SHA-256 5b76f7654ee9eed1c92406118323c4c2ace86a9a1e786184236313039abce3e8 (local == public); installed and launched on the emulator without a crash.

## Not verified
- Not exercised on the emulator/device with a real library (no Jellyfin session on the emulator); the layout was checked in a desktop-width browser only, not at phone width.
- No automated UI test covers the new pages (the app has none for this view).
