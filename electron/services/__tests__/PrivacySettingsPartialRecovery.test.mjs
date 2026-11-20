// An older build left a corrupt backup (settings.json.corrupt-*) and later wrote back only part
// of the privacy settings. Recovery keeps every value the user explicitly stored and fails secure
// per missing field: a missing retention is 'never', each missing cloud scope is off. A settings
// folder that cannot be listed is treated the same way; a genuine first install keeps defaults.
// Each state is booted twice over the same folder and the second boot must not flip anything.
// Runs the real built SettingsManager in a temp userData; readdir failure is stubbed.
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
const BACKUP = 'settings.json.corrupt-2026-11-01T00-00-00-000Z-abcd1234';

// readdirDenied: listing the userData folder throws EACCES (reads of files still work).
function bootSettings(userData, { readdirDenied = false } = {}) {
  const stubFs = { ...fs, readdirSync(dir, ...rest) {
    if (readdirDenied && path.resolve(String(dir)) === path.resolve(userData)) {
      throw Object.assign(new Error(`EACCES: permission denied, scandir '${dir}'`), { code: 'EACCES' });
    }
    return fs.readdirSync(dir, ...rest);
  } };
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(dist, 'services/SettingsManager.js'), 'utf8'), { module, exports: module.exports, console: quiet, process, Object,
    require: id => id === 'electron' ? { app: { isReady: () => true, getPath: () => userData } } : id === 'fs' ? stubFs : require(id) });
  return module.exports.SettingsManager.getInstance();
}

// What the app actually does: retention as MeetingPersistence sees it, and each scope allowed/denied.
function effective(settings) {
  const denied = getDeniedDataScopes(SCOPES, settings.get('providerDataScopes'));
  return {
    meetingsSaved: !settings.privacySettingsUnreadable() && settings.get('meetingRetention') !== 'never',
    retention: settings.getMeetingRetention(),
    transcript: !denied.includes('transcript'),
    screenshots: !denied.includes('screenshots'),
    profile_history: !denied.includes('profile_history'),
  };
}

const tempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'privacy-partial-'));
const writeJson = (dir, value) => fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify(value));
const readJson = dir => JSON.parse(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8'));
const table = [];

function bootTwice(label, dir, expected, options) {
  const results = [];
  for (const start of [1, 2]) {
    const result = effective(bootSettings(dir, options));
    table.push({ state: label, start, ...result });
    assert.deepEqual(result, expected, `${label}, start ${start}`);
    results.push(result);
  }
  assert.deepEqual(results[1], results[0], `${label}: the second start does not flip anything`);
}

test('(a) corrupt backup, main file kept only "don\'t save meetings": all three cloud scopes are off', () => {
  const dir = tempDir();
  fs.writeFileSync(path.join(dir, BACKUP), CORRUPT);
  writeJson(dir, { uiLanguage: 'zh-CN', meetingRetention: 'never' });
  bootTwice('(a) only retention', dir,
    { meetingsSaved: false, retention: 'never', transcript: false, screenshots: false, profile_history: false });
  assert.deepEqual(readJson(dir), { uiLanguage: 'zh-CN', meetingRetention: 'never',
    providerDataScopes: { transcript: false, screenshots: false, profile_history: false } });
  assert.equal(fs.readFileSync(path.join(dir, BACKUP), 'utf8'), CORRUPT, 'the backup is untouched');
});

test('(b) corrupt backup, main file kept only some cloud scopes: stored scopes kept, others off, meetings not saved', () => {
  const dir = tempDir();
  fs.writeFileSync(path.join(dir, BACKUP), CORRUPT);
  writeJson(dir, { providerDataScopes: { transcript: true } });
  bootTwice('(b) only some scopes', dir,
    { meetingsSaved: false, retention: 'never', transcript: true, screenshots: false, profile_history: false });
  assert.deepEqual(readJson(dir), { meetingRetention: 'never',
    providerDataScopes: { transcript: true, screenshots: false, profile_history: false } });
});

test('(b2) corrupt backup, all three scopes stored but no retention: scopes kept as stored, meetings not saved', () => {
  const dir = tempDir();
  fs.writeFileSync(path.join(dir, BACKUP), CORRUPT);
  writeJson(dir, { providerDataScopes: { transcript: true, screenshots: false, profile_history: true } });
  bootTwice('(b2) all scopes, no retention', dir,
    { meetingsSaved: false, retention: 'never', transcript: true, screenshots: false, profile_history: true });
});

test('(a2) corrupt backup, explicit "keep meetings" and no scopes: retention kept on both starts, scopes off', () => {
  const dir = tempDir();
  fs.writeFileSync(path.join(dir, BACKUP), CORRUPT);
  writeJson(dir, { meetingRetention: 'forever' });
  bootTwice('(a2) retention forever only', dir,
    { meetingsSaved: true, retention: 'forever', transcript: false, screenshots: false, profile_history: false });
});

test('(c) settings folder refuses listing: missing privacy fields fail secure, stored ones are kept', () => {
  const dir = tempDir();
  writeJson(dir, { uiLanguage: 'zh-CN' });
  bootTwice('(c) readdir EACCES, UI-only file', dir,
    { meetingsSaved: false, retention: 'never', transcript: false, screenshots: false, profile_history: false }, { readdirDenied: true });
  assert.equal(readJson(dir).uiLanguage, 'zh-CN', 'UI preferences are kept');

  const partial = tempDir();
  writeJson(partial, { meetingRetention: 'never', providerDataScopes: { screenshots: true } });
  bootTwice('(c) readdir EACCES, partial file', partial,
    { meetingsSaved: false, retention: 'never', transcript: false, screenshots: true, profile_history: false }, { readdirDenied: true });

  const missing = tempDir();
  bootTwice('(c) readdir EACCES, no settings.json', missing,
    { meetingsSaved: false, retention: 'never', transcript: false, screenshots: false, profile_history: false }, { readdirDenied: true });
});

test('(d) genuine first install keeps the first-install defaults on both starts and writes nothing', () => {
  const dir = tempDir();
  bootTwice('(d) first install', dir,
    { meetingsSaved: true, retention: 'forever', transcript: true, screenshots: true, profile_history: true });
  assert.deepEqual(fs.readdirSync(dir), []);
});

test('a complete privacy setting beside a corrupt backup is left exactly as stored', () => {
  const dir = tempDir();
  fs.writeFileSync(path.join(dir, BACKUP), CORRUPT);
  const stored = { meetingRetention: 'forever', providerDataScopes: { transcript: true, screenshots: true, profile_history: false } };
  writeJson(dir, stored);
  bootTwice('complete beside backup', dir,
    { meetingsSaved: true, retention: 'forever', transcript: true, screenshots: true, profile_history: false });
  assert.deepEqual(readJson(dir), stored);
});

test.after(() => {
  if (process.env.PRIVACY_RECOVERY_TABLE) console.table(table);
});
