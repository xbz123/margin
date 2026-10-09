#!/usr/bin/env node
'use strict';

// AG-25 (PLAN S11): clean output -> build -> arm64 package -> ad hoc signature
// (the afterPack hook) -> package checks -> zip. GitHub Actions only; this
// machine never packages. Variant from MARGIN_APP_VARIANT (temp by default).
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { selectIdentity } = require('./margin/app-identity.cjs');
const { checkPackage } = require('./margin/package-check.cjs');

const ROOT = path.resolve(__dirname, '..');
if (process.env.CI !== 'true' || process.env.GITHUB_ACTIONS !== 'true' || process.platform !== 'darwin' || process.arch !== 'arm64') {
  throw new Error('Packaging runs only on GitHub Actions macOS arm64 (PLAN S11)');
}
for (const key of Object.keys(process.env)) {
  if (/^(CSC_|APPLE_)/.test(key) || ['NATIVELY_PRODUCTION_SIGN', 'NATIVELY_SIGN_IDENTITY'].includes(key)) throw new Error(`Signing variable ${key} is not allowed`);
}
const identity = selectIdentity();
const out = path.join(process.env.RUNNER_TEMP, 'margin-package', identity.variant);
if (fs.existsSync(out)) throw new Error(`Output already exists: ${out}`);
fs.mkdirSync(out, { recursive: true });
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
// S22: the rebuilt libvips installed by scripts/margin/libvips/install-rebuilt.mjs.
const installed = JSON.parse(fs.readFileSync(path.join(process.env.RUNNER_TEMP, 'libvips-installed.json'), 'utf8'));
const report = checkPackage(app, identity, { sourceRoot: ROOT, libvipsSHA256: installed.rebuiltSHA256 });
report.libvips = installed;
report.commit = process.env.GITHUB_SHA;
report.run = `${process.env.GITHUB_RUN_ID}/${process.env.GITHUB_RUN_ATTEMPT}`;
fs.writeFileSync(path.join(out, 'package-checks.json'), JSON.stringify(report, null, 2) + '\n');

const zip = path.join(out, `${identity.name}-${identity.variant}-arm64.zip`);
const ditto = spawnSync('/usr/bin/ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', app, zip], { encoding: 'utf8' });
if (ditto.status !== 0) throw new Error(`zip failed: ${ditto.stderr}`);
const digest = crypto.createHash('sha256').update(fs.readFileSync(zip)).digest('hex');
fs.writeFileSync(path.join(out, 'BUILD-INFO.txt'), [
  `commit: ${process.env.GITHUB_SHA}`, `run: ${report.run}`, `variant: ${identity.variant}`,
  `name: ${identity.name}`, `appId: ${identity.appId}`, `checks: ${report.passed ? 'passed' : 'FAILED'}`,
  `${digest}  ${path.basename(zip)}`, '',
].join('\n'));
console.log(JSON.stringify({ variant: identity.variant, passed: report.passed, zip: path.basename(zip), sha256: digest }));
if (!report.passed) {
  console.error(JSON.stringify(report.checks.filter((check) => !check.passed), null, 2));
  process.exitCode = 1;
}
