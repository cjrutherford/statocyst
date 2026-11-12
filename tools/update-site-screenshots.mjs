#!/usr/bin/env node
/**
 * Site screenshot update pass.
 *
 * Converts the current captures in site/captures/ into the WebP assets used
 * by the landing page, refreshes clip posters, regenerates the OG image, and builds
 * the one allowed constructed screen: the Android Auto head-unit preview.
 *
 * Run automatically by tools/build-site.mjs, or directly:
 *   node tools/update-site-screenshots.mjs
 *   node tools/capture-site-screenshots.mjs  # refresh site/captures/ first
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, statSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const site = path.join(root, 'site');
const screens = path.join(site, 'assets', 'screens');
const video = path.join(site, 'assets', 'video');
const branding = path.join(site, 'assets', 'branding');

const ffmpeg = process.env.FFMPEG || 'ffmpeg';

function fail(message) {
  throw new Error(message);
}

function runFfmpeg(args, label) {
  const result = spawnSync(ffmpeg, args, { stdio: 'inherit' });
  if (result.error?.code === 'ENOENT') {
    fail('ffmpeg is required for the screenshot update pass. Install ffmpeg and retry.');
  }
  if (result.status !== 0) fail(`ffmpeg failed while ${label}`);
}

function requireFile(file) {
  if (!existsSync(file)) fail(`missing screenshot source: ${path.relative(root, file)}`);
}

function toWebp(source, target, filter) {
  requireFile(source);
  mkdirSync(path.dirname(target), { recursive: true });
  const vf = filter ? `${filter}` : 'scale=iw:-1:flags=lanczos';
  runFfmpeg(
    ['-y', '-hide_banner', '-loglevel', 'error', '-i', source, '-vf', vf, '-frames:v', '1', '-c:v', 'libwebp', '-quality', '84', target],
    `converting ${path.relative(root, source)}`
  );
}

function poster(source, target) {
  requireFile(source);
  runFfmpeg(
    ['-y', '-hide_banner', '-loglevel', 'error', '-ss', '1.8', '-i', source, '-frames:v', '1', '-q:v', '3', target],
    `extracting a poster from ${path.relative(root, source)}`
  );
}

const stills = [
  ['site/captures/desktop-library-dark.png', 'desktop-library-dark.webp', 'scale=1320:-1:flags=lanczos'],
  ['site/captures/desktop-now-playing-light.png', 'desktop-now-playing-light.webp', 'scale=1320:-1:flags=lanczos'],
  ['site/captures/tablet-library.png', 'tablet-library.webp', 'scale=1024:-1:flags=lanczos'],
  ['site/captures/phone-now-playing-dark.png', 'phone-now-playing-dark.webp', 'scale=390:-1:flags=lanczos'],
  ['site/captures/phone-library-dark.png', 'phone-library-dark.webp', 'scale=390:-1:flags=lanczos'],
  ['site/captures/desktop-queue-light.png', 'queue-light.webp', 'scale=1320:-1:flags=lanczos'],
  ['site/captures/desktop-library-light.png', 'library-light.webp', 'scale=1320:-1:flags=lanczos'],
];

for (const [source, name, filter] of stills) {
  toWebp(path.join(root, source), path.join(screens, name), filter);
}

const clips = ['playlists', 'queue', 'now-playing'];
for (const name of clips) {
  poster(path.join(video, `${name}.mp4`), path.join(video, `${name}-poster.jpg`));
}

// Assets used by the constructed car screens.
runFfmpeg(
  ['-y', '-hide_banner', '-loglevel', 'error', '-i', path.join(root, 'resources/demo/cover.jpg'), '-vf', 'scale=256:256:flags=lanczos', '-frames:v', '1', path.join(branding, 'car-cover.jpg')],
  'refreshing the car cover'
);
runFfmpeg(
  ['-y', '-hide_banner', '-loglevel', 'error', '-i', path.join(branding, 'statocyst-symbol.png'), '-vf', 'scale=128:128:flags=lanczos', '-frames:v', '1', path.join(branding, 'statocyst-symbol-128.png')],
  'refreshing the small car mark'
);

// Keep the social card in sync with the desktop hero capture.
requireFile(path.join(screens, 'desktop-library-dark.webp'));
const og = path.join(branding, 'og.jpg');
runFfmpeg(
  ['-y', '-hide_banner', '-loglevel', 'error', '-i', path.join(screens, 'desktop-library-dark.webp'), '-vf', 'scale=1200:-1:flags=lanczos,crop=1200:630:0:0', '-frames:v', '1', '-q:v', '3', og],
  'refreshing the OG image'
);

// The only constructed screens: Android Auto now playing and browse previews.
const carMock = spawnSync(process.execPath, [path.join(root, 'tools/make-car-mock.mjs')], { stdio: 'inherit' });
if (carMock.status !== 0) fail('the car preview generator failed');

const bytes = (file) => `${(statSync(file).size / 1024).toFixed(0)} KB`;
console.log(`screenshots updated: ${stills.length} stills, ${clips.length} posters, 1 OG image, 2 constructed car previews`);
console.log(`  desktop: ${bytes(path.join(screens, 'desktop-library-dark.webp'))}`);
console.log(`  phone:   ${bytes(path.join(screens, 'phone-now-playing-dark.webp'))}`);
console.log(`  car:     ${bytes(path.join(screens, 'car-head-unit-now-playing.svg'))} + ${bytes(path.join(screens, 'car-head-unit-browse.svg'))}`);
