# Evidence report: S043 — Shared podcast feed core

**Status:** VERIFIED
**Date:** 2026-11-08
**Depends on:** S042

## Landed

- New `libs/podcast-core` (`@statocyst/podcast-core`) with no network, filesystem,
  Electron or Capacitor code.
- RSS 2.0, Atom 1.0, iTunes namespace and Podcast 2.0 fields used by the schema:
  - feed metadata, categories, explicit flag, artwork, language, site URL;
  - episode GUID, enclosure, duration, dates, season/episode/type, artwork, chapters and
    transcript pointers;
  - relative URL resolution against the final feed URL.
- XML safety: `fast-xml-parser` with entities disabled, `XMLValidator` well-formedness
  check, DTD/ENTITY rejection, 5 MiB cap and a 2,000-episode cap.
- Episode identity: stable `podcast:<sha256(feedUrl + NUL + guid)>` path key via Web Crypto.
- Duplicate GUIDs and missing/unsafe enclosures are dropped and counted; per-feed cap
  truncation is reported.
- HTML-to-text sanitizer and safe link extraction: scripts/styles removed, entities
  decoded, only HTTP(S) links retained, relative links resolved, 20-link cap.
- OPML parse/serialize: nested folders, dedupe, invalid count, 5,000-feed cap, XML escaping.
- URL safety: scheme and credential checks, local hostname rules, IPv4/IPv6 private,
  loopback, link-local, metadata, CGNAT and IPv4-mapped handling; explicit local-network
  mode still blocks link-local/metadata.

## Dependency

- `fast-xml-parser@5.12.0` (MIT), pinned in `package.json`/lockfile. This is the only new
  runtime dependency for the parser; no podcast SDK, DOM parser or sanitizer library was
  added.

## Commands and results

| Command | Result |
| --- | --- |
| `pnpm add fast-xml-parser@5.12.0` | exit 0, dependency added |
| `pnpm exec tsc-rs --noEmit -p libs/podcast-core/tsconfig.json` | exit 0 |
| `pnpm exec vitest run --config libs/podcast-core/vitest.config.ts` | 20 passed (4 files) |

Fixture matrix exercised:

- RSS with iTunes/Content/Podcast namespaces, relative enclosure, missing enclosure,
  duplicate GUID, CDATA HTML, script injection and duration/date variants.
- Atom with escaped HTML, alternate/enclosure links and iTunes fields.
- Malformed XML, XXE/DOCTYPE, empty, oversized and non-feed documents.
- Episode cap/dedupe, private enclosure allow/deny.
- OPML nested folders, duplicates, invalid local URL, cap and serialize round-trip.
- URL safety: private/loopback/link-local/metadata, IPv4-mapped IPv6, credentials,
  unsupported schemes, normalization and log redaction.

Logs:

- `/tmp/statocyst-s043-tsc.log`
- `/tmp/statocyst-s043-test.log`
- `/tmp/statocyst-s043-pnpm-add.log`

## Not verified / next

- No network fetch or persistence is part of this slice; S044 wires the parser to the
  Electron host and repository.
- Real-world feed corpus coverage is limited to the committed fixtures. S044 should run a
  representative live-feed refresh before claiming the ingestion gate.
