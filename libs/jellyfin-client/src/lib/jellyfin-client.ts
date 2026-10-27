/**
 * Typed Jellyfin API client for the desktop main process.
 *
 * Encapsulates the exact request surface verified in the S006 spike
 * (`verification/JELLYFIN_API.md`): the Jellyfin 12 `Authorization` header,
 * `System/Info/Public` discovery, and `Users/AuthenticateByName` login. It is a
 * pure library with no Electron or persistence dependencies so it can be unit
 * tested and reused across runtimes.
 */

export interface ClientIdentity {
  client: string;
  device: string;
  deviceId: string;
  version: string;
}

export interface JellyfinServerInfo {
  baseUrl: string;
  id: string;
  name: string;
  version: string;
}

export interface JellyfinUser {
  id: string;
  name: string;
}

export interface JellyfinAuthResult {
  serverId: string;
  accessToken: string;
  user: JellyfinUser;
}

export type JellyfinErrorCode =
  | 'INVALID_URL'
  | 'NOT_HTTPS'
  | 'UNREACHABLE'
  | 'NOT_JELLYFIN'
  | 'AUTH_FAILED'
  | 'UNAUTHORIZED'
  | 'IDENTITY_MISMATCH';

export class JellyfinError extends Error {
  constructor(
    readonly code: JellyfinErrorCode,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'JellyfinError';
  }
}

export type FetchLike = typeof fetch;

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

function isLoopback(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, '');
  return LOOPBACK_HOSTS.has(host) || host.startsWith('127.');
}

/** Trims trailing slashes and lower-cases the scheme/host; returns null for a malformed URL. */
export function normalizeBaseUrl(input: string): string | null {
  if (typeof input !== 'string') return null;
  const trimmed = input.trim();
  if (!trimmed) return null;
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  parsed.pathname = parsed.pathname.replace(/\/+$/, '');
  parsed.search = '';
  parsed.hash = '';
  return parsed.toString().replace(/\/$/, '');
}

/**
 * Enforces the "no silent HTTP downgrade" invariant: only https (or plain http
 * to the loopback interface, for local test fixtures) is permitted.
 */
export function assertSecureBaseUrl(baseUrl: string, allowInsecureLoopback = true): JellyfinError | null {
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    return new JellyfinError('INVALID_URL', 'The server URL is not valid');
  }
  if (parsed.protocol === 'https:') return null;
  if (parsed.protocol === 'http:' && allowInsecureLoopback && isLoopback(parsed.hostname)) {
    return null;
  }
  return new JellyfinError(
    'NOT_HTTPS',
    'The server must be reachable over HTTPS. Plain HTTP is only allowed for localhost.',
  );
}

function authorizationHeader(identity: ClientIdentity, token?: string): string {
  const parts = [
    `Client="${identity.client}"`,
    `Device="${identity.device}"`,
    `DeviceId="${identity.deviceId}"`,
    `Version="${identity.version}"`,
  ];
  if (token) parts.push(`Token="${token}"`);
  return `MediaBrowser ${parts.join(', ')}`;
}

async function requestJson(
  fetchImpl: FetchLike,
  url: string,
  init: RequestInit,
): Promise<unknown> {
  const response = await fetchImpl(url, {
    ...init,
    headers: { Accept: 'application/json', ...(init.headers ?? {}) },
    redirect: 'error',
  });
  const text = await response.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
  }
  if (!response.ok) {
    const message =
      (body && typeof body === 'object' && 'Message' in body && typeof (body as { Message: unknown }).Message === 'string'
        ? (body as { Message: string }).Message
        : '') || text || `HTTP ${response.status}`;
    throw new JellyfinError(
      response.status === 401 ? 'UNAUTHORIZED' : 'AUTH_FAILED',
      message,
      response.status,
    );
  }
  return body;
}

function serverInfoFrom(baseUrl: string, body: unknown): JellyfinServerInfo {
  const record = body as Record<string, unknown>;
  if (
    typeof record?.['ProductName'] !== 'string' ||
    record['ProductName'] !== 'Jellyfin Server' ||
    typeof record['Id'] !== 'string' ||
    typeof record['Version'] !== 'string'
  ) {
    throw new JellyfinError('NOT_JELLYFIN', 'The endpoint did not identify itself as a Jellyfin server');
  }
  const serverName = record['ServerName'];
  return {
    baseUrl,
    id: record['Id'],
    name: typeof serverName === 'string' && serverName ? serverName : 'Jellyfin',
    version: record['Version'],
  };
}

