# Statocyst Privacy Policy

Effective date: `<DATE BEFORE PUBLISHING>`
Developer: Hopeful Aspirations Industries
Contact: `<CONTACT EMAIL>`

Statocyst is a music player. It plays audio files stored on your device and media from a Jellyfin
server that you run or have access to. This policy explains what the app handles.

## What stays on your device
- Your library index, queue, favorites, listening history and settings.
- Audio you download for offline listening and the rolling playback cache.
- Your Jellyfin server address, username and access token. Your password is sent to your server
  once to sign in and is not stored by the app.

We do not receive any of this. The developer runs no servers for the app and has no accounts,
analytics, advertising or crash-reporting services in it.

## What the app sends over the network
1. **Your Jellyfin server.** When you connect a server, the app sends your sign-in details and
   requests for your library, artwork and audio to the address you entered, and to nowhere else.
   Use an HTTPS address; unencrypted connections are only allowed to the device itself.
2. **Artwork lookup (optional, off by default).** If you turn it on in Settings, the names of
   albums and artists in your library are sent to MusicBrainz and the Cover Art Archive, and image
   requests go to Wikidata and Wikimedia Commons, to find cover and artist pictures. Nothing else
   about you or your library is sent. These services have their own privacy policies.

## Permissions
- Notifications: media and download controls.
- Foreground services: keep music playing and downloads running while the app is in the background.
- Network, wake and Wi-Fi locks: stream without interruption.
- The app does not request access to your location, contacts, microphone, camera or shared storage.
  Files and folders are opened only through the system file picker, and only the ones you choose.

## Diagnostics
Settings can create a support bundle on your device. It excludes your access token, password and
listening history. It is not uploaded; it only leaves the device if you share it yourself.

## Backups
The app opts out of Android cloud backup and device transfer, so your server details and library
are not copied elsewhere. After restoring a phone, sign in again.

## Your choices and deletion
Sign out in the app, clear its storage in Android settings, or uninstall to delete everything the
app holds. Because the developer holds no copy, there is nothing further to request or delete.

## Children
Statocyst is not directed at children under 13 and does not knowingly collect their data.

## Changes
Changes to this policy will be published at this address with a new effective date.
