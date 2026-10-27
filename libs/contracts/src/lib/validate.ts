import type { PlaybackCommand, Result } from './playback';
import { fail, ok } from './playback';

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: JsonObject, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isNonNegativeNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function isUnitInterval(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}

function isIndex(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

/**
 * Runtime guard for IPC input. The JSON Schema is the cross-language source of
 * truth; this guard mirrors it and additionally rejects unknown keys so a
 * compromised renderer cannot smuggle fields into main-process handlers.
 */
export function validatePlaybackCommand(value: unknown): Result<PlaybackCommand> {
  if (!isObject(value) || typeof value['type'] !== 'string') {
    return fail('INVALID_ARGUMENT', 'Playback command must be an object with a type');
  }
  const type = value['type'];

  switch (type) {
    case 'play':
      if (!hasOnlyKeys(value, ['type', 'trackId'])) {
        return fail('INVALID_ARGUMENT', 'Unexpected field on play command');
      }
      if (value['trackId'] !== undefined && !isNonEmptyString(value['trackId'])) {
        return fail('INVALID_ARGUMENT', 'trackId must be a non-empty string');
      }
      return ok({ type: 'play', ...(value['trackId'] ? { trackId: value['trackId'] } : {}) });

    case 'playEntry':
      if (!hasOnlyKeys(value, ['type', 'entryId']) || !isNonEmptyString(value['entryId'])) {
        return fail('INVALID_ARGUMENT', 'playEntry requires an entryId');
      }
      return ok({ type: 'playEntry', entryId: value['entryId'] });

    case 'pause':
      if (!hasOnlyKeys(value, ['type'])) {
        return fail('INVALID_ARGUMENT', 'Unexpected field on pause command');
      }
      return ok({ type: 'pause' });

    case 'seek':
      if (!hasOnlyKeys(value, ['type', 'positionMs']) || !isNonNegativeNumber(value['positionMs'])) {
        return fail('INVALID_ARGUMENT', 'seek requires a non-negative positionMs');
      }
      return ok({ type: 'seek', positionMs: value['positionMs'] });

    case 'skipNext':
    case 'skipPrevious':
      if (!hasOnlyKeys(value, ['type'])) {
        return fail('INVALID_ARGUMENT', `Unexpected field on ${type} command`);
      }
      return ok({ type });

    case 'enqueue': {
      if (!hasOnlyKeys(value, ['type', 'trackIds', 'position'])) {
        return fail('INVALID_ARGUMENT', 'Unexpected field on enqueue command');
      }
      const trackIds = value['trackIds'];
      if (
        !Array.isArray(trackIds) ||
        trackIds.length === 0 ||
        trackIds.length > 10_000 ||
        !trackIds.every(isNonEmptyString) ||
        new Set(trackIds).size !== trackIds.length
      ) {
        return fail('INVALID_ARGUMENT', 'enqueue requires unique, non-empty trackIds');
      }
      if (
        value['position'] !== undefined &&
        value['position'] !== 'end' &&
        value['position'] !== 'next'
      ) {
        return fail('INVALID_ARGUMENT', 'position must be "end" or "next"');
      }
      return ok({
        type: 'enqueue',
        trackIds: trackIds as string[],
        ...(value['position'] ? { position: value['position'] as 'end' | 'next' } : {}),
      });
    }

    case 'playNext':
      if (!hasOnlyKeys(value, ['type', 'trackId']) || !isNonEmptyString(value['trackId'])) {
        return fail('INVALID_ARGUMENT', 'playNext requires a trackId');
      }
      return ok({ type: 'playNext', trackId: value['trackId'] });

    case 'remove':
      if (!hasOnlyKeys(value, ['type', 'entryId']) || !isNonEmptyString(value['entryId'])) {
        return fail('INVALID_ARGUMENT', 'remove requires an entryId');
      }
      return ok({ type: 'remove', entryId: value['entryId'] });

    case 'reorder':
      if (
        !hasOnlyKeys(value, ['type', 'entryId', 'toIndex']) ||
        !isNonEmptyString(value['entryId']) ||
        !isIndex(value['toIndex'])
      ) {
        return fail('INVALID_ARGUMENT', 'reorder requires an entryId and non-negative toIndex');
      }
      return ok({ type: 'reorder', entryId: value['entryId'], toIndex: value['toIndex'] });

    case 'setShuffle':
      if (!hasOnlyKeys(value, ['type', 'enabled']) || typeof value['enabled'] !== 'boolean') {
        return fail('INVALID_ARGUMENT', 'setShuffle requires an enabled boolean');
      }
      return ok({ type: 'setShuffle', enabled: value['enabled'] });

    case 'setRepeat':
      if (
        !hasOnlyKeys(value, ['type', 'mode']) ||
        (value['mode'] !== 'off' && value['mode'] !== 'all' && value['mode'] !== 'one')
      ) {
        return fail('INVALID_ARGUMENT', 'setRepeat mode must be off, all or one');
      }
      return ok({ type: 'setRepeat', mode: value['mode'] });

    case 'setVolume':
      if (!hasOnlyKeys(value, ['type', 'volume']) || !isUnitInterval(value['volume'])) {
        return fail('INVALID_ARGUMENT', 'setVolume requires a volume between 0 and 1');
      }
      return ok({ type: 'setVolume', volume: value['volume'] });

    case 'setMuted':
      if (!hasOnlyKeys(value, ['type', 'muted']) || typeof value['muted'] !== 'boolean') {
        return fail('INVALID_ARGUMENT', 'setMuted requires a muted boolean');
      }
      return ok({ type: 'setMuted', muted: value['muted'] });

    case 'clear':
      if (!hasOnlyKeys(value, ['type'])) {
        return fail('INVALID_ARGUMENT', 'Unexpected field on clear command');
      }
      return ok({ type: 'clear' });

    default:
      return fail('INVALID_ARGUMENT', `Unknown playback command: ${type}`);
  }
}
