// AG-71: the isolation entry on Windows. Runs on any host; the Windows rules are
// exercised through injected platform, environment and file checks.
//   node scripts/margin/isolation/run-node.mjs --test scripts/margin/isolation/__tests__/windows-isolation.node.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { windowsProfileEnv } from '../env.mjs';

const require = createRequire(import.meta.url);
const { resolvable } = require('../guard.cjs');

const sandbox = { home: path.join('S', 'home'), tmp: path.join('S', 'tmp') };

test('Windows profile, app data and temp point into the sandbox', () => {
  const env = windowsProfileEnv(sandbox, {
    SystemRoot: 'C:\\Windows', PATHEXT: '.COM;.EXE;.BAT;.CMD', ComSpec: 'C:\\Windows\\system32\\cmd.exe',
    USERPROFILE: 'C:\\Users\\real', APPDATA: 'C:\\Users\\real\\AppData\\Roaming',
    LOCALAPPDATA: 'C:\\Users\\real\\AppData\\Local', TEMP: 'C:\\Users\\real\\AppData\\Local\\Temp',
    USERNAME: 'real', HOMEPATH: '\\Users\\real', OPENAI_API_KEY: 'sk-real',
  });
  assert.equal(env.USERPROFILE, sandbox.home);
  assert.equal(env.APPDATA, path.join(sandbox.home, 'AppData', 'Roaming'));
  assert.equal(env.LOCALAPPDATA, path.join(sandbox.home, 'AppData', 'Local'));
  assert.equal(env.TEMP, sandbox.tmp);
  assert.equal(env.TMP, sandbox.tmp);
  assert.equal(env.SystemRoot, 'C:\\Windows');
  assert.equal(env.PATHEXT, '.COM;.EXE;.BAT;.CMD');
  for (const k of ['USERNAME', 'HOMEPATH', 'OPENAI_API_KEY']) assert.equal(env[k], undefined, `${k} must not pass through`);
});

const winEnv = { PATH: 'C:\\Windows\\System32;C:\\tools', PATHEXT: '.COM;.EXE;.BAT;.CMD' };
const files = new Set(['C:\\Windows\\System32\\curl.exe', 'C:\\tools\\gh.cmd', 'C:\\tools\\bin\\probe.exe']);
const win = { platform: 'win32', env: winEnv, exists: (f) => files.has(f) };

test('a bare Windows command is found through its .exe or PATHEXT extension', () => {
  // Before AG-71 only "curl" itself was looked up, so curl.exe passed as unresolvable.
  assert.equal(resolvable('curl', win), true);
  assert.equal(resolvable('gh', win), true);
  assert.equal(resolvable('missing-tool', win), false);
});

test('a Windows path with backslashes is checked as a path', () => {
  assert.equal(resolvable('C:\\tools\\bin\\probe', win), true);
  assert.equal(resolvable('C:\\tools\\bin\\absent', win), false);
});

test('POSIX lookup is unchanged: no extensions, backslash is not a separator', () => {
  const posixFiles = new Set(['/usr/bin/curl']);
  const posix = { platform: 'darwin', env: { PATH: '/usr/bin' }, exists: (f) => posixFiles.has(f) };
  assert.equal(resolvable('curl', posix), true);
  assert.equal(resolvable('curl.exe', posix), false);
  assert.equal(resolvable('/usr/bin/curl', posix), true);
});
