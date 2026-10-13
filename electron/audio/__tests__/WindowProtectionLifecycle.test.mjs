import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import { EventEmitter } from 'node:events';

const root = path.resolve(import.meta.dirname, '../../..');
function fixture({ failCreation = false } = {}) {
  const windows = [], calls = [], timers = [];
  class Window extends EventEmitter {
    constructor(options) { super(); this.fail = failCreation; this.options = options; this.bounds = { x: options.x ?? 0, y: options.y ?? 0, width: options.width, height: options.height }; this.webContents = new EventEmitter(); this.webContents.send = () => {}; this.webContents.setWindowOpenHandler = () => {}; windows.push(this); }
    isDestroyed() { return !!this.destroyed; } isVisible() { return !!this.visible; } isFocused() { return false; }
    show() { this.visible = true; calls.push('show'); } showInactive() { this.visible = true; calls.push('showInactive'); }
    hide() { this.visible = false; calls.push('hide'); } focus() { calls.push('focus'); }
    setContentProtection(value) { calls.push(['protect', value]); if (this.fail) throw Error('native'); }
    getBounds() { return this.bounds; } setBounds(value) { this.bounds = value; }
    getPosition() { return [this.bounds.x, this.bounds.y]; } getSize() { return [this.bounds.width, this.bounds.height]; } getContentSize() { return this.getSize(); }
    setPosition(x, y) { this.bounds = { ...this.bounds, x, y }; } setSize(width, height) { this.bounds = { ...this.bounds, width, height }; }
    loadURL() { return Promise.resolve(); } setParentWindow() {} setVisibleOnAllWorkspaces() {} setHiddenInMissionControl() {}
    setAlwaysOnTop() {} isAlwaysOnTop() { return false; } setIgnoreMouseEvents() { calls.push('ignoreMouse'); } setFocusable() { calls.push('focusable'); }
    setOpacity() {} setIcon() {} setTitle() {} getNativeWindowHandle() { return Buffer.alloc(8); } setMenuBarVisibility() {}
  }
  const display = { bounds: { x: 0, y: 0, width: 1600, height: 900 }, workArea: { x: 0, y: 0, width: 1600, height: 900 }, workAreaSize: { width: 1600, height: 900 } };
  const app = { isPackaged: false, getAppPath: () => '/synthetic', on() {}, removeListener() {} };
  const electron = { app, BrowserWindow: Window, Menu: {}, ipcMain: { on() {}, removeListener() {} },
    screen: { getPrimaryDisplay: () => display, getAllDisplays: () => [display], getDisplayMatching: () => display, getDisplayNearestPoint: () => display, getCursorScreenPoint: () => ({ x: 100, y: 100 }) } };
  function load(name) {
    const module = { exports: {} };
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root, 'electron', `${name}.ts`), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText,
      { module, exports: module.exports, console: { log() {}, warn() {}, error() {} }, Buffer, __dirname: '/synthetic', process: { platform: 'darwin', execPath: '/synthetic', env: {} },
        setTimeout(fn) { timers.push(fn); return timers.length; }, clearTimeout() {},
        require(id) { if (id === 'electron') return electron; if (id === 'node:path') return path;
          if (id === './margin/appIdentity') return { APP_IDENTITY: { name: 'Synthetic' } };
          if (id === './main') return { AppState: {} };
          if (id === './services/KeybindManager') return { KeybindManager: { getInstance: () => ({ setMode() {} }) } };
          if (id === './services/mainStrings') return { mainText: value => value };
          if (id === './audio/nativeModuleLoader') return { loadNativeModule: () => null };
          if (id === './services/StealthKeyboardManager') return { StealthKeyboardManager: { getInstance: () => ({ stop() {}, setOverlayWindow() {} }) } };
          throw Error(`Unexpected import: ${id}`); } });
    return module.exports[name];
  }
  const state = { getDisguiseName: () => 'Terminal', getDisguiseIconPath: () => '/synthetic/terminal.png', getDisguise: () => 'terminal', getOverlayMousePassthrough: () => true, reportProtectionFailure() { calls.push('failed'); }, isQuitting: () => false };
  const Main = load('WindowHelper'), Settings = load('SettingsWindowHelper'), Selector = load('ModelSelectorWindowHelper'), Cropper = load('CropperWindowHelper');
  const main = new Main(state), settings = new Settings(), selector = new Selector(), cropper = new Cropper(state.getDisguiseName, state.reportProtectionFailure, state.getDisguiseIconPath);
  settings.setWindowHelper(main); selector.setWindowHelper(main);
  return { main, settings, selector, cropper, windows, calls };
}

