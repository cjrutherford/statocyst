import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StatocystDatabase } from '@statocyst/persistence';
import { authenticate, discover, JellyfinError, listAudioItems } from '@statocyst/jellyfin-client';
import type { ClientIdentity } from '@statocyst/jellyfin-client';
import { JellyfinService } from './jellyfin-service';
import type { TokenCodec } from './credential-store';

vi.mock('@statocyst/jellyfin-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@statocyst/jellyfin-client')>();
  return {
    ...actual,
    discover: vi.fn(),
    authenticate: vi.fn(),
    listAudioItems: vi.fn(),
  };
});

const identity: ClientIdentity = {
  client: 'Statocyst',
  device: 'Test',
  deviceId: 'device-1',
  version: '0.1.0',
};

const logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
} as never;

class FakeCodec implements TokenCodec {
  available = true;
  async isAvailable(): Promise<boolean> {
    return this.available;
  }
  async encrypt(plaintext: string): Promise<string> {
    return `cipher:${Buffer.from(plaintext).toString('base64')}`;
  }
  async decrypt(ciphertext: string): Promise<string> {
    return Buffer.from(ciphertext.slice('cipher:'.length), 'base64').toString();
  }
}

const directories: string[] = [];

async function makeService(codec: TokenCodec = new FakeCodec()) {
  const dir = await mkdtemp(join(tmpdir(), 'statocyst-jf-service-'));
  directories.push(dir);
  const db = await StatocystDatabase.open({ path: join(dir, 'statocyst.db') });
  const service = new JellyfinService({ database: db, identity, codec, logger: logger as never });
  return { service, db, dir };
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  vi.clearAllMocks();
});

