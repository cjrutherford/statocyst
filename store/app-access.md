# App access instructions for Play review

Paste into Play Console > App content > App access ("All or some functionality is restricted").
Reviewers cannot use the app without a media source, so give them one of the two paths below.

## Path A: local files (no account needed)
1. Install the build from the testing track and open Statocyst.
2. Download the sample audio pack from `<URL TO HOST THE SAMPLE FILES>` (the four files in
   `resources/demo/` of the repository: MP3, FLAC, OGG, WAV, plus cover art) onto the device.
3. In Statocyst choose Import, pick the files or the folder, then tap a track to play.

## Path B: demo Jellyfin server
- Server URL: `<DEMO SERVER HTTPS URL>`
- Username: `<REVIEW USERNAME>`
- Password: `<REVIEW PASSWORD>`
1. Open Settings, choose Jellyfin, enter the server URL and credentials, sign in.
2. Browse the library and tap a track to play.

The server must stay reachable over HTTPS for the whole review window. Cleartext HTTP servers
are not supported.

## Statement for the listing and review notes
Statocyst does not supply, host or stream any music. It plays audio files the user already
has and media from a Jellyfin server the user runs.

**TODO (owner):** host the sample files and decide whether to run a demo Jellyfin server;
fill in the placeholders above.
