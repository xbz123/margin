// Launches the built app under the X2 isolation guard for the Margin harness tests
// (PLAN.md AG-09). Shared by the answer regression and the meeting storage test.

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { isolatedEnv, readGuardLog, CHROMIUM_SWITCHES, REPO, GUARD } from '../../scripts/margin/isolation/env.mjs';

const require = createRequire(import.meta.url);
const { _electron } = require('playwright');

const RECORDER = fileURLToPath(new URL('./record-main-errors.cjs', import.meta.url));

export const ELECTRON = path.join(REPO, 'node_modules/electron/dist',
  fs.readFileSync(path.join(REPO, 'node_modules/electron/path.txt'), 'utf8').trim());

export async function windowWithQuery(app, query, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const w = app.windows().find((p) => p.url().includes(query));
    if (w) return w;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`window ${query} did not appear`);
}

// Reads the records of record-main-errors.cjs. Fails when the file is missing or has no
// "loaded" record from `pid`: then nothing shows that exceptions were watched.
// Returns the exception and rejection records.
export function readMainErrors(file, pid) {
  if (!fs.existsSync(file)) throw new Error(`main-process error record missing: ${file}`);
  const records = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  if (!records.some((r) => r.kind === 'loaded' && r.pid === pid)) {
    throw new Error(`main-process error recorder did not load in pid ${pid}: ${JSON.stringify(records.slice(0, 3))}`);
  }
  return records.filter((r) => r.kind !== 'loaded');
}

// Starts the app in `sandbox` (from makeSandbox) with `extraEnv`. Aborts unless the
// guard is active in the main process. Returns { app, output, mainErrorsLog, userDataPath } where
// `output` holds the main process's stdout and stderr so far and `mainErrorsLog` is
// the file record-main-errors.cjs writes (read it with readMainErrors).
export async function launchApp(sandbox, extraEnv = {}) {
  const mainErrorsLog = path.join(sandbox.root, 'main-errors.jsonl');
  const app = await _electron.launch({
    executablePath: ELECTRON,
    // Playwright deletes NODE_OPTIONS and preloads its own loader with -r, so the
    // isolation guard must be passed the same way or it would not load at all. The
    // exception recorder is loaded the same way, before the app code.
    args: ['-r', GUARD, '-r', RECORDER, REPO, ...CHROMIUM_SWITCHES],
    cwd: sandbox.work,
    env: isolatedEnv(sandbox, { MARGIN_MAIN_ERRORS_LOG: mainErrorsLog, ...extraEnv }),
    timeout: 60_000,
  });
  const output = [];
  app.process().stdout.on('data', (d) => output.push(String(d)));
  app.process().stderr.on('data', (d) => output.push(String(d)));
  app.process().on('exit', (code, signal) => output.push(`[harness] main process exited code=${code} signal=${signal}`));

  // Playwright can report "Promise was collected" as a destroyed context. Keep
  // the guard and userData snapshot in this bounded, read-only startup query;
  // never retry a caller's evaluate or a state-changing IPC operation.
  let startup;
  for (let attempt = 1; ; attempt++) {
    try {
      startup = await app.evaluate(({ app: electronApp }) => ({
        guardActive: process.env.MARGIN_ISOLATION_ACTIVE,
        userDataPath: electronApp.getPath('userData'),
      }));
      break;
    } catch (e) {
      const alive = app.process().exitCode === null && app.process().signalCode === null;
      if (alive && attempt < 10 && /context was destroyed/.test(e.message)) {
        await new Promise((r) => setTimeout(r, 500));
        continue;
      }
      await new Promise((r) => setTimeout(r, 1_000));
      console.error(output.join('').split('\n').filter((l) => !l.includes('isolation-debug')).slice(-40).join('\n'));
      await app.close().catch(() => {});
      throw e;
    }
  }
  if (startup.guardActive !== '1') {
    await app.close().catch(() => {});
    throw new Error('isolation guard is not active in the Electron main process; aborting');
  }
  // Fails now, not at the end of the test, if the recorder is not running or the
  // guard wrote no load record from this main process.
  try {
    readMainErrors(mainErrorsLog, app.process().pid);
    readGuardLog(sandbox, { pid: app.process().pid });
  } catch (e) {
    await app.close().catch(() => {});
    throw e;
  }
  return { app, output, mainErrorsLog, userDataPath: startup.userDataPath };
}
