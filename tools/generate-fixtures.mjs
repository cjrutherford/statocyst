#!/usr/bin/env node
/**
 * Generates reproducible, royalty-free demo audio and test fixtures with ffmpeg.
 *
 * Visual material is derived only from the approved project branding asset
 * (`statocyst-architecture-pack/assets/branding/transparent/statocyst-symbol-512.png`).
 */
import { execFile } from 'node:child_process';
import { mkdir, copyFile, rm, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const brand = join(
  root,
  'statocyst-architecture-pack/assets/branding/transparent/statocyst-symbol-512.png',
);
const fixtureDir = join(root, 'fixtures/audio');
const demoDir = join(root, 'resources/demo');
const work = join(root, 'tmp/fixtures');
const cover = join(work, 'cover.jpg');

const tracks = [
  {
    slug: '01-sonar-bloom',
    title: 'Sonar Bloom',
    artist: 'Statocyst Ensemble',
    album: 'Bathypelagic Sessions',
    track: 1,
    year: 2026,
    genre: 'Ambient',
    frequency: 174,
    duration: 12,
    format: 'mp3',
    embedCover: true,
  },
  {
    slug: '02-tide-glass',
    title: 'Tide Glass',
    artist: 'Statocyst Ensemble',
    album: 'Bathypelagic Sessions',
    track: 2,
    year: 2026,
    genre: 'Ambient',
    frequency: 220,
    duration: 10,
    format: 'flac',
    embedCover: true,
  },
  {
    slug: '03-pearl-drift',
    title: 'Pearl Drift',
    artist: 'Neritic Choir',
    album: 'Suspended Light',
    track: 1,
    year: 2026,
    genre: 'Downtempo',
    frequency: 261.63,
    duration: 9,
    format: 'ogg',
    embedCover: false,
  },
  {
    slug: '04-abyssal-pulse',
    title: 'Abyssal Pulse',
    artist: 'Neritic Choir',
    album: 'Suspended Light',
    track: 2,
    year: 2026,
    genre: 'Downtempo',
    frequency: 329.63,
    duration: 8,
    format: 'wav',
    embedCover: false,
  },
];

async function ensureFfmpeg() {
  try {
    await run('ffmpeg', ['-version']);
  } catch {
    throw new Error('ffmpeg is required to generate demo audio fixtures');
  }
}

async function createCover() {
  await mkdir(work, { recursive: true });
  await run('ffmpeg', [
    '-y',
    '-loglevel',
    'error',
    '-i',
    brand,
    '-vf',
    'scale=512:512,format=yuvj420p',
    '-q:v',
    '3',
    cover,
  ]);
}

function metadataArgs(track) {
  return [
    '-metadata',
    `title=${track.title}`,
    '-metadata',
    `artist=${track.artist}`,
    '-metadata',
    `album=${track.album}`,
    '-metadata',
    `album_artist=${track.artist}`,
    '-metadata',
    `track=${track.track}`,
    '-metadata',
    `date=${track.year}`,
    '-metadata',
    `genre=${track.genre}`,
  ];
}

async function encode(track, output) {
  const inputs = [
    '-y',
    '-loglevel',
    'error',
    '-f',
    'lavfi',
    '-i',
    `sine=frequency=${track.frequency}:sample_rate=44100:duration=${track.duration}`,
  ];
  if (track.embedCover) inputs.push('-i', cover);
  const filter = [
    '-af',
    'volume=0.18,afade=t=in:st=0:d=0.8,afade=t=out:st=' +
      Math.max(0, track.duration - 1.2) +
      ':d=1.2',
  ];
  const meta = metadataArgs(track);

  if (track.format === 'mp3') {
    const args = [...inputs, ...filter, '-map', '0:a'];
    if (track.embedCover) {
      args.push('-map', '1:v', '-c:v', 'mjpeg', '-disposition:v', 'attached_pic');
    }
    args.push('-c:a', 'libmp3lame', '-b:a', '192k', '-id3v2_version', '3', ...meta, output);
    await run('ffmpeg', args);
    return;
  }

  if (track.format === 'flac') {
    const args = [...inputs, ...filter, '-map', '0:a'];
    if (track.embedCover) {
      args.push('-map', '1:v', '-c:v', 'mjpeg', '-disposition:v', 'attached_pic');
    }
    args.push('-c:a', 'flac', '-compression_level', '8', ...meta, output);
    await run('ffmpeg', args);
    return;
  }

  if (track.format === 'ogg') {
    await run('ffmpeg', [
      ...inputs,
      ...filter,
      '-c:a',
      'libvorbis',
      '-q:a',
      '5',
      ...meta,
      output,
    ]);
    return;
  }

  await run('ffmpeg', [...inputs, ...filter, '-c:a', 'pcm_s16le', output]);
}

async function main() {
  await ensureFfmpeg();
  await rm(fixtureDir, { recursive: true, force: true });
  await rm(demoDir, { recursive: true, force: true });
  await mkdir(fixtureDir, { recursive: true });
  await mkdir(demoDir, { recursive: true });
  await createCover();
  await copyFile(cover, join(demoDir, 'cover.jpg'));

  for (const track of tracks) {
    const fixture = join(fixtureDir, `${track.slug}.${track.format}`);
    const demo = join(demoDir, `${track.slug}.${track.format}`);
    await encode(track, fixture);
    await copyFile(fixture, demo);
    const size = (await stat(fixture)).size;
    console.log(`${track.slug}.${track.format}  ${(size / 1024).toFixed(0)} KiB`);
  }

  console.log(`\nFixtures: ${fixtureDir}`);
  console.log(`Demo library: ${demoDir}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
