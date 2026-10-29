import type {
  JellyfinError,
  JellyfinResult,
  JellyfinServerView,
  JellyfinSyncSummary,
} from '@statocyst/contracts';
import {
  authenticate,
  authenticateWithQuickConnect,
  discover,
  initiateQuickConnect,
  JellyfinError as ClientError,
  listAudioItems,
  normalizeBaseUrl,
  quickConnectStatus,
  type ClientIdentity,
  type JellyfinAudioItem,
  type JellyfinQuickConnectInit,
} from '@statocyst/jellyfin-client';
import type { StatocystDatabase, StoredJellyfinAccount, StoredJellyfinServer, TrackUpsert } from '@statocyst/persistence';
import type { Logger } from './logger';
import type { TokenCodec } from './credential-store';

export interface JellyfinServiceOptions {
  database: StatocystDatabase;
  identity: ClientIdentity;
  codec: TokenCodec;
  logger: Logger;
}

function ok<T>(value: T): JellyfinResult<T> {
  return { ok: true, value };
}

function fail(code: JellyfinError['code'], message: string): JellyfinResult<never> {
  return { ok: false, error: { code, message } };
}

function toView(server: StoredJellyfinServer, account: StoredJellyfinAccount | null): JellyfinServerView {
  return {
    id: server.id,
    url: server.url,
    name: server.name,
    jellyfinId: server.jellyfinId,
    version: server.version,
    connected: account !== null,
    userName: account?.userName ?? null,
  };
}

function mapError(error: unknown): JellyfinError {
  if (error instanceof ClientError) {
    return { code: error.code as JellyfinError['code'], message: error.message };
  }
  const message = error instanceof Error ? error.message : String(error);
  return { code: 'INTERNAL_ERROR', message };
}

function toTrackUpsert(item: JellyfinAudioItem, sourceId: string, jellyfinId: string): TrackUpsert {
  const container = (item.container ?? '').toLowerCase() || 'audio';
  const artist = item.artists[0] ?? item.albumArtist ?? 'Unknown artist';
  const genre = item.genres.length > 0 ? item.genres.join(', ') : null;
  return {
    sourceId,
    path: item.id,
    pathKey: `jellyfin:${jellyfinId}:${item.id}`,
    fileName: item.name,
    ext: container,
    sizeBytes: 0,
    mtimeMs: 0,
    title: item.name,
    artist,
    album: item.album,
    albumArtist: item.albumArtist ?? artist,
    trackNo: item.indexNumber,
    discNo: item.parentIndexNumber,
    year: item.productionYear,
    genre,
    durationMs: Math.max(0, Math.round(item.runTimeTicks / 10_000)),
    bitrate: item.bitrate,
    sampleRate: null,
    channels: null,
    codec: item.container,
    format: item.container,
    artworkPath: null,
    jellyfinImageTag: item.imageTag,
  };
}

export class JellyfinService {
  constructor(private readonly options: JellyfinServiceOptions) {}

  async listServers(): Promise<JellyfinServerView[]> {
    const [servers, accounts] = await Promise.all([
      this.options.database.listJellyfinServers(),
      this.loadAccounts(),
    ]);
    return servers.map((server) => toView(server, accounts.get(server.id) ?? null));
  }

  async encryptionAvailable(): Promise<boolean> {
    return this.options.codec.isAvailable();
  }

  /**
   * Resolves the remote stream context for a Jellyfin catalog track: the
   * server URL and a decrypted access token. Returns null when the track's
   * source is not Jellyfin or the session is gone.
   */
  async resolveRemoteTrack(sourceId: string): Promise<{ serverUrl: string; token: string } | null> {
    const source = await this.options.database.getSource(sourceId);
    if (!source || source.kind !== 'jellyfin' || !source.rootPath) return null;
    const server = await this.options.database.getJellyfinServer(source.rootPath);
    if (!server) return null;
    const account = await this.options.database.getJellyfinAccount(server.id);
    if (!account) return null;
    try {
      return { serverUrl: server.url, token: await this.options.codec.decrypt(account.tokenCiphertext) };
    } catch {
      return null;
    }
  }

