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

// Each load is a fresh process-like module instance over a synthetic userData directory.
function loadBundle(file, userData, fsImpl = fs) {
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(dist, file), 'utf8'), { module, exports: module.exports, console: quiet, process, Object,
    require(id) {
      if (id === 'electron') return { app: { isReady: () => true, getPath: () => userData } };
      if (id === 'fs') return fsImpl;
      return require(id);
    },
  });
  return module.exports;
}

const tempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ag60-language-'));
// Handler results are created inside the vm realm; compare them as plain data.
const plain = value => JSON.parse(JSON.stringify(value));

test('AG60: interface language loads valid, rejects invalid and defaults to English', () => {
  const dir = tempDir();
  assert.equal(loadBundle('SettingsManager.js', dir).SettingsManager.getInstance().getUiLanguage(), 'en');
  for (const [stored, expected] of [['zh-CN', 'zh-CN'], ['fr', 'en'], [42, 'en'], ['en', 'en']]) {
    fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ uiLanguage: stored, meetingRetention: '7d' }));
    assert.equal(loadBundle('SettingsManager.js', dir).SettingsManager.getInstance().getUiLanguage(), expected, String(stored));
  }
});

test('AG60: saving the interface language is atomic, keeps other settings and survives restart', () => {
  const dir = tempDir();
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ meetingRetention: '30d' }));
  const manager = loadBundle('SettingsManager.js', dir).SettingsManager.getInstance();
  assert.equal(manager.saveUiLanguage('zh-CN'), 'zh-CN');
  assert.equal(manager.getUiLanguage(), 'zh-CN');
  assert.deepEqual(fs.readdirSync(dir), ['settings.json']);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8')), { meetingRetention: '30d', uiLanguage: 'zh-CN' });
  if (process.platform !== 'win32') assert.equal(fs.statSync(path.join(dir, 'settings.json')).mode & 0o777, 0o600);
  const restarted = loadBundle('SettingsManager.js', dir).SettingsManager.getInstance();
  assert.equal(restarted.getUiLanguage(), 'zh-CN');
  assert.equal(restarted.get('meetingRetention'), '30d');
  assert.throws(() => restarted.saveUiLanguage('de'), /Unsupported interface language/);
  assert.equal(restarted.getUiLanguage(), 'zh-CN');
});

test('AG60: a failed language write leaves memory and disk unchanged and cleans its temp file', () => {
  const dir = tempDir();
  const file = path.join(dir, 'settings.json');
  fs.writeFileSync(file, JSON.stringify({ uiLanguage: 'en' }));
  const before = fs.readFileSync(file, 'utf8');
  const failingFs = { ...fs, renameSync() { throw Object.assign(new Error('disk full'), { code: 'ENOSPC' }); } };
  const manager = loadBundle('SettingsManager.js', dir, failingFs).SettingsManager.getInstance();
  assert.throws(() => manager.saveUiLanguage('zh-CN'), /The interface language could not be saved\./);
  assert.equal(manager.getUiLanguage(), 'en');
  assert.equal(fs.readFileSync(file, 'utf8'), before);
  assert.deepEqual(fs.readdirSync(dir), ['settings.json']);
  assert.equal(loadBundle('SettingsManager.js', dir).SettingsManager.getInstance().getUiLanguage(), 'en');
});

test('AG60: main-process labels follow the saved language with English fallback and placeholders', () => {
  const dir = tempDir();
  const strings = loadBundle('mainStrings.js', dir);
  assert.equal(strings.mainTextFor('en', 'View'), 'View');
  assert.equal(strings.mainTextFor('zh-CN', 'View'), '视图');
  assert.equal(strings.mainTextFor('zh-CN', 'Quit'), '退出');
  assert.equal(strings.mainTextFor('zh-CN', 'Show {name}', { name: 'Margin' }), '显示 Margin');
  assert.equal(strings.mainTextFor('zh-CN', 'Toggle Window ({shortcut})', { shortcut: '⌘B' }).includes('⌘B'), true);
  assert.equal(strings.mainTextFor('zh-CN', 'Not a dictionary key {x}'), 'Not a dictionary key {x}');
  assert.equal(strings.mainText('Developer Console'), 'Developer Console');
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ uiLanguage: 'zh-CN' }));
  assert.equal(loadBundle('mainStrings.js', dir).mainText('View'), '视图');
  const notReady = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(dist, 'mainStrings.js'), 'utf8'), { module: notReady, exports: notReady.exports, console: quiet, process, Object,
    require: id => id === 'electron' ? { app: { isReady: () => false, getPath: () => dir } } : require(id) });
  assert.equal(notReady.exports.mainText('View'), 'View');
});

