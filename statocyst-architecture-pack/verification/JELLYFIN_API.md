# Jellyfin API — verified behavior (S006 spike)

Status: verified against stock `jellyfin/jellyfin:12.1` and `12.4`, plus the public
surface of `https://jelly.christopherrutherford.net` (12.1.0). This is the durable
handoff for S007–S011. Do not assume anything not listed here without re-verifying.

## Auth (Jellyfin 12 breaking changes)

- Use the `Authorization` header, **not** `X-Emby-Authorization`. Jellyfin 12
  throws `request.App` null (HTTP 400) for the legacy header.
- Header shape (no token for login, add `Token="…"` after login):

  ```
  Authorization: MediaBrowser Client="Statocyst", Device="<device>", DeviceId="<uuid>", Version="0.1.0"
  ```

- Login: `POST /Users/AuthenticateByName` body `{"Username":"…","Pw":"…"}` →
  200 `{ User:{Id,Name}, SessionInfo, AccessToken, ServerId }`. `AccessToken` is
  a 32-char token.
- Rejection is not a fixed 401: stock returns 401 for a non-existent user; the
  upstream (custom auth) returns 500 `Error processing request.`. Treat any
  non-200 as "rejected".

## First-run wizard (fixture provisioning only)

1. `GET /Startup/Configuration`
2. `POST /Startup/Configuration` `{UICulture, MetadataCountryCode, PreferredMetadataLanguage}`
3. `GET /Startup/User` (required before set)
4. `POST /Startup/User` `{Name, Password}`
5. `POST /Startup/Complete`

## Library provisioning

- `POST /Library/VirtualFolders?name=Music&collectionType=music&paths=/media/music`
  (paths **unencoded**; `%2F` fails to bind). `refreshLibrary=true` is unreliable —
  follow with `POST /Library/Refresh`.

## Browse (Jellyfin 12 change)

- Tracks: `GET /Users/{uid}/Items?Recursive=true&IncludeItemTypes=Audio&SortBy=SortName&SortOrder=Ascending&StartIndex=&Limit=`
  → `{ Items, TotalRecordCount, StartIndex }`. Paging is standard.
- Artists: `GET /Users/{uid}/Items?Recursive=true&IncludeItemTypes=MusicArtist`
  (or `GET /Artists?userId=…`) returns MusicArtist rollups.
- Albums: **`IncludeItemTypes=MusicAlbum` returns 0 in 12.x.** Albums are not
  itemised; derive them by grouping Audio items on `Album` + `AlbumArtist`.
  The music view lists Audio items flat.
- Search: `searchTerm=` is case-insensitive.
- Media sources: `Fields=MediaSources` exposes `MediaSources[0].Container`.

## Artwork

- `GET /Items/{itemId}/Images/Primary?maxHeight=300&quality=90` with auth header.

## Streaming / playback

- Direct: `GET /Audio/{itemId}/stream?static=true` — honours `Range` (206,
  `Content-Range`, `Accept-Ranges`, correct `Content-Type`); invalid range → 416.
- Universal: `GET /Audio/{itemId}/universal?UserId=&DeviceId=&MaxStreamingBitrate=&AudioCodec=&Container=`
  resolves to 200/206/302 (redirect to a stream).
- Download: `GET /Items/{itemId}/Download`.
- Reporting: `POST /Sessions/Playing`, `POST /Sessions/Playing/Stopped` → 204.
- Favourites: `POST`/`DELETE /Users/{uid}/FavoriteItems/{itemId}` → 200.

## Implications for S007+

- S007 must send the `Authorization` header (typed client), pin the `ServerId`
  + TLS identity, and store only the `AccessToken`/user id in OS-backed storage
  (never the password after login, never in the catalog DB or logs).
- S008 catalog sync must treat albums/artists as derived metadata from Audio
  items, not as importable MusicAlbum entities.
- S010 stream resolution can rely on `stream?static=true` for direct play and
  `universal` for fallback; the `<audio>` element cannot set auth headers, so the
  privileged `statocyst-media:` protocol must inject the `Authorization` header
  (same pattern already used for local playback).
