// Privacy settings never look saved when they are not, and an unreadable settings.json fails
// secure: the bad file is kept aside, meetings are not saved and cloud data scopes are denied
// until the user saves a setting again. A missing settings.json (first run) keeps the defaults.
// Runs the real SettingsManager (built), MeetingPersistence and ipcHandlers in a temp userData.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const dist = path.resolve(import.meta.dirname, '../../../dist-electron/electron');
const quiet = { log() {}, warn() {}, error() {} };
const transpile = file => ts.transpileModule(fs.readFileSync(path.resolve(import.meta.dirname, '../..', file), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText;
const { getDeniedDataScopes } = require(path.join(dist, 'llm/ProviderRouter.js'));
const SCOPES = ['transcript', 'screenshots', 'profile_history'];
const plain = value => JSON.parse(JSON.stringify(value));

function bootSettings(userData) {
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(dist, 'services/SettingsManager.js'), 'utf8'), { module, exports: module.exports, console: quiet, process, Object,
    require: id => id === 'electron' ? { app: { isReady: () => true, getPath: () => userData } } : require(id) });
  return module.exports.SettingsManager.getInstance();
}

async function stopMeeting(settings) {
  const module = { exports: {} }; const saved = [];
  const modules = {
    crypto: require('node:crypto'),
    electron: { BrowserWindow: { getAllWindows: () => [] } },
    './db/DatabaseManager': { DatabaseManager: { getInstance: () => ({ saveMeeting: meeting => saved.push(meeting) }) } },
    './services/SettingsManager': { SettingsManager: { getInstance: () => settings } },
  };
  vm.runInNewContext(transpile('MeetingPersistence.ts'), { module, exports: module.exports, Date, console: quiet,
    require(id) { if (Object.hasOwn(modules, id)) return modules[id]; throw Error(`unexpected require ${id}`); } });
  const startedAt = Date.now() - 5_000;
  const session = { flushInterimTranscript() {}, getSessionStartTime: () => startedAt, getMeetingMetadata: () => null, reset() {},
    getFullTranscript: () => [{ speaker: 'user', text: 'SENTINEL', timestamp: 1 }], getFullUsage: () => [] };
  const result = plain(await new module.exports.MeetingPersistence(session).stopMeeting());
  return { result, saved };
}

function privacyHandlers(settings) {
  const callbacks = new Map(); const sent = []; const cancelled = [];
  const win = { isDestroyed: () => false, webContents: { send: (...args) => sent.push(args) } };
  const module = { exports: {} };
  vm.runInNewContext(transpile('ipcHandlers.ts'), { module, exports: module.exports, console: quiet, process: { env: { NODE_ENV: 'test' }, platform: process.platform }, AbortController,
    require(id) {
      if (id === 'electron') return { app: { getPath: () => os.tmpdir() }, BrowserWindow: { getAllWindows: () => [win] }, ipcMain: { removeHandler() {}, handle: (name, callback) => callbacks.set(name, callback), removeAllListeners() {}, on() {} } };
      if (id === './services/SettingsManager') return { SettingsManager: { getInstance: () => settings } };
      if (id === './ipc/sttHandlers') return { registerDomesticSttHandlers() {} };
      if (id === './ipc/localContextHandlers') return { registerLocalContextHandlers() {} };
      if (id === './ipc/speechActions') return require(path.join(dist, 'ipc/speechActions.js'));
      if (id === './direct-assist/errors') return require(path.join(dist, 'direct-assist/errors.js'));
      if (id === './llm/scenarioPrompts') return require(path.join(dist, 'llm/scenarioPrompts.js'));
      if (id === './margin/appIdentity') return { APP_IDENTITY: { name: 'Synthetic' } };
      if (['fs', 'os', 'path', 'crypto'].includes(id)) return require(id);
      return {};
    },
  });
  module.exports.initializeIpcHandlers({ processingHelper: { getLLMHelper: () => ({ cancelGenerationTasks: reason => cancelled.push(reason) }) }, getIntelligenceManager: () => ({}) });
  const call = async (name, ...args) => plain(await callbacks.get(name)({}, ...args));
  return { call, sent, cancelled };
}

const tempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'privacy-settings-'));