  async addServer(url: string): Promise<JellyfinResult<JellyfinServerView>> {
    const normalized = normalizeBaseUrl(url);
    if (!normalized) return fail('INVALID_URL', 'The server URL is not valid');
    try {
      const info = await discover(normalized);
      const server = await this.options.database.upsertJellyfinServer({
        url: info.baseUrl,
        name: info.name,
        jellyfinId: info.id,
        version: info.version,
      });
      this.options.logger.info('jellyfin.server.added', { id: server.id, url: server.url });
      return ok(toView(server, null));
    } catch (error) {
      this.options.logger.warn('jellyfin.server.add.failed', { url: normalized, error: mapError(error) });
      return fail(mapError(error).code, mapError(error).message);
    }
  }

  async login(url: string, username: string, password: string): Promise<JellyfinResult<JellyfinServerView>> {
    const normalized = normalizeBaseUrl(url);
    if (!normalized) return fail('INVALID_URL', 'The server URL is not valid');
    if (typeof username !== 'string' || username.length === 0) {
      return fail('INVALID_URL', 'A username is required');
    }
    if (typeof password !== 'string' || password.length === 0) {
      return fail('INVALID_URL', 'A password is required');
    }

    try {
      // Ensure a server profile exists so its pinned identity can be checked.
      let server: StoredJellyfinServer | null =
        (await this.options.database.listJellyfinServers()).find(
          (candidate) => candidate.url === normalized,
        ) ?? null;
      if (!server) {
        const info = await discover(normalized);
        server = await this.options.database.upsertJellyfinServer({
          url: info.baseUrl,
          name: info.name,
          jellyfinId: info.id,
          version: info.version,
        });
      }

      const auth = await authenticate(normalized, username, password, this.options.identity);

      // Endpoint identity pin: the login response's ServerId must match the
      // id observed at discovery. Never reuse credentials across identities.
      if (auth.serverId !== server.jellyfinId) {
        this.options.logger.error('jellyfin.server.identity-mismatch', {
          expected: server.jellyfinId,
          actual: auth.serverId,
        });
        return fail('IDENTITY_MISMATCH', 'The server identity changed since it was discovered');
      }

      if (!(await this.options.codec.isAvailable())) {
        return fail(
          'CREDENTIAL_STORAGE_UNAVAILABLE',
          'No secure credential storage is available, so the login cannot be saved',
        );
      }

      const tokenCiphertext = await this.options.codec.encrypt(auth.accessToken);
      await this.options.database.saveJellyfinAccount({
        serverId: server.id,
        userId: auth.user.id,
        userName: auth.user.name,
        tokenCiphertext,
      });
      await this.options.database.touchJellyfinServer(server.id);

      this.options.logger.info('jellyfin.server.connected', { id: server.id, user: auth.user.id });
      return ok(toView(server, await this.options.database.getJellyfinAccount(server.id)));
    } catch (error) {
      this.options.logger.warn('jellyfin.server.login.failed', { url: normalized, error: mapError(error) });
      return fail(mapError(error).code, mapError(error).message);
    }
  }

  async initiateQuickConnect(url: string): Promise<JellyfinResult<JellyfinQuickConnectInit>> {
    const normalized = normalizeBaseUrl(url);
    if (!normalized) return fail('INVALID_URL', 'The server URL is not valid');
    try {
      const info = await discover(normalized);
      await this.options.database.upsertJellyfinServer({
        url: info.baseUrl,
        name: info.name,
        jellyfinId: info.id,
        version: info.version,
      });
      const init = await initiateQuickConnect(normalized, this.options.identity);
      return ok(init);
    } catch (error) {
      return fail(mapError(error).code, mapError(error).message);
    }
  }

  async pollQuickConnect(url: string, secret: string): Promise<JellyfinResult<{ authenticated: boolean }>> {
    const normalized = normalizeBaseUrl(url);
    if (!normalized) return fail('INVALID_URL', 'The server URL is not valid');
    try {
      const status = await quickConnectStatus(normalized, secret, this.options.identity);
      return ok({ authenticated: status.authenticated });
    } catch (error) {
      return fail(mapError(error).code, mapError(error).message);
    }
  }

