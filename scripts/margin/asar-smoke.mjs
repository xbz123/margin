#!/usr/bin/env node
// AG-25 local launch smoke of a downloaded temp package (PLAN §5 phase 2 exit item 6).
// The packaged binary ignores the X2 guard and its first launch asks for Screen
// Recording permission (S9), so locally the package's own app.asar and unpacked
// native modules run in the repository's Electron under the guard instead; the
// packaged binary itself is launched only on CI (packaged-launch.mjs).
//   node scripts/margin/isolation/run-node.mjs --allow-exec Electron:lsof \
//     scripts/margin/asar-smoke.mjs <temp.app> <report.json>
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { REPO } from './isolation/env.mjs';
import { launchApp, windowWithQuery, readMainErrors } from '../../tests/margin/launch-app.mjs';
import { makeSandbox, readBlocked } from './isolation/env.mjs';

const [appBundle, reportFile] = process.argv.slice(2).map((item) => path.resolve(item));
const asar = path.join(appBundle, 'Contents/Resources/app.asar');
if (!fs.existsSync(asar)) throw new Error(`no app.asar in ${appBundle}`);
const sandbox = makeSandbox('asar-smoke');
const report = { app: path.basename(appBundle), checks: [] };
const add = (id, passed, detail) => report.checks.push({ id, passed: !!passed, detail });
const { app, mainErrorsLog } = await launchApp(sandbox, { NODE_ENV: 'production' }, { appPath: asar });
const pid = app.process().pid;
try {
  const launcher = await windowWithQuery(app, 'window=launcher', 30_000);
  await launcher.waitForLoadState('domcontentloaded');
  await launcher.waitForFunction(() => document.body && document.body.innerText.trim().length > 0, null, { timeout: 30_000 });
  add('launcher-window', true, 'window=launcher rendered');
  add('preload-api', await launcher.evaluate(() => typeof window.electronAPI === 'object'), 'window.electronAPI');
  add('renderer-from-package', launcher.url().startsWith(`file://${asar}/dist/index.html`), launcher.url().split(asar).join('<asar>'));
  const state = await app.evaluate(({ app: a }) => ({
    appPath: a.getAppPath(), name: a.getName(), userData: a.getPath('userData'),
  }));
  add('app-path', state.appPath === asar, state.appPath.split(asar).join('<asar>'));
  add('app-name', state.name === 'temp', state.name);
  add('user-data-in-sandbox', state.userData.startsWith(sandbox.root), state.userData.split(sandbox.root).join('<sandbox>'));
  // Native code mapped into the main process: the package's own modules, none from the repository.
  const mapped = execFileSync('/usr/sbin/lsof', ['-p', String(pid), '-Fn'], { encoding: 'utf8' }).split('\n')
    .filter((line) => line.startsWith('n') && /\.(node|dylib)$/.test(line)).map((line) => line.slice(1));
  const fromPackage = mapped.filter((file) => file.startsWith(`${asar}.unpacked/`));
  const fromRepo = mapped.filter((file) => file.startsWith(path.join(REPO, 'node_modules')) && !file.includes('/electron/dist/') || file.startsWith(path.join(REPO, 'native-module')));
  add('native-from-package', fromPackage.some((file) => file.endsWith('index.darwin-arm64.node')) && fromRepo.length === 0,
    { fromPackage: fromPackage.map((file) => file.split(asar).join('<asar>')), fromRepo });
  await new Promise((resolve) => setTimeout(resolve, 10_000));
  add('stays-up', app.process().exitCode === null, 'alive after 10 s');
} catch (error) {
  add('launch', false, error.message);
} finally {
  await app.close().catch(() => {});
}
const errors = readMainErrors(mainErrorsLog, pid);
add('no-main-errors', errors.length === 0, errors.slice(0, 5));
const blocked = readBlocked(sandbox).filter((item) => !['permission', 'device', 'local-exec'].includes(item.kind));
add('no-outbound', blocked.length === 0, blocked.slice(0, 10));
report.passed = report.checks.every((check) => check.passed);
fs.writeFileSync(reportFile, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ passed: report.passed, failed: report.checks.filter((check) => !check.passed) }));
process.exitCode = report.passed ? 0 : 1;
