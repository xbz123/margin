#!/usr/bin/env node
// Runs `node <args>` (for example `--test 'electron/**/__tests__/*.test.mjs'`) from the
// repository root with the isolation guard and a clean temporary HOME.
//   node scripts/margin/isolation/run-node.mjs --test electron/services/__tests__/Foo.test.mjs
// Any blocked attempt fails the run, unless the first argument is --allow-blocked
// (used by the guard's own self-test, which provokes blocks on purpose).

import { spawnSync } from 'node:child_process';
import { makeSandbox, isolatedEnv, readBlocked, REPO } from './env.mjs';

let args = process.argv.slice(2);
const allowBlocked = args[0] === '--allow-blocked';
if (allowBlocked) args = args.slice(1);

const sandbox = makeSandbox('node');
const res = spawnSync(process.execPath, args, {
  cwd: REPO,
  env: isolatedEnv(sandbox),
  stdio: 'inherit',
});
const blocked = readBlocked(sandbox);
if (blocked.length) {
  console.error(`[isolation] ${blocked.length} blocked attempt(s); log: ${sandbox.log}`);
  if (!allowBlocked) process.exit(1);
}
process.exit(res.status ?? 1);
