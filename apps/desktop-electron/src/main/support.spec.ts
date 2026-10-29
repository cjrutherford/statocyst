import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { StatocystDatabase } from '@statocyst/persistence';
import { buildSupportBundle, collectHealth } from './support';

const APP = {
  name: 'Statocyst',
  version: '0.1.0',
  electron: '45',
  chrome: '140',
  node: '24',
  platform: 'linux x64',
  dataPath: '/home/tester/.local/share/statocyst',
  databasePath: '/home/tester/.local/share/statocyst/statocyst.db',
  logPath: '/home/tester/.local/share/statocyst/logs/main.jsonl',
  packaged: false,
};

const DIAGNOSTICS = {
  databasePath: APP.databasePath,
  logPath: APP.logPath,
  databaseBytes: 4096,
  cacheBytes: 2048,
  schemaVersion: 5,
  integrity: 'ok' as const,
  queueEntries: 0,
  trackCount: 4,
};

const SETTINGS = {
  theme: 'dark' as const,
  density: 'comfortable' as const,
  volume: 0.8,
  muted: false,
  cacheBudgetBytes: 2 * 1024 * 1024 * 1024,
  quality: 'lossless' as const,
  listeningHistory: false,
};

describe('buildSupportBundle', () => {
  it('keeps useful diagnostics but drops every embedded secret', () => {
    const logText = [
      '{"event":"jellyfin.connect","data":{"url":"https://jellyfin.example?api_key=deadbeef"}}',
      'Authorization: Bearer abc123',
      'MediaBrowser Token="tok-999", Client="Statocyst"',
      'password=hunter2',
      'fetch https://alice:s3cret@jellyfin.example/Items',
      '{"event":"playback.start","data":{"trackId":"t1"}}',
    ].join('\n');

    const bundle = buildSupportBundle({
      app: APP,
      diagnostics: DIAGNOSTICS,
      settings: SETTINGS,
      health: [
        { id: 'database-integrity', label: 'Database integrity', status: 'ok', detail: 'passed' },
      ],
      logText,
    });

    for (const secret of ['deadbeef', 'abc123', 'tok-999', 'hunter2', 's3cret']) {
      expect(bundle).not.toContain(secret);
    }
    expect(bundle).toContain('"trackCount": 4');
    expect(bundle).toContain('playback.start');
    expect(bundle).toContain('[redacted]');
    expect(bundle).toContain('"externalReporting": false');
    expect(bundle).toContain('"listeningHistory": false');
  });

  it('redacts secret-named settings even if a future field is added', () => {
    const bundle = buildSupportBundle({
      app: APP,
      diagnostics: DIAGNOSTICS,
      settings: { ...SETTINGS, apiKey: 'leaked-key' } as unknown as typeof SETTINGS,
      health: [],
      logText: '',
    });
    expect(bundle).not.toContain('leaked-key');
  });
});

describe('collectHealth', () => {
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'statocyst-health-'));
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  const database = (overrides: Partial<Record<'integrityCheck' | 'schemaVersion', unknown>> = {}) =>
    ({
      integrityCheck: async () => 'ok',
      schemaVersion: async () => 5,
      ...overrides,
    }) as unknown as StatocystDatabase;

  it('reports healthy local state', async () => {
    const logPath = join(directory, 'main.jsonl');
    await writeFile(logPath, '{}\n', 'utf8');
    const checks = await collectHealth({
      database: database(),
      dataDirectory: directory,
      logPath,
      cacheBudgetBytes: 1024,
    });
    const byId = Object.fromEntries(checks.map((check) => [check.id, check]));
    expect(byId['database-integrity'].status).toBe('ok');
    expect(byId['schema'].status).toBe('ok');
    expect(byId['data-directory'].status).toBe('ok');
    expect(byId['log-file'].status).toBe('ok');
    expect(['ok', 'warn']).toContain(byId['disk-space'].status);
  });

  it('reports a failed integrity check and a missing log', async () => {
    const checks = await collectHealth({
      database: database({ integrityCheck: async () => 'failed' }),
      dataDirectory: directory,
      logPath: join(directory, 'missing.jsonl'),
      cacheBudgetBytes: 1024,
    });
    const byId = Object.fromEntries(checks.map((check) => [check.id, check]));
    expect(byId['database-integrity'].status).toBe('fail');
    expect(byId['log-file'].status).toBe('warn');
  });

  it('never throws when the database probe rejects', async () => {
    const checks = await collectHealth({
      database: database({
        integrityCheck: async () => {
          throw new Error('disk gone');
        },
      }),
      dataDirectory: join(directory, 'missing-subdirectory'),
      logPath: join(directory, 'main.jsonl'),
      cacheBudgetBytes: 1024,
    });
    expect(checks.find((check) => check.id === 'database-integrity')?.status).toBe('fail');
    expect(checks.find((check) => check.id === 'data-directory')?.status).toBe('fail');
  });
});
