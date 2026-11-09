import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { BrowserWindow } from 'electron';
import { CHANNELS, type EngineCommand, type EngineLoadRequest } from '@statocyst/contracts';
import { StatocystDatabase } from '@statocyst/persistence';
import { Logger } from './logger';
import { PlaybackService } from './playback-service';
import { DEFAULT_SETTINGS, type SettingsService } from './settings-service';

const directories: string[] = [];
const services: PlaybackService[] = [];

afterEach(async () => {
  await Promise.all(services.splice(0).map((service) => service.shutdown()));
  await Promise.all(
    directories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }).catch(() => undefined),
    ),
  );
});

interface Harness {
  directory: string;
  db: StatocystDatabase;
  service: PlaybackService;
  settings: SettingsService;
  musicId: string;
  episodeOneMediaId: string;
  episodeTwoMediaId: string;
  episodeOneId: string;
  loads: EngineLoadRequest[];
  commands: EngineCommand[];
  events: Array<{ channel: string; payload: unknown }>;
}

async function setup(): Promise<Harness> {
  const directory = await mkdtemp(join(tmpdir(), 'statocyst-playback-'));
  directories.push(directory);
  const db = await StatocystDatabase.open({ path: join(directory, 'statocyst.db') });
  const logger = new Logger(join(directory, 'statocyst.log'));
  await logger.init();
  const source = await db.upsertSource({ kind: 'local', label: 'Music', rootPath: '/music' });
  const music = (
    await db.upsertTrack({
      sourceId: source.id,
      path: '/music/one.mp3',
      pathKey: '/music/one.mp3',
      fileName: 'one.mp3',
      ext: 'mp3',
      sizeBytes: 1,
      mtimeMs: 1,
      title: 'Music One',
      artist: 'Artist',
      album: 'Album',
      durationMs: 120_000,
    })
  ).track;
  const feed = await db.upsertPodcastFeed({
    feedUrl: 'https://feeds.example.com/show.xml',
    title: 'Show',
    author: 'Host',
    feedType: 'rss',
  });
  await db.savePodcastEpisodes(feed.id, [
    {
      feedId: feed.id,
      guid: 'ep-1',
      title: 'Episode One',
      enclosureUrl: 'https://cdn.example.com/1.mp3',
      enclosureType: 'audio/mpeg',
      durationMs: 60_000,
    },
    {
      feedId: feed.id,
      guid: 'ep-2',
      title: 'Episode Two',
      enclosureUrl: 'https://cdn.example.com/2.mp3',
      enclosureType: 'audio/mpeg',
      durationMs: 60_000,
    },
  ]);
  const episodes = await db.listPodcastEpisodes(feed.id, { sort: 'oldest' });
  const loads: EngineLoadRequest[] = [];
  const commands: EngineCommand[] = [];
  const events: Array<{ channel: string; payload: unknown }> = [];
  const window = {
    isDestroyed: () => false,
    webContents: {
      send: (channel: string, payload: unknown) => {
        events.push({ channel, payload });
        if (channel === CHANNELS.engineLoad) loads.push(payload as EngineLoadRequest);
        if (channel === CHANNELS.engineCommand) commands.push(payload as EngineCommand);
      },
    },
  } as unknown as BrowserWindow;
  const settings = {
    get: () => ({ ...DEFAULT_SETTINGS, listeningHistory: true }),
    update: async (patch: Record<string, unknown>) => ({ ...DEFAULT_SETTINGS, ...patch }),
  } as unknown as SettingsService;
  const service = new PlaybackService({
    database: db,
    settings,
    logger,
    getWindow: () => window,
  });
  services.push(service);
  await service.init();
  return {
    directory,
    db,
    service,
    settings,
    musicId: music.id,
    episodeOneMediaId: episodes[0].id,
    episodeTwoMediaId: episodes[1].id,
    episodeOneId: episodes[0].episodeId,
    loads,
    commands,
    events,
  };
}

function engine(harness: Harness) {
  const load = harness.loads[harness.loads.length - 1];
  if (!load) throw new Error('no engine load');
  return {
    load,
    playing: () => harness.service.engineEvent({ type: 'state', token: load.token, state: 'playing' }),
    time: (positionMs: number) =>
      harness.service.engineEvent({
        type: 'time',
        token: load.token,
        positionMs,
        durationMs: load.durationMs,
      }),
    ended: () => harness.service.engineEvent({ type: 'ended', token: load.token }),
  };
}

