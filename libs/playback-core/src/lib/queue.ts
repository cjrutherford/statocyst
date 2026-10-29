import type { PlaybackCommand, RepeatMode } from '@statocyst/contracts';

export interface QueueEntryModel {
  entryId: string;
  trackId: string;
}

export interface QueueModel {
  entries: QueueEntryModel[];
  currentEntryId: string | null;
  shuffle: boolean;
  repeat: RepeatMode;
  /** Entry ids not yet visited in the current shuffle cycle. */
  shuffleRemaining: string[];
  /** Previously selected entry ids, most recent last. */
  history: string[];
}

export interface QueueContext {
  isKnownTrack(trackId: string): boolean;
  createEntryId(trackId: string): string;
  random?: () => number;
}

export type QueueSelectionReason =
  | 'started'
  | 'selected'
  | 'next'
  | 'previous'
  | 'restart'
  | 'none';

export interface QueueOutcome {
  queue: QueueModel;
  error?: { code: 'INVALID_ARGUMENT' | 'TRACK_NOT_FOUND' | 'ENTRY_NOT_FOUND' | 'NO_CURRENT_TRACK'; message: string };
  selection?: {
    reason: QueueSelectionReason;
    entryId: string | null;
    trackId: string | null;
    /** True when selection happened because playback naturally ended. */
    automatic: boolean;
  };
  addedEntryIds: string[];
  removedEntryIds: string[];
  queueChanged: boolean;
  selectionChanged: boolean;
  shuffleChanged: boolean;
  repeatChanged: boolean;
}

let fallbackCounter = 0;

export function defaultEntryId(trackId: string): string {
  const cryptoApi = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (cryptoApi?.randomUUID) {
    return `q_${cryptoApi.randomUUID()}`;
  }
  fallbackCounter += 1;
  return `q_${trackId}_${fallbackCounter}`;
}

export function createQueue(): QueueModel {
  return {
    entries: [],
    currentEntryId: null,
    shuffle: false,
    repeat: 'off',
    shuffleRemaining: [],
    history: [],
  };
}

function clone(queue: QueueModel): QueueModel {
  return {
    ...queue,
    entries: queue.entries.map((entry) => ({ ...entry })),
    shuffleRemaining: [...queue.shuffleRemaining],
    history: [...queue.history],
  };
}

function failure(
  queue: QueueModel,
  code: NonNullable<QueueOutcome['error']>['code'],
  message: string,
): QueueOutcome {
  return {
    queue,
    error: { code, message },
    addedEntryIds: [],
    removedEntryIds: [],
    queueChanged: false,
    selectionChanged: false,
    shuffleChanged: false,
    repeatChanged: false,
  };
}

