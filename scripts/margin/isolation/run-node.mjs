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
// --allow-exec <basename[:basename]> lets the test process start named programs (the
// regression harness starts Electron, which then runs under its own isolated env).
let allowExec = '';
if (args[0] === '--allow-exec') { allowExec = args[1]; args = args.slice(2); }

const sandbox = makeSandbox('node');
// run-gates.mjs sets MARGIN_RUN_NODE_LOG so it can read the isolation log itself even
// when it has to end this process early (PLAN.md AG-17 review).
if (process.env.MARGIN_RUN_NODE_LOG) sandbox.log = process.env.MARGIN_RUN_NODE_LOG;
const res = spawnSync(process.execPath, args, {
  cwd: REPO,
  env: isolatedEnv(sandbox, { MARGIN_ISOLATION_ALLOW_EXEC: allowExec }),
  stdio: 'inherit',
});
// The test process itself must have loaded the guard (readGuardLog checks its pid).
const blocked = readBlocked(sandbox, { pid: res.pid });
if (blocked.length) {
  console.error(`[isolation] ${blocked.length} blocked attempt(s); log: ${sandbox.log}`);
  for (const b of blocked) console.error(`[isolation]   ${b.kind} ${b.detail}`);
  if (!allowBlocked) process.exit(1);
}
process.exit(res.status ?? 1);
