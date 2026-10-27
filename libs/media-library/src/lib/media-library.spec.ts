import { afterEach, describe, expect, it } from 'vitest';
import { copyFile, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  artworkExtension,
  computePathKey,
  extensionOf,
  fallbackTitle,
  isSupportedAudioPath,
  pathIsInside,
  scanPaths,
} from '../index';

const fixtures = resolve(import.meta.dirname, '../../../../fixtures/audio');
const directories: string[] = [];

async function tempDir(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'statocyst-media-'));
  directories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('local media import', () => {
  it('reads real MP3, FLAC, OGG and WAV fixtures with metadata and artwork', async () => {
    const result = await scanPaths([fixtures]);
    expect(result.rejected).toEqual([]);
    expect(result.tracks).toHaveLength(4);
    const byExtension = new Map(result.tracks.map((track) => [track.ext, track]));

    const mp3 = byExtension.get('mp3')!;
    expect(mp3.title).toBe('Sonar Bloom');
    expect(mp3.artist).toBe('Statocyst Ensemble');
    expect(mp3.album).toBe('Bathypelagic Sessions');
    expect(mp3.albumArtist).toBe('Statocyst Ensemble');
    expect(mp3.trackNo).toBe(1);
    expect(mp3.year).toBe(2026);
    expect(mp3.durationMs).toBeGreaterThan(11_000);
    expect(mp3.bitrate).toBeGreaterThan(100_000);
    expect(mp3.artwork?.mimeType).toBe('image/jpeg');
    expect(mp3.artwork?.data.length).toBeGreaterThan(1000);

    const flac = byExtension.get('flac')!;
    expect(flac.title).toBe('Tide Glass');
    expect(flac.durationMs).toBeCloseTo(10_000, -2);
    expect(flac.artwork?.mimeType).toBe('image/jpeg');

    const ogg = byExtension.get('ogg')!;
    expect(ogg.title).toBe('Pearl Drift');
    expect(ogg.artist).toBe('Neritic Choir');
    expect(ogg.artwork).toBeNull();

    const wav = byExtension.get('wav')!;
    expect(wav.title).toBe('Abyssal Pulse');
    expect(wav.artist).toBe('Unknown artist');
    expect(wav.album).toBe('Unknown album');
    expect(wav.durationMs).toBeCloseTo(8_000, -2);
  });

  it('rejects missing, unsupported, corrupt and non-absolute inputs without throwing', async () => {
    const directory = await tempDir();
    const text = join(directory, 'notes.txt');
    const corrupt = join(directory, 'broken.mp3');
    await writeFile(text, 'not audio');
    await writeFile(corrupt, 'definitely not an mp3 payload');
    const result = await scanPaths([
      join(directory, 'missing.mp3'),
      text,
      corrupt,
      'relative/song.mp3',
    ]);
    expect(result.tracks).toEqual([]);
    expect(result.rejected.map((item) => item.code).sort()).toEqual([
      'NOT_FOUND',
      'PARSE_FAILED',
      'UNREADABLE',
      'UNSUPPORTED',
    ]);
  });

  it('skips hidden files and symlinks during directory walks', async () => {
    const directory = await tempDir();
    const outside = await tempDir();
    await copyFile(join(fixtures, '01-sonar-bloom.mp3'), join(outside, 'outside.mp3'));
    await symlink(outside, join(directory, 'escape'));
    await symlink(join(fixtures, '03-pearl-drift.ogg'), join(directory, 'linked.ogg'));
    await writeFile(join(directory, '.hidden.mp3'), 'ignored');
    const result = await scanPaths([directory]);
    expect(result.tracks).toEqual([]);
    expect(result.rejected).toEqual([]);

    const explicit = await scanPaths([join(directory, 'linked.ogg')]);
    expect(explicit.rejected[0].code).toBe('SYMLINK');
  });

  it('honours maxFiles and reports a limit rejection', async () => {
    const directory = await tempDir();
    await copyFile(join(fixtures, '01-sonar-bloom.mp3'), join(directory, 'a.mp3'));
    await copyFile(join(fixtures, '02-tide-glass.flac'), join(directory, 'b.flac'));
    await copyFile(join(fixtures, '03-pearl-drift.ogg'), join(directory, 'c.ogg'));
    const result = await scanPaths([directory], { maxFiles: 2 });
    expect(result.tracks).toHaveLength(2);
    expect(result.rejected.some((item) => item.code === 'LIMIT_REACHED')).toBe(true);
  });

  it('honours maxDepth', async () => {
    const directory = await tempDir();
    const nested = join(directory, 'one/two/three');
    await mkdir(nested, { recursive: true });
    await copyFile(join(fixtures, '01-sonar-bloom.mp3'), join(nested, 'deep.mp3'));
    const shallow = await scanPaths([directory], { maxDepth: 1 });
    expect(shallow.tracks).toHaveLength(0);
    const deep = await scanPaths([directory], { maxDepth: 4 });
    expect(deep.tracks).toHaveLength(1);
  });

  it('supports cancellation', async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await scanPaths([fixtures], { signal: controller.signal });
    expect(result.tracks).toHaveLength(0);
  });

  it('continues when one parser call fails', async () => {
    let calls = 0;
    const result = await scanPaths([fixtures], {
      parser: async (path) => {
        calls += 1;
        if (calls === 2) throw new Error('synthetic parser failure');
        const { parseFile } = await import('music-metadata');
        return parseFile(path, { duration: true });
      },
    });
    expect(result.tracks).toHaveLength(3);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0].code).toBe('PARSE_FAILED');
  });

  it('normalises path keys for Windows case-insensitive lookups', () => {
    expect(computePathKey('C:\\Music\\Song.mp3', 'win32')).toBe(
      computePathKey('c:\\music\\song.MP3', 'win32'),
    );
    expect(computePathKey('/Music/Song.mp3', 'linux')).not.toBe(
      computePathKey('/music/song.mp3', 'linux'),
    );
  });

  it('exposes deterministic display helpers', () => {
    expect(extensionOf('/music/Song.FLAC')).toBe('flac');
    expect(isSupportedAudioPath('/music/Song.FLAC')).toBe(true);
    expect(isSupportedAudioPath('/music/Song.txt')).toBe(false);
    expect(fallbackTitle('01 - Sonar_Bloom.mp3')).toBe('Sonar Bloom');
    expect(artworkExtension('image/png')).toBe('png');
    expect(artworkExtension('image/svg+xml')).toBeNull();
    expect(pathIsInside('/music', '/music/album/song.mp3')).toBe(true);
    expect(pathIsInside('/music', '/music-other/song.mp3')).toBe(false);
  });
});
