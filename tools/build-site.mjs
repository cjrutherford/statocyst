#!/usr/bin/env node
/**
 * Build the static landing page with the latest GitHub release baked in.
 *
 * Usage:
 *   node tools/build-site.mjs             # use the API, fall back to site/release-fallback.json
 *   node tools/build-site.mjs --offline   # always use the checked-in fallback
 *   node tools/build-site.mjs --strict    # fail if the API is unavailable or an asset is missing
 *
 * The output is _site/ and is what the Pages workflow uploads.
 * No third-party dependencies.
 */

import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const REPO = 'cjrutherford/statocyst';
const API = `https://api.github.com/repos/${REPO}/releases/latest`;
const root = process.cwd();
const siteDir = path.join(root, 'site');
const outDir = path.join(root, '_site');
const fallbackFile = path.join(siteDir, 'release-fallback.json');
const strict = process.argv.includes('--strict') || process.env.SITE_STRICT === '1';
const offline = process.argv.includes('--offline');
const skipScreenshots = process.argv.includes('--no-screenshots');

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '';
  const mb = bytes / 1024 / 1024;
  return `${mb.toFixed(mb >= 100 ? 0 : 1)} MB`;
}

function formatDate(iso) {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.valueOf())) return '';
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date);
}

async function fetchLatest() {
  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'statocyst-site-builder',
  };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const res = await fetch(API, { headers });
  if (!res.ok) throw new Error(`GitHub API responded ${res.status} ${res.statusText}`);
  const release = await res.json();
  if (!release || !Array.isArray(release.assets)) throw new Error('GitHub API returned no assets');
  return release;
}

async function loadRelease() {
  if (offline) {
    console.log('offline: using site/release-fallback.json');
    return JSON.parse(await readFile(fallbackFile, 'utf8'));
  }
  try {
    const release = await fetchLatest();
    console.log(`release: ${release.tag_name} (${release.assets.length} assets)`);
    return release;
  } catch (error) {
    if (strict) throw error;
    console.warn(`warning: ${error.message}`);
    console.warn('falling back to site/release-fallback.json');
    return JSON.parse(await readFile(fallbackFile, 'utf8'));
  }
}