describe('two-context playback', () => {
  it('switches context, preserves both queues and restores podcast resume', async () => {
    const first = await setup();
    const musicPlay = await first.service.command({ type: 'play', trackId: first.musicId }, 'music');
    expect(musicPlay.ok, JSON.stringify(musicPlay)).toBe(true);
    expect(first.loads.length, JSON.stringify(first.events)).toBeGreaterThan(0);
    const firstEngine = engine(first);
    firstEngine.playing();
    firstEngine.time(30_000);
    expect(first.service.getSnapshot('music')).toMatchObject({
      context: 'music',
      active: true,
      state: 'playing',
    });

    await first.service.command(
      {
        type: 'play',
        trackId: first.episodeOneMediaId,
        contextTrackIds: [first.episodeOneMediaId, first.episodeTwoMediaId],
      },
      'podcast',
    );
    const podcastEngine = engine(first);
    podcastEngine.playing();
    podcastEngine.time(20_000);
    expect(first.service.getSnapshot('podcast')).toMatchObject({
      context: 'podcast',
      active: true,
      track: { title: 'Episode One' },
    });
    expect(first.service.getSnapshot('music').active).toBe(false);
    expect(first.service.getSnapshot('music').track?.title).toBe('Music One');

    await first.service.command({ type: 'play' }, 'music');
    expect(first.service.getSnapshot('music').active).toBe(true);
    expect(first.service.getSnapshot('podcast').active).toBe(false);
    const episode = await first.db.getPodcastEpisode(first.episodeOneId);
    expect(episode?.resumePositionMs).toBe(20_000);

    await first.service.shutdown();
    services.splice(services.indexOf(first.service), 1);
    await first.db.close();

    const path = join(first.directory, 'statocyst.db');
    const reopened = await StatocystDatabase.open({ path });
    const logger = new Logger(join(first.directory, 'restore.log'));
    await logger.init();
    const restored = new PlaybackService({
      database: reopened,
      settings: first.settings,
      logger,
      getWindow: () => null,
    });
    services.push(restored);
    await restored.init();
    const snapshot = restored.getSnapshot('podcast');
    expect(snapshot.positionMs).toBe(20_000);
    expect(snapshot.track?.title).toBe('Episode One');
    expect(restored.getSnapshot('music').track?.title).toBe('Music One');
    await reopened.close();
  });

  it('resumes the selected episode with its own saved position', async () => {
    const harness = await setup();
    await harness.service.command(
      {
        type: 'play',
        trackId: harness.episodeOneMediaId,
        contextTrackIds: [harness.episodeOneMediaId, harness.episodeTwoMediaId],
      },
      'podcast',
    );
    const first = engine(harness);
    first.playing();
    first.time(20_000);
    await harness.service.command({ type: 'pause' }, 'podcast');

    await harness.service.command(
      {
        type: 'play',
        trackId: harness.episodeTwoMediaId,
        contextTrackIds: [harness.episodeOneMediaId, harness.episodeTwoMediaId],
      },
      'podcast',
    );
    const second = engine(harness);
    second.playing();
    second.time(35_000);
    await harness.service.command({ type: 'pause' }, 'podcast');

    // Both episodes live in one queue. Choosing the first must resume episode
    // one at 20s rather than continuing episode two or starting at zero.
    await harness.service.command(
      {
        type: 'play',
        trackId: harness.episodeOneMediaId,
        contextTrackIds: [harness.episodeOneMediaId, harness.episodeTwoMediaId],
      },
      'podcast',
    );
    const load = harness.loads.at(-1);
    expect(load?.trackId).toBe(harness.episodeOneMediaId);
    expect(load?.startPositionMs).toBe(20_000);
    expect(harness.service.getSnapshot('podcast').track?.title).toBe('Episode One');
  });

  it('mutates the inactive queue without switching audio', async () => {
    const harness = await setup();
    await harness.service.command({ type: 'play', trackId: harness.musicId }, 'music');
    await harness.service.command(
      { type: 'enqueue', trackIds: [harness.episodeOneMediaId] },
      'podcast',
    );
    expect(harness.service.getSnapshot('music').active).toBe(true);
    expect(harness.service.getQueue('podcast').entries.map((entry) => entry.trackId)).toEqual([
      harness.episodeOneMediaId,
    ]);
  });

  it('applies rate only to the podcast context', async () => {
    const harness = await setup();
    await harness.service.command(
      { type: 'play', trackId: harness.episodeOneMediaId },
      'podcast',
    );
    const rate = await harness.service.command({ type: 'setRate', rate: 1.5 }, 'podcast');
    expect(rate.ok).toBe(true);
    expect(harness.service.getSnapshot('podcast').rate).toBe(1.5);
    expect(harness.commands.at(-1)).toMatchObject({ action: 'rate', rate: 1.5 });
    const musicRate = await harness.service.command({ type: 'setRate', rate: 1.5 }, 'music');
    expect(musicRate.ok).toBe(false);
  });

  it('marks an episode complete and advances on end', async () => {
    const harness = await setup();
    await harness.service.command(
      {
        type: 'play',
        trackId: harness.episodeOneMediaId,
        contextTrackIds: [harness.episodeOneMediaId, harness.episodeTwoMediaId],
      },
      'podcast',
    );
    engine(harness).ended();
    await new Promise((resolve) => setTimeout(resolve, 50));
    const first = await harness.db.getPodcastEpisode(harness.episodeOneId);
    expect(first?.played).toBe(true);
    expect(first?.completed).toBe(true);
    expect(harness.service.getSnapshot('podcast').track?.title).toBe('Episode Two');
  });
});
