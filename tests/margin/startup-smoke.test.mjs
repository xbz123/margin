// Margin startup smoke test (PLAN.md AG-17; phase 1 exit item 5).
//
// Starts the built app under the X2 isolation guard in a fresh sandbox and checks:
//   - the launcher window and the settings window open (load time is recorded);
//   - the app stays up for an observation window;
//   - app.quit() ends the main process with exit code 0;
//   - the main process logged no uncaught exception or unhandled rejection
//     (main.ts writes both to natively_debug.log in the sandbox's Documents);
//   - the guard recorded no outbound attempt.
//
// Prerequisites: `node scripts/build-electron.js` and `npx vite build`.
// Run:
//   node scripts/margin/isolation/run-node.mjs --allow-exec Electron \
//     --test --test-timeout=180000 tests/margin/startup-smoke.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { launchApp, windowWithQuery } from './launch-app.mjs';
import { makeSandbox, readBlocked } from '../../scripts/margin/isolation/env.mjs';

const OBSERVE_MS = 15_000;

test('the app starts, opens the launcher and settings, stays up, and quits cleanly', async (t) => {
  const sandbox = makeSandbox('startup-smoke');
  const started = Date.now();
  const { app, output } = await launchApp(sandbox, { NODE_ENV: 'production' });
  const mainProcess = app.process();
  const exited = new Promise((resolve) => mainProcess.once('exit', (code, signal) => resolve({ code, signal })));

  try {
    const launcher = await windowWithQuery(app, 'window=launcher', 30_000);
    await launcher.waitForLoadState('domcontentloaded');
    await launcher.waitForFunction(() => document.body && document.body.innerText.trim().length > 0, null, { timeout: 30_000 });
    const launcherReadyMs = Date.now() - started;

    await launcher.evaluate(() => window.electronAPI.toggleSettingsWindow());
    const settings = await windowWithQuery(app, 'window=settings', 30_000);
    await settings.waitForLoadState('domcontentloaded');
    const settingsReadyMs = Date.now() - started;

    const windows = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((w) => ({
      url: w.webContents.getURL().replace(/^.*\?/, '?'),
      visible: w.isVisible(),
    })));
    assert.ok(windows.some((w) => w.url.includes('window=launcher') && w.visible), `launcher not visible: ${JSON.stringify(windows)}`);
    assert.ok(windows.some((w) => w.url.includes('window=settings') && w.visible), `settings not visible: ${JSON.stringify(windows)}`);

    await new Promise((r) => setTimeout(r, OBSERVE_MS));
    assert.equal(mainProcess.exitCode, null, 'main process must still be running after the observation window');

    const logFile = await app.evaluate(({ app: electronApp }) =>
      process.getBuiltinModule('path').join(electronApp.getPath('documents'), 'natively_debug.log'));
    assert.ok(logFile.startsWith(sandbox.root), `debug log must live in the sandbox, got ${logFile}`);

    await app.evaluate(({ app: electronApp }) => { setTimeout(() => electronApp.quit(), 0); });
    const { code, signal } = await Promise.race([
      exited,
      new Promise((_, reject) => setTimeout(() => reject(new Error('app did not exit within 20 s of app.quit()')), 20_000)),
    ]);
    assert.equal(signal, null, `main process ended by signal ${signal}`);
    assert.equal(code, 0, `main process exit code ${code}`);

    const logText = fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8') : '';
    const critical = [...logText.split('\n'), ...output.join('').split('\n')].filter((l) => /\[CRITICAL\]|Uncaught Exception|Unhandled Rejection/.test(l));
    assert.deepEqual(critical, [], 'no uncaught exception or unhandled rejection in the main process');

    const blocked = readBlocked(sandbox).filter((b) => !['permission', 'device', 'local-exec'].includes(b.kind));
    assert.deepEqual(blocked.map((b) => `${b.kind} ${b.detail}`), [], 'no outbound attempts during start-up');

    t.diagnostic(`launcher ready ${launcherReadyMs} ms, settings ready ${settingsReadyMs} ms, observed ${OBSERVE_MS} ms, exit code ${code}`);
    console.log(`[startup-smoke] launcher ready ${launcherReadyMs} ms; settings ready ${settingsReadyMs} ms; observed ${OBSERVE_MS} ms; exit code ${code}; windows ${JSON.stringify(windows)}`);
  } finally {
    if (mainProcess.exitCode === null && mainProcess.signalCode === null) await app.close().catch(() => {});
  }
});
