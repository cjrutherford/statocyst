import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { discover, whoami, listAudioItems } from '@statocyst/jellyfin-client';
import type { ClientIdentity } from '@statocyst/jellyfin-client';

const RUN = process.env['STATOCYST_JELLYFIN_UPSTREAM'] === '1';
const SESSION = '/tmp/statocyst-qc/session.json';
const BASE = 'https://jelly.christopherrutherford.net';
const IDENTITY: ClientIdentity = {
  client: 'Statocyst',
  device: 'Statocyst CLI',
  deviceId: 'qc-poll',
  version: '0.1.0',
};

describe.skipIf(!RUN || !existsSync(SESSION))('Jellyfin upstream (real server)', () => {
  it('discovers, validates the session and lists the real audio catalog', async () => {
    const session = JSON.parse(readFileSync(SESSION, 'utf8'));

    const info = await discover(BASE);
    // eslint-disable-next-line no-console
    console.log(`UPSTREAM info version=${info.version} name="${info.name}" id=${info.id}`);
    expect(info.id).toBe(session.serverId);

    const user = await whoami(BASE, session.accessToken, IDENTITY);
    // eslint-disable-next-line no-console
    console.log(`UPSTREAM user=${user.name} id=${user.id}`);
    expect(user.id).toBe(session.userId);

    const page = await listAudioItems(BASE, session.userId, session.accessToken, IDENTITY, {
      startIndex: 0,
      limit: 50,
    });
    // eslint-disable-next-line no-console
    console.log(`UPSTREAM audio total=${page.totalRecordCount} fetched=${page.items.length}`);
    if (page.items.length > 0) {
      const first = page.items[0];
      // eslint-disable-next-line no-console
      console.log(
        `UPSTREAM sample=${JSON.stringify({
          name: first.name,
          album: first.album,
          albumArtist: first.albumArtist,
          container: first.container,
          bitrate: first.bitrate,
          durationMs: Math.round(first.runTimeTicks / 10_000),
          imageTag: first.imageTag !== null,
        })}`,
      );
    }
    expect(page.items.length).toBeGreaterThan(0);
  }, 60_000);
});
