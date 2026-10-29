#!/usr/bin/env node
/**
 * S006 — Jellyfin API compatibility spike.
 *
 * Boots a disposable stock Jellyfin container, completes the first-run wizard,
 * seeds a small music library, and exercises the exact request surface the
 * desktop connector will rely on: public discovery, endpoint identity, auth,
 * paginated browse, search, artwork, authenticated streaming (static + range),
 * universal stream resolution, downloads, playback reporting and favourites.
 *
 * Every request is recorded (method, path, status, duration, key headers and a
 * redacted body summary) to JSON. No token or password is ever logged.
 *
 * Usage:
 *   node tools/jellyfin-spike.mjs --versions 12.1,12.4 [--upstream https://...] [--keep]
 *
 * Requires: docker on PATH, network access to Docker Hub, and (optionally) the
 * upstream Jellyfin host for the public-only checks.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, existsSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';

const REPO_ROOT = resolve(import.meta.dirname, '..');
const MUSIC_DIR = join(REPO_ROOT, 'fixtures', 'audio');
const ARTIFACT_DIR = join(REPO_ROOT, 'evidence', 'artifacts', 'S006');
const CLIENT = 'Statocyst';
const DEVICE = 'Statocyst Spike';
const APP_VERSION = '0.1.0';

// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = { versions: ['12.1'], upstream: null, keep: false, musicDir: MUSIC_DIR };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--versions') args.versions = argv[++i].split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--upstream') args.upstream = argv[++i];
    else if (a === '--keep') args.keep = true;
    else if (a === '--music-dir') args.musicDir = argv[++i];
  }
  return args;
}

function docker(args, opts = {}) {
  return execFileSync('docker', args, { encoding: 'utf8', stdio: opts.stdio ?? 'pipe', ...opts });
}

/** Redact secrets in any serialized value by key name. */
function redact(value) {
  if (value === null || value === undefined) return value;
  if (typeof value !== 'object') return value;
  const out = Array.isArray(value) ? [] : {};
  for (const [k, v] of Object.entries(value)) {
    if (/token|password|pw|secret|authorization|apikey|api_key|credential/i.test(k)) {
      out[k] = '[redacted]';
    } else {
      out[k] = redact(v);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------

class Recorder {
  constructor() {
    this.requests = [];
    this.checks = [];
  }
  async request(method, url, { headers = {}, body, token, allowStatus = null } = {}) {
    const started = Date.now();
    const requestHeaders = { ...headers };
    if (body !== undefined && !('Content-Type' in requestHeaders) && !('content-type' in requestHeaders)) {
      requestHeaders['Content-Type'] = 'application/json';
    }
    if (token) requestHeaders['Authorization'] = `MediaBrowser Client="${CLIENT}", Device="${DEVICE}", DeviceId="${DEVICE_ID}", Version="${APP_VERSION}", Token="${token}"`;
    let response;
    try {
      response = await fetch(url, {
        method,
        headers: requestHeaders,
        body: body === undefined ? undefined : JSON.stringify(body),
        redirect: 'manual',
      });
    } catch (error) {
      this.requests.push({
        label: url,
        method,
        status: 'NETWORK_ERROR',
        durationMs: Date.now() - started,
        error: String(error),
      });
      throw error;
    }
    const durationMs = Date.now() - started;
    const raw = await response.text();
    let json = null;
    try {
      json = raw ? JSON.parse(raw) : null;
    } catch {
      json = null;
    }
    const entry = {
      method,
      url: url.replace(/api_key=[^&"]*/g, 'api_key=[redacted]').replace(/Token="[^"]*"/g, 'Token="[redacted]"'),
      status: response.status,
      durationMs,
      requestHeaders: redact(requestHeaders),
      responseHeaders: {
        'content-type': response.headers.get('content-type'),
        'content-length': response.headers.get('content-length'),
        'content-range': response.headers.get('content-range'),
        'accept-ranges': response.headers.get('accept-ranges'),
        'content-disposition': response.headers.get('content-disposition'),
        location: response.headers.get('location'),
      },
      bodySummary: json
        ? summarize(redact(json))
        : raw.length > 0
          ? { bytes: raw.length, preview: raw.slice(0, 160) }
          : null,
    };
    if (allowStatus && !allowStatus.includes(response.status)) {
      entry.unexpected = `expected ${allowStatus.join('/')}`;
    }
    this.requests.push(entry);
    return { status: response.status, headers: response.headers, json, raw, durationMs };
  }
  check(name, pass, detail = '') {
    this.checks.push({ name, pass: !!pass, detail });
    return pass;
  }
  toJSON() {
    return { checks: this.checks, requests: this.requests };
  }
}

function summarize(value) {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) {
    return { count: value.length, first: value[0] === undefined ? null : summarize(value[0]) };
  }
  if (typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = summarize(v);
    }
    return out;
  }
  if (typeof value === 'string' && value.length > 80) return `${value.slice(0, 80)}…`;
  return value;
}

// ---------------------------------------------------------------------------

class Fixture {
  constructor(version, port, musicDir) {
    this.version = version;
    this.tag = `jellyfin/jellyfin:${version}`;
    this.port = port;
    this.name = `statocyst-s006-${version.replace(/\./g, '-')}`;
    this.base = `http://127.0.0.1:${port}`;
    this.tmp = join(tmpdir(), `statocyst-s006-${version}-${randomBytes(4).toString('hex')}`);
    this.musicDir = musicDir;
    this.username = 'statocyst';
    this.password = randomBytes(9).toString('base64url');
    this.token = null;
    this.userId = null;
    this.serverId = null;
    this.digest = null;
    this.recorder = new Recorder();
  }

  ensureDirs() {
    mkdirSync(join(this.tmp, 'config'), { recursive: true });
    mkdirSync(join(this.tmp, 'cache'), { recursive: true });
  }

  pull() {
    docker(['pull', this.tag], { stdio: 'inherit' });
    const inspect = docker(['image', 'inspect', this.tag, '--format', '{{index .RepoDigests 0}}']).trim();
    this.digest = inspect || null;
  }

  start() {
    docker(['rm', '-f', this.name]);
    this.ensureDirs();
    docker([
      'run', '-d', '--name', this.name, '-p', `${this.port}:8096`,
      '-v', `${join(this.tmp, 'config')}:/config`,
      '-v', `${join(this.tmp, 'cache')}:/cache`,
      '-v', `${this.musicDir}:/media/music:ro`,
      this.tag,
    ]);
  }

  async waitReady(timeoutMs = 120_000) {
    const deadline = Date.now() + timeoutMs;
    let last;
    while (Date.now() < deadline) {
      try {
        const r = await fetch(`${this.base}/System/Info/Public`);
        const text = await r.text();
        const json = JSON.parse(text);
        if (json.Version && json.Id) {
          last = json;
          break;
        }
      } catch {
        // still booting
      }
      await new Promise((res) => setTimeout(res, 1000));
    }
    if (!last) throw new Error(`Jellyfin ${this.version} did not become ready within ${timeoutMs}ms`);
    return last;
  }

  async wizard() {
    const cfgRead = await this.recorder.request('GET', `${this.base}/Startup/Configuration`, { allowStatus: [200] });
    const cfg = await this.recorder.request('POST', `${this.base}/Startup/Configuration`, {
      body: { UICulture: 'en-US', MetadataCountryCode: 'US', PreferredMetadataLanguage: 'en' },
      allowStatus: [204],
    });
    // Jellyfin 12 requires the current first-user state to be read before it can be set.
    const userRead = await this.recorder.request('GET', `${this.base}/Startup/User`, { allowStatus: [200] });
    const user = await this.recorder.request('POST', `${this.base}/Startup/User`, {
      body: { Name: this.username, Password: this.password },
      allowStatus: [204],
    });
    const done = await this.recorder.request('POST', `${this.base}/Startup/Complete`, { allowStatus: [204] });
    this.recorder.check(
      'startup wizard completed',
      cfg.status === 204 && user.status === 204 && done.status === 204,
      `cfg=${cfg.status} user=${user.status} done=${done.status}`,
    );
  }

  async authenticate() {
    const res = await this.recorder.request('POST', `${this.base}/Users/AuthenticateByName`, {
      headers: {
        'Authorization': `MediaBrowser Client="${CLIENT}", Device="${DEVICE}", DeviceId="${DEVICE_ID}", Version="${APP_VERSION}"`,
      },
      body: { Username: this.username, Pw: this.password },
      allowStatus: [200],
    });
    this.token = res.json?.AccessToken ?? null;
    this.userId = res.json?.User?.Id ?? null;
    this.serverId = res.json?.ServerId ?? null;
    this.recorder.check('auth returns access token', typeof this.token === 'string' && this.token.length > 20, `len=${this.token?.length}`);
    this.recorder.check('auth returns user id + server id', !!this.userId && !!this.serverId);
  }

  async addLibrary() {
    const res = await this.recorder.request(
      'POST',
      `${this.base}/Library/VirtualFolders?name=Music&collectionType=music&paths=/media/music`,
      { token: this.token, allowStatus: [204, 200] },
    );
    this.recorder.check('music library created', [200, 204].includes(res.status), `status=${res.status}`);
  }

  async refreshLibrary() {
    const res = await this.recorder.request('POST', `${this.base}/Library/Refresh`, {
      token: this.token,
      allowStatus: [204, 200],
    });
    this.recorder.check('library refresh accepted', [200, 204].includes(res.status), `status=${res.status}`);
  }

  async waitScan(expected = 4, timeoutMs = 120_000) {
    const deadline = Date.now() + timeoutMs;
    let audioCount = 0;
    let artistCount = 0;
    let fullyPopulated = false;
    while (Date.now() < deadline) {
      const audio = await this.recorder.request(
        'GET',
        `${this.base}/Users/${this.userId}/Items?Recursive=true&IncludeItemTypes=Audio&SortBy=SortName&Limit=${expected}`,
        { token: this.token, allowStatus: [200] },
      );
      if (audio.json && typeof audio.json.TotalRecordCount === 'number') {
        audioCount = audio.json.TotalRecordCount;
        const items = audio.json.Items ?? [];
        fullyPopulated =
          items.length >= expected &&
          items.every((it) => it.Id && it.Type === 'Audio' && typeof it.RunTimeTicks === 'number' && it.RunTimeTicks > 0);
      }
      const artists = await this.recorder.request(
        'GET',
        `${this.base}/Users/${this.userId}/Items?Recursive=true&IncludeItemTypes=MusicArtist`,
        { token: this.token, allowStatus: [200] },
      );
      if (artists.json && typeof artists.json.TotalRecordCount === 'number') {
        artistCount = artists.json.TotalRecordCount;
      }
      if (audioCount >= expected && fullyPopulated && artistCount >= 1) break;
      await new Promise((res) => setTimeout(res, 1000));
    }
    this.recorder.check(
      `library scanned (>= ${expected} audio items, fully populated)`,
      audioCount >= expected && fullyPopulated,
      `audio=${audioCount} artists=${artistCount}`,
    );
    return audioCount;
  }

  async teardown() {
    docker(['rm', '-f', this.name]);
    spawnSync('docker', ['run', '--rm', '-v', `${this.tmp}:/p`, 'alpine', 'rm', '-rf', '/p'], { stdio: 'ignore' });
    rmSync(this.tmp, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------

const DEVICE_ID = randomUUID();

async function publicChecks(recorder, base, label) {
  const info = await recorder.request('GET', `${base}/System/Info/Public`, { allowStatus: [200] });
  recorder.check(`${label}: public info returns product + version`, info.json && info.json.ProductName === 'Jellyfin Server' && typeof info.json.Version === 'string');

  const health = await recorder.request('GET', `${base}/health`, { allowStatus: [200] });
  recorder.check(`${label}: health endpoint reachable`, health.status === 200);

  const me = await recorder.request('GET', `${base}/Users`, { allowStatus: [401] });
  recorder.check(`${label}: user listing requires auth (401)`, me.status === 401);

  const badAuth = await recorder.request('POST', `${base}/Users/AuthenticateByName`, {
    headers: {
      'Authorization': `MediaBrowser Client="${CLIENT}", Device="${DEVICE}", DeviceId="${DEVICE_ID}", Version="${APP_VERSION}"`,
    },
    body: { Username: 'nobody', Pw: 'wrong-password' },
    allowStatus: [200, 401, 403, 500],
  });
  recorder.check(
    `${label}: invalid credentials do not yield a token (status recorded)`,
    badAuth.status !== 200,
    `status=${badAuth.status}`,
  );
}

async function verifyFixture(fixture) {
  const r = fixture.recorder;
  const base = fixture.base;

  await publicChecks(r, base, `${fixture.version} fixture`);

  // Identity stability: ServerId must not change across two calls.
  const info1 = await r.request('GET', `${base}/System/Info/Public`, { allowStatus: [200] });
  const info2 = await r.request('GET', `${base}/System/Info/Public`, { allowStatus: [200] });
  r.check('server identity stable across calls', info1.json.Id === info2.json.Id);

  await fixture.authenticate();

  // Auth round-trip: whoami
  const me = await r.request('GET', `${base}/Users/Me`, { token: fixture.token, allowStatus: [200] });
  r.check('authenticated /Users/Me matches login user', me.json?.Name === fixture.username);

  // Invalid token shape
  const badToken = await r.request('GET', `${base}/Users/Me`, { token: 'not-a-real-token', allowStatus: [401] });
  r.check('invalid token rejected (401)', badToken.status === 401);

  // --- Paginated browse ----------------------------------------------------
  const page1 = await r.request(
    'GET',
    `${base}/Users/${fixture.userId}/Items?Recursive=true&IncludeItemTypes=Audio&SortBy=SortName&SortOrder=Ascending&StartIndex=0&Limit=2`,
    { token: fixture.token, allowStatus: [200] },
  );
  const page2 = await r.request(
    'GET',
    `${base}/Users/${fixture.userId}/Items?Recursive=true&IncludeItemTypes=Audio&SortBy=SortName&SortOrder=Ascending&StartIndex=2&Limit=2`,
    { token: fixture.token, allowStatus: [200] },
  );
  const page3 = await r.request(
    'GET',
    `${base}/Users/${fixture.userId}/Items?Recursive=true&IncludeItemTypes=Audio&SortBy=SortName&SortOrder=Ascending&StartIndex=4&Limit=2`,
    { token: fixture.token, allowStatus: [200] },
  );
  const total = page1.json?.TotalRecordCount ?? 0;
  const p1 = page1.json?.Items ?? [];
  const p2 = page2.json?.Items ?? [];
  const p3 = page3.json?.Items ?? [];
  r.check('TotalRecordCount equals seeded audio count', total === 4, `total=${total}`);
  r.check('page size honoured (Limit=2)', p1.length === 2 && p2.length === 2, `p1=${p1.length} p2=${p2.length}`);
  r.check('final page is empty', p3.length === 0, `p3=${p3.length}`);
  const all = [...p1, ...p2];
  const ids = all.map((it) => it.Id);
  r.check('no duplicate ids across pages', new Set(ids).size === ids.length);
  r.check('item fields present (Id, Name, RunTimeTicks, Type)', all.every((it) => it.Id && typeof it.Name === 'string' && typeof it.RunTimeTicks === 'number' && it.Type === 'Audio'));

  // Browse album + artist rollups. Jellyfin 12 itemises MusicArtist but NOT
  // MusicAlbum — albums are string metadata (Album/AlbumArtist) on Audio items.
  const albums = await r.request('GET', `${base}/Users/${fixture.userId}/Items?Recursive=true&IncludeItemTypes=MusicAlbum`, { token: fixture.token, allowStatus: [200] });
  const artists = await r.request('GET', `${base}/Users/${fixture.userId}/Items?Recursive=true&IncludeItemTypes=MusicArtist`, { token: fixture.token, allowStatus: [200] });
  r.check('MusicArtist rollup returns artists', (artists.json?.Items?.length ?? 0) >= 2, `artists=${artists.json?.Items?.length}`);
  r.check('MusicAlbum rollup is empty in Jellyfin 12 (recorded)', (albums.json?.Items?.length ?? 0) === 0, `albums=${albums.json?.Items?.length}`);
  const albumNames = new Set(all.map((it) => it.Album).filter(Boolean));
  r.check('albums derivable from Audio item Album field', albumNames.size >= 2, `albums=[${[...albumNames].join(' | ')}]`);

  // Fields=MediaSources exposes container/bitrate for direct play planning
  const withSources = await r.request(
    'GET',
    `${base}/Users/${fixture.userId}/Items?Recursive=true&IncludeItemTypes=Audio&Fields=MediaSources,Genres,DateCreated,Path&EnableImages=true&Limit=1`,
    { token: fixture.token, allowStatus: [200] },
  );
  const firstSource = withSources.json?.Items?.[0];
  r.check('Fields=MediaSources returns media source details', !!(firstSource?.MediaSources?.[0]?.Container));

  // --- Search ---------------------------------------------------------------
  const search = await r.request('GET', `${base}/Users/${fixture.userId}/Items?Recursive=true&IncludeItemTypes=Audio&searchTerm=Tide`, { token: fixture.token, allowStatus: [200] });
  r.check('search finds "Tide Glass"', (search.json?.Items ?? []).some((it) => it.Name === 'Tide Glass'));
  const searchCase = await r.request('GET', `${base}/Users/${fixture.userId}/Items?Recursive=true&IncludeItemTypes=Audio&searchTerm=tide`, { token: fixture.token, allowStatus: [200] });
  r.check('search is case-insensitive', (searchCase.json?.Items ?? []).some((it) => it.Name === 'Tide Glass'));

  // --- Artwork --------------------------------------------------------------
  const withArt = (page1.json?.Items ?? []).find((it) => it.ImageTags?.Primary);
  if (withArt) {
    const art = await r.request('GET', `${base}/Items/${withArt.Id}/Images/Primary?maxHeight=300&quality=90`, { token: fixture.token, allowStatus: [200] });
    const ct = art.headers.get('content-type') ?? '';
    r.check('artwork returns an image', /^image\//.test(ct), ct);
    const artUnauth = await r.request('GET', `${base}/Items/${withArt.Id}/Images/Primary?maxHeight=300`, { allowStatus: [401, 200] });
    r.check('artwork without auth is 401 or open (recorded)', [401, 200].includes(artUnauth.status));
  }

  // --- Streaming ------------------------------------------------------------
  const mp3 = all.find((it) => it.Name === 'Sonar Bloom') ?? all[0];
  const flac = all.find((it) => it.Name === 'Tide Glass');
  if (mp3) {
    const stream = await r.request('GET', `${base}/Audio/${mp3.Id}/stream?static=true`, {
      token: fixture.token,
      headers: { Range: 'bytes=0-1023' },
      allowStatus: [200, 206],
    });
    r.check('static stream honours Range', stream.status === 206 && stream.headers.get('content-range') === 'bytes 0-1023/313724', `status=${stream.status} cr=${stream.headers.get('content-range')}`);
    r.check('static stream content-type is audio/mpeg', (stream.headers.get('content-type') ?? '').startsWith('audio/mpeg'));

    const badRange = await r.request('GET', `${base}/Audio/${mp3.Id}/stream?static=true`, {
      token: fixture.token,
      headers: { Range: 'bytes=999999999-' },
      allowStatus: [416],
    });
    r.check('invalid range returns 416', badRange.status === 416);

    const universal = await r.request(
      'GET',
      `${base}/Audio/${mp3.Id}/universal?UserId=${fixture.userId}&DeviceId=${DEVICE_ID}&MaxStreamingBitrate=140000000&AudioCodec=aac&Container=opus,mp3,aac,flac,ogg`,
      { token: fixture.token, allowStatus: [200, 206, 302] },
    );
    r.check('universal stream resolves (200/206/302)', [200, 206, 302].includes(universal.status), `status=${universal.status}`);

    const download = await r.request('GET', `${base}/Items/${mp3.Id}/Download`, { token: fixture.token, allowStatus: [200] });
    r.check('download endpoint streams original', download.status === 200);
  }
  if (flac) {
    const flacStream = await r.request('GET', `${base}/Audio/${flac.Id}/stream?static=true`, {
      token: fixture.token,
      headers: { Range: 'bytes=0-127' },
      allowStatus: [200, 206],
    });
    r.check('FLAC direct-play streams', [200, 206].includes(flacStream.status), `status=${flacStream.status} ct=${flacStream.headers.get('content-type')}`);
  }

  // --- Playback reporting ---------------------------------------------------
  const playSession = randomUUID();
  const playing = await r.request('POST', `${base}/Sessions/Playing`, {
    token: fixture.token,
    body: {
      ItemId: mp3?.Id ?? all[0].Id,
      PlaySessionId: playSession,
      PlayMethod: 'DirectStream',
      CanSeek: true,
      IsPaused: false,
      IsMuted: false,
      PositionTicks: 0,
      VolumeLevel: 100,
      RepeatMode: 'RepeatNone',
    },
    allowStatus: [204],
  });
  r.check('Sessions/Playing accepted (204)', playing.status === 204);
  const stopped = await r.request('POST', `${base}/Sessions/Playing/Stopped`, {
    token: fixture.token,
    body: { ItemId: mp3?.Id ?? all[0].Id, PlaySessionId: playSession, PositionTicks: 1_000_000 },
    allowStatus: [204],
  });
  r.check('Sessions/Playing/Stopped accepted (204)', stopped.status === 204);

  // --- Favourites -----------------------------------------------------------
  const favItem = mp3?.Id ?? all[0].Id;
  const favAdd = await r.request('POST', `${base}/Users/${fixture.userId}/FavoriteItems/${favItem}`, { token: fixture.token, allowStatus: [200] });
  r.check('favourite add accepted (200)', favAdd.status === 200);
  const favList = await r.request('GET', `${base}/Users/${fixture.userId}/Items?Filters=IsFavorite&IncludeItemTypes=Audio`, { token: fixture.token, allowStatus: [200] });
  r.check('favourite filter returns the favourited item', (favList.json?.Items ?? []).some((it) => it.Id === favItem));
  const favDel = await r.request('DELETE', `${base}/Users/${fixture.userId}/FavoriteItems/${favItem}`, { token: fixture.token, allowStatus: [200] });
  r.check('favourite remove accepted (200)', favDel.status === 200);
}

// ---------------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv.slice(2));
  mkdirSync(ARTIFACT_DIR, { recursive: true });

  const versionResults = [];
  let port = 18096;
  for (const version of args.versions) {
    const fixture = new Fixture(version, port, args.musicDir);
    port += 1;
    process.stdout.write(`\n== Jellyfin ${version} ==\n`);
    process.stdout.write(`  pulling ${fixture.tag} …\n`);
    fixture.pull();
    fixture.start();
    const info = await fixture.waitReady();
    process.stdout.write(`  ready: ${info.ProductName} ${info.Version} (id=${info.Id})\n`);
    await fixture.wizard();
    await fixture.authenticate();
    await fixture.addLibrary();
    await fixture.refreshLibrary();
    await fixture.waitScan();
    await verifyFixture(fixture);

    const failed = fixture.recorder.checks.filter((c) => !c.pass);
    process.stdout.write(`  checks: ${fixture.recorder.checks.length - failed.length}/${fixture.recorder.checks.length} passed\n`);
    for (const f of failed) process.stdout.write(`    FAIL: ${f.name} — ${f.detail}\n`);

    const out = {
      version: info.Version,
      imageTag: fixture.tag,
      imageDigest: fixture.digest,
      serverId: info.Id,
      serverName: info.ServerName,
      ...fixture.recorder.toJSON(),
    };
    writeFileSync(join(ARTIFACT_DIR, `fixture-${version}.json`), `${JSON.stringify(out, null, 2)}\n`);
    versionResults.push({ version: info.Version, pass: failed.length === 0, file: `fixture-${version}.json` });

    if (!args.keep) await fixture.teardown();
    else process.stdout.write(`  KEPT running at ${fixture.base}\n`);
  }

  // Upstream public-only checks (no credentials sent).
  if (args.upstream) {
    process.stdout.write(`\n== Upstream public checks: ${args.upstream} ==\n`);
    const recorder = new Recorder();
    try {
      await publicChecks(recorder, args.upstream.replace(/\/$/, ''), 'upstream');
      const info = await recorder.request('GET', `${args.upstream.replace(/\/$/, '')}/System/Info/Public`, { allowStatus: [200] });
      const out = { base: args.upstream, version: info.json?.Version, serverName: info.json?.ServerName, ...recorder.toJSON() };
      writeFileSync(join(ARTIFACT_DIR, 'upstream-public.json'), `${JSON.stringify(out, null, 2)}\n`);
      const failed = recorder.checks.filter((c) => !c.pass);
      process.stdout.write(`  checks: ${recorder.checks.length - failed.length}/${recorder.checks.length} passed\n`);
      for (const f of failed) process.stdout.write(`    FAIL: ${f.name} — ${f.detail}\n`);
      versionResults.push({ version: `upstream (${info.json?.Version ?? '?'})`, pass: failed.length === 0, file: 'upstream-public.json' });
    } catch (error) {
      process.stderr.write(`  upstream check failed: ${error}\n`);
      versionResults.push({ version: 'upstream', pass: false, file: null, error: String(error) });
    }
  }

  process.stdout.write(`\nResults written to ${ARTIFACT_DIR}\n`);
  const allPass = versionResults.every((v) => v.pass);
  process.stdout.write(JSON.stringify(versionResults, null, 2));
  process.stdout.write('\n');
  if (!allPass) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
