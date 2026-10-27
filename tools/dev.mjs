#!/usr/bin/env node
/**
 * Development launcher: builds the Angular renderer and Electron bundles, then
 * starts Electron against the built files. Uses the locally pinned Electron.
 */
import { spawn } from 'node:child_process';
import { dirname, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolvePath(dirname(fileURLToPath(import.meta.url)), '..');

function run(command, args, options = {}) {
  return new Promise((done, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      stdio: 'inherit',
      env: process.env,
      ...options,
    });
    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (code === 0) done();
      else reject(new Error(`${command} exited with ${code ?? signal}`));
    });
  });
}

async function main() {
  await run('pnpm', ['exec', 'nx', 'build', 'desktop']);
  await run('node', ['tools/build-electron.mjs']);
  await run('pnpm', ['exec', 'electron', '.', '--no-sandbox'], {
    stdio: 'inherit',
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