export async function discover(
  baseUrl: string,
  identity?: ClientIdentity,
  fetchImpl: FetchLike = fetch,
): Promise<JellyfinServerInfo> {
  const normalized = normalizeBaseUrl(baseUrl);
  if (!normalized) throw new JellyfinError('INVALID_URL', 'The server URL is not valid');
  const security = assertSecureBaseUrl(normalized);
  if (security) throw security;
  let body: unknown;
  try {
    body = await requestJson(fetchImpl, `${normalized}/System/Info/Public`, { method: 'GET' });
  } catch (error) {
    if (error instanceof JellyfinError) throw error;
    throw new JellyfinError('UNREACHABLE', 'The server did not respond');
  }
  return serverInfoFrom(normalized, body);
}

export async function authenticate(
  baseUrl: string,
  username: string,
  password: string,
  identity: ClientIdentity,
  fetchImpl: FetchLike = fetch,
): Promise<JellyfinAuthResult> {
  const normalized = normalizeBaseUrl(baseUrl);
  if (!normalized) throw new JellyfinError('INVALID_URL', 'The server URL is not valid');
  const body = await requestJson(fetchImpl, `${normalized}/Users/AuthenticateByName`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: authorizationHeader(identity),
    },
    body: JSON.stringify({ Username: username, Pw: password }),
  });
  const record = body as Record<string, unknown>;
  const user = record?.['User'] as Record<string, unknown> | undefined;
  const accessToken = record?.['AccessToken'];
  const serverId = record?.['ServerId'];
  if (
    typeof accessToken !== 'string' ||
    accessToken.length === 0 ||
    typeof serverId !== 'string' ||
    !user ||
    typeof user['Id'] !== 'string'
  ) {
    throw new JellyfinError('AUTH_FAILED', 'The server rejected the credentials');
  }
  return {
    serverId,
    accessToken,
    user: {
      id: user['Id'],
      name: typeof user['Name'] === 'string' ? user['Name'] : username,
    },
  };
}

export async function whoami(
  baseUrl: string,
  token: string,
  identity: ClientIdentity,
  fetchImpl: FetchLike = fetch,
): Promise<JellyfinUser> {
  const normalized = normalizeBaseUrl(baseUrl);
  if (!normalized) throw new JellyfinError('INVALID_URL', 'The server URL is not valid');
  const body = await requestJson(fetchImpl, `${normalized}/Users/Me`, {
    method: 'GET',
    headers: { Authorization: authorizationHeader(identity, token) },
  });
  const record = body as Record<string, unknown>;
  if (!record || typeof record['Id'] !== 'string') {
    throw new JellyfinError('UNAUTHORIZED', 'The stored session is no longer valid');
  }
  return { id: record['Id'], name: typeof record['Name'] === 'string' ? record['Name'] : '' };
}

export interface JellyfinQuickConnectInit {
  secret: string;
  code: string;
}

export interface JellyfinQuickConnectStatus {
  authenticated: boolean;
  secret: string;
  code: string;
}

export async function initiateQuickConnect(
  baseUrl: string,
  identity: ClientIdentity,
  fetchImpl: FetchLike = fetch,
): Promise<JellyfinQuickConnectInit> {
  const normalized = normalizeBaseUrl(baseUrl);
  if (!normalized) throw new JellyfinError('INVALID_URL', 'The server URL is not valid');
  const security = assertSecureBaseUrl(normalized);
  if (security) throw security;
  const body = await requestJson(fetchImpl, `${normalized}/QuickConnect/Initiate`, {
    method: 'POST',
    headers: { Authorization: authorizationHeader(identity) },
  });
  const record = body as Record<string, unknown>;
  const secret = asString(record['Secret']);
  const code = asString(record['Code']);
  if (!secret || !code) throw new JellyfinError('AUTH_FAILED', 'Quick Connect is not available on this server');
  return { secret, code };
}

export async function quickConnectStatus(
  baseUrl: string,
  secret: string,
  identity: ClientIdentity,
  fetchImpl: FetchLike = fetch,
): Promise<JellyfinQuickConnectStatus> {
  const normalized = normalizeBaseUrl(baseUrl);
  if (!normalized) throw new JellyfinError('INVALID_URL', 'The server URL is not valid');
  const body = await requestJson(fetchImpl, `${normalized}/QuickConnect/Connect?secret=${encodeURIComponent(secret)}`, {
    method: 'GET',
    headers: { Authorization: authorizationHeader(identity) },
  });
  const record = body as Record<string, unknown>;
  return {
    authenticated: record['Authenticated'] === true,
    secret: (asString(record['Secret']) ?? secret),
    code: asString(record['Code']) ?? '',
  };
}

