import { computed, signal } from '@angular/core';
import { describe, expect, it, vi } from 'vitest';
import { cancelPendingForRepeatedDestination, dispatchBack, isCurrentNavigation } from './back-navigation';
import { libraryBackLabel, type LibraryHistoryEntry } from '../views/library-back-label';

describe('back navigation helpers', () => {
  it('stops at the first transient Back handler and reaches the feed on the next Back', () => {
    let expanded = true;
    let selectedFeed = true;
    const dismissExpanded = () => {
      if (!expanded) return false;
      expanded = false;
      return true;
    };
    const closeFeed = () => {
      if (!selectedFeed) return false;
      selectedFeed = false;
      return true;
    };

    expect(dispatchBack(dismissExpanded, closeFeed)).toBe(true);
    expect(expanded).toBe(false);
    expect(selectedFeed).toBe(true);
    expect(dispatchBack(dismissExpanded, closeFeed)).toBe(true);
    expect(selectedFeed).toBe(false);
  });

  it('rejects a stale scroll restore even when its destination becomes active again', () => {
    expect(isCurrentNavigation('library', 3, 4, 'library')).toBe(false);
    expect(isCurrentNavigation('library', 4, 4, 'library')).toBe(true);
    expect(isCurrentNavigation('podcasts', 4, 4, 'library')).toBe(false);
  });

  it('cancels a pending destination when the currently visible destination is selected', () => {
    const cancel = vi.fn();
    expect(cancelPendingForRepeatedDestination('library', 'library', cancel)).toBe(true);
    expect(cancel).toHaveBeenCalledOnce();
    expect(cancelPendingForRepeatedDestination('library', 'podcasts', cancel)).toBe(false);
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('recomputes the library Back label when detail history changes', () => {
    const history = signal<LibraryHistoryEntry[]>([{ mode: 'albums', detail: null, scrollTop: 0 }]);
    const label = computed(() => libraryBackLabel(history(), ''));
    expect(label()).toBe('Albums');
    history.set([{ mode: 'tracks', detail: { kind: 'artist', artist: 'A. Artist' }, scrollTop: 12 }]);
    expect(label()).toBe('A. Artist');
  });
});