test('a corrupt settings.json is kept aside, meetings are not saved and every data scope is denied', async () => {
  const dir = tempDir();
  const corrupt = '{"meetingRetention": "forever", "providerDataScopes": {"transcript": tr';
  fs.writeFileSync(path.join(dir, 'settings.json'), corrupt);
  const settings = bootSettings(dir);

  const backups = fs.readdirSync(dir).filter(name => name.startsWith('settings.json.corrupt-'));
  assert.equal(backups.length, 1, 'the unreadable file is preserved');
  assert.equal(fs.readFileSync(path.join(dir, backups[0]), 'utf8'), corrupt);

  const { result, saved } = await stopMeeting(settings);
  assert.deepEqual(result, { status: 'skipped', reason: 'privacy-settings-unreadable' });
  assert.equal(saved.length, 0);
  assert.equal(settings.getMeetingRetention(), 'never');
  assert.deepEqual(getDeniedDataScopes(SCOPES, settings.get('providerDataScopes')), SCOPES);

  // An unrelated save writes the fail-secure values explicitly and leaves the backup alone.
  settings.saveUiLanguage('zh-CN');
  assert.equal(fs.readFileSync(path.join(dir, backups[0]), 'utf8'), corrupt);
  const restarted = bootSettings(dir);
  assert.equal(restarted.getMeetingRetention(), 'never', 'a restart stays fail secure');
  assert.deepEqual(getDeniedDataScopes(SCOPES, restarted.get('providerDataScopes')), SCOPES);
  assert.equal((await stopMeeting(restarted)).saved.length, 0);
});

test('a restart after a corrupt boot without any save stays fail secure', async () => {
  const dir = tempDir();
  fs.writeFileSync(path.join(dir, 'settings.json'), 'not json');
  bootSettings(dir);
  const restarted = bootSettings(dir);
  assert.equal(restarted.getMeetingRetention(), 'never');
  assert.deepEqual(getDeniedDataScopes(SCOPES, restarted.get('providerDataScopes')), SCOPES);
  assert.equal((await stopMeeting(restarted)).saved.length, 0);
});

test('saving a privacy setting after a corrupt boot is kept and lifts the unreadable state', async () => {
  const dir = tempDir();
  fs.writeFileSync(path.join(dir, 'settings.json'), '[]');
  const settings = bootSettings(dir);
  const ipc = privacyHandlers(settings);
  assert.deepEqual(await ipc.call('get-provider-data-scopes'), { transcript: false, screenshots: false, profile_history: false });
  assert.deepEqual(await ipc.call('set-meeting-retention', 'forever'), { success: true });
  assert.equal((await stopMeeting(settings)).result.status, 'saved');
  assert.equal(bootSettings(dir).getMeetingRetention(), 'forever');
});

test('a failed write on set-meeting-retention reports failure and keeps the previous value', async () => {
  const dir = tempDir();
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ meetingRetention: 'never' }));
  const settings = bootSettings(dir);
  const ipc = privacyHandlers(settings);
  fs.rmSync(dir, { recursive: true, force: true }); // every later write fails
  const reply = await ipc.call('set-meeting-retention', 'forever');
  assert.equal(reply.success, false);
  assert.match(reply.error, /could not be saved/);
  assert.equal(settings.getMeetingRetention(), 'never', 'memory keeps the previous value');
  assert.equal(await ipc.call('get-meeting-retention'), 'never');
  assert.deepEqual(ipc.sent, [], 'no window is told the setting changed');
});

test('a failed write on set-provider-data-scopes reports failure and keeps the previous scopes', async () => {
  const dir = tempDir();
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ providerDataScopes: { transcript: false } }));
  const settings = bootSettings(dir);
  const ipc = privacyHandlers(settings);
  fs.rmSync(dir, { recursive: true, force: true });
  const reply = await ipc.call('set-provider-data-scopes', { transcript: true });
  assert.equal(reply.success, false);
  assert.match(reply.error, /could not be saved/);
  assert.deepEqual(plain(settings.get('providerDataScopes')), { transcript: false });
  assert.deepEqual(ipc.sent, []);
  assert.deepEqual(ipc.cancelled, []);
});

test('first run without settings.json keeps the defaults and writes nothing', async () => {
  const dir = tempDir();
  const settings = bootSettings(dir);
  assert.deepEqual(fs.readdirSync(dir), []);
  assert.equal(settings.getMeetingRetention(), 'forever');
  assert.deepEqual(getDeniedDataScopes(SCOPES, settings.get('providerDataScopes')), []);
  const { result, saved } = await stopMeeting(settings);
  assert.equal(result.status, 'saved');
  assert.equal(saved.length, 1);
});
