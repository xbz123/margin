import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';

const root = path.resolve(import.meta.dirname, '../../..');
const quiet = { log() {}, warn() {}, error() {} };
const plain = value => JSON.parse(JSON.stringify(value));
export function evaluate(source, globals = {}, imports = {}) {
  const module = { exports: {} };
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText,
    { module, exports: module.exports, console: quiet, Buffer, __dirname: '/synthetic/electron', setTimeout, clearTimeout, setInterval, clearInterval, ...globals,
      require(id) { if (id in imports) return imports[id]; throw new Error(`Unexpected import ${id}`); } });
  return module.exports;
}
export function mainFixture({ failSave = false, failWindow = false, failDock = false, failDisguise = false, platform = 'darwin' } = {}) {
  const source = fs.readFileSync(path.join(root, 'electron/main.ts'), 'utf8');
  const ast = ts.createSourceFile('main.ts', source, ts.ScriptTarget.Latest, true);
  const cls = ast.statements.find(node => ts.isClassDeclaration(node) && node.name.text === 'AppState');
  const calls = [], events = [], timers = [], identities = [];
  const win = { isDestroyed: () => false, isVisible: () => true, isFocused: () => false,
    hide() { calls.push('hide'); }, focus() { calls.push('focus'); }, setTitle(value) { identities.push(['title', value]); }, setIcon(value) { identities.push(['window.icon', value]); },
    webContents: { send(...args) { events.push(args); } } };
  const helper = { setContentProtection(value) { calls.push(['protection', value]); if (failWindow) throw Error('native'); },
    syncActivationPolicy() {}, syncOverlayInteractionPolicy() { calls.push('passthrough'); if (failWindow) throw Error('native'); },
    getMainWindow: () => win, getLauncherWindow: () => win, getOverlayWindow: () => win,
    getSettingsWindow: () => win, getWindow: () => win, setIgnoreBlur() {} };
  const app = { dock: { hide() { calls.push('dock.hide'); if (failDock) throw Error('dock'); }, async show() { calls.push('dock.show'); if (failDock) throw Error('dock'); }, setIcon(image) { identities.push(['dock.icon', image]); } },
    setName(value) { identities.push(['name', value]); if (failDisguise) throw Error('native'); }, setAppUserModelId() {}, isPackaged: false, getAppPath: () => '/synthetic' };
  const settings = { set() { calls.push('save'); if (failSave) throw Error('disk'); }, saveWindowPreference() { calls.push('save'); if (failSave) throw Error('disk'); } };
  const loaded = evaluate(cls.getText(ast), { app, process: { platform, env: {} }, SettingsManager: { getInstance: () => settings },
    KeybindManager: { getInstance: () => ({ revalidateShortcuts: () => [] }) }, APP_IDENTITY: { name: 'Synthetic', appId: 'test.synthetic' }, fs: { existsSync: () => true }, path, nativeImage: { createFromPath: value => value },
    isDisguiseMode: value => ['none', 'terminal', 'settings', 'activity'].includes(value),
    decideToggle: (current, value) => ({ changed: current !== value }),
    setTimeout(fn) { timers.push(fn); return timers.length; }, clearTimeout() {} });
  const state = Object.assign(Object.create(loaded.AppState.prototype), { windowHelper: helper, settingsWindowHelper: helper,
    modelSelectorWindowHelper: helper, cropperWindowHelper: { ...helper, getWindow: () => win }, isUndetectable: false,
    overlayMousePassthrough: false, disguiseMode: 'none', _disguiseTimers: [], _windowPreferenceRevision: { protection: 0, passthrough: 0, disguise: 0 },
    _windowPreferenceResults: {}, _dockApplyTask: Promise.resolve() });
  state.showTray = () => calls.push('tray.show'); state.hideTray = () => calls.push('tray.hide');
  return { state, calls, events, win, helper, identities, app, timers, async flush() { while (timers.length) await timers.shift()(); } };
}

test('AG61: failed protection save preserves the preference and never starts native application', async () => {
  const f = mainFixture({ failSave: true });
  const pending = f.state.setUndetectable(true); await f.flush();
  const result = await pending;
  assert.equal(result.code, 'save_failed'); assert.equal(result.value, false);
  assert.equal(f.state.getUndetectable(), false);
  assert.deepEqual(f.calls, ['save']);
});

