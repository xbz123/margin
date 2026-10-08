// Margin startup smoke test (PLAN.md AG-17; phase 1 exit item 5).
//
// Starts the built app under the X2 isolation guard in a fresh sandbox and checks:
//   - the launcher window and the settings window open (load time is recorded);
//   - the app stays up for an observation window;
//   - app.quit() ends the main process with exit code 0;
//   - the main process had no uncaught exception or unhandled rejection, checked in
//     two places: record-main-errors.cjs (loaded with -r before the app code) and the
//     app's own debug.log in the sandbox's identity data directory;
//   - the guard recorded no outbound attempt.
// Missing evidence fails the test: the recorder's file, the debug log and the guard
// log must all exist. As a positive control, one probe exception and one probe
// rejection are raised in the main process just before quitting; the recorder
// retains probe text and production file/terminal logs retain exact event counts.
// Synthetic canaries also exercise real main and renderer console exits.
//
// Prerequisites: `node scripts/build-electron.js` and `npx vite build`.
// Run:
//   node scripts/margin/isolation/run-node.mjs --allow-exec Electron \
//     --test --test-timeout=180000 tests/margin/startup-smoke.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { launchApp, windowWithQuery, readMainErrors } from './launch-app.mjs';
import { assertCriticalEvents } from './logging-evidence.mjs';
import { makeSandbox, readBlocked, readGuardLog, REPO } from '../../scripts/margin/isolation/env.mjs';

const OBSERVE_MS = 15_000;
const PROBE = 'MARGIN-SMOKE-PROBE';
const LOG_CANARY = 'SYNTHETIC_AG23_STARTUP_PRIVATE_LOG_CONTENT';
const identity = JSON.parse(fs.readFileSync(path.join(REPO, 'dist-electron/app-identity.json'), 'utf8'));

