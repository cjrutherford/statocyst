# UI/UX review — layout and interface mechanisms

**Date:** 2026-11-05
**Scope:** desktop shell, tablet rail, phone layout, player, queue, library actions,
settings and empty states. Evidence captured from the running Electron app at 1320×880,
942×844 and 390×844.

## Scorecard

| Area | Score | Notes |
| --- | ---: | --- |
| Layout composition | 8.2 | Clear hierarchy and generous spacing; the library, queue and player read as one system. |
| Responsive adaptation | 7.6 | Phone layout now keeps readable queue titles and a compact player; tablet keeps labels; five bottom tabs remain dense. |
| Navigation / IA | 8.0 | Five sections are easy to reach; Now Playing gained Minimize; Offline gained a Library action. |
| Interaction mechanisms | 7.8 | Pop-up volume, context-menu Escape/focus, confirmations and dismissible status replace the rougher edges. |
| Feedback and status | 8.0 | Toasts, download card, offline banner and import summary are visible; toasts still float over content by design. |
| Accessibility | 8.4 | 44 px touch targets, focus return, Escape, ARIA labels, reduced motion; menu arrow-key navigation is still missing. |
| Visual consistency | 8.4 | Buttons, segmented controls, cards and empty states now share the same language. |
| **Overall** | **8.1 / 10** | Strong visual product; the remaining gaps are large-library virtualization, swipe/reorder gestures and richer onboarding. |

## What changed

- **Volume is a popover** in the player bar and Now Playing instead of a permanently
  visible slider. The speaker button opens mute + slider + percentage; Escape or a
  click outside closes it. Toasts no longer cover it.
- **Track actions** are a proper sheet on phones: title header, close button, grouped
  sections, 44 px rows, Escape closes, focus returns to the trigger, and removing a
  download now asks first.
- **Phone queue rows** keep the full title and artist; reorder/remove actions move to a
  second line instead of squeezing the title.
- **Sidebar labels** survive down to 900 px (previously 1080 px), so tablet widths no
  longer collapse to unexplained icons.
- **Settings** no longer claims “Android Auto” on desktop, and download network/limit
  controls only appear where the native queue implements them.
- **Offline empty state** has a “Browse library” action; the import summary is
  dismissible; Playlists disables save actions when there is nothing to save.
- **Now Playing** has a Minimize control; the offline banner is a full-width strip that
  shifts the shell instead of covering the header.

## Still open

- Virtualize the library table for very large catalogs (content-visibility helps but is
  not paging).
- Swipe actions and drag-to-reorder in the queue/library.
- First-run onboarding that connects a server and pins an album in one flow.
- Arrow-key navigation inside the track-actions menu.
