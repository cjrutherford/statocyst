/**
 * Language-neutral playback contract, mirrored by
 * `libs/contracts/schema/playback.schema.json` and exercised by fixtures.
 *
 * The same vocabulary is implemented by the Electron runtime today and must be
 * implemented by Media3 on Android without sharing executable code.
 */

export const PLAYBACK_CONTRACT_VERSION = 1 as const;

export const PLAYBACK_STATES = [
  'idle',
  'buffering',
  'playing',
  'paused',
  'ended',
  'error',
  'waiting-network',
] as const;
export type PlaybackState = (typeof PLAYBACK_STATES)[number];

export const REPEAT_MODES = ['off', 'all', 'one'] as const;
export type RepeatMode = (typeof REPEAT_MODES)[number];

/** A media row is either music or a podcast episode. */
export type MediaKind = 'music' | 'podcast';

/** The primary presentation of a podcast episode. Video is still a podcast. */
export type MediaForm = 'audio' | 'video';

/** How the current episode is presented; audio remains authoritative. */
export type Presentation = 'audio-only' | 'video';

/**
 * The active audio context. Each running instance has one authoritative queue
 * at a time; the inactive context is persisted state, not a second player.
 */
export type PlaybackContext = 'music' | 'podcast';

export const ERROR_CODES = [
  'INVALID_ARGUMENT',
  'TRACK_NOT_FOUND',
  'ENTRY_NOT_FOUND',
  'NO_CURRENT_TRACK',
  'UNSUPPORTED_MEDIA',
  'MEDIA_UNAVAILABLE',
  'ENGINE_UNAVAILABLE',
  'DATABASE_ERROR',
  'IMPORT_FAILED',
  'UNAUTHORIZED',
  'INSUFFICIENT_SPACE',
  'INTERNAL_ERROR',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export interface CommandError {
  code: ErrorCode;
  message: string;
  details?: Record<string, unknown>;
}

export type Result<T> = { ok: true; value: T } | { ok: false; error: CommandError };

export interface Track {
  id: string;
  title: string;
  artist: string;
  album: string;
  albumArtist?: string;
  durationMs: number;
  artworkUrl: string | null;
  /** Artist photo (Android, only when online artwork is enabled). */
  artistArtworkUrl?: string | null;
  sourceId: string;
  sourceLabel: string;
  /** Runtime source kind: `local`, `demo`, `jellyfin`, or `podcast`. Optional for older hosts. */
  sourceKind?: string;
  /** Media kind; absent on older hosts means music. */
  mediaKind?: MediaKind;
  /** Primary presentation; absent on older hosts means audio. */
  mediaForm?: MediaForm;
  /** True when the episode has a video form, even if audio is primary. */
  videoAvailable?: boolean;
  trackNo?: number | null;
  year?: number | null;
  genre?: string | null;
  format?: string | null;
  /** Size of the original media in bytes; 0 or undefined when the source does not report it. */
  sizeBytes?: number;
  /** Source bitrate in bits per second, when known. */
  bitrate?: number | null;
  missing: boolean;
  /** Ids of the same recording on other servers, hidden behind this row. */
  aliases?: string[];
}

export interface QueueEntry {
  entryId: string;
  trackId: string;
}

export interface QueueEntryView extends QueueEntry {
  track: Track;
}

export interface QueueSnapshot {
  entries: QueueEntryView[];
  currentEntryId: string | null;
  shuffle: boolean;
  repeat: RepeatMode;
  context: PlaybackContext;
  active: boolean;
}

export interface PlaybackSnapshot {
  state: PlaybackState;
  currentEntryId: string | null;
  positionMs: number;
  durationMs: number;
  volume: number;
  muted: boolean;
  shuffle: boolean;
  repeat: RepeatMode;
  rate: number;
  context: PlaybackContext;
  active: boolean;
  /** Presentation of the current episode; audio for music and audio-only episodes. */
  mediaForm: MediaForm;
  presentation: Presentation;
  /** True when the current episode has a video form available, even if audio is primary. */
  videoAvailable?: boolean;
  track: Track | null;
}

export type PlaybackCommand =
  /**
   * `contextTrackIds` is the list the track was picked from (album, search
   * result, playlist). When given, it replaces the queue so next/previous and
   * shuffle operate on that context instead of on stale queue leftovers.
   */
  | { type: 'play'; trackId?: string; contextTrackIds?: string[] }
  | { type: 'playEntry'; entryId: string }
  | { type: 'pause' }
  | { type: 'seek'; positionMs: number }
  | { type: 'skipNext' }
  | { type: 'skipPrevious' }
  | { type: 'enqueue'; trackIds: string[]; position?: 'end' | 'next' }
  | { type: 'playNext'; trackId: string }
  | { type: 'remove'; entryId: string }
  | { type: 'reorder'; entryId: string; toIndex: number }
  | { type: 'setShuffle'; enabled: boolean }
  | { type: 'setRepeat'; mode: RepeatMode }
  | { type: 'setVolume'; volume: number }
  | { type: 'setMuted'; muted: boolean }
  | { type: 'setRate'; rate: number }
  | { type: 'setPresentation'; mode: Presentation }
  | { type: 'clear' };

export type PlaybackCommandName = PlaybackCommand['type'];

export const PLAYBACK_COMMANDS: readonly PlaybackCommandName[] = [
  'play',
  'playEntry',
  'pause',
  'seek',
  'skipNext',
  'skipPrevious',
  'enqueue',
  'playNext',
  'remove',
  'reorder',
  'setShuffle',
  'setRepeat',
  'setVolume',
  'setMuted',
  'setRate',
  'setPresentation',
  'clear',
] as const;

export type PlaybackEvent =
  | { type: 'stateChanged'; snapshot: PlaybackSnapshot }
  | { type: 'positionChanged'; positionMs: number; durationMs: number }
  | { type: 'queueChanged'; queue: QueueSnapshot }
  | { type: 'trackChanged'; entry: QueueEntryView }
  | { type: 'error'; error: CommandError };

export type PlaybackEventName = PlaybackEvent['type'];

export const PLAYBACK_EVENTS: readonly PlaybackEventName[] = [
  'stateChanged',
  'positionChanged',
  'queueChanged',
  'trackChanged',
  'error',
] as const;

export const PLAYBACK_INVARIANTS = [
  'oneAuthoritativeQueuePerRuntime',
  'stableEntryIds',
  'nativeAndroidPlaybackIndependentOfWebView',
  'persistQueueWithoutCredentials',
] as const;

export function isPlaybackState(value: unknown): value is PlaybackState {
  return typeof value === 'string' && (PLAYBACK_STATES as readonly string[]).includes(value);
}

export function isRepeatMode(value: unknown): value is RepeatMode {
  return typeof value === 'string' && (REPEAT_MODES as readonly string[]).includes(value);
}

export function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

export function fail<T>(code: ErrorCode, message: string, details?: Record<string, unknown>): Result<T> {
  return { ok: false, error: { code, message, ...(details ? { details } : {}) } };
}