test('the app starts, opens the launcher and settings, stays up, and quits cleanly', async (t) => {
  const sandbox = makeSandbox('startup-smoke');
  const started = Date.now();
  const { app, output, mainErrorsLog } = await launchApp(sandbox, { NODE_ENV: 'production' });
  const mainProcess = app.process();
  const mainPid = mainProcess.pid;
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

    const rendererLogs = [];
    const safePayload = JSON.stringify([{ type: 'string', length: LOG_CANARY.length }, { type: 'object' }, { type: 'object' }]);
    for (const [name, page] of [['launcher', launcher], ['settings', settings]]) {
      page.on('console', message => rendererLogs.push(message.text()));
      const safeEvent = page.waitForEvent('console', {
        predicate: message => message.text() === `console.warn ${safePayload}`, timeout: 10_000,
      });
      await page.evaluate(canary => console.warn(canary, { privateText: canary }, new Error(canary)), LOG_CANARY);
      const message = await safeEvent;
      assert.equal(message.type(), 'warning', `${name} main-world console really emitted the safe warning`);
      assert.ok(!rendererLogs.join('\n').includes(LOG_CANARY), `${name} console never exposes synthetic private content`);
    }
    await app.evaluate((_, canary) => {
      console.log(canary, { privateText: canary }, new Error(canary));
      console.warn(canary, { privateText: canary }, new Error(canary));
    }, LOG_CANARY);

    const windows = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((w) => ({
      url: w.webContents.getURL().replace(/^.*\?/, '?'),
      visible: w.isVisible(),
    })));
    assert.ok(windows.some((w) => w.url.includes('window=launcher') && w.visible), `launcher not visible: ${JSON.stringify(windows)}`);
    assert.ok(windows.some((w) => w.url.includes('window=settings') && w.visible), `settings not visible: ${JSON.stringify(windows)}`);

    await new Promise((r) => setTimeout(r, OBSERVE_MS));
    assert.equal(mainProcess.exitCode, null, 'main process must still be running after the observation window');

    const logFile = await app.evaluate(({ app: electronApp }) =>
      process.getBuiltinModule('path').join(electronApp.getPath('logs'), 'debug.log'));
    const expectedLogFile = path.join(sandbox.home, 'Library/Application Support', identity.name, 'debug.log');
    assert.equal(fs.realpathSync(logFile), fs.realpathSync(expectedLogFile), 'debug log must be exactly the built identity log in the synthetic HOME');

    assert.ok(fs.existsSync(logFile), 'production log exists before probing');
    assertCriticalEvents(fs.readFileSync(logFile, 'utf8'), []);
    assertCriticalEvents(output.join(''), []);

    // Positive control for both error channels (see the header).
    await app.evaluate((_, probe) => {
      setTimeout(() => { throw new Error(`${probe} uncaught`); }, 0);
      setTimeout(() => { Promise.reject(new Error(`${probe} rejection`)); }, 0);
    }, PROBE);
    await new Promise((r) => setTimeout(r, 1_000));

    await app.evaluate(({ app: electronApp }) => { setTimeout(() => electronApp.quit(), 0); });
    const { code, signal } = await Promise.race([
      exited,
      new Promise((_, reject) => setTimeout(() => reject(new Error('app did not exit within 20 s of app.quit()')), 20_000)),
    ]);
    assert.equal(signal, null, `main process ended by signal ${signal}`);
    assert.equal(code, 0, `main process exit code ${code}`);

    const mainErrors = readMainErrors(mainErrorsLog, mainPid);
    const isProbe = (text) => text.includes(PROBE);
    assert.deepEqual(mainErrors.filter((e) => isProbe(e.detail)).map((e) => e.kind).sort(), ['uncaughtException', 'unhandledRejection'],
      `the recorder missed the probe: ${JSON.stringify(mainErrors)}`);
    assert.deepEqual(mainErrors.filter((e) => !isProbe(e.detail)).map((e) => `${e.kind}: ${e.detail.split('\n')[0]}`), [],
      'no uncaught exception or unhandled rejection in the main process (recorder)');

    assert.ok(fs.existsSync(logFile), `the app's debug log was not written: ${logFile}`);
    const logText = fs.readFileSync(logFile, 'utf8');
    const expectedEvents = ['uncaughtException', 'unhandledRejection'];
    assertCriticalEvents(logText, expectedEvents);
    assertCriticalEvents(output.join(''), expectedEvents);
    assert.ok(!logText.includes(PROBE), 'probe error text is not written to the production file');
    assert.ok(!output.join('').includes(PROBE), 'probe error text is not written to stdout/stderr');
    assert.ok(!logText.includes(LOG_CANARY), 'main file contains no console canary text');
    assert.ok(!output.join('').includes(LOG_CANARY), 'main stdout/stderr contain no console canary text');
    assert.ok(!rendererLogs.join('\n').includes(LOG_CANARY), 'renderer consoles contain no console canary text');
    for (const method of ['log', 'warn']) {
      const safeLine = `console.${method} ${safePayload}`;
      assert.ok(logText.includes(safeLine), `main ${method} actually reached the file as metadata`);
      assert.ok(output.join('').includes(safeLine), `main ${method} actually reached stdout/stderr as metadata`);
    }

    const guardLog = readGuardLog(sandbox); // throws if the guard log is missing
    assert.ok(guardLog.some((e) => e.kind === 'guard-loaded' && e.pid === mainPid), `no guard-loaded record from the main process (pid ${mainPid})`);
    const blocked = readBlocked(sandbox).filter((b) => !['permission', 'device', 'local-exec'].includes(b.kind));
    assert.deepEqual(blocked.map((b) => `${b.kind} ${b.detail}`), [], 'no outbound attempts during start-up');

    t.diagnostic(`launcher ready ${launcherReadyMs} ms, settings ready ${settingsReadyMs} ms, observed ${OBSERVE_MS} ms, exit code ${code}`);
    console.log(`[startup-smoke] launcher ready ${launcherReadyMs} ms; settings ready ${settingsReadyMs} ms; observed ${OBSERVE_MS} ms; exit code ${code}; windows ${JSON.stringify(windows)}`);
  } finally {
    if (mainProcess.exitCode === null && mainProcess.signalCode === null) await app.close().catch(() => {});
  }
});
