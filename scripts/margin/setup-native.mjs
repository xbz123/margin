#!/usr/bin/env node
// Reviewed native setup for Margin (PLAN.md AG-08). `.npmrc` sets ignore-scripts=true,
// so `npm ci` runs no install scripts at all: not this repo's legacy postinstall (which
// downloads models) and not any dependency's. This script runs only the steps the kept
// features need, each from an official source:
//
//   1. Electron binary        node_modules/electron/install.js (official Electron release)
//   2. better-sqlite3, keytar @electron/rebuild against the installed Electron
//                             (Electron headers from electronjs.org, or a prebuilt binary
//                             from the package's release). better-sqlite3 has no prebuilt
//                             binary for Electron 43, so it is compiled locally; see
//                             nativeCompileEnv() below.
//   3. native-module          scripts/build-native.js (cargo; crates from crates.io)
//   4. dev Info.plist         scripts/patch-electron-plist.js (local file edit only)
//
// It downloads no models and runs no other dependency install scripts.
// Usage: npm run setup:native

import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const node = process.execPath;
const run = (label, file, args, opts = {}) => {
  console.log(`\n[setup:native] ${label}`);
  execFileSync(file, args, { cwd: ROOT, stdio: 'inherit', ...opts, env: { ...process.env, ...(opts.env || {}) } });
};

// Local compile environment for step 2 (PLAN.md X3, AG-17). With only the Command
// Line Tools installed, two things break a node-gyp build on macOS: a GNU libtool
// earlier in PATH (for example from anaconda) shadows Apple's, and clang++ cannot find
// the libc++ headers. Put /usr/bin first, and only when a one-line C++ include fails,
// point CXXFLAGS at the SDK's libc++ headers. A machine with full Xcode compiles the
// include fine and gets no extra flags.
function nativeCompileEnv() {
  if (process.platform !== 'darwin') return {};
  const env = { PATH: `/usr/bin:${process.env.PATH ?? ''}` };
  const probe = spawnSync('/usr/bin/clang++', ['-x', 'c++', '-fsyntax-only', '-'], {
    input: '#include <cstdio>\nint main() { return 0; }\n',
    encoding: 'utf8',
  });
  if (probe.status !== 0) {
    const sdk = execFileSync('/usr/bin/xcrun', ['--show-sdk-path'], { encoding: 'utf8' }).trim();
    const libcxx = path.join(sdk, 'usr/include/c++/v1');
    if (fs.existsSync(libcxx)) {
      env.CXXFLAGS = [process.env.CXXFLAGS, `-isystem ${libcxx}`].filter(Boolean).join(' ');
      console.log(`[setup:native] clang++ cannot find libc++ headers; using ${libcxx}`);
    }
  }
  return env;
}

const electronPkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'node_modules/electron/package.json'), 'utf8'));
const electronDist = path.join(ROOT, 'node_modules/electron/dist');
if (!fs.existsSync(electronDist)) {
  run(`1/4 Electron ${electronPkg.version} binary`, node, ['node_modules/electron/install.js']);
} else {
  console.log(`\n[setup:native] 1/4 Electron ${electronPkg.version} binary already present`);
}

run('2/4 rebuild better-sqlite3 and keytar for Electron', node, [
  'node_modules/@electron/rebuild/lib/cli.js', '-f', '-w', 'better-sqlite3,keytar', '-v', electronPkg.version,
], { env: nativeCompileEnv() });

run('3/4 build native-module', node, ['scripts/build-native.js']);

run('4/4 patch dev Electron Info.plist', node, ['scripts/patch-electron-plist.js']);

console.log('\n[setup:native] done');
