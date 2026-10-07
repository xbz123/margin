// Launches the built app under the X2 isolation guard for the Margin harness tests
// (PLAN.md AG-09). Shared by the answer regression and the meeting storage test.

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { isolatedEnv, CHROMIUM_SWITCHES, REPO, GUARD } from '../../scripts/margin/isolation/env.mjs';

const require = createRequire(import.meta.url);
const { _electron } = require('playwright');

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

// Starts the app in `sandbox` (from makeSandbox) with `extraEnv`. Aborts unless the
// guard is active in the main process. Returns { app, output } where `output` holds
// the main process's stdout and stderr so far.
export async function launchApp(sandbox, extraEnv = {}) {
  const app = await _electron.launch({
    executablePath: ELECTRON,
    // Playwright deletes NODE_OPTIONS and preloads its own loader with -r, so the
    // isolation guard must be passed the same way or it would not load at all.
    args: ['-r', GUARD, REPO, ...CHROMIUM_SWITCHES],
    cwd: sandbox.work,
    env: isolatedEnv(sandbox, extraEnv),
    timeout: 60_000,
  });
  const output = [];
  app.process().stdout.on('data', (d) => output.push(String(d)));
  app.process().stderr.on('data', (d) => output.push(String(d)));
  app.process().on('exit', (code, signal) => output.push(`[harness] main process exited code=${code} signal=${signal}`));

  // The first main-process evaluate can race start-up ("Execution context was
  // destroyed"); retry while the process is alive, and show its output if it died.
  let guardActive;
  for (let attempt = 1; ; attempt++) {
    try {
      guardActive = await app.evaluate(() => process.env.MARGIN_ISOLATION_ACTIVE);
      break;
    } catch (e) {
      const alive = app.process().exitCode === null && app.process().signalCode === null;
      if (alive && attempt < 10 && /context was destroyed/.test(e.message)) {
        await new Promise((r) => setTimeout(r, 500));
        continue;
      }
      await new Promise((r) => setTimeout(r, 1_000));
      console.error(output.join('').split('\n').filter((l) => !l.includes('isolation-debug')).slice(-40).join('\n'));
      throw e;
    }
  }
  if (guardActive !== '1') {
    await app.close().catch(() => {});
    throw new Error('isolation guard is not active in the Electron main process; aborting');
  }
  return { app, output };
}
