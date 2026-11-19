// Meeting retention is 'forever' or 'never'. Older builds also saved '7d'/'30d', which nothing
// enforced; they read as 'forever'. The IPC setter accepts only the two current values.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const dist = path.resolve(import.meta.dirname, '../../../dist-electron/electron/services');
const quiet = { log() {}, warn() {}, error() {} };

function loadSettings(userData) {
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(dist, 'SettingsManager.js'), 'utf8'), { module, exports: module.exports, console: quiet, process, Object,
    require: id => id === 'electron' ? { app: { isReady: () => true, getPath: () => userData } } : require(id) });
  return module.exports.SettingsManager.getInstance();
}

test('stored meeting retention reads as forever unless it is never', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'retention-settings-'));
  assert.equal(loadSettings(dir).getMeetingRetention(), 'forever');
  for (const [stored, expected] of [['forever', 'forever'], ['never', 'never'], ['7d', 'forever'], ['30d', 'forever'], [42, 'forever']]) {
    fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ meetingRetention: stored }));
    assert.equal(loadSettings(dir).getMeetingRetention(), expected, String(stored));
  }
});

function retentionHandlers(stored) {
  const source = fs.readFileSync(path.resolve(import.meta.dirname, '../../ipcHandlers.ts'), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText;
  const callbacks = new Map(); const saves = []; const sent = [];
  const settings = { get: () => undefined, savePrivacySetting(key, value) { saves.push([key, value]); stored = value; }, getMeetingRetention: () => stored === 'never' ? 'never' : 'forever' };
  const win = { isDestroyed: () => false, webContents: { send: (...args) => sent.push(args) } };
  const module = { exports: {} };
  vm.runInNewContext(compiled, { module, exports: module.exports, console: quiet, process: { env: { NODE_ENV: 'test' }, platform: process.platform }, AbortController,
    require(id) {
      if (id === 'electron') return { app: { getPath: () => os.tmpdir() }, BrowserWindow: { getAllWindows: () => [win] }, ipcMain: { removeHandler() {}, handle: (name, callback) => callbacks.set(name, callback), removeAllListeners() {}, on() {} } };
      if (id === './services/SettingsManager') return { SettingsManager: { getInstance: () => settings } };
      if (id === './ipc/sttHandlers') return { registerDomesticSttHandlers() {} };
      if (id === './ipc/localContextHandlers') return { registerLocalContextHandlers() {} };
      if (id === './ipc/speechActions') return require('../../../dist-electron/electron/ipc/speechActions.js');
      if (id === './direct-assist/errors') return require('../../../dist-electron/electron/direct-assist/errors.js');
      if (id === './llm/scenarioPrompts') return require('../../../dist-electron/electron/llm/scenarioPrompts.js');
      if (id === './margin/appIdentity') return { APP_IDENTITY: { name: 'Synthetic' } };
      if (['fs', 'os', 'path', 'crypto'].includes(id)) return require(id);
      return {};
    },
  });
  module.exports.initializeIpcHandlers({ processingHelper: { getLLMHelper: () => ({}) }, getIntelligenceManager: () => ({}) });
  return { get: () => callbacks.get('get-meeting-retention')({}), set: async value => JSON.parse(JSON.stringify(await callbacks.get('set-meeting-retention')({}, value))), saves, sent };
}

test('retention IPC reads legacy values as forever and saves only forever or never', async () => {
  const ipc = retentionHandlers('30d');
  assert.equal(await ipc.get(), 'forever');
  for (const value of ['7d', '30d', 'always', null]) assert.deepEqual(await ipc.set(value), { success: false, error: 'invalid_retention' });
  assert.deepEqual(ipc.saves, []); assert.deepEqual(ipc.sent, []);
  assert.deepEqual(await ipc.set('never'), { success: true });
  assert.equal(await ipc.get(), 'never');
  assert.deepEqual(await ipc.set('forever'), { success: true });
  assert.deepEqual(ipc.saves, [['meetingRetention', 'never'], ['meetingRetention', 'forever']]);
  assert.deepEqual(ipc.sent, [['meeting-retention-changed', 'never'], ['meeting-retention-changed', 'forever']]);
});