test('AG61: invalid protection, passthrough and disguise have zero effects', async () => {
  const f = mainFixture();
  for (const value of [null, 'false', 1, {}, []]) {
    assert.equal((await f.state.setUndetectable(value)).code, 'invalid_value');
    assert.equal(f.state.setOverlayMousePassthrough(value).code, 'invalid_value');
    assert.equal(f.state.setDisguise(value).code, 'invalid_value');
  }
  assert.deepEqual(f.calls, []); assert.deepEqual(f.events, []);
});

test('AG61: partial protection application retains saved preference, hides windows and retries same value', async () => {
  const f = mainFixture({ failWindow: true });
  const first = f.state.setUndetectable(true); await f.flush();
  assert.equal((await first).code, 'apply_failed'); assert.equal(f.state.getUndetectable(), true);
  assert.ok(f.calls.includes('hide'));
  f.helper.setContentProtection = value => f.calls.push(['retry', value]);
  f.state.cropperWindowHelper.setContentProtection = f.helper.setContentProtection;
  const second = f.state.setUndetectable(true); await f.flush();
  assert.equal((await second).success, true);
  assert.equal(f.calls.filter(call => call === 'save').length, 1);
  assert.equal(f.calls.filter(call => Array.isArray(call) && call[0] === 'retry').length, 4);
});

test('AG61: rejected Dock.show is returned and broadcast as apply_failed', async () => {
  const f = mainFixture({ failDock: true }); f.state.isUndetectable = true;
  const pending = f.state.setUndetectable(false); await f.flush();
  const result = await pending;
  assert.equal(result.code, 'apply_failed'); assert.equal(result.value, false);
  assert.ok(f.events.some(event => event[0] === 'window-preferences:result' && event[1].code === 'apply_failed'));
});

test('AG61: rapid protection changes settle only the latest Dock policy', async () => {
  const f = mainFixture();
  const first = f.state.setUndetectable(true), second = f.state.setUndetectable(false);
  await f.flush(); await Promise.all([first, second]);
  assert.equal(f.state.getUndetectable(), false);
  assert.equal(f.calls.filter(call => call === 'dock.hide').length, 0);
  assert.equal(f.calls.filter(call => call === 'dock.show').length, 1);
});

test('AG61: passthrough failure restores old preference without saving, showing or focusing', () => {
  const f = mainFixture({ failWindow: true });
  const result = f.state.setOverlayMousePassthrough(true);
  assert.equal(result.code, 'apply_failed'); assert.equal(result.value, false);
  assert.match(result.error, /restored/);
  assert.deepEqual(f.calls, ['passthrough', 'passthrough']);
});

test('AG61: protection no-op still reconciles consumers but does not churn native policy', async () => {
  const f = mainFixture(); assert.equal((await f.state.setUndetectable(false)).success, true);
  assert.deepEqual(f.calls, []);
  assert.ok(f.events.some(event => event[0] === 'undetectable-changed' && event[1] === false));
});

test('AG61: a same-value request cannot strand the temporary Settings blur guard', async () => {
  const f = mainFixture(); let ignoreBlur = false;
  f.helper.setIgnoreBlur = value => { ignoreBlur = value; };
  const pending = f.state.setUndetectable(true);
  f.timers.shift()();
  await pending;
  assert.equal(ignoreBlur, true, 'keep the existing grace period for delayed native blur');
  await f.state.setUndetectable(true);
  await f.flush();
  assert.equal(ignoreBlur, false, 'normal outside clicks work again after the grace period');
});

test('AG61: a later show failure is authoritative and the same preference retries native application', async () => {
  const f = mainFixture();
  const first = f.state.setUndetectable(true); await f.flush(); assert.equal((await first).success, true);
  f.calls.length = 0;
  f.state.reportProtectionFailure();
  assert.equal(f.state.getWindowPreferences().find(result => result.kind === 'protection').code, 'apply_failed');
  const retry = f.state.setUndetectable(true); await f.flush(); assert.equal((await retry).success, true);
  assert.equal(f.calls.filter(call => Array.isArray(call) && call[0] === 'protection').length, 4);
  assert.equal(f.calls.includes('save'), false);
});

