#!/usr/bin/env node
/**
 * Generate the constructed car previews.
 *
 * These are the only constructed screens on the site. Statocyst uses a Media3
 * MediaLibraryService, so Android Auto draws its standard media surface from
 * the real browse tree (BrowseTree.kt) and the session's shuffle / repeat /
 * heart actions (PlaybackService.kt). These previews follow that surface, not
 * the Car App Library's MediaPlaybackTemplate/SectionedItemTemplate.
 *
 * Reference layouts:
 *   developer.android.com/training/cars/media
 *   android/app/src/main/java/.../media/BrowseTree.kt
 *   android/app/src/main/java/.../media/PlaybackService.kt
 *
 * Everything else on the site is a real capture.
 */
import { rm, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const outDir = path.join(root, 'site', 'assets', 'screens');
const nowPlayingOut = path.join(outDir, 'car-head-unit-now-playing.svg');
const browseOut = path.join(outDir, 'car-head-unit-browse.svg');

function read(file) {
  if (!existsSync(file)) throw new Error(`missing required asset: ${path.relative(root, file)}`);
  return readFileSync(file);
}

function b64(file, mime) {
  return `data:${mime};base64,${read(file).toString('base64')}`;
}

const cover = b64(path.join(root, 'site/assets/branding/car-cover.jpg'), 'image/jpeg');
const mark = b64(path.join(root, 'site/assets/branding/statocyst-symbol-128.png'), 'image/png');
const fontInter = b64(path.join(root, 'site/assets/fonts/inter.woff2'), 'font/woff2');
const fontDisplay = b64(path.join(root, 'site/assets/fonts/space-grotesk.woff2'), 'font/woff2');

const style = `
  @font-face { font-family: 'Inter'; src: url('${fontInter}') format('woff2'); font-weight: 400 600; }
  @font-face { font-family: 'Space Grotesk'; src: url('${fontDisplay}') format('woff2'); font-weight: 400 700; }
  .sans { font-family: 'Inter', system-ui, sans-serif; }
  .display { font-family: 'Space Grotesk', 'Inter', system-ui, sans-serif; }
  .mono { font-family: ui-monospace, 'Cascadia Mono', monospace; }
`;

const defs = (withMark = false) => `
  <defs>
    <style>${style}</style>
    <clipPath id="clipArt"><rect x="1040" y="150" width="470" height="470" rx="24"/></clipPath>
    <clipPath id="clipRow"><rect width="92" height="92" rx="14"/></clipPath>
    <clipPath id="clipMini"><rect width="64" height="64" rx="12"/></clipPath>
    <clipPath id="clipApp"><circle cx="96" cy="116" r="32"/></clipPath>
    ${withMark ? `<clipPath id="clipMark"><circle cx="96" cy="116" r="28"/></clipPath>` : ''}
    <filter id="artShadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="16" stdDeviation="20" flood-color="#000" flood-opacity="0.5"/>
    </filter>
  </defs>
`;

const statusBar = `
  <rect width="1600" height="46" fill="#080808"/>
  <text x="52" y="30" class="mono" fill="#e8e8e8" font-size="16">22:41</text>
  <g fill="#e8e8e8">
    <rect x="1390" y="22" width="4" height="12" rx="1"/>
    <rect x="1398" y="18" width="4" height="16" rx="1"/>
    <rect x="1406" y="14" width="4" height="20" rx="1"/>
    <path d="M1440 20c8-7 20-7 28 0l-4 5c-6-5-14-5-20 0z"/>
    <path d="M1447 27c4-3 10-3 14 0l-4 5c-2-2-4-2-6 0z"/>
    <rect x="1490" y="17" width="34" height="18" rx="5" fill="none" stroke="#e8e8e8" stroke-width="2"/>
    <rect x="1495" y="22" width="22" height="8" rx="2"/>
    <rect x="1526" y="22" width="3" height="8" rx="1"/>
  </g>
`;

const back = `<path d="M108 104H68M68 104l20-20M68 104l20 20"/>`;
const queuePill = `
  <rect x="1408" y="76" width="140" height="54" rx="27" fill="none" stroke="#d0d0d0" stroke-width="2.2"/>
  <g fill="none" stroke="#d0d0d0" stroke-width="2.2" stroke-linecap="round">
    <path d="M1428 94h22M1428 104h22M1428 114h14"/>
    <path d="M1454 94v20"/>
  </g>
  <text x="1470" y="111" class="sans" fill="#e8e8e8" font-size="22">Queue</text>
`;
const shuffle = `<path d="M1148 822h22l30 30h26M1148 852h22l30-30h26M1218 814l8 8-8 8M1218 844l8 8-8 8"/>`;
const repeat = `<path d="M1270 844a18 18 0 1 1 8 15M1278 824v22h-22"/>`;
const heart = `<path d="M1392 852s-20-12-20-25a10.5 10.5 0 0 1 20-4 10.5 10.5 0 0 1 20 4c0 13-20 25-20 25z"/>`;

// --- standard MediaLibraryService now-playing surface ----------------------
const nowPlaying = `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900" viewBox="0 0 1600 900" role="img" aria-label="Constructed Android Auto now playing screen for Statocyst">
  ${defs()}
  <rect width="1600" height="900" fill="#121212"/>
  ${statusBar}
  <g fill="none" stroke="#e8e8e8" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">${back}</g>
  ${queuePill}

  <text x="96" y="214" class="sans" fill="#a0a0a0" font-size="16" letter-spacing="2.4">SUSPENDED LIGHT</text>
  <text x="96" y="292" class="display" fill="#f5f5f5" font-size="58" font-weight="600" letter-spacing="-1.2">Pearl Drift</text>
  <text x="96" y="340" class="sans" fill="#a0a0a0" font-size="28">Neritic Choir</text>

  <rect x="1040" y="150" width="470" height="470" rx="24" fill="#1b1b1b"/>
  <image x="1040" y="150" width="470" height="470" href="${cover}" clip-path="url(#clipArt)" preserveAspectRatio="xMidYMid slice" filter="url(#artShadow)"/>

  <rect x="96" y="690" width="1408" height="6" rx="3" fill="#4a4a4a"/>
  <rect x="96" y="690" width="550" height="6" rx="3" fill="#e8e8e8"/>
  <circle cx="646" cy="693" r="7" fill="#e8e8e8"/>
  <text x="1504" y="736" class="sans" fill="#a0a0a0" font-size="23" text-anchor="end">1:34 / 3:45</text>

  <rect x="96" y="778" width="150" height="86" rx="20" fill="#e8e8e8"/>
  <rect x="158" y="798" width="8" height="46" rx="3" fill="#121212"/>
  <rect x="176" y="798" width="8" height="46" rx="3" fill="#121212"/>
  <g fill="#e8e8e8">
    <path d="M316 778h7v54h-7z"/>
    <path d="M352 778l-26 27 26 27z"/>
    <path d="M430 778l26 27-26 27z"/>
    <path d="M455 778h7v54h-7z"/>
  </g>
  <g fill="none" stroke="#e8e8e8" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
    ${shuffle}
    ${repeat}
    ${heart}
  </g>
</svg>`;

// --- standard MediaLibraryService browse surface ---------------------------
const row = (y, title, artist, duration) => `
  <g transform="translate(96 ${y})" clip-path="url(#clipRow)"><image width="92" height="92" href="${cover}" preserveAspectRatio="xMidYMid slice"/></g>
  <text x="212" y="${y + 38}" class="sans" fill="#f5f5f5" font-size="30">${title}</text>
  <text x="212" y="${y + 70}" class="sans" fill="#a0a0a0" font-size="21">${artist}</text>
  <text x="1470" y="${y + 58}" class="mono" fill="#a0a0a0" font-size="15" text-anchor="end">${duration}</text>
  <line x1="96" y1="${y + 112}" x2="1504" y2="${y + 112}" stroke="#3a3a3a" stroke-width="1"/>
`;

const tab = (x, label, selected = false) => `
  <text x="${x}" y="206" class="sans" fill="${selected ? '#f5f5f5' : '#a0a0a0'}" font-size="22">${label}</text>
  ${selected ? `<rect x="${x}" y="220" width="${Math.max(54, label.length * 11)}" height="3" rx="1.5" fill="#7fe9ff"/>` : ''}
`;

const browse = `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900" viewBox="0 0 1600 900" role="img" aria-label="Constructed Android Auto browse screen for Statocyst">
  ${defs(true)}
  <rect width="1600" height="900" fill="#121212"/>
  ${statusBar}

  <circle cx="96" cy="116" r="34" fill="#ffffff"/>
  <image x="64" y="84" width="64" height="64" href="${mark}" clip-path="url(#clipMark)" preserveAspectRatio="xMidYMid meet"/>
  <text x="150" y="132" class="display" fill="#f5f5f5" font-size="40" font-weight="600" letter-spacing="-0.8">Statocyst</text>
  <g fill="none" stroke="#e8e8e8" stroke-width="3" stroke-linecap="round">
    <circle cx="1500" cy="112" r="19"/>
    <path d="M1514 126l17 17"/>
  </g>

  ${tab(96, 'Recently played', true)}
  ${tab(300, 'Favorites')}
  ${tab(470, 'Playlists')}
  ${tab(650, 'Podcasts')}
  ${tab(830, 'Song radio')}
  ${tab(1005, 'Albums')}
  ${tab(1160, 'Artists')}
  ${tab(1310, 'All tracks')}
  ${tab(1460, 'Queue')}

  ${row(270, 'Pearl Drift', 'Neritic Choir', '0:09')}
  ${row(382, 'Sonar Bloom', 'Statocyst Ensemble', '0:12')}
  ${row(494, 'Tide Glass', 'Statocyst Ensemble', '0:10')}

  <rect x="0" y="800" width="1600" height="100" fill="#1b1b1b"/>
  <g transform="translate(88 816)" clip-path="url(#clipMini)"><image width="68" height="68" href="${cover}" preserveAspectRatio="xMidYMid slice"/></g>
  <text x="180" y="846" class="sans" fill="#f5f5f5" font-size="20" font-weight="500">Pearl Drift</text>
  <text x="180" y="870" class="sans" fill="#a0a0a0" font-size="16">Neritic Choir</text>
  <circle cx="1320" cy="850" r="30" fill="#e8e8e8"/>
  <rect x="1312" y="838" width="5" height="24" rx="2" fill="#121212"/>
  <rect x="1323" y="838" width="5" height="24" rx="2" fill="#121212"/>
  <g fill="#e8e8e8">
    <path d="M1372 838h5v24h-5zM1386 838l-14 12 14 12z"/>
    <path d="M1440 838l14 12-14 12zM1457 838h5v24h-5z"/>
  </g>
  <g fill="none" stroke="#e8e8e8" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">
    <path d="M1510 862s-14-8-14-17a7.5 7.5 0 0 1 14-3 7.5 7.5 0 0 1 14 3c0 9-14 17-14 17z"/>
  </g>
</svg>`;

await rm(path.join(outDir, 'car-head-unit.svg'), { force: true });
const clean = (svg) => svg.replace(/[ \t]+$/gm, '');
await writeFile(nowPlayingOut, clean(nowPlaying));
await writeFile(browseOut, clean(browse));
console.log(`car previews: ${path.relative(root, nowPlayingOut)}, ${path.relative(root, browseOut)}`);
