# Evidence report: S052 — Podcast browse in Android Auto and CarPlay

**Status:** BLOCKED (iOS/CarPlay dependent; Android Auto podcast browse not implemented)
**Date:** 2026-11-08
**Depends on:** S049, S051

## What exists

- Android Auto music browse and playback exist from the earlier milestones.
- iOS CarPlay music browse exists and is IMPLEMENTED_UNVERIFIED for music (S039).
- Podcast episodes are native Room rows on Android after S048/S049; iOS has no podcast
  data yet.

## Why this is BLOCKED

- Android Auto podcast nodes/actions are not implemented; a DHU/physical head-unit run is
  required for the slice gate.
- CarPlay requires S050/S051, an Apple entitlement and a real head unit for full evidence.
- The Linux host cannot build or run the iOS CarPlay simulator.

## Reproduction recipe

On Android (DHU + phone):

1. Add podcast roots/children to the native browse tree (Continue Listening, Subscriptions
   → Episodes) over Room.
2. Wire selection to the existing native playback queue and podcast resume.
3. Run the Desktop Head Unit and a physical phone with the screen off and offline.

On macOS (CarPlay):

1. Complete S050/S051, add the `CPTemplateApplicationScene` podcast templates and share
   `PlaybackManager`.
2. Run the CarPlay simulator and record the entitlement/head-unit result.

## Evidence decision

BLOCKED. Do not claim car podcast support in the MVP-5 release.
