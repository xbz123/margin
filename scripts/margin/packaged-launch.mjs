#!/usr/bin/env node
// AG-25 CI launch check of a packaged app (PLAN §5 phase 2 exit items 2 and 6).
// GitHub Actions only: a packaged Electron app ignores NODE_OPTIONS and -r, so the
// X2 guard cannot be injected, and its first launch asks for Screen Recording
// permission. Neither is acceptable on the user's machine (S9, S15); a CI runner
// has no real data. Isolation here: throwaway HOME/CFFIXED_USER_HOME and TMPDIR,
// mock keychain and the Chromium resolver block from the guard's switch list.
//   node scripts/margin/packaged-launch.mjs <app> <name> <appId> <report.json>
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { CHROMIUM_SWITCHES } from './isolation/env.mjs';

const require = createRequire(import.meta.url);
const { _electron } = require('playwright');

if (process.env.CI !== 'true' || process.env.GITHUB_ACTIONS !== 'true') throw new Error('Packaged launch runs only on GitHub Actions');
const [app, name, appId, reportFile] = process.argv.slice(2);
const home = fs.realpathSync(fs.mkdtempSync(path.join(process.env.RUNNER_TEMP || os.tmpdir(), `margin-launch-${name}-`)));
fs.mkdirSync(path.join(home, 'tmp'));
const env = {
  PATH: process.env.PATH, HOME: home, CFFIXED_USER_HOME: home, TMPDIR: path.join(home, 'tmp') + path.sep,
  CI: 'true', GITHUB_ACTIONS: 'true', NO_PROXY: '*', ELECTRON_NO_ATTACH_CONSOLE: '1',
};
const report = { app: path.basename(app), expected: { name, appId }, home: '<throwaway>', checks: [] };
const add = (id, passed, detail) => report.checks.push({ id, passed: !!passed, detail });
let electronApp;
const output = [];
try {
  electronApp = await _electron.launch({ executablePath: path.join(app, 'Contents/MacOS', name), args: CHROMIUM_SWITCHES, env, timeout: 90_000 });
  electronApp.process().stdout.on('data', (d) => output.push(String(d)));
  electronApp.process().stderr.on('data', (d) => output.push(String(d)));
  const deadline = Date.now() + 60_000;
  let launcher;
  while (!launcher && Date.now() < deadline) {
    launcher = electronApp.windows().find((page) => page.url().includes('window=launcher'));
    if (!launcher) await new Promise((resolve) => setTimeout(resolve, 250));
  }
  add('launcher-window', !!launcher, launcher ? 'window=launcher loaded' : 'no launcher window within 60 s');
  if (launcher) {
    await launcher.waitForLoadState('domcontentloaded');
    add('preload-api', await launcher.evaluate(() => typeof window.electronAPI === 'object'), 'window.electronAPI');
  }
  const state = await electronApp.evaluate(({ app: a }) => ({
    packaged: a.isPackaged, name: a.getName(), userData: a.getPath('userData'), logs: a.getPath('logs'), appData: a.getPath('appData'),
  }));
  const own = path.join(home, 'Library/Application Support', name);
  add('packaged', state.packaged === true, state.packaged);
  add('app-name', state.name === name, state.name);
  add('user-data', state.userData === own, { userData: state.userData.split(home).join('<home>') });
  add('logs', state.logs === own, { logs: state.logs.split(home).join('<home>') });
  const support = path.join(home, 'Library/Application Support');
  const created = fs.existsSync(support) ? fs.readdirSync(support) : [];
  add('only-own-directory', created.length === 1 && created[0] === name, created);
} catch (error) {
  add('launch', false, error.message.split(home).join('<home>'));
} finally {
  if (electronApp) await electronApp.close().catch(() => {});
}
report.output = output.join('').split(home).join('<home>').split('\n').slice(-60);
report.passed = report.checks.length > 0 && report.checks.every((check) => check.passed);
fs.writeFileSync(reportFile, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ app: report.app, passed: report.passed, failed: report.checks.filter((c) => !c.passed) }));
process.exitCode = report.passed ? 0 : 1;