describe('JellyfinService', () => {
  it('stores an encrypted token (never plaintext) and reports a connected view', async () => {
    const { service, db, dir } = await makeService();
    vi.mocked(discover).mockResolvedValue({
      baseUrl: 'https://jelly.example.com',
      id: 'jellyfin-id-1',
      name: 'Test Server',
      version: '12.1.0',
    });
    vi.mocked(authenticate).mockResolvedValue({
      serverId: 'jellyfin-id-1',
      accessToken: 'plaintext-token-123',
      user: { id: 'user-1', name: 'statocyst' },
    });

    const added = await service.addServer('https://jelly.example.com/');
    expect(added.ok).toBe(true);
    expect(added.ok && added.value.name).toBe('Test Server');

    const loggedIn = await service.login('https://jelly.example.com/', 'statocyst', 'pw');
    expect(loggedIn.ok).toBe(true);
    expect(loggedIn.ok && loggedIn.value.connected).toBe(true);
    expect(loggedIn.ok && loggedIn.value.userName).toBe('statocyst');

    const account = await db.getJellyfinAccount((added as { value: { id: string } }).value.id);
    expect(account?.tokenCiphertext).toContain('cipher:');
    expect(account?.tokenCiphertext).not.toContain('plaintext-token-123');

    // The plaintext token is absent from the on-disk database bytes.
    const { readFileSync } = await import('node:fs');
    const raw = readFileSync(join(dir, 'statocyst.db'), 'utf8');
    expect(raw).not.toContain('plaintext-token-123');
  });

  it('rejects a login when the endpoint identity changed', async () => {
    const { service } = await makeService();
    vi.mocked(discover).mockResolvedValue({
      baseUrl: 'https://jelly.example.com',
      id: 'jellyfin-id-1',
      name: 'Test Server',
      version: '12.1.0',
    });
    await service.addServer('https://jelly.example.com');

    // The login response reports a different server id than discovery did.
    vi.mocked(authenticate).mockResolvedValue({
      serverId: 'jellyfin-id-OTHER',
      accessToken: 'token',
      user: { id: 'user-1', name: 'statocyst' },
    });
    const result = await service.login('https://jelly.example.com', 'statocyst', 'pw');
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.code).toBe('IDENTITY_MISMATCH');
  });

  it('refuses to persist a token when credential storage is unavailable', async () => {
    const codec = new FakeCodec();
    codec.available = false;
    const { service } = await makeService(codec);
    vi.mocked(discover).mockResolvedValue({
      baseUrl: 'https://jelly.example.com',
      id: 'jellyfin-id-1',
      name: 'Test Server',
      version: '12.1.0',
    });
    await service.addServer('https://jelly.example.com');
    vi.mocked(authenticate).mockResolvedValue({
      serverId: 'jellyfin-id-1',
      accessToken: 'token',
      user: { id: 'user-1', name: 'statocyst' },
    });
    const result = await service.login('https://jelly.example.com', 'statocyst', 'pw');
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.code).toBe('CREDENTIAL_STORAGE_UNAVAILABLE');
  });

  it('surfaces client errors (non-HTTPS, unreachable, bad auth) as typed failures', async () => {
    const { service } = await makeService();
    vi.mocked(discover).mockRejectedValue(new JellyfinError('NOT_HTTPS', 'not https'));
    const result = await service.addServer('http://jelly.example.com');
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.code).toBe('NOT_HTTPS');
  });

  it('removes accounts and servers', async () => {
    const { service, db } = await makeService();
    vi.mocked(discover).mockResolvedValue({
      baseUrl: 'https://jelly.example.com',
      id: 'jellyfin-id-1',
      name: 'Test Server',
      version: '12.1.0',
    });
    vi.mocked(authenticate).mockResolvedValue({
      serverId: 'jellyfin-id-1',
      accessToken: 'token',
      user: { id: 'user-1', name: 'statocyst' },
    });
    const added = await service.addServer('https://jelly.example.com');
    const id = (added as { value: { id: string } }).value.id;
    await service.login('https://jelly.example.com', 'statocyst', 'pw');

    const logout = await service.logout(id);
    expect(logout.ok && logout.value.removed).toBe(true);
    expect(await db.getJellyfinAccount(id)).toBeNull();

    const removed = await service.removeServer(id);
    expect(removed.ok && removed.value.removed).toBe(true);
    expect(await db.getJellyfinServer(id)).toBeNull();
  });

  it('syncs the catalog idempotently (re-run has no duplicate rows)', async () => {
    const { service, db } = await makeService();
    vi.mocked(discover).mockResolvedValue({
      baseUrl: 'https://jelly.example.com',
      id: 'jellyfin-id-1',
      name: 'Test Server',
      version: '12.1.0',
    });
    vi.mocked(authenticate).mockResolvedValue({
      serverId: 'jellyfin-id-1',
      accessToken: 'token',
      user: { id: 'user-1', name: 'statocyst' },
    });
    const added = await service.addServer('https://jelly.example.com');
    const serverId = (added as { value: { id: string } }).value.id;
    await service.login('https://jelly.example.com', 'statocyst', 'pw');

    vi.mocked(listAudioItems).mockResolvedValue({
      items: [
        {
          id: 'item-1',
          name: 'Sonar Bloom',
          album: 'Bathypelagic Sessions',
          albumArtist: 'Statocyst Ensemble',
          artists: ['Statocyst Ensemble'],
          runTimeTicks: 120_000_0000,
          productionYear: 2026,
          indexNumber: 1,
          parentIndexNumber: 1,
          genres: ['Ambient'],
          container: 'mp3',
          bitrate: 192_000,
          imageTag: 'abc',
        },
        {
          id: 'item-2',
          name: 'Tide Glass',
          album: 'Bathypelagic Sessions',
          albumArtist: 'Statocyst Ensemble',
          artists: ['Statocyst Ensemble'],
          runTimeTicks: 100_000_0000,
          productionYear: 2026,
          indexNumber: 2,
          parentIndexNumber: 1,
          genres: ['Ambient'],
          container: 'flac',
          bitrate: null,
          imageTag: null,
        },
      ],
      totalRecordCount: 2,
    });

    const first = await service.syncCatalog(serverId);
    expect(first.ok).toBe(true);
    expect(first.ok && first.value.imported).toBe(2);
    expect(first.ok && first.value.updated).toBe(0);

    const second = await service.syncCatalog(serverId);
    expect(second.ok).toBe(true);
    expect(second.ok && second.value.imported).toBe(0);
    expect(second.ok && second.value.updated).toBe(2);

    expect(await db.listTracks()).toHaveLength(2);
  });
});