test('AG61: actual IPC propagates authoritative results from production setters, including invalid values and save failures', async () => {
  const f = mainFixture({ failSave: true }); const callbacks = new Map();
  Object.assign(f.state, { processingHelper: { getLLMHelper: () => ({}) }, getIntelligenceManager: () => ({}) });
  const module = { exports: {} };
  const source = fs.readFileSync(path.join(root, 'electron/ipcHandlers.ts'), 'utf8');
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText,
    { module, exports: module.exports, console: quiet, AbortController, process: { env: { NODE_ENV: 'test' }, platform: 'darwin' },
      require(id) {
        if (id === 'electron') return { app: { getPath: () => '/synthetic' }, BrowserWindow: { getAllWindows: () => [] }, ipcMain: { removeHandler() {}, handle: (name, fn) => callbacks.set(name, fn), removeAllListeners() {}, on() {} } };
        if (id === './ipc/sttHandlers') return { registerDomesticSttHandlers() {} };
        if (id === './ipc/localContextHandlers') return { registerLocalContextHandlers() {} };
        if (id === './ipc/speechActions') return { SpeechActions: class {} };
        if (id === './services/mainStrings') return { mainText: value => value };
        if (id === './margin/appIdentity') return { APP_IDENTITY: { name: 'Synthetic' } };
        return {};
      } });
  module.exports.initializeIpcHandlers(f.state);
  assert.equal((await callbacks.get('set-undetectable')({}, 'true')).code, 'invalid_value');
  assert.equal((await callbacks.get('set-overlay-mouse-passthrough')({}, 1)).code, 'invalid_value');
  assert.equal((await callbacks.get('set-disguise')({}, 'browser')).code, 'invalid_value');
  assert.deepEqual(f.calls, []);
  assert.equal((await callbacks.get('set-undetectable')({}, true)).code, 'save_failed');
  assert.equal((await callbacks.get('set-disguise')({}, 'terminal')).code, 'save_failed');
  assert.equal((await callbacks.get('window-preferences:get')()).find(result => result.kind === 'protection').value, false);
  assert.deepEqual(f.calls, ['save', 'save']);
  const result = await callbacks.get('toggle-overlay-mouse-passthrough')({});
  assert.equal(result.success, true); assert.equal(result.value, true);
});

test('AG61: disguise apply failure retains the saved preference and advertises a retryable error', () => {
  const f = mainFixture({ failDisguise: true });
  const result = f.state.setDisguise('terminal');
  assert.equal(result.code, 'apply_failed'); assert.equal(result.value, 'terminal'); assert.equal(f.state.getDisguise(), 'terminal');
  f.app.setName = () => {};
  assert.equal(f.state.setDisguise('terminal').success, true);
  assert.ok(f.identities.some(([kind, value]) => kind === 'dock.icon' && value.endsWith('/assets/fakeicon/mac/terminal.png')));
});

test('AG61: protected cold startup keeps disguise saved and disabling protection restores its app name and icon', async () => {
  const f = mainFixture(); f.state.isUndetectable = true; f.state.disguiseMode = 'settings';
  f.state.applyInitialDisguise();
  assert.equal(f.identities.some(([kind]) => kind === 'name' || kind === 'dock.icon'), false);
  const pending = f.state.setUndetectable(false); await f.flush(); assert.equal((await pending).success, true);
  assert.ok(f.identities.some(([kind, value]) => kind === 'name' && value === 'System Settings '));
  assert.ok(f.identities.some(([kind, value]) => kind === 'dock.icon' && value.endsWith('/assets/fakeicon/mac/settings.png')));
});

test('AG61: Windows disguise applies title and existing icon to each current window kind', () => {
  const f = mainFixture({ platform: 'win32' }), identities = [];
  const window = name => ({ isDestroyed: () => false, webContents: { send() {} }, setIcon: value => identities.push([name, 'icon', value]), setTitle: value => identities.push([name, 'title', value]) });
  const windows = ['launcher', 'overlay', 'settings', 'selector', 'cropper'].map(window);
  f.helper.getMainWindow = () => windows[0]; f.helper.getLauncherWindow = () => windows[0]; f.helper.getOverlayWindow = () => windows[1];
  f.helper.getSettingsWindow = () => windows[2]; f.helper.getWindow = () => windows[3]; f.state.cropperWindowHelper.getWindow = () => windows[4];
  assert.equal(f.state.setDisguise('activity').success, true);
  for (const name of ['launcher', 'overlay', 'settings', 'selector', 'cropper']) {
    assert.ok(identities.some(([kind, action, value]) => kind === name && action === 'icon' && value.endsWith('/assets/fakeicon/win/activity.png')));
    assert.ok(identities.some(([kind, action, value]) => kind === name && action === 'title' && value === 'Task Manager'));
  }
});
