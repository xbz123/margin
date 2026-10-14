#!/usr/bin/env node
'use strict';

// AG-25 (PLAN S11): clean output -> build -> arm64 package -> ad hoc signature
// (the afterPack hook) -> package checks -> zip. The local test identity is the
// user-approved exception to CI-only packaging; it reuses existing native modules.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { selectIdentity } = require('./margin/app-identity.cjs');
const { checkPackage } = require('./margin/package-check.cjs');

const ROOT = path.resolve(__dirname, '..');
const identity = selectIdentity();
const local = identity.variant === 'local';
if ((!local && (process.env.CI !== 'true' || process.env.GITHUB_ACTIONS !== 'true')) || process.platform !== 'darwin' || process.arch !== 'arm64') {
  throw new Error('Packaging requires GitHub Actions or the local test identity on macOS arm64');
}
for (const key of Object.keys(process.env)) {
  if (/^(CSC_|APPLE_)/.test(key) || ['NATIVELY_PRODUCTION_SIGN', 'NATIVELY_SIGN_IDENTITY'].includes(key)) throw new Error(`Signing variable ${key} is not allowed`);
}
const out = local ? fs.mkdtempSync(path.join(os.tmpdir(), 'natively-local-package-')) : path.join(process.env.RUNNER_TEMP, 'margin-package', identity.variant);
if (!local) {
  if (fs.existsSync(out)) throw new Error(`Output already exists: ${out}`);
  fs.mkdirSync(out, { recursive: true });
}
console.log(`Package output: ${out}`);
const revision = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' });
if (revision.status !== 0) throw new Error('Cannot identify package source revision');
const commit = local ? revision.stdout.trim() : process.env.GITHUB_SHA;
const run = local ? 'local' : `${process.env.GITHUB_RUN_ID}/${process.env.GITHUB_RUN_ATTEMPT}`;
if (local && spawnSync('git', ['diff', '--quiet', 'HEAD'], { cwd: ROOT }).status !== 0) {
  throw new Error('Commit tracked changes before local packaging so BUILD-INFO identifies the tested source');
}
if (local) {
  const untracked = spawnSync('git', ['ls-files', '--others', '--exclude-standard', '--', 'electron', 'src', 'scripts', 'assets', 'licenses', 'native-module/src'], { cwd: ROOT, encoding: 'utf8' });
  if (untracked.status !== 0 || untracked.stdout.trim()) throw new Error('Untracked build inputs must be reviewed before packaging');
}
const env = { ...process.env, MARGIN_PACKAGE_OUT: path.join(out, 'builder'), CSC_IDENTITY_AUTO_DISCOVERY: 'false' };

function step(name, command, args) {
  const result = spawnSync(command, args, { cwd: ROOT, env, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  fs.writeFileSync(path.join(out, `${name}.log`), (result.stdout ?? '') + (result.stderr ?? ''));
  if (result.status !== 0) throw new Error(`${name} failed (exit ${result.status}); see ${name}.log`);
}

for (const dir of ['dist', 'dist-electron']) fs.rmSync(path.join(ROOT, dir), { recursive: true, force: true });
step('build-electron', process.execPath, ['scripts/build-electron.js']);
step('vite-build', path.join(ROOT, 'node_modules/.bin/vite'), ['build']);
step('electron-builder', path.join(ROOT, 'node_modules/.bin/electron-builder'),
  ['--dir', '--mac', '--arm64', '--publish', 'never', '--config', 'scripts/margin/package.config.cjs']);

const app = path.join(out, 'builder', 'mac-arm64', `${identity.name}.app`);
const report = checkPackage(app, identity, { sourceRoot: ROOT });
report.commit = commit;
report.run = run;
fs.writeFileSync(path.join(out, 'package-checks.json'), JSON.stringify(report, null, 2) + '\n');

const zip = path.join(out, `${identity.name}-${identity.variant}-arm64.zip`);
const ditto = spawnSync('/usr/bin/ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', app, zip], { encoding: 'utf8' });
if (ditto.status !== 0) throw new Error(`zip failed: ${ditto.stderr}`);
const digest = crypto.createHash('sha256').update(fs.readFileSync(zip)).digest('hex');
fs.writeFileSync(path.join(out, 'BUILD-INFO.txt'), [
  `commit: ${commit}`, `run: ${report.run}`, `variant: ${identity.variant}`,
  `name: ${identity.name}`, `appId: ${identity.appId}`, `checks: ${report.passed ? 'passed' : 'FAILED'}`,
  `${digest}  ${path.basename(zip)}`, '',
].join('\n'));
console.log(JSON.stringify({ variant: identity.variant, passed: report.passed, zip: path.basename(zip), sha256: digest }));
if (!report.passed) {
  console.error(JSON.stringify(report.checks.filter((check) => !check.passed), null, 2));
  process.exitCode = 1;
}
