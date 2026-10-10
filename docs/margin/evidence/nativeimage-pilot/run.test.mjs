// Starts exp-main.cjs in Electron under the isolation guard and checks that the guard
// loaded and blocked nothing. Run from the repository root:
//   node scripts/margin/isolation/run-node.mjs --allow-exec Electron --test docs/margin/evidence/nativeimage-pilot/run.test.mjs
// EXP_SRC holds the PNGs from make-sources.swift. Images and results.json go to EXP_OUT
// (default: a directory inside the sandbox). run-node.mjs does not pass the caller's
// environment, so run this file with node directly when setting EXP_SRC/EXP_OUT.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeSandbox, isolatedEnv, readBlocked, CHROMIUM_SWITCHES, REPO, GUARD } from '../../../../scripts/margin/isolation/env.mjs';
import { ELECTRON } from '../../../../tests/margin/launch-app.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

test('nativeImage pilot runs under the guard', () => {
  const sandbox = makeSandbox('nativeimage');
  const out = process.env.EXP_OUT || path.join(sandbox.root, 'out');
  fs.mkdirSync(out, { recursive: true });
  const res = spawnSync(ELECTRON, ['-r', GUARD, HERE, ...CHROMIUM_SWITCHES], {
    cwd: sandbox.work,
    env: isolatedEnv(sandbox, { EXP_OUT: out, EXP_REPO: REPO, EXP_SRC: process.env.EXP_SRC }),
    encoding: 'utf8',
    timeout: 180_000,
  });
  const err = path.join(out, 'error.txt');
  assert.equal(res.status, 0, `electron exited ${res.status} ${res.signal}\n${fs.existsSync(err) ? fs.readFileSync(err, 'utf8') : ''}\n${res.stderr?.slice(-2000)}`);
  assert.deepEqual(readBlocked(sandbox, { pid: res.pid }), []);
  assert.ok(fs.existsSync(path.join(out, "results.json")), `no results\n${res.stdout?.slice(-2000)}\n${res.stderr?.slice(-2000)}`);
  console.log(`# out: ${out}`);
});
