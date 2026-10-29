import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { StatocystDatabase } from '@statocyst/persistence';
import { authenticate, discover } from '@statocyst/jellyfin-client';
import type { ClientIdentity } from '@statocyst/jellyfin-client';
import { JellyfinService } from './jellyfin-service';
import type { TokenCodec } from './credential-store';

/**
 * Opt-in integration gate (TEST_MATRIX: "Dockerized stock Jellyfin versions").
 * Boots a disposable stock Jellyfin 12.1 container, seeds a small library, and
 * exercises the real client + service (discover, authenticate, login, identity
 * pin, encrypted token storage).
 *
 * Run with: STATOCYST_JELLYFIN_INTEGRATION=1 vitest run --config apps/desktop-electron/vitest.config.ts
 */

const RUN = process.env['STATOCYST_JELLYFIN_INTEGRATION'] === '1';
const MUSIC = resolve(import.meta.dirname, '../../../../fixtures/audio');
const TAG = 'jellyfin/jellyfin:12.1';
const NAME = 'statocyst-s007-integration';
const PORT = 18097;
const BASE = `http://127.0.0.1:${PORT}`;
const PASSWORD = 'Integration-Pass-123';

const IDENTITY: ClientIdentity = {
  client: 'Statocyst',
  device: 'Integration',
  deviceId: 'integration-device-1',
  version: '0.1.0',
};

const logger = { info() {}, warn() {}, error() {}, debug() {} } as never;

class FakeCodec implements TokenCodec {
  isAvailable(): Promise<boolean> {
    return Promise.resolve(true);
  }
  encrypt(plaintext: string): Promise<string> {
    return Promise.resolve(`cipher:${Buffer.from(plaintext).toString('base64')}`);
  }
  decrypt(ciphertext: string): Promise<string> {
    return Promise.resolve(Buffer.from(ciphertext.slice('cipher:'.length), 'base64').toString());
  }
}

let dataDir: string;
let token: string;
let userId: string;

function docker(args: string[]): string {
  return execFileSync('docker', args, { encoding: 'utf8' });
}

async function waitReady(): Promise<void> {
  for (let i = 0; i < 90; i += 1) {
    try {
      const info = await discover(BASE);
      if (info.id) return;
    } catch {
      // still booting
    }
    await new Promise((res) => setTimeout(res, 1000));
  }
  throw new Error('fixture did not become ready');
}

describe.skipIf(!RUN)('Jellyfin real integration', () => {
  beforeAll(async () => {
    docker(['rm', '-f', NAME]);
    dataDir = join(tmpdir(), 'statocyst-s007-integration');
    rmSync(dataDir, { recursive: true, force: true });
    mkdirSync(join(dataDir, 'config'), { recursive: true });
    mkdirSync(join(dataDir, 'cache'), { recursive: true });
    docker([
      'run', '-d', '--name', NAME, '-p', `${PORT}:8096`,
      '-v', `${join(dataDir, 'config')}:/config`,
      '-v', `${join(dataDir, 'cache')}:/cache`,
      '-v', `${MUSIC}:/media/music:ro`,
      TAG,
    ]);
    await waitReady();

    const authHeader = 'MediaBrowser Client="Statocyst", Device="Integration", DeviceId="integration-device-1", Version="0.1.0"';
    const h = { 'Content-Type': 'application/json', Authorization: authHeader };
    await fetch(`${BASE}/Startup/Configuration`, { method: 'POST', headers: h, body: JSON.stringify({ UICulture: 'en-US', MetadataCountryCode: 'US', PreferredMetadataLanguage: 'en' }) });
    await fetch(`${BASE}/Startup/User`, { method: 'GET' });
    await fetch(`${BASE}/Startup/User`, { method: 'POST', headers: h, body: JSON.stringify({ Name: 'statocyst', Password: PASSWORD }) });
    await fetch(`${BASE}/Startup/Complete`, { method: 'POST' });
  }, 180_000);

  afterAll(() => {
    docker(['rm', '-f', NAME]);
    spawnSync('docker', ['run', '--rm', '-v', `${dataDir}:/p`, 'alpine', 'rm', '-rf', '/p'], { stdio: 'ignore' });
  });

  it('discovers, authenticates and logs in against a real Jellyfin 12.1', async () => {
    const info = await discover(BASE);
    expect(info.version).toBe('12.1.0');
    expect(info.id).toBeTruthy();

    const auth = await authenticate(BASE, 'statocyst', PASSWORD, IDENTITY);
    token = auth.accessToken;
    userId = auth.user.id;
    expect(auth.serverId).toBe(info.id);
    expect(auth.user.name).toBe('statocyst');

    // Full service path with a real DB + codec: identity pin + encrypted storage.
    const db = await StatocystDatabase.open({ path: join(dataDir, 'statocyst.db') });
    const service = new JellyfinService({ database: db, identity: IDENTITY, codec: new FakeCodec(), logger });
    const added = await service.addServer(BASE);
    expect(added.ok).toBe(true);

    const login = await service.login(BASE, 'statocyst', PASSWORD);
    expect(login.ok).toBe(true);
    if (login.ok) {
      expect(login.value.connected).toBe(true);
      expect(login.value.userName).toBe('statocyst');
    }

    const serverId = (added as { value: { id: string } }).value.id;
    const account = await db.getJellyfinAccount(serverId);
    expect(account?.userId).toBe(userId);
    expect(account?.tokenCiphertext).not.toContain(token);
    expect(readFileSync(join(dataDir, 'statocyst.db'), 'utf8')).not.toContain(token);
    await db.close();
  }, 60_000);
});