function makeTokens(release) {
  const assets = release.assets ?? [];
  const releaseUrl = release.html_url || `https://github.com/${REPO}/releases`;
  const checksums =
    assets.find((asset) => asset.name === 'SHA256SUMS') ||
    assets.find((asset) => /^SHA256SUMS/i.test(asset.name));
  const tag = release.tag_name || '';
  const version = tag.replace(/^v/, '');

  const pick = (...tests) => assets.find((asset) => tests.every((test) => test(asset.name)));
  const linuxAppImage = pick((name) => name.endsWith('.AppImage')) || pick((name) => name.includes('linux') && name.endsWith('.AppImage'));
  const linuxDeb = pick((name) => name.endsWith('.deb'));
  const macArm64 = pick((name) => name.includes('mac-arm64') && name.endsWith('.dmg')) || pick((name) => name.endsWith('.dmg'));
  const macZip = pick((name) => name.includes('mac-arm64') && name.endsWith('.zip')) || pick((name) => name.endsWith('.zip'));
  const windows = pick((name) => name.endsWith('.exe'));
  const androidApk = pick((name) => name.endsWith('.apk'));
  const iosIpa = pick((name) => name.endsWith('.ipa'));

  const asset = (value, label) => {
    if (!value) {
      console.warn(`warning: release ${tag} has no ${label} asset; linking to the release page instead`);
      return { url: releaseUrl, name: 'View release', size: '' };
    }
    return {
      url: value.browser_download_url || releaseUrl,
      name: value.name,
      size: formatBytes(value.size),
    };
  };

  const linuxAppImageAsset = asset(linuxAppImage, 'linux AppImage');
  const linuxDebAsset = asset(linuxDeb, 'linux .deb');
  const macArm64Asset = asset(macArm64, 'macOS arm64 DMG');
  const macZipAsset = asset(macZip, 'macOS arm64 zip');
  const windowsAsset = asset(windows, 'Windows installer');
  const androidApkAsset = asset(androidApk, 'Android APK');
  const iosIpaAsset = asset(iosIpa, 'iOS IPA');

  return {
    VERSION: version,
    TAG: tag,
    RELEASE_NAME: release.name || `Statocyst ${version}`,
    RELEASE_DATE: formatDate(release.published_at),
    RELEASE_URL: releaseUrl,
    CHECKSUMS_URL: checksums?.browser_download_url || releaseUrl,

    ASSET_LINUX_APPIMAGE: linuxAppImageAsset.url,
    NAME_LINUX_APPIMAGE: linuxAppImageAsset.name,
    SIZE_LINUX_APPIMAGE: linuxAppImageAsset.size,
    ASSET_LINUX_DEB: linuxDebAsset.url,
    NAME_LINUX_DEB: linuxDebAsset.name,
    SIZE_LINUX_DEB: linuxDebAsset.size,
    ASSET_MAC_ARM64: macArm64Asset.url,
    NAME_MAC_ARM64: macArm64Asset.name,
    SIZE_MAC_ARM64: macArm64Asset.size,
    ASSET_MAC_ZIP: macZipAsset.url,
    NAME_MAC_ZIP: macZipAsset.name,
    SIZE_MAC_ZIP: macZipAsset.size,
    ASSET_WINDOWS: windowsAsset.url,
    NAME_WINDOWS: windowsAsset.name,
    SIZE_WINDOWS: windowsAsset.size,
    ASSET_ANDROID_APK: androidApkAsset.url,
    NAME_ANDROID_APK: androidApkAsset.name,
    SIZE_ANDROID_APK: androidApkAsset.size,
    ASSET_IOS_IPA: iosIpaAsset.url,
    NAME_IOS_IPA: iosIpaAsset.name,
    SIZE_IOS_IPA: iosIpaAsset.size,
  };
}

function render(html, tokens) {
  let output = html;
  for (const [key, value] of Object.entries(tokens)) {
    output = output.replaceAll(`{{${key}}}`, value ?? '');
  }
  const left = output.match(/\{\{[A-Z0-9_]+\}\}/g);
  if (left) throw new Error(`unresolved template tokens: ${[...new Set(left)].join(', ')}`);
  return output;
}

async function main() {
  if (!existsSync(path.join(siteDir, 'index.html'))) {
    throw new Error('site/index.html is missing');
  }

  if (!skipScreenshots) {
    console.log('screenshot pass: refreshing stills, posters, OG image and the car preview');
    const result = spawnSync(process.execPath, [path.join(root, 'tools/update-site-screenshots.mjs')], {
      stdio: 'inherit',
    });
    if (result.status !== 0) throw new Error('screenshot update pass failed');
  }

  const release = await loadRelease();
  const tokens = makeTokens(release);

  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });

  for (const file of ['index.html', 'styles.css', 'main.js', 'site.webmanifest']) {
    await cp(path.join(siteDir, file), path.join(outDir, file));
  }
  await cp(path.join(siteDir, 'assets'), path.join(outDir, 'assets'), { recursive: true });

  const template = await readFile(path.join(outDir, 'index.html'), 'utf8');
  const html = render(template, tokens);
  await writeFile(path.join(outDir, 'index.html'), html);

  console.log(`built _site/ for ${tokens.RELEASE_NAME} (${tokens.VERSION})`);
  console.log(`  linux:   ${tokens.NAME_LINUX_APPIMAGE}`);
  console.log(`  mac:     ${tokens.NAME_MAC_ARM64}`);
  console.log(`  windows: ${tokens.NAME_WINDOWS}`);
  console.log(`  android: ${tokens.NAME_ANDROID_APK}`);
  console.log(`  ios:     ${tokens.NAME_IOS_IPA}`);
}

main().catch((error) => {
  console.error(`build-site failed: ${error.stack || error.message}`);
  process.exitCode = 1;
});
