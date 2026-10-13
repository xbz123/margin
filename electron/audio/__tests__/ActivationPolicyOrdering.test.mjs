import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';

const source = fs.readFileSync(path.resolve(import.meta.dirname, '../../main.ts'), 'utf8');
const ast = ts.createSourceFile('main.ts', source, ts.ScriptTarget.Latest, true);
const initialize = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'initializeApp');

// Execute the real initializer; window construction is not a first-paint signal.
for (const protectedStartup of [true, false]) test(`AG61: ${protectedStartup ? 'protected' : 'normal'} startup applies identity before construction and first paint without changing Dock policy`, async () => {
  const calls = [], paints = [];
  const state = { processingHelper: { loadStoredCredentials() {} }, prewarmSttProviders() {},
    applyInitialDisguise() { calls.push('identity'); }, getUndetectable: () => protectedStartup,
    createWindow() { calls.push('construct'); paints.push(() => calls.push('first-paint')); }, showTray() { calls.push('tray.show'); },
    settingsWindowHelper: { preloadWindow() {} }, modelSelectorWindowHelper: { preloadWindow() {} } };
  const app = { requestSingleInstanceLock: () => true, async whenReady() { calls.push('ready'); }, on() {}, once() {}, commandLine: { appendSwitch() {} },
    dock: { hide() { calls.push('dock.hide'); }, show() { calls.push('dock.show'); return Promise.resolve(); } } };
  const module = { exports: {} };
  vm.runInNewContext(ts.transpileModule(`${initialize.getText(ast)}\nexports.initializeApp = initializeApp;`, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { module, exports: module.exports, app, process: { platform: 'darwin' }, console: { log() {}, warn() {}, error() {} },
      AppState: { getInstance: () => state }, SettingsManager: { getInstance: () => ({ get: () => protectedStartup }) },
      KeybindManager: { getInstance: () => ({ registerGlobalShortcuts() {} }) }, initializeIpcHandlers() {}, logAppEvent() {}, screen: {},
      registerOsEventSubscriptions: () => () => {}, setTimeout() {},
      require(id) { if (id === './services/CredentialsManager') return { CredentialsManager: { getInstance: () => ({ init: () => ({ ok: true }) }) } }; if (id === 'electron') return { powerMonitor: {} }; throw Error(`Unexpected import: ${id}`); } });
  await module.exports.initializeApp();
  assert.equal(calls.includes('first-paint'), false);
  assert.ok(calls.indexOf('ready') < calls.indexOf('identity'));
  assert.ok(calls.indexOf('identity') < calls.indexOf('construct'));
  paints.forEach(paint => paint());
  assert.ok(calls.indexOf('identity') < calls.indexOf('first-paint'));
  assert.equal(calls.includes('dock.show'), false);
  assert.equal(calls.includes('tray.show'), !protectedStartup);
  assert.equal(calls.includes('dock.hide'), protectedStartup);
  if (protectedStartup) assert.ok(calls.indexOf('dock.hide') < calls.indexOf('identity'));
});