function shuffleInPlace<T>(items: T[], random: () => number): T[] {
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

function makeShuffleBag(entries: QueueEntryModel[], exclude: string | null, random: () => number) {
  return shuffleInPlace(
    entries.map((entry) => entry.entryId).filter((entryId) => entryId !== exclude),
    random,
  );
}

function currentIndex(queue: QueueModel): number {
  if (!queue.currentEntryId) return -1;
  return queue.entries.findIndex((entry) => entry.entryId === queue.currentEntryId);
}

function select(queue: QueueModel, entryId: string, reason: QueueSelectionReason): QueueModel {
  if (queue.currentEntryId && queue.currentEntryId !== entryId) {
    queue.history.push(queue.currentEntryId);
    const maxHistory = Math.max(queue.entries.length, 8);
    if (queue.history.length > maxHistory) queue.history.shift();
  }
  queue.currentEntryId = entryId;
  queue.shuffleRemaining = queue.shuffleRemaining.filter((id) => id !== entryId);
  return queue;
}

export function applyQueueCommand(
  source: QueueModel,
  command: PlaybackCommand,
  context: QueueContext,
  options: { automatic?: boolean } = {},
): QueueOutcome {
  const random = context.random ?? Math.random;
  const queue = clone(source);
  const addedEntryIds: string[] = [];
  const removedEntryIds: string[] = [];
  let selection: QueueOutcome['selection'];
  let queueChanged = false;
  let selectionChanged = false;
  let shuffleChanged = false;
  let repeatChanged = false;

  const finish = (): QueueOutcome => ({
    queue,
    ...(selection ? { selection } : {}),
    addedEntryIds,
    removedEntryIds,
    queueChanged,
    selectionChanged,
    shuffleChanged,
    repeatChanged,
  });

  const selectEntry = (entryId: string, reason: QueueSelectionReason, automatic = false) => {
    const entry = queue.entries.find((candidate) => candidate.entryId === entryId);
    if (!entry) return false;
    if (queue.currentEntryId !== entryId) {
      select(queue, entryId, reason);
      selectionChanged = true;
    }
    selection = { reason, entryId, trackId: entry.trackId, automatic };
    return true;
  };

  const stepForward = (automatic: boolean): boolean => {
    if (queue.entries.length === 0) {
      selection = { reason: 'none', entryId: null, trackId: null, automatic };
      return false;
    }

    if (automatic && queue.repeat === 'one' && queue.currentEntryId) {
      const current = queue.entries.find((entry) => entry.entryId === queue.currentEntryId);
      if (current) {
        selection = {
          reason: 'restart',
          entryId: current.entryId,
          trackId: current.trackId,
          automatic,
        };
        return true;
      }
    }

    if (queue.shuffle) {
      let nextId: string | undefined;
      while (queue.shuffleRemaining.length > 0 && !nextId) {
        const candidate = queue.shuffleRemaining.shift();
        if (candidate && queue.entries.some((entry) => entry.entryId === candidate)) {
          nextId = candidate;
        }
      }
      if (!nextId && queue.repeat === 'all') {
        queue.shuffleRemaining = makeShuffleBag(queue.entries, queue.currentEntryId, random);
        nextId = queue.shuffleRemaining.shift();
        // A one-entry queue has nothing else to draw: replay it.
        if (!nextId && queue.entries.length === 1) nextId = queue.entries[0].entryId;
      }
      if (nextId) {
        selectEntry(nextId, nextId === queue.currentEntryId ? 'restart' : 'next', automatic);
        return true;
      }
      selection = { reason: 'none', entryId: null, trackId: null, automatic };
      return false;
    }

    const index = currentIndex(queue);
    const next = queue.entries[index + 1];
    if (next) {
      selectEntry(next.entryId, 'next', automatic);
      return true;
    }
    if (queue.repeat === 'all' && queue.entries.length > 0) {
      const first = queue.entries[0];
      selectEntry(first.entryId, first.entryId === queue.currentEntryId ? 'restart' : 'next', automatic);
      return true;
    }
    selection = { reason: 'none', entryId: null, trackId: null, automatic };
    return false;
  };

  switch (command.type) {
    case 'play': {
      if (command.trackId) {
        if (!context.isKnownTrack(command.trackId)) {
          return failure(source, 'TRACK_NOT_FOUND', `Track ${command.trackId} is not in the library`);
        }
        if (command.contextTrackIds && command.contextTrackIds.length > 0) {
          const ids = command.contextTrackIds.filter((id) => context.isKnownTrack(id));
          if (!ids.includes(command.trackId)) ids.unshift(command.trackId);
          removedEntryIds.push(...queue.entries.map((entry) => entry.entryId));
          queue.entries = ids.map((trackId) => ({ entryId: context.createEntryId(trackId), trackId }));
          queue.history = [];
          queue.currentEntryId = null;
          queue.shuffleRemaining = queue.shuffle ? queue.entries.map((entry) => entry.entryId) : [];
          addedEntryIds.push(...queue.entries.map((entry) => entry.entryId));
          queueChanged = true;
          const target = queue.entries[ids.indexOf(command.trackId)];
          selectEntry(target.entryId, 'started');
          break;
        }
        const existing = queue.entries.find((entry) => entry.trackId === command.trackId);
        if (existing) {
          selectEntry(existing.entryId, 'selected');
          break;
        }
        const entryId = context.createEntryId(command.trackId);
        queue.entries.push({ entryId, trackId: command.trackId });
        queue.shuffleRemaining.push(entryId);
        addedEntryIds.push(entryId);
        queueChanged = true;
        selectEntry(entryId, 'started');
        break;
      }
      if (queue.currentEntryId) {
        selectEntry(queue.currentEntryId, 'selected');
        break;
      }
      const first = queue.entries[0];
      if (first) {
        selectEntry(first.entryId, 'started');
        break;
      }
      return failure(source, 'NO_CURRENT_TRACK', 'The queue is empty');
    }

    case 'playEntry': {
      if (!queue.entries.some((entry) => entry.entryId === command.entryId)) {
        return failure(source, 'ENTRY_NOT_FOUND', `Queue entry ${command.entryId} does not exist`);
      }
      selectEntry(command.entryId, 'selected');
      break;
    }

    case 'pause':
      break;

    case 'seek':
      if (!Number.isFinite(command.positionMs) || command.positionMs < 0) {
        return failure(source, 'INVALID_ARGUMENT', 'Seek position must be a non-negative number');
      }
      break;

    case 'skipNext': {
      if (queue.entries.length === 0) {
        return failure(source, 'NO_CURRENT_TRACK', 'The queue is empty');
      }
      stepForward(options.automatic === true);
      break;
    }

    case 'skipPrevious': {
      if (queue.entries.length === 0) {
        return failure(source, 'NO_CURRENT_TRACK', 'The queue is empty');
      }
      const previousId = queue.history.pop();
      if (previousId && queue.entries.some((entry) => entry.entryId === previousId)) {
        const entry = queue.entries.find((candidate) => candidate.entryId === previousId)!;
        queue.currentEntryId = previousId;
        queue.shuffleRemaining = queue.shuffleRemaining.filter((id) => id !== previousId);
        selection = { reason: 'previous', entryId: entry.entryId, trackId: entry.trackId, automatic: false };
        selectionChanged = true;
        break;
      }
      const index = currentIndex(queue);
      if (index > 0) {
        selectEntry(queue.entries[index - 1].entryId, 'previous');
      } else if (queue.currentEntryId) {
        selection = {
          reason: 'restart',
          entryId: queue.currentEntryId,
          trackId: queue.entries[index]?.trackId ?? null,
          automatic: false,
        };
      } else {
        selectEntry(queue.entries[0].entryId, 'previous');
      }
      break;
    }

    case 'enqueue': {
      if (command.position !== undefined && command.position !== 'end' && command.position !== 'next') {
        return failure(source, 'INVALID_ARGUMENT', 'Enqueue position must be "end" or "next"');
      }
      if (!Array.isArray(command.trackIds) || command.trackIds.length === 0) {
        return failure(source, 'INVALID_ARGUMENT', 'At least one track id is required');
      }
      for (const trackId of command.trackIds) {
        if (typeof trackId !== 'string' || trackId.length === 0) {
          return failure(source, 'INVALID_ARGUMENT', 'Track ids must be non-empty strings');
        }
        if (!context.isKnownTrack(trackId)) {
          return failure(source, 'TRACK_NOT_FOUND', `Track ${trackId} is not in the library`);
        }
      }
      const insertionIndex =
        command.position === 'next'
          ? Math.max(currentIndex(queue) + 1, 0)
          : queue.entries.length;
      const newEntries = command.trackIds.map((trackId) => ({
        entryId: context.createEntryId(trackId),
        trackId,
      }));
      queue.entries.splice(insertionIndex, 0, ...newEntries);
      for (const entry of newEntries) {
        queue.shuffleRemaining.push(entry.entryId);
        addedEntryIds.push(entry.entryId);
      }
      if (queue.shuffle) {
        queue.shuffleRemaining = shuffleInPlace(queue.shuffleRemaining, random);
      }
      queueChanged = true;
      if (!queue.currentEntryId && newEntries.length > 0) {
        selectEntry(newEntries[0].entryId, 'started');
      }
      break;
    }

    case 'playNext': {
      if (!context.isKnownTrack(command.trackId)) {
        return failure(source, 'TRACK_NOT_FOUND', `Track ${command.trackId} is not in the library`);
      }
      const entry = { entryId: context.createEntryId(command.trackId), trackId: command.trackId };
      queue.entries.splice(Math.max(currentIndex(queue) + 1, 0), 0, entry);
      queue.shuffleRemaining.push(entry.entryId);
      if (queue.shuffle) queue.shuffleRemaining = shuffleInPlace(queue.shuffleRemaining, random);
      addedEntryIds.push(entry.entryId);
      queueChanged = true;
      if (!queue.currentEntryId) selectEntry(entry.entryId, 'started');
      break;
    }

    case 'remove': {
      const index = queue.entries.findIndex((entry) => entry.entryId === command.entryId);
      if (index === -1) {
        return failure(source, 'ENTRY_NOT_FOUND', `Queue entry ${command.entryId} does not exist`);
      }
      const [removed] = queue.entries.splice(index, 1);
      removedEntryIds.push(removed.entryId);
      queue.shuffleRemaining = queue.shuffleRemaining.filter((id) => id !== command.entryId);
      queue.history = queue.history.filter((id) => id !== command.entryId);
      queueChanged = true;
      if (queue.currentEntryId === command.entryId) {
        const replacement = queue.entries[index] ?? queue.entries[index - 1] ?? null;
        if (replacement) {
          queue.currentEntryId = replacement.entryId;
          selection = {
            reason: 'selected',
            entryId: replacement.entryId,
            trackId: replacement.trackId,
            automatic: false,
          };
          selectionChanged = true;
        } else {
          queue.currentEntryId = null;
          selection = { reason: 'none', entryId: null, trackId: null, automatic: false };
          selectionChanged = true;
        }
      }
      break;
    }

    case 'reorder': {
      const index = queue.entries.findIndex((entry) => entry.entryId === command.entryId);
      if (index === -1) {
        return failure(source, 'ENTRY_NOT_FOUND', `Queue entry ${command.entryId} does not exist`);
      }
      if (!Number.isInteger(command.toIndex) || command.toIndex < 0) {
        return failure(source, 'INVALID_ARGUMENT', 'Target index must be a non-negative integer');
      }
      const target = Math.min(command.toIndex, queue.entries.length - 1);
      if (target !== index) {
        const [entry] = queue.entries.splice(index, 1);
        queue.entries.splice(target, 0, entry);
        queueChanged = true;
      }
      break;
    }

    case 'setShuffle': {
      if (typeof command.enabled !== 'boolean') {
        return failure(source, 'INVALID_ARGUMENT', 'Shuffle flag must be a boolean');
      }
      if (queue.shuffle !== command.enabled) {
        queue.shuffle = command.enabled;
        queue.shuffleRemaining = command.enabled
          ? makeShuffleBag(queue.entries, queue.currentEntryId, random)
          : [];
        shuffleChanged = true;
      }
      break;
    }

    case 'setRepeat': {
      if (command.mode !== 'off' && command.mode !== 'all' && command.mode !== 'one') {
        return failure(source, 'INVALID_ARGUMENT', 'Repeat mode must be off, all or one');
      }
      if (queue.repeat !== command.mode) {
        queue.repeat = command.mode;
        repeatChanged = true;
      }
      break;
    }

    case 'setVolume': {
      if (!Number.isFinite(command.volume) || command.volume < 0 || command.volume > 1) {
        return failure(source, 'INVALID_ARGUMENT', 'Volume must be between 0 and 1');
      }
      break;
    }

    case 'setMuted': {
      if (typeof command.muted !== 'boolean') {
        return failure(source, 'INVALID_ARGUMENT', 'Mute flag must be a boolean');
      }
      break;
    }

    case 'clear': {
      if (queue.entries.length > 0) {
        removedEntryIds.push(...queue.entries.map((entry) => entry.entryId));
        queue.entries = [];
        queue.shuffleRemaining = [];
        queue.history = [];
        queue.currentEntryId = null;
        queueChanged = true;
        selectionChanged = true;
        selection = { reason: 'none', entryId: null, trackId: null, automatic: false };
      }
      break;
    }

    default: {
      return failure(source, 'INVALID_ARGUMENT', 'Unknown playback command');
    }
  }

  return finish();
}

/**
 * Advance for natural track completion. Applies repeat-one and wraps the queue
 * according to repeat-all; returns reason "none" when playback should stop.
 */
export function advanceAfterEnd(queue: QueueModel, context: QueueContext): QueueOutcome {
  if (queue.repeat === 'one' && queue.currentEntryId) {
    const entry = currentEntry(queue);
    if (entry) {
      return {
        queue,
        selection: {
          reason: 'restart',
          entryId: entry.entryId,
          trackId: entry.trackId,
          automatic: true,
        },
        addedEntryIds: [],
        removedEntryIds: [],
        queueChanged: false,
        selectionChanged: false,
        shuffleChanged: false,
        repeatChanged: false,
      };
    }
  }
  return applyQueueCommand(queue, { type: 'skipNext' }, context, { automatic: true });
}

export function currentEntry(queue: QueueModel): QueueEntryModel | null {
  if (!queue.currentEntryId) return null;
  return queue.entries.find((entry) => entry.entryId === queue.currentEntryId) ?? null;
}

export function queueTrackIds(queue: QueueModel): string[] {
  return queue.entries.map((entry) => entry.trackId);
}