  async loginWithQuickConnect(url: string, secret: string): Promise<JellyfinResult<JellyfinServerView>> {
    const normalized = normalizeBaseUrl(url);
    if (!normalized) return fail('INVALID_URL', 'The server URL is not valid');
    const server = (await this.options.database.listJellyfinServers()).find((c) => c.url === normalized) ?? null;
    if (!server) return fail('NOT_FOUND', 'The server must be discovered first');

    try {
      const auth = await authenticateWithQuickConnect(normalized, secret, this.options.identity);
      if (auth.serverId !== server.jellyfinId) {
        return fail('IDENTITY_MISMATCH', 'The server identity changed since it was discovered');
      }
      if (!(await this.options.codec.isAvailable())) {
        return fail('CREDENTIAL_STORAGE_UNAVAILABLE', 'No secure credential storage is available, so the login cannot be saved');
      }
      const tokenCiphertext = await this.options.codec.encrypt(auth.accessToken);
      await this.options.database.saveJellyfinAccount({
        serverId: server.id,
        userId: auth.user.id,
        userName: auth.user.name,
        tokenCiphertext,
      });
      await this.options.database.touchJellyfinServer(server.id);
      this.options.logger.info('jellyfin.server.connected', { id: server.id, user: auth.user.id, method: 'quick-connect' });
      return ok(toView(server, await this.options.database.getJellyfinAccount(server.id)));
    } catch (error) {
      return fail(mapError(error).code, mapError(error).message);
    }
  }

  async logout(serverId: string): Promise<JellyfinResult<{ removed: boolean }>> {
    const server = await this.options.database.getJellyfinServer(serverId);
    if (!server) return fail('NOT_FOUND', 'The server does not exist');
    await this.options.database.removeJellyfinAccount(serverId);
    this.options.logger.info('jellyfin.server.disconnected', { id: serverId });
    return ok({ removed: true });
  }

  async syncCatalog(serverId: string): Promise<JellyfinResult<JellyfinSyncSummary>> {
    const server = await this.options.database.getJellyfinServer(serverId);
    if (!server) return fail('NOT_FOUND', 'The server does not exist');
    const account = await this.options.database.getJellyfinAccount(serverId);
    if (!account) return fail('UNAUTHORIZED', 'The server is not signed in');

    let token: string;
    try {
      token = await this.options.codec.decrypt(account.tokenCiphertext);
    } catch {
      return fail('UNAUTHORIZED', 'The stored session could not be decrypted');
    }

    try {
      const source = await this.options.database.upsertSource({
        kind: 'jellyfin',
        label: server.name,
        rootPath: server.id,
      });
      const pageSize = 200;
      let startIndex = 0;
      let imported = 0;
      let updated = 0;
      let fetched = 0;
      for (;;) {
        const page = await listAudioItems(server.url, account.userId, token, this.options.identity, {
          startIndex,
          limit: pageSize,
        });
        fetched += page.items.length;
        for (const item of page.items) {
          const result = await this.options.database.upsertTrack(toTrackUpsert(item, source.id, server.jellyfinId));
          if (result.duplicate) updated += 1;
          else imported += 1;
        }
        if (page.items.length < pageSize || fetched >= page.totalRecordCount) break;
        startIndex += pageSize;
      }
      await this.options.database.touchJellyfinServer(serverId);
      this.options.logger.info('jellyfin.catalog.synced', { serverId, fetched, imported, updated });
      return ok({ serverId, total: fetched, imported, updated });
    } catch (error) {
      return fail(mapError(error).code, mapError(error).message);
    }
  }

  async removeServer(serverId: string): Promise<JellyfinResult<{ removed: boolean }>> {
    const removed = await this.options.database.removeJellyfinServer(serverId);
    if (!removed) return fail('NOT_FOUND', 'The server does not exist');
    this.options.logger.info('jellyfin.server.removed', { id: serverId });
    return ok({ removed: true });
  }

  private async loadAccounts(): Promise<Map<string, StoredJellyfinAccount>> {
    const servers = await this.options.database.listJellyfinServers();
    const accounts = new Map<string, StoredJellyfinAccount>();
    for (const server of servers) {
      const account = await this.options.database.getJellyfinAccount(server.id);
      if (account) accounts.set(server.id, account);
    }
    return accounts;
  }
}
