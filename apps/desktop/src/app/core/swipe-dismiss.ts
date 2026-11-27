/** Downward travel (px) a swipe must cover before releasing it dismisses the screen. */
export const SWIPE_DISMISS_DISTANCE = 90;
/** Visual follow is capped so the screen never slides far off before it is released. */
export const SWIPE_DISMISS_MAX_OFFSET = 160;

/**
 * True when a touch gesture is a deliberate downward swipe: it started with the
 * scroller at the top (so it is not a scroll back up), went far enough down, and
 * was mostly vertical (so a horizontal swipe or a seek drag does not count).
 */
export function isSwipeDismiss(dx: number, dy: number, startedAtTop: boolean): boolean {
  if (!startedAtTop) return false;
  if (dy < SWIPE_DISMISS_DISTANCE) return false;
  return Math.abs(dx) <= dy * 0.6;
}

/** How far the screen follows the finger while a swipe-down is in progress. */
export function swipeDismissOffset(dx: number, dy: number, startedAtTop: boolean): number {
  if (!startedAtTop || dy <= 0 || Math.abs(dx) > dy) return 0;
  return Math.min(SWIPE_DISMISS_MAX_OFFSET, dy * 0.6);
}
