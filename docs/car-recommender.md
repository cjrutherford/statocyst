# Car recommendation fallback

The car surfaces never require the Angular WebView to build “For you”. The phone
publishes a snapshot when it can, but Android Auto, AAOS and CarPlay fall back to a
native ranking over the local catalog, favorites and recent plays.

## Precedence

1. **Fresh phone snapshot** — used when `car_recommendations` exists and its
   `generatedAt` is less than 24 hours old.
2. **Native fallback** — used when the snapshot is missing, malformed or stale.
3. **Empty/warming state** — only when the local catalog has no playable music.

The native fallback produces the same four mixes:

| Mix | Rule |
| --- | --- |
| Daily drift | Top ranked tracks |
| Rediscover | Favorites never played, or tracks last played 30+ days ago |
| Deep cuts | Ranked tracks whose strongest reasons include artist or album affinity |
| Favorites radio | Favorites ordered by the current rank, then title/id |

## Ranking rules

The reference implementation is
[`libs/recommendation`](../libs/recommendation/src/lib/recommendation.ts):

- favorite: +25
- artist affinity: up to +30
- genre affinity: up to +18
- album affinity: up to +8
- seed similarity to the three newest plays: up to +20
- rediscover: +6
- discovery: +4
- played within 2 days: −22
- played within 7 days: −10
- played within 12 hours: excluded entirely
- deterministic 0–3 jitter
- per-artist cap of two, then deferred rows fill the requested length
- top two reasons are retained for the car row

Android Auto and AAOS use `CarRecommender.kt`; CarPlay uses
`CarPlayRecommender` in `CarPlayBrowse.swift`.

## Golden fixture

[`libs/recommendation/fixtures/car-recommendation-golden.json`](../libs/recommendation/fixtures/car-recommendation-golden.json)
contains the full input and expected four-mix snapshot.

It is asserted by:

- the TypeScript golden test: `car-golden.spec.ts`
- the Android JVM test: `CarRecommenderTest`
- the Swift implementation should use the same fixture once a Swift test target and
  macOS build are available

Any weight or rule change must update the fixture and all three implementations in
the same change. A mismatch is a bug, not a platform-specific preference.

## Verification status

- TypeScript and Kotlin: verified against the golden fixture.
- AAOS: cold-start verified on the automotive emulator with `car_recommendations`
  removed; all four mixes appeared from the local fallback.
- CarPlay: implemented; requires a macOS/Xcode build and CarPlay entitlement to
  compile and run the same fixture.