function languageHandlers({ saved = 'en', saveError = null, windows = [], refreshError = null } = {}) {
  const source = fs.readFileSync(path.resolve(import.meta.dirname, '../../ipcHandlers.ts'), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText;
  const callbacks = new Map(); const saves = []; const refreshes = [];
  const settings = { getUiLanguage: () => saved, saveUiLanguage(language) { saves.push(language); if (saveError) throw saveError; saved = language; return language; }, get() {} };
  const module = { exports: {} };
  vm.runInNewContext(compiled, { module, exports: module.exports, console: quiet, process: { env: { NODE_ENV: 'test' }, platform: process.platform }, AbortController,
    require(id) {
      if (id === 'electron') return { app: { getPath: () => os.tmpdir() }, BrowserWindow: { getAllWindows: () => windows }, ipcMain: { removeHandler() {}, handle: (name, callback) => callbacks.set(name, callback), removeAllListeners() {}, on() {} } };
      if (id === './services/SettingsManager') return { SettingsManager: { getInstance: () => settings } };
      if (id === '../src/types/uiLanguage') return { isUiLanguage: value => value === 'en' || value === 'zh-CN' };
      if (id === './services/mainStrings') return { mainText: english => english };
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
  module.exports.initializeIpcHandlers({ refreshLocalizedMenus() { refreshes.push(true); if (refreshError) throw refreshError; }, processingHelper: { getLLMHelper: () => ({}) }, getIntelligenceManager: () => ({}) });
  return { get: () => callbacks.get('ui-language:get')({}), set: async value => plain(await callbacks.get('ui-language:set')({}, value)), saves, refreshes };
}

const fakeWindow = (destroyed = false, throws = false) => {
  const sent = [];
  return { sent, isDestroyed: () => destroyed, webContents: { send(...args) { if (throws) throw new Error('gone'); sent.push(args); } } };
};

test('AG60: ui-language IPC rejects invalid values without saving or broadcasting', async () => {
  const win = fakeWindow();
  const ipc = languageHandlers({ windows: [win] });
  assert.equal(await ipc.get(), 'en');
  for (const value of ['fr', null, { language: 'zh-CN' }, 'zh-cn']) {
    assert.deepEqual(await ipc.set(value), { ok: false, message: 'Unsupported interface language.' });
  }
  assert.deepEqual(ipc.saves, []); assert.deepEqual(ipc.refreshes, []); assert.deepEqual(win.sent, []);
});

test('AG60: ui-language IPC never broadcasts or rebuilds menus after a failed save', async () => {
  const win = fakeWindow();
  const ipc = languageHandlers({ windows: [win], saveError: new Error('The interface language could not be saved.') });
  assert.deepEqual(await ipc.set('zh-CN'), { ok: false, message: 'The interface language could not be saved.' });
  assert.deepEqual(ipc.saves, ['zh-CN']); assert.deepEqual(ipc.refreshes, []); assert.deepEqual(win.sent, []);
  assert.equal(await ipc.get(), 'en');
});

test('AG60: a saved language rebuilds menus and reaches every live window', async () => {
  const launcher = fakeWindow(), overlay = fakeWindow(), closed = fakeWindow(true), tearingDown = fakeWindow(false, true);
  const ipc = languageHandlers({ windows: [launcher, closed, tearingDown, overlay], refreshError: new Error('menu failure') });
  assert.deepEqual(await ipc.set('zh-CN'), { ok: true, language: 'zh-CN' });
  assert.deepEqual(ipc.refreshes, [true]);
  assert.deepEqual(launcher.sent, [['ui-language:changed', 'zh-CN']]);
  assert.deepEqual(overlay.sent, [['ui-language:changed', 'zh-CN']]);
  assert.deepEqual(closed.sent, []);
  assert.equal(await ipc.get(), 'zh-CN');
});
