#!/usr/bin/env node
// Reviewed native setup for Margin (PLAN.md AG-08). `.npmrc` sets ignore-scripts=true,
// so `npm ci` runs no install scripts at all: not this repo's legacy postinstall (which
// downloads models) and not any dependency's. This script runs only the steps the kept
// features need, each from an official source:
//
//   1. Electron binary        node_modules/electron/install.js (official Electron release)
//   2. sharp check            sharp's own check script; uses the prebuilt @img package from npm
//   3. better-sqlite3, keytar @electron/rebuild against the installed Electron
//                             (Electron headers from electronjs.org, or a prebuilt binary
//                             from the package's release)
//   4. native-module          scripts/build-native.js (cargo; crates from crates.io)
//   5. dev Info.plist         scripts/patch-electron-plist.js (local file edit only)
//
// It downloads no models and runs no other dependency install scripts.
// Usage: npm run setup:native

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const node = process.execPath;
const run = (label, file, args, opts = {}) => {
  console.log(`\n[setup:native] ${label}`);
  execFileSync(file, args, { cwd: ROOT, stdio: 'inherit', ...opts, env: { ...process.env, ...(opts.env || {}) } });
};

const electronPkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'node_modules/electron/package.json'), 'utf8'));
const electronDist = path.join(ROOT, 'node_modules/electron/dist');
if (!fs.existsSync(electronDist)) {
  run(`1/5 Electron ${electronPkg.version} binary`, node, ['node_modules/electron/install.js']);
} else {
  console.log(`\n[setup:native] 1/5 Electron ${electronPkg.version} binary already present`);
}

run('2/5 sharp prebuilt check', node, ['install/check.js'], {
  cwd: path.join(ROOT, 'node_modules/sharp'),
  env: { SHARP_IGNORE_GLOBAL_LIBVIPS: '1' },
});

run('3/5 rebuild better-sqlite3 and keytar for Electron', node, [
  'node_modules/@electron/rebuild/lib/cli.js', '-f', '-w', 'better-sqlite3,keytar', '-v', electronPkg.version,
]);

run('4/5 build native-module', node, ['scripts/build-native.js']);

run('5/5 patch dev Electron Info.plist', node, ['scripts/patch-electron-plist.js']);

console.log('\n[setup:native] done');
