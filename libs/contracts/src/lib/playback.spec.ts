import { describe, expect, it } from 'vitest';
import Ajv2020 from 'ajv/dist/2020';
import schema from '../../schema/playback.schema.json';
import validCommands from '../../fixtures/commands.valid.json';
import invalidCommands from '../../fixtures/commands.invalid.json';
import eventFixture from '../../fixtures/events.json';
import architectureContract from '../../../../statocyst-architecture-pack/contracts/playback-contract.json';
import {
  PLAYBACK_COMMANDS,
  PLAYBACK_EVENTS,
  PLAYBACK_STATES,
  REPEAT_MODES,
  ERROR_CODES,
  PLAYBACK_CONTRACT_VERSION,
  validatePlaybackCommand,
} from '../index';

const ajv = new Ajv2020({ allErrors: true, strict: false });
ajv.addSchema(schema);
const validateCommand = ajv.getSchema<unknown>(
  'https://statocyst.local/contracts/playback.schema.json#/$defs/command',
)!;
const validateEvent = ajv.getSchema<unknown>(
  'https://statocyst.local/contracts/playback.schema.json#/$defs/event',
)!;
const validateResult = ajv.getSchema<unknown>(
  'https://statocyst.local/contracts/playback.schema.json#/$defs/commandResult',
)!;
const validateSnapshot = ajv.getSchema<unknown>(
  'https://statocyst.local/contracts/playback.schema.json#/$defs/playbackSnapshot',
)!;

describe('playback contract schema', () => {
  it('accepts every valid command fixture', () => {
    for (const command of validCommands) {
      expect(validateCommand(command), JSON.stringify(validateCommand.errors)).toBe(true);
    }
  });

  it('rejects every invalid command fixture', () => {
    for (const command of invalidCommands) {
      expect(validateCommand(command)).toBe(false);
    }
  });

  it('accepts every event fixture', () => {
    for (const event of eventFixture.events) {
      expect(validateEvent(event), JSON.stringify(validateEvent.errors)).toBe(true);
    }
  });

  it('accepts typed success and failure results', () => {
    expect(
      validateResult({
        ok: false,
        error: { code: 'TRACK_NOT_FOUND', message: 'Track not found' },
      }),
    ).toBe(true);
    expect(
      validateResult({
        ok: true,
        value: {
          state: 'idle',
          currentEntryId: null,
          positionMs: 0,
          durationMs: 0,
          volume: 1,
          muted: false,
          shuffle: false,
          repeat: 'off',
          track: null,
        },
      }),
    ).toBe(true);
    expect(validateResult({ ok: true, value: { state: 'bogus' } })).toBe(false);
  });

  it('accepts a complete snapshot', () => {
    const snapshot = (
      eventFixture.events.find((event) => event.type === 'stateChanged') as {
        snapshot: unknown;
      }
    ).snapshot;
    expect(validateSnapshot(snapshot), JSON.stringify(validateSnapshot.errors)).toBe(true);
  });

  it('keeps language-neutral enums in lockstep with TypeScript constants', () => {
    const defs = (schema as { $defs: Record<string, { enum?: string[] }> }).$defs;
    expect(defs['playbackState'].enum).toEqual([...PLAYBACK_STATES]);
    expect(defs['repeatMode'].enum).toEqual([...REPEAT_MODES]);
    expect(defs['errorCode'].enum).toEqual([...ERROR_CODES]);

    const commandNames = new Set(
      (defs['command'] as unknown as { oneOf: Array<{ properties: { type: { const: string } } }> })
        .oneOf.map((branch) => branch.properties.type.const),
    );
    expect(commandNames).toEqual(new Set(PLAYBACK_COMMANDS));

    const eventNames = new Set(
      (defs['event'] as unknown as { oneOf: Array<{ properties: { type: { const: string } } }> })
        .oneOf.map((branch) => branch.properties.type.const),
    );
    expect(eventNames).toEqual(new Set(PLAYBACK_EVENTS));
  });

  it('keeps the IPC runtime guard aligned with schema fixtures', () => {
    for (const command of validCommands) {
      const result = validatePlaybackCommand(command);
      expect(result.ok, JSON.stringify(command)).toBe(true);
    }
    for (const command of invalidCommands) {
      expect(validatePlaybackCommand(command).ok).toBe(false);
    }
    expect(validatePlaybackCommand({ type: 'pause', unexpected: true }).ok).toBe(false);
    expect(validatePlaybackCommand(null).ok).toBe(false);
  });

  it('supersets the architecture-pack contract vocabulary', () => {
    expect(PLAYBACK_CONTRACT_VERSION).toBe(architectureContract.schemaVersion);
    for (const command of architectureContract.commands) {
      expect(PLAYBACK_COMMANDS, `missing command ${command}`).toContain(command);
    }
    for (const event of architectureContract.events) {
      expect(PLAYBACK_EVENTS, `missing event ${event}`).toContain(event);
    }
    for (const state of architectureContract.state) {
      expect(PLAYBACK_STATES, `missing state ${state}`).toContain(state);
    }
  });
});
