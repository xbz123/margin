// A corrupt settings.json recovery that stops halfway (the unreadable copy is kept aside, then the
// disk is full when the fail-secure settings are written) must not look like a first install on
// the next boot. The unreadable file stays at settings.json until the replacement is written,
// and the legacy state an older build could leave (settings.json missing, only a corrupt-* copy
// beside it) also fails secure. A genuine first install keeps the defaults.
// Runs the real built SettingsManager in a temp userData with an fs whose writes can be failed.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const dist = path.resolve(import.meta.dirname, '../../../dist-electron/electron');
const quiet = { log() {}, warn() {}, error() {} };
const { getDeniedDataScopes } = require(path.join(dist, 'llm/ProviderRouter.js'));
const SCOPES = ['transcript', 'screenshots', 'profile_history'];
const CORRUPT = '{"meetingRetention": "forever", "providerDataScopes": {"transcript": tr';

// diskFull: every writeFileSync throws ENOSPC; copies (the backup) still succeed.
function bootSettings(userData, { diskFull = false } = {}) {
  const failingFs = { ...fs, writeFileSync(...args) {
    if (diskFull) throw Object.assign(new Error('ENOSPC: no space left on device, write'), { code: 'ENOSPC' });
    return fs.writeFileSync(...args);
  } };
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(dist, 'services/SettingsManager.js'), 'utf8'), { module, exports: module.exports, console: quiet, process, Object,
    require: id => id === 'electron' ? { app: { isReady: () => true, getPath: () => userData } } : id === 'fs' ? failingFs : require(id) });
  return module.exports.SettingsManager.getInstance();
}

function assertFailSecure(settings, label) {
  assert.equal(settings.privacySettingsUnreadable(), true, `${label}: meetings are not saved`);
  assert.equal(settings.getMeetingRetention(), 'never', `${label}: retention is never`);
  assert.deepEqual(getDeniedDataScopes(SCOPES, settings.get('providerDataScopes')), SCOPES, `${label}: transcript, screenshot and history uploads are off`);
}

const tempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'privacy-recovery-'));
const backups = dir => fs.readdirSync(dir).filter(name => name.startsWith('settings.json.corrupt-'));

test('backup kept, fail-secure write fails: the next boot still fails secure', () => {
  const dir = tempDir();
  fs.writeFileSync(path.join(dir, 'settings.json'), CORRUPT);

  assertFailSecure(bootSettings(dir, { diskFull: true }), 'first boot');
  assert.equal(backups(dir).length, 1, 'the unreadable copy was kept aside');
  assert.equal(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8'), CORRUPT, 'settings.json is not left empty or missing');
  assert.deepEqual(fs.readdirSync(dir).filter(name => name.endsWith('.tmp')), [], 'no temp file is left behind');

  // Disk still full on the second boot.
  assertFailSecure(bootSettings(dir, { diskFull: true }), 'second boot, disk still full');
  // Space freed: the boot after that writes the fail-secure values and stays secure.
  assertFailSecure(bootSettings(dir), 'boot after space freed');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8')),
    { meetingRetention: 'never', providerDataScopes: { transcript: false, screenshots: false, profile_history: false } });
  assert.equal(fs.readFileSync(path.join(dir, backups(dir)[0]), 'utf8'), CORRUPT, 'the first backup is untouched');
});

test('normal corrupt recovery writes the fail-secure settings and keeps the backup', () => {
  const dir = tempDir();
  fs.writeFileSync(path.join(dir, 'settings.json'), CORRUPT);
  assertFailSecure(bootSettings(dir), 'first boot');
  assert.equal(backups(dir).length, 1);
  assert.equal(fs.readFileSync(path.join(dir, backups(dir)[0]), 'utf8'), CORRUPT);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8')).meetingRetention, 'never');
  const restarted = bootSettings(dir);
  assert.equal(restarted.getMeetingRetention(), 'never');
  assert.deepEqual(getDeniedDataScopes(SCOPES, restarted.get('providerDataScopes')), SCOPES);
});

test('legacy state: settings.json missing with only a corrupt backup fails secure, not first install', () => {
  const dir = tempDir();
  fs.writeFileSync(path.join(dir, 'settings.json.corrupt-2026-11-01T00-00-00-000Z-abcd1234'), CORRUPT);
  assertFailSecure(bootSettings(dir, { diskFull: true }), 'legacy boot, write fails');
  assert.equal(fs.existsSync(path.join(dir, 'settings.json')), false);
  assertFailSecure(bootSettings(dir), 'legacy boot, write succeeds');
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8')).meetingRetention, 'never');
  // The stored fail-secure values keep the next boot secure (retention 'never' also skips saving).
  const restarted = bootSettings(dir);
  assert.equal(restarted.getMeetingRetention(), 'never');
  assert.deepEqual(getDeniedDataScopes(SCOPES, restarted.get('providerDataScopes')), SCOPES);
  // Saving a setting again lifts the unreadable state, as after any corrupt boot.
  const settings = bootSettings(dir);
  settings.savePrivacySetting('meetingRetention', 'forever');
  assert.equal(settings.privacySettingsUnreadable(), false);
  assert.equal(bootSettings(dir).getMeetingRetention(), 'forever');
});

test('genuine first install (no settings.json, no backup) keeps the defaults and writes nothing', () => {
  const dir = tempDir();
  const settings = bootSettings(dir);
  assert.deepEqual(fs.readdirSync(dir), []);
  assert.equal(settings.privacySettingsUnreadable(), false);
  assert.equal(settings.getMeetingRetention(), 'forever');
  assert.deepEqual(getDeniedDataScopes(SCOPES, settings.get('providerDataScopes')), []);
});
