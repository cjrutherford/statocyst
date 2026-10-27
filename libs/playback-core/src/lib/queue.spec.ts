import { describe, expect, it } from 'vitest';
import type { PlaybackCommand } from '@statocyst/contracts';
import {
  advanceAfterEnd,
  applyQueueCommand,
  createQueue,
  currentEntry,
  type QueueContext,
  type QueueModel,
} from './queue';

function context(
  known: string[] = ['a', 'b', 'c', 'd'],
  random: () => number = () => 0.5,
): QueueContext {
  let counter = 0;
  return {
    isKnownTrack: (trackId) => known.includes(trackId),
    createEntryId: (trackId) => `${trackId}-entry-${++counter}`,
    random,
  };
}

function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

function apply(queue: QueueModel, command: PlaybackCommand, ctx = context()) {
  return applyQueueCommand(queue, command, ctx);
}

function applyRaw(queue: QueueModel, command: unknown) {
  return applyQueueCommand(queue, command as PlaybackCommand, context());
}

describe('queue semantics', () => {
  it('rejects play on an empty queue with a typed error', () => {
    const outcome = apply(createQueue(), { type: 'play' });
    expect(outcome.error?.code).toBe('NO_CURRENT_TRACK');
  });

  it('rejects unknown tracks and entries', () => {
    expect(apply(createQueue(), { type: 'play', trackId: 'nope' }).error?.code).toBe(
      'TRACK_NOT_FOUND',
    );
    expect(apply(createQueue(), { type: 'playEntry', entryId: 'nope' }).error?.code).toBe(
      'ENTRY_NOT_FOUND',
    );
    expect(apply(createQueue(), { type: 'remove', entryId: 'nope' }).error?.code).toBe(
      'ENTRY_NOT_FOUND',
    );
    expect(
      apply(createQueue(), { type: 'reorder', entryId: 'nope', toIndex: 0 }).error?.code,
    ).toBe('ENTRY_NOT_FOUND');
  });

  it('rejects invalid arguments without mutating the queue', () => {
    const queue = apply(createQueue(), { type: 'enqueue', trackIds: ['a', 'b'] }).queue;
    const before = JSON.stringify(queue);
    for (const command of [
      { type: 'seek', positionMs: -1 },
      { type: 'setVolume', volume: 2 },
      { type: 'setRepeat', mode: 'sometimes' },
      { type: 'enqueue', trackIds: [] },
      { type: 'reorder', entryId: queue.entries[0].entryId, toIndex: -1 },
    ] as const) {
      expect(applyRaw(queue, command).error?.code).toBe('INVALID_ARGUMENT');
    }
    expect(JSON.stringify(queue)).toBe(before);
  });

  it('enqueues at the end, selects the first entry, and keeps stable entry ids', () => {
    const ctx = context();
    const first = apply(createQueue(), { type: 'enqueue', trackIds: ['a', 'b'] }, ctx);
    expect(first.queue.entries.map((entry) => entry.trackId)).toEqual(['a', 'b']);
    expect(first.queue.currentEntryId).toBe('a-entry-1');
    expect(first.addedEntryIds).toHaveLength(2);
    expect(currentEntry(first.queue)?.trackId).toBe('a');

    const second = apply(first.queue, { type: 'enqueue', trackIds: ['c'] }, ctx);
    expect(second.queue.entries.map((entry) => entry.entryId)).toEqual([
      'a-entry-1',
      'b-entry-2',
      'c-entry-3',
    ]);
    expect(second.queue.currentEntryId).toBe('a-entry-1');
  });

  it('enqueues next to the current entry', () => {
    let queue = apply(createQueue(), { type: 'enqueue', trackIds: ['a', 'b'] }).queue;
    queue = apply(queue, { type: 'enqueue', trackIds: ['c'], position: 'next' }).queue;
    expect(queue.entries.map((entry) => entry.trackId)).toEqual(['a', 'c', 'b']);
  });

  it('play adds a missing track and selects an existing track without duplicating', () => {
    let queue = apply(createQueue(), { type: 'enqueue', trackIds: ['a', 'b'] }).queue;
    queue = apply(queue, { type: 'play', trackId: 'c' }).queue;
    expect(queue.entries.map((entry) => entry.trackId)).toEqual(['a', 'b', 'c']);
    expect(currentEntry(queue)?.trackId).toBe('c');

    const repeated = apply(queue, { type: 'play', trackId: 'a' });
    expect(repeated.queue.entries).toHaveLength(3);
    expect(repeated.selection?.reason).toBe('selected');
    expect(currentEntry(repeated.queue)?.trackId).toBe('a');
  });

  it('skips forward and backward with a history stack', () => {
    let queue = apply(createQueue(), { type: 'enqueue', trackIds: ['a', 'b', 'c'] }).queue;
    queue = apply(queue, { type: 'playEntry', entryId: 'a-entry-1' }).queue;
    queue = apply(queue, { type: 'skipNext' }).queue;
    expect(currentEntry(queue)?.trackId).toBe('b');
    queue = apply(queue, { type: 'skipNext' }).queue;
    expect(currentEntry(queue)?.trackId).toBe('c');
    queue = apply(queue, { type: 'skipPrevious' }).queue;
    expect(currentEntry(queue)?.trackId).toBe('b');
    queue = apply(queue, { type: 'skipPrevious' }).queue;
    expect(currentEntry(queue)?.trackId).toBe('a');
    const restart = apply(queue, { type: 'skipPrevious' });
    expect(restart.selection?.reason).toBe('restart');
    expect(currentEntry(restart.queue)?.trackId).toBe('a');
  });

  it('stops at the end with repeat off and wraps with repeat all', () => {
    let queue = apply(createQueue(), { type: 'enqueue', trackIds: ['a', 'b'] }).queue;
    queue = apply(queue, { type: 'skipNext' }).queue;
    const end = apply(queue, { type: 'skipNext' });
    expect(end.selection).toMatchObject({ reason: 'none', entryId: null });
    expect(currentEntry(end.queue)?.trackId).toBe('b');

    queue = apply(queue, { type: 'setRepeat', mode: 'all' }).queue;
    const wrapped = apply(queue, { type: 'skipNext' });
    expect(wrapped.selection?.reason).toBe('next');
    expect(currentEntry(wrapped.queue)?.trackId).toBe('a');
  });

  it('restarts the track on natural end with repeat one', () => {
    let queue = apply(createQueue(), { type: 'enqueue', trackIds: ['a', 'b'] }).queue;
    queue = apply(queue, { type: 'setRepeat', mode: 'one' }).queue;
    const outcome = advanceAfterEnd(queue, context());
    expect(outcome.selection).toMatchObject({
      reason: 'restart',
      trackId: 'a',
      automatic: true,
    });
    expect(outcome.queue.currentEntryId).toBe('a-entry-1');
  });

  it('advances on natural end otherwise', () => {
    const queue = apply(createQueue(), { type: 'enqueue', trackIds: ['a', 'b'] }).queue;
    const outcome = advanceAfterEnd(queue, context());
    expect(outcome.selection).toMatchObject({ reason: 'next', trackId: 'b', automatic: true });
  });

  it('removes the current entry and selects the following one', () => {
    let queue = apply(createQueue(), { type: 'enqueue', trackIds: ['a', 'b', 'c'] }).queue;
    queue = apply(queue, { type: 'playEntry', entryId: 'b-entry-2' }).queue;
    const removed = apply(queue, { type: 'remove', entryId: 'b-entry-2' });
    expect(removed.removedEntryIds).toEqual(['b-entry-2']);
    expect(removed.selection?.trackId).toBe('c');
    expect(removed.queue.entries.map((entry) => entry.trackId)).toEqual(['a', 'c']);
  });

  it('removes the last entry and selects the previous one', () => {
    let queue = apply(createQueue(), { type: 'enqueue', trackIds: ['a', 'b'] }).queue;
    queue = apply(queue, { type: 'playEntry', entryId: 'b-entry-2' }).queue;
    const removed = apply(queue, { type: 'remove', entryId: 'b-entry-2' });
    expect(removed.selection?.trackId).toBe('a');
  });

  it('clears a queue and reports no selection', () => {
    const queue = apply(createQueue(), { type: 'enqueue', trackIds: ['a', 'b'] }).queue;
    const cleared = apply(queue, { type: 'clear' });
    expect(cleared.queue.entries).toHaveLength(0);
    expect(cleared.queue.currentEntryId).toBeNull();
    expect(cleared.selection?.reason).toBe('none');
    expect(cleared.removedEntryIds).toHaveLength(2);
  });

  it('reorders entries and clamps the target index', () => {
    let queue = apply(createQueue(), { type: 'enqueue', trackIds: ['a', 'b', 'c'] }).queue;
    queue = apply(queue, { type: 'reorder', entryId: 'c-entry-3', toIndex: 0 }).queue;
    expect(queue.entries.map((entry) => entry.trackId)).toEqual(['c', 'a', 'b']);
    queue = apply(queue, { type: 'reorder', entryId: 'c-entry-3', toIndex: 99 }).queue;
    expect(queue.entries.map((entry) => entry.trackId)).toEqual(['a', 'b', 'c']);
  });

  it('shuffles without repeating an entry until the bag is exhausted', () => {
    let queue = apply(createQueue(), { type: 'enqueue', trackIds: ['a', 'b', 'c', 'd'] }, context()).queue;
    queue = apply(queue, { type: 'setShuffle', enabled: true }, context(undefined, seeded(7))).queue;
    const visited = new Set<string>([currentEntry(queue)!.entryId]);
    for (let i = 0; i < 3; i += 1) {
      const outcome = apply(queue, { type: 'skipNext' }, context(undefined, seeded(7 + i)));
      queue = outcome.queue;
      expect(outcome.selection?.reason).toBe('next');
      const entryId = currentEntry(queue)!.entryId;
      expect(visited.has(entryId)).toBe(false);
      visited.add(entryId);
    }
    expect(visited.size).toBe(4);
    expect(apply(queue, { type: 'skipNext' }).selection?.reason).toBe('none');
  });

  it('refills the shuffle bag with repeat all', () => {
    let queue = apply(createQueue(), { type: 'enqueue', trackIds: ['a', 'b'] }, context()).queue;
    queue = apply(queue, { type: 'setShuffle', enabled: true }, context(undefined, seeded(3))).queue;
    queue = apply(queue, { type: 'setRepeat', mode: 'all' }).queue;
    queue = apply(queue, { type: 'skipNext' }, context(undefined, seeded(4))).queue;
    const after = apply(queue, { type: 'skipNext' }, context(undefined, seeded(5)));
    expect(after.selection?.reason).toBe('next');
    expect(after.queue.currentEntryId).not.toBeNull();
  });

  it('does not mutate the input queue', () => {
    const queue = apply(createQueue(), { type: 'enqueue', trackIds: ['a', 'b'] }).queue;
    const snapshot = JSON.stringify(queue);
    apply(queue, { type: 'skipNext' });
    apply(queue, { type: 'remove', entryId: queue.entries[0].entryId });
    apply(queue, { type: 'setShuffle', enabled: true });
    expect(JSON.stringify(queue)).toBe(snapshot);
  });
});