test('AG61: cold and destroyed settings creation preserves inactive activation and current disguise', () => {
  const f = fixture();
  for (let attempt = 0; attempt < 2; attempt++) {
    f.calls.length = 0; f.settings.showWindow(20, 30, { activate: false });
    const window = f.settings.getSettingsWindow();
    assert.equal(window.options.title, 'Terminal'); assert.equal(window.options.icon, '/synthetic/terminal.png');
    assert.equal(f.calls.includes('show'), false); window.emit('ready-to-show');
    assert.ok(f.calls.includes('showInactive')); assert.equal(f.calls.includes('show'), false); assert.equal(f.calls.includes('focus'), false);
    window.destroyed = true;
  }
});

test('AG61: all five window kinds hide on failed protection, report failure and retry the same value', () => {
  const f = fixture(); f.main.createWindow(); f.settings.preloadWindow(); f.selector.preloadWindow(); f.cropper.preload();
  assert.equal(f.windows.length, 5);
  for (const win of f.windows) { assert.equal(win.options.title, 'Terminal'); win.fail = true; }
  for (const helper of [f.main, f.settings, f.selector, f.cropper]) {
    assert.throws(() => helper.setContentProtection(true));
    assert.throws(() => helper.setContentProtection(true));
  }
  assert.equal(f.windows.some(window => window.isVisible()), false); assert.ok(f.calls.includes('failed'));
  assert.throws(() => f.settings.showWindow(1, 1)); assert.throws(() => f.selector.showWindow(1, 1)); assert.throws(() => f.main.switchToOverlay());
  for (const win of f.windows) win.fail = false;
  for (const helper of [f.main, f.settings, f.selector, f.cropper]) assert.doesNotThrow(() => helper.setContentProtection(true));
});

test('AG61: native cropper failure cleans selection state so a retry can be shown', async () => {
  const f = fixture(); f.cropper.preload(); const win = f.cropper.getWindow();
  f.cropper.setContentProtection(true); win.fail = true;
  assert.equal(await f.cropper.showCropper(), null); assert.ok(f.calls.includes('failed'));
  win.fail = false;
  const pending = f.cropper.showCropper();
  win.emit('closed'); assert.equal(await pending, null);
});

test('AG61: passthrough synchronization never constructs, shows or focuses a window', () => {
  const f = fixture(); f.main.syncOverlayInteractionPolicy(); assert.equal(f.windows.length, 0);
  f.main.createWindow(); f.calls.length = 0; f.main.syncOverlayInteractionPolicy();
  assert.deepEqual(f.calls, ['ignoreMouse']); assert.equal(f.windows.length, 2);
});

test('AG61: failed cold native protection does not abandon construction or bypass the ready/show guard', () => {
  const f = fixture({ failCreation: true });
  for (const helper of [f.main, f.settings, f.selector, f.cropper]) helper.setContentProtection(true);
  assert.doesNotThrow(() => f.main.createWindow());
  assert.doesNotThrow(() => f.settings.showWindow(20, 30, { activate: false }));
  assert.doesNotThrow(() => f.selector.showWindow(20, 30, { activate: false }));
  f.cropper.preload(); assert.equal(f.windows.length, 5);
  for (const win of f.windows) win.emit('ready-to-show');
  assert.equal(f.windows.some(win => win.isVisible()), false); assert.ok(f.calls.includes('failed'));
  for (const win of f.windows) win.fail = false;
  for (const helper of [f.main, f.settings, f.selector, f.cropper]) helper.setContentProtection(true);
  f.calls.length = 0;
  for (const helper of [f.main, f.settings, f.selector]) helper.setContentProtection(true);
  assert.equal(f.calls.some(call => Array.isArray(call) && call[0] === 'protect'), false);
  f.settings.showWindow(20, 30, { activate: false }); assert.ok(f.calls.includes('showInactive')); assert.equal(f.calls.includes('focus'), false);
});
