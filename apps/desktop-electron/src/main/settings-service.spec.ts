import { describe, expect, it } from 'vitest';
import type { StatocystDatabase } from '@statocyst/persistence';
import type { Logger } from './logger';
import { DEFAULT_SETTINGS, SettingsService } from './settings-service';

function makeService(): { service: SettingsService; state: Map<string, string> } {
  const state = new Map<string, string>();
  const database = {
    getAppState: async (key: string) => state.get(key) ?? null,
    setAppState: async (key: string, value: string) => {
      state.set(key, value);
    },
  } as unknown as StatocystDatabase;
  const logger = { warn: () => undefined } as unknown as Logger;
  return { service: new SettingsService(database, logger), state };
}

describe('SettingsService privacy policy', () => {
  it('defaults listening history off (ADR-015 opt-in)', () => {
    expect(DEFAULT_SETTINGS.listeningHistory).toBe(false);
  });

  it('persists an explicit listening-history choice', async () => {
    const { service, state } = makeService();
    await service.init();
    expect(service.get().listeningHistory).toBe(false);

    await service.update({ listeningHistory: true });
    expect(service.get().listeningHistory).toBe(true);
    expect(JSON.parse(state.get('settings') ?? '{}').listeningHistory).toBe(true);

    await service.update({ listeningHistory: false });
    expect(service.get().listeningHistory).toBe(false);
  });

  it('ignores non-boolean values from a corrupt settings blob', async () => {
    const { service, state } = makeService();
    state.set(
      'settings',
      JSON.stringify({ ...DEFAULT_SETTINGS, listeningHistory: 'yes-please' }),
    );
    await service.init();
    expect(service.get().listeningHistory).toBe(false);
  });
});
