# Data safety form: answer sheet

Play Console > Policy and programs > App content > Data safety. These answers come from the code
as of this branch; re-verify against the live form wording before submitting, and update this
file whenever a feature changes what leaves the device.

## Overview questions
| Question | Answer |
| --- | --- |
| Does the app collect or share any required user data types? | Yes (see below) |
| Is all collected data encrypted in transit? | Yes. Cleartext is permitted only for 127.0.0.1/localhost (`network_security_config.xml`); every remote request uses HTTPS |
| Do you provide a way for users to request data deletion? | Yes: sign out inside the app, clear app data, or uninstall. Nothing is held by the developer |
| Committed to the Play Families policy? | No, the app is not directed at children |

## Data types
| Play category | Data | Collected | Shared | Optional | Purpose |
| --- | --- | --- | --- | --- | --- |
| Personal info > User IDs / Auth info | Jellyfin username and access token | Yes, stored on device and sent only to the server the user configures | No (user's own server, not a third party) | Yes, only when a Jellyfin server is connected | App functionality, account management |
| App info and performance > Diagnostics | None collected by the developer. The support bundle is written locally and only leaves the device if the user shares it from the Android share sheet | No | No | n/a | n/a |
| App activity > Other user-generated content / App interactions | Album and artist names sent to MusicBrainz, Cover Art Archive, Wikidata, Wikimedia Commons for artwork lookup | Yes | Yes (third-party services) | Yes, artwork lookup setting | App functionality |
| Audio files, Photos and videos, Location, Contacts, Financial, Health, Web history, Device or other IDs | Not accessed | No | No | n/a | n/a |

## Declarations to select
- No advertising ID, no ads, no analytics SDK, no crash-reporting SDK.
- Data is not sold. Data is not used for advertising or personalization.
- Local library files are read through the system file picker (`ACTION_OPEN_DOCUMENT[_TREE]`); the app requests no storage permission.

## Re-check before each release
- Any new network endpoint or SDK added since the last submission.
- Whether the artwork lookup still defaults to the current optional/opt-in behaviour.
