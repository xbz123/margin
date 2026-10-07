#!/usr/bin/env node
// Lists IPC channels that preload or the renderer invoke but that no main-process
// handler registers. After a feature is retired, such channels reject at runtime.
//   node scripts/margin/ipc-channel-check.mjs [--baseline-allow file]
// Exit 1 when an invoked channel has no handler, unless it is listed in the allow file
// (one channel per line; used for gaps that already existed on the baseline).

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', 'electron', 'src'], { cwd: ROOT, encoding: 'utf8' })
  .split('\n').filter((f) => /\.(ts|tsx|js|mjs)$/.test(f) && !/__tests__|electron\/test\//.test(f) && fs.existsSync(path.join(ROOT, f)));

const invoked = new Map();
const handled = new Set();
for (const f of files) {
  const text = fs.readFileSync(path.join(ROOT, f), 'utf8');
  for (const m of text.matchAll(/\binvoke\(\s*['"]([\w:.\-/]+)['"]/g)) {
    if (!invoked.has(m[1])) invoked.set(m[1], f);
  }
  if (f.startsWith('electron/') && !f.endsWith('preload.ts')) {
    for (const m of text.matchAll(/(?:safeHandle|ipcMain\.handle|registerStealthHandler|handle)\(\s*['"]([\w:.\-/]+)['"]/g)) handled.add(m[1]);
    // safeHandle(\n 'channel', ...) spread over lines
    for (const m of text.matchAll(/(?:safeHandle|ipcMain\.handle)\(\s*\n\s*['"]([\w:.\-/]+)['"]/g)) handled.add(m[1]);
  }
}

const allowArg = process.argv.indexOf('--baseline-allow');
const allow = new Set(allowArg > 0 ? fs.readFileSync(process.argv[allowArg + 1], 'utf8').split('\n').map((s) => s.trim()).filter(Boolean) : []);
const missing = [...invoked].filter(([ch]) => !handled.has(ch) && !allow.has(ch)).sort();
console.log(`invoked ${invoked.size}, handled ${handled.size}, invoked-without-handler ${missing.length}`);
for (const [ch, f] of missing) console.log(`  ${ch}  (${f})`);
process.exitCode = missing.length ? 1 : 0;