export async function authenticateWithQuickConnect(
  baseUrl: string,
  secret: string,
  identity: ClientIdentity,
  fetchImpl: FetchLike = fetch,
): Promise<JellyfinAuthResult> {
  const normalized = normalizeBaseUrl(baseUrl);
  if (!normalized) throw new JellyfinError('INVALID_URL', 'The server URL is not valid');
  const body = await requestJson(fetchImpl, `${normalized}/Users/AuthenticateWithQuickConnect`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: authorizationHeader(identity),
    },
    body: JSON.stringify({ Secret: secret }),
  });
  const record = body as Record<string, unknown>;
  const user = record?.['User'] as Record<string, unknown> | undefined;
  const accessToken = record?.['AccessToken'];
  const serverId = record?.['ServerId'];
  if (
    typeof accessToken !== 'string' ||
    accessToken.length === 0 ||
    typeof serverId !== 'string' ||
    !user ||
    typeof user['Id'] !== 'string'
  ) {
    throw new JellyfinError('AUTH_FAILED', 'Quick Connect was not approved');
  }
  return {
    serverId,
    accessToken,
    user: {
      id: user['Id'],
      name: typeof user['Name'] === 'string' ? user['Name'] : '',
    },
  };
}

export interface JellyfinAudioItem {
  id: string;
  name: string;
  album: string;
  albumArtist: string;
  artists: string[];
  runTimeTicks: number;
  productionYear: number | null;
  indexNumber: number | null;
  parentIndexNumber: number | null;
  genres: string[];
  container: string | null;
  bitrate: number | null;
  imageTag: string | null;
}

export interface JellyfinItemsPage {
  items: JellyfinAudioItem[];
  totalRecordCount: number;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function toAudioItem(record: Record<string, unknown>): JellyfinAudioItem | null {
  const id = asString(record['Id']);
  const name = asString(record['Name']);
  if (!id || !name) return null;
  const album = asString(record['Album']) ?? 'Unknown album';
  const artists = asStringArray(record['Artists']);
  const albumArtist = asString(record['AlbumArtist']) ?? artists[0] ?? 'Unknown artist';
  const mediaSources = Array.isArray(record['MediaSources']) ? (record['MediaSources'] as Record<string, unknown>[]) : [];
  const source = mediaSources[0] ?? {};
  const imageTags = (record['ImageTags'] ?? {}) as Record<string, unknown>;
  return {
    id,
    name,
    album,
    albumArtist,
    artists,
    runTimeTicks: (asNumber(record['RunTimeTicks']) ?? 0) || 0,
    productionYear: asNumber(record['ProductionYear']),
    indexNumber: asNumber(record['IndexNumber']),
    parentIndexNumber: asNumber(record['ParentIndexNumber']),
    genres: asStringArray(record['Genres']),
    container: asString(source['Container']) ?? asString(record['Container']),
    bitrate: asNumber(source['Bitrate']),
    imageTag: asString(imageTags['Primary']),
  };
}

export async function listAudioItems(
  baseUrl: string,
  userId: string,
  token: string,
  identity: ClientIdentity,
  options: { startIndex?: number; limit?: number } = {},
  fetchImpl: FetchLike = fetch,
): Promise<JellyfinItemsPage> {
  const normalized = normalizeBaseUrl(baseUrl);
  if (!normalized) throw new JellyfinError('INVALID_URL', 'The server URL is not valid');
  const startIndex = options.startIndex ?? 0;
  const limit = options.limit ?? 200;
  const params = new URLSearchParams({
    Recursive: 'true',
    IncludeItemTypes: 'Audio',
    Fields: 'MediaSources,Genres',
    EnableImages: 'true',
    SortBy: 'SortName',
    SortOrder: 'Ascending',
    StartIndex: String(startIndex),
    Limit: String(limit),
  });
  const body = await requestJson(
    fetchImpl,
    `${normalized}/Users/${encodeURIComponent(userId)}/Items?${params.toString()}`,
    { method: 'GET', headers: { Authorization: authorizationHeader(identity, token) } },
  );
  const record = body as Record<string, unknown>;
  const items = Array.isArray(record['Items']) ? (record['Items'] as Record<string, unknown>[]) : [];
  return {
    items: items.map(toAudioItem).filter((item): item is JellyfinAudioItem => item !== null),
    totalRecordCount: (asNumber(record['TotalRecordCount']) ?? items.length) || items.length,
  };
}
