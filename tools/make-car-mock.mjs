#!/usr/bin/env node
/**
 * Generate the constructed car previews.
 *
 * These are the only constructed screens on the site. They follow the real
 * Android Auto media templates:
 *   - MediaPlaybackTemplate: track left, art right, progress + controls bottom
 *   - SectionedItemTemplate: app header, recently played rows, album grid,
 *     minimized control panel
 *
 * Reference: developer.android.com/training/cars/apps/media
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

const symbol = b64(path.join(root, 'site/assets/branding/statocyst-symbol-128.png'), 'image/png');
const cover = b64(path.join(root, 'site/assets/branding/car-cover.jpg'), 'image/jpeg');
const fontInter = b64(path.join(root, 'site/assets/fonts/inter.woff2'), 'font/woff2');
const fontDisplay = b64(path.join(root, 'site/assets/fonts/space-grotesk.woff2'), 'font/woff2');

const style = `
  @font-face { font-family: 'Inter'; src: url('${fontInter}') format('woff2'); font-weight: 400 600; }
  @font-face { font-family: 'Space Grotesk'; src: url('${fontDisplay}') format('woff2'); font-weight: 400 700; }
  .sans { font-family: 'Inter', system-ui, sans-serif; }
  .display { font-family: 'Space Grotesk', 'Inter', system-ui, sans-serif; }
`;

const defs = (withMark = false) => `
  <defs>
    <style>${style}</style>
    <clipPath id="art"><rect x="1020" y="200" width="480" height="480" rx="22"/></clipPath>
    <clipPath id="appIcon"><circle cx="104" cy="88" r="30"/></clipPath>
    <clipPath id="clipRow"><rect width="84" height="84" rx="12"/></clipPath>
    <clipPath id="clipAlbum"><rect width="220" height="220" rx="14"/></clipPath>
    <clipPath id="clipMini"><rect width="68" height="68" rx="12"/></clipPath>
    <symbol id="coverArt" viewBox="0 0 512 512" preserveAspectRatio="xMidYMid slice"><image width="512" height="512" href="${cover}"/></symbol>
    ${withMark ? `<symbol id="appMark" viewBox="0 0 512 512"><image width="512" height="512" href="${symbol}"/></symbol>` : ''}
    <filter id="artShadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="12" stdDeviation="18" flood-color="#000" flood-opacity="0.45"/>
    </filter>
  </defs>
`;

// --- MediaPlaybackTemplate -------------------------------------------------
const nowPlaying = `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900" viewBox="0 0 1600 900" role="img" aria-label="Constructed Android Auto now playing screen for Statocyst">
  ${defs()}
  <rect width="1600" height="900" fill="#121212"/>

  <!-- header -->
  <g fill="none" stroke="#e8e8e8" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
    <path d="M106 60H70M70 60l18-18M70 60l18 18"/>
  </g>
  <circle cx="1376" cy="62" r="26" fill="none" stroke="#d0d0d0" stroke-width="2.4"/>
  <g fill="none" stroke="#d0d0d0" stroke-width="2.2" stroke-linecap="round">
    <path d="M1364 54h24M1364 62h24M1364 70h15"/>
    <path d="M1372 48v27"/>
  </g>
  <rect x="1426" y="34" width="150" height="56" rx="28" fill="none" stroke="#d0d0d0" stroke-width="2.2"/>
  <g fill="none" stroke="#d0d0d0" stroke-width="2.2" stroke-linecap="round">
    <circle cx="1454" cy="54" r="6"/>
    <path d="M1444 74c0-6 4-10 10-10s10 4 10 10"/>
    <circle cx="1474" cy="57" r="5"/>
    <path d="M1466 74c0-5 3-9 8-9"/>
  </g>
  <text x="1490" y="70" class="sans" fill="#d0d0d0" font-size="24">Queue</text>

  <!-- track -->
  <text x="96" y="390" class="sans" fill="#f5f5f5" font-size="68" font-weight="500" letter-spacing="-1.2">Sonar Bloom</text>
  <text x="96" y="454" class="sans" fill="#a0a0a0" font-size="30" letter-spacing="0.2">Statocyst Ensemble</text>

  <!-- art -->
  <rect x="1020" y="200" width="480" height="480" rx="22" fill="#1e1e1e"/>
  <image x="1020" y="200" width="480" height="480" href="${cover}" clip-path="url(#art)" preserveAspectRatio="xMidYMid slice" filter="url(#artShadow)"/>

  <!-- progress -->
  <rect x="96" y="700" width="1408" height="6" rx="3" fill="#4a4a4a"/>
  <rect x="96" y="700" width="493" height="6" rx="3" fill="#e8e8e8"/>
  <circle cx="589" cy="703" r="7" fill="#e8e8e8"/>
  <text x="1504" y="744" class="sans" fill="#a0a0a0" font-size="24" text-anchor="end">1:34 / 3:45</text>

  <!-- transport -->
  <rect x="96" y="780" width="160" height="90" rx="22" fill="#e8e8e8"/>
  <path d="M164 808l28 17-28 17z" fill="#121212"/>
  <g fill="#e8e8e8">
    <path d="M316 798h7v50h-7z"/>
    <path d="M352 798l-26 25 26 25z"/>
    <path d="M430 798l26 25-26 25z"/>
    <path d="M455 798h7v50h-7z"/>
  </g>
  <g fill="none" stroke="#e8e8e8" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
    <path d="M1166 812h22l22 22h18M1166 834h22l22-22h18"/>
    <path d="M1208 806l8 6-8 6M1208 828l8 6-8 6"/>
    <path d="M1272 824a13 13 0 1 1 6 11M1278 808v18h-18"/>
    <rect x="1367" y="802" width="18" height="30" rx="9"/>
    <path d="M1358 820c0 10 8 18 18 18s18-8 18-18M1376 838v10"/>
  </g>
</svg>`;

// --- SectionedItemTemplate -------------------------------------------------
const row = (y, title, artist) => `
  <g transform="translate(96 ${y})" clip-path="url(#clipRow)"><image width="84" height="84" href="${cover}" preserveAspectRatio="xMidYMid slice"/></g>
  <text x="204" y="${y + 36}" class="sans" fill="#f5f5f5" font-size="30">${title}</text>
  <text x="204" y="${y + 68}" class="sans" fill="#a0a0a0" font-size="22">${artist}</text>
  <line x1="96" y1="${y + 112}" x2="1504" y2="${y + 112}" stroke="#3a3a3a" stroke-width="1"/>
`;

const album = (x, title, artist) => `
  <g transform="translate(${x} 512)" clip-path="url(#clipAlbum)"><image width="220" height="220" href="${cover}" preserveAspectRatio="xMidYMid slice"/></g>
  <text x="${x}" y="766" class="sans" fill="#f5f5f5" font-size="20">${title}</text>
  <text x="${x}" y="792" class="sans" fill="#a0a0a0" font-size="16">${artist}</text>
`;

const browse = `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900" viewBox="0 0 1600 900" role="img" aria-label="Constructed Android Auto browse screen for Statocyst">
  ${defs(true)}
  <rect width="1600" height="900" fill="#121212"/>

  <!-- app header -->
  <circle cx="104" cy="88" r="34" fill="#ffffff"/>
  <image x="74" y="58" width="60" height="60" href="${symbol}" clip-path="url(#appIcon)" preserveAspectRatio="xMidYMid meet"/>
  <text x="160" y="104" class="sans" fill="#f5f5f5" font-size="42" font-weight="500">Statocyst</text>
  <g fill="none" stroke="#e8e8e8" stroke-width="3" stroke-linecap="round">
    <circle cx="1492" cy="84" r="20"/>
    <path d="M1506 98l18 18"/>
  </g>

  <!-- recently played -->
  <text x="96" y="180" class="sans" fill="#f5f5f5" font-size="28" font-weight="500">Recently played</text>
  ${row(208, 'Sonar Bloom', 'Statocyst Ensemble')}
  ${row(328, 'Tide Glass', 'Statocyst Ensemble')}

  <!-- albums -->
  <text x="96" y="486" class="sans" fill="#f5f5f5" font-size="28" font-weight="500">Albums</text>
  ${album(96, 'Bathypelagic Sessions', 'Statocyst Ensemble')}
  ${album(356, 'Suspended Light', 'Neritic Choir')}
  ${album(616, 'The Hadal Zone', 'Statocyst Ensemble')}
  ${album(876, 'Pearl Drift', 'Neritic Choir')}
  ${album(1136, 'Shoreline', 'Driftwood')}

  <!-- minimized control panel -->
  <rect x="0" y="800" width="1600" height="100" fill="#1b1b1b"/>
  <g transform="translate(88 816)" clip-path="url(#clipMini)"><image width="68" height="68" href="${cover}" preserveAspectRatio="xMidYMid slice"/></g>
  <text x="180" y="846" class="sans" fill="#f5f5f5" font-size="20" font-weight="500">Sonar Bloom</text>
  <text x="180" y="870" class="sans" fill="#a0a0a0" font-size="16">Statocyst Ensemble</text>
  <circle cx="1320" cy="850" r="30" fill="#e8e8e8"/>
  <path d="M1312 838l24 12-24 12z" fill="#121212"/>
  <g fill="none" stroke="#e8e8e8" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
    <path d="M1376 832v36M1376 832l-18 18 18 18"/>
    <path d="M1440 832v36M1440 832l18 18-18 18"/>
  </g>
</svg>`;

await rm(path.join(outDir, 'car-head-unit.svg'), { force: true });
await writeFile(nowPlayingOut, nowPlaying);
await writeFile(browseOut, browse);
console.log(`car previews: ${path.relative(root, nowPlayingOut)}, ${path.relative(root, browseOut)}`);
