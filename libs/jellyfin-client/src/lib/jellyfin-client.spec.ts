import { describe, expect, it, vi } from 'vitest';
import {
  assertSecureBaseUrl,
  authenticate,
  discover,
  JellyfinError,
  listAudioItems,
  normalizeBaseUrl,
  whoami,
  type ClientIdentity,
  type FetchLike,
} from '../index';

const IDENTITY: ClientIdentity = {
  client: 'Statocyst',
  device: 'Test Device',
  deviceId: 'test-device-id',
  version: '0.1.0',
};

function mockFetch(handler: (url: string, init: RequestInit) => Response | Promise<Response>): FetchLike {
  return vi.fn(handler) as unknown as FetchLike;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const PUBLIC_INFO = {
  LocalAddress: 'http://127.0.0.1:8096',
  ServerName: 'Test Server',
  Version: '12.1.0',
  ProductName: 'Jellyfin Server',
  OperatingSystem: 'Linux',
  Id: 'server-id-123',
  StartupWizardCompleted: true,
};

describe('URL handling', () => {
  it('normalises trailing slashes, query and hash', () => {
    expect(normalizeBaseUrl('https://jelly.example.com/')).toBe('https://jelly.example.com');
    expect(normalizeBaseUrl('https://jelly.example.com/subpath///')).toBe('https://jelly.example.com/subpath');
    expect(normalizeBaseUrl('  https://JELLY.example.com  ')).toBe('https://jelly.example.com');
  });

  it('rejects malformed and non-http URLs', () => {
    expect(normalizeBaseUrl('')).toBeNull();
    expect(normalizeBaseUrl('not a url')).toBeNull();
    expect(normalizeBaseUrl('ftp://jelly.example.com')).toBeNull();
  });

  it('enforces HTTPS except for loopback', () => {
    expect(assertSecureBaseUrl('https://jelly.example.com')).toBeNull();
    expect(assertSecureBaseUrl('http://127.0.0.1:8096')).toBeNull();
    expect(assertSecureBaseUrl('http://localhost:8096')).toBeNull();
    expect(assertSecureBaseUrl('http://192.168.1.10:8096')?.code).toBe('NOT_HTTPS');
    expect(assertSecureBaseUrl('http://jelly.example.com')?.code).toBe('NOT_HTTPS');
  });
});

describe('discover', () => {
  it('parses System/Info/Public and returns server identity', async () => {
    const fetchImpl = mockFetch((url) => {
      expect(url).toBe('https://jelly.example.com/System/Info/Public');
      return jsonResponse(PUBLIC_INFO);
    });
    const info = await discover('https://jelly.example.com/', IDENTITY, fetchImpl);
    expect(info).toEqual({
      baseUrl: 'https://jelly.example.com',
      id: 'server-id-123',
      name: 'Test Server',
      version: '12.1.0',
    });
  });

  it('rejects a non-Jellyfin endpoint', async () => {
    const fetchImpl = mockFetch(() => jsonResponse({ ...PUBLIC_INFO, ProductName: 'Not Jellyfin' }));
    await expect(discover('https://jelly.example.com', IDENTITY, fetchImpl)).rejects.toMatchObject({
      code: 'NOT_JELLYFIN',
    });
  });

  it('rejects an unreachable endpoint', async () => {
    const fetchImpl = mockFetch(() => {
      throw new TypeError('fetch failed');
    });
    await expect(discover('https://jelly.example.com', IDENTITY, fetchImpl)).rejects.toMatchObject({
      code: 'UNREACHABLE',
    });
  });

  it('rejects plain HTTP to a non-loopback host', async () => {
    const fetchImpl = mockFetch(() => jsonResponse(PUBLIC_INFO));
    await expect(discover('http://jelly.example.com', IDENTITY, fetchImpl)).rejects.toMatchObject({
      code: 'NOT_HTTPS',
    });
  });
});

describe('authenticate', () => {
  it('sends the Jellyfin 12 Authorization header and returns the token', async () => {
    let capturedHeaders: Record<string, string> = {};
    const fetchImpl = mockFetch((_url, init) => {
      capturedHeaders = (init.headers ?? {}) as Record<string, string>;
      return jsonResponse({
        User: { Name: 'statocyst', Id: 'user-1' },
        AccessToken: 'token-abcdef',
        ServerId: 'server-id-123',
        SessionInfo: {},
      });
    });
    const result = await authenticate('https://jelly.example.com', 'statocyst', 'pw', IDENTITY, fetchImpl);
    expect(result).toEqual({ serverId: 'server-id-123', accessToken: 'token-abcdef', user: { id: 'user-1', name: 'statocyst' } });
    expect(capturedHeaders['Authorization']).toBe(
      'MediaBrowser Client="Statocyst", Device="Test Device", DeviceId="test-device-id", Version="0.1.0"',
    );
  });

  it('throws AUTH_FAILED when the server rejects credentials', async () => {
    const fetchImpl = mockFetch(() => new Response('Error processing request.', { status: 401 }));
    await expect(authenticate('https://jelly.example.com', 'statocyst', 'bad', IDENTITY, fetchImpl)).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
  });
});

describe('whoami', () => {
  it('sends the token and returns the user', async () => {
    let capturedHeaders: Record<string, string> = {};
    const fetchImpl = mockFetch((_url, init) => {
      capturedHeaders = (init.headers ?? {}) as Record<string, string>;
      return jsonResponse({ Name: 'statocyst', Id: 'user-1' });
    });
    const user = await whoami('https://jelly.example.com', 'token-abcdef', IDENTITY, fetchImpl);
    expect(user).toEqual({ id: 'user-1', name: 'statocyst' });
    expect(capturedHeaders['Authorization']).toContain('Token="token-abcdef"');
  });

  it('throws UNAUTHORIZED on a 401', async () => {
    const fetchImpl = mockFetch(() => new Response('Unauthorized', { status: 401 }));
    await expect(whoami('https://jelly.example.com', 'stale', IDENTITY, fetchImpl)).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
  });
});

describe('JellyfinError', () => {
  it('carries code, message and status', () => {
    const error = new JellyfinError('AUTH_FAILED', 'nope', 400);
    expect(error.code).toBe('AUTH_FAILED');
    expect(error.status).toBe(400);
    expect(error.name).toBe('JellyfinError');
  });
});

describe('listAudioItems', () => {
  it('requests paginated audio items with the correct URL and maps fields', async () => {
    let requestedUrl = '';
    const fetchImpl = mockFetch((url, init) => {
      requestedUrl = url;
      expect((init.headers as Record<string, string>)['Authorization']).toContain('Token="tok"');
      return jsonResponse({
        Items: [
          {
            Id: 'item-1',
            Name: 'Sonar Bloom',
            Album: 'Bathypelagic Sessions',
            AlbumArtist: 'Statocyst Ensemble',
            Artists: ['Statocyst Ensemble'],
            RunTimeTicks: 120000000,
            ProductionYear: 2026,
            IndexNumber: 1,
            ParentIndexNumber: 1,
            Genres: ['Ambient'],
            MediaSources: [{ Container: 'mp3', Bitrate: 192000 }],
            ImageTags: { Primary: 'abc123' },
          },
        ],
        TotalRecordCount: 1,
        StartIndex: 0,
      });
    });
    const page = await listAudioItems('https://jelly.example.com', 'user-1', 'tok', IDENTITY, {
      startIndex: 0,
      limit: 200,
    }, fetchImpl);

    expect(requestedUrl).toContain('/Users/user-1/Items');
    expect(requestedUrl).toContain('IncludeItemTypes=Audio');
    expect(requestedUrl).toContain('StartIndex=0');
    expect(requestedUrl).toContain('Limit=200');
    expect(page.totalRecordCount).toBe(1);
    expect(page.items[0]).toMatchObject({
      id: 'item-1',
      name: 'Sonar Bloom',
      album: 'Bathypelagic Sessions',
      albumArtist: 'Statocyst Ensemble',
      artists: ['Statocyst Ensemble'],
      runTimeTicks: 120000000,
      productionYear: 2026,
      indexNumber: 1,
      parentIndexNumber: 1,
      genres: ['Ambient'],
      container: 'mp3',
      bitrate: 192000,
      imageTag: 'abc123',
    });
  });

  it('tolerates missing optional fields and empty items', async () => {
    const fetchImpl = mockFetch(() => jsonResponse({ Items: [], TotalRecordCount: 0 }));
    const page = await listAudioItems('https://jelly.example.com', 'user-1', 'tok', IDENTITY, {}, fetchImpl);
    expect(page.items).toEqual([]);
    expect(page.totalRecordCount).toBe(0);
  });
});
