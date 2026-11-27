import { describe, expect, it } from 'vitest';
import { isSwipeDismiss, SWIPE_DISMISS_MAX_OFFSET, swipeDismissOffset } from './swipe-dismiss';

describe('swipe to dismiss', () => {
  it('dismisses on a long, mostly vertical downward swipe from the top', () => {
    expect(isSwipeDismiss(10, 140, true)).toBe(true);
  });

  it('ignores a swipe that started while the screen was scrolled', () => {
    expect(isSwipeDismiss(0, 200, false)).toBe(false);
  });

  it('ignores short, upward and mostly horizontal gestures', () => {
    expect(isSwipeDismiss(0, 40, true)).toBe(false);
    expect(isSwipeDismiss(0, -150, true)).toBe(false);
    expect(isSwipeDismiss(160, 120, true)).toBe(false);
  });

  it('follows the finger only for downward vertical drags, capped', () => {
    expect(swipeDismissOffset(0, 100, true)).toBe(60);
    expect(swipeDismissOffset(0, 1000, true)).toBe(SWIPE_DISMISS_MAX_OFFSET);
    expect(swipeDismissOffset(0, -50, true)).toBe(0);
    expect(swipeDismissOffset(200, 50, true)).toBe(0);
    expect(swipeDismissOffset(0, 100, false)).toBe(0);
  });
});
