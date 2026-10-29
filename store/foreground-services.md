# Permissions and foreground service declarations

Play Console > App content > Foreground service permissions (one declaration per type), plus the
permission justifications to keep ready for review. Declarations may require a short demo video
of the user-visible feature (record from an emulator or device).

## Foreground service types
| Type | Component | What the user sees | Impact if stopped / not allowed |
| --- | --- | --- | --- |
| `mediaPlayback` | `media.PlaybackService` (Media3 `MediaLibraryService`) | A media notification with transport controls while music plays; also drives lock screen, Bluetooth and Android Auto controls | Audio stops as soon as the app leaves the foreground |
| `dataSync` | `downloads.DownloadService` | A progress notification while the user's selected tracks download for offline listening | Downloads are interrupted or killed when the app is backgrounded, leaving partial files |

Demo video (suggested): start playback and leave the app (mediaPlayback); queue several
downloads then leave the app (dataSync).

## Permissions
| Permission | Why |
| --- | --- |
| `INTERNET` | Reach the user's Jellyfin server and the optional artwork services |
| `ACCESS_NETWORK_STATE` | Pause prefetch/downloads when offline and report connection problems |
| `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_MEDIA_PLAYBACK`, `FOREGROUND_SERVICE_DATA_SYNC` | Declarations above |
| `POST_NOTIFICATIONS` | Media and download notifications (Android 13+) |
| `WAKE_LOCK`, `WIFI_LOCK` | Keep playback and streaming from stalling when the screen is off |

No sensitive permissions (location, contacts, SMS, storage, microphone, camera) are requested.
