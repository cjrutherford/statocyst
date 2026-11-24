import type { View } from './navigation.store';

/** Run Back handlers in priority order until one consumes the action. */
export function dispatchBack(...handlers: Array<() => boolean>): boolean {
  return handlers.some((handler) => handler());
}

/** Cancel a queued destination when its still-visible current destination is selected again. */
export function cancelPendingForRepeatedDestination(
  current: View,
  target: View,
  cancel: () => void,
): boolean {
  if (current !== target) return false;
  cancel();
  return true;
}

/** A navigation continuation may mutate UI only while its target is still active. */
export function isCurrentNavigation(
  target: View | null,
  generation: number,
  activeGeneration: number,
  activeView: View,
): boolean {
  return target !== null && generation === activeGeneration && activeView === target;
}
