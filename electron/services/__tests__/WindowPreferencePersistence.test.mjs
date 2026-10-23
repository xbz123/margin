import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';

const root = path.resolve(import.meta.dirname, '../../..');
const plain = value => JSON.parse(JSON.stringify(value));
// SettingsManager joins its file name with the same path module the fixture injects.
const SETTINGS_FILE = path.join('/synthetic', 'settings.json');
function load(relative, imports, globals = {}) {
  const module = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root, relative), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText,
    { module, exports: module.exports, console: { log() {}, warn() {}, error() {} }, process: { platform: 'darwin' },
      setInterval: () => ({ unref() {} }), clearInterval() {}, ...globals,
      require(id) { if (id in imports) return imports[id]; throw Error(`Unexpected import: ${id}`); } });
  return module.exports;
}
function disk(initial = {}) {
  const files = new Map(Object.entries(initial)), writes = []; let failure;
  const boundary = { existsSync: file => files.has(file), readFileSync: file => files.get(file),
    writeFileSync(file, data, options) { writes.push(['write', options]); if (failure === 'write') throw Error('disk'); files.set(file, data); },
    renameSync(from, to) { writes.push(['rename']); if (failure === 'rename') throw Error('disk'); files.set(to, files.get(from)); files.delete(from); },
    unlinkSync: file => files.delete(file) };
  return { files, writes, boundary, fail: value => { failure = value; } };
}
function settingsFixture(storage) {
  return load('electron/services/SettingsManager.ts', { electron: { app: { isReady: () => true, getPath: () => '/synthetic' } }, fs: storage.boundary, path,
    'node:crypto': { randomUUID: () => 'unique' }, '../../src/types/codexSource': { DEFAULT_CODEX_SOURCE_CONFIG: {}, validateCodexSourceConfig: value => value } }).SettingsManager.getInstance();
}
function keysFixture(storage = disk()) {
  const registered = new Set(), calls = [], handlers = new Map(), events = []; let conflict = false;
  const loaded = load('electron/services/KeybindManager.ts', {
    electron: { app: { getPath: () => '/synthetic', name: 'Synthetic' }, globalShortcut: {
      unregisterAll() { calls.push('unregister'); registered.clear(); },
      register(acc) { calls.push(['register', acc]); if (!conflict) registered.add(acc); return !conflict; },
      isRegistered: acc => registered.has(acc) }, Menu: { buildFromTemplate: value => value, setApplicationMenu() {} },
      BrowserWindow: { getAllWindows: () => [{ isDestroyed: () => false, webContents: { send: (...args) => events.push(args) } }] },
      ipcMain: { handle: (channel, fn) => handlers.set(channel, fn) } }, path, fs: storage.boundary, 'node:crypto': { randomUUID: () => 'unique' }, './mainStrings': { mainText: value => value } });
  return { manager: loaded.KeybindManager.getInstance(), defaults: loaded.DEFAULT_KEYBINDS, calls, events, registered, handlers, conflict: value => { conflict = value; } };
}

for (const failure of ['write', 'rename']) test(`AG61: ${failure} failure preserves protection/disguise memory and disk across restart`, () => {
  const initial = JSON.stringify({ isUndetectable: false, disguiseMode: 'terminal', verboseLogging: true });
  const storage = disk({ [SETTINGS_FILE]: initial }); const manager = settingsFixture(storage);
  storage.fail(failure);
  assert.throws(() => manager.saveWindowPreference('isUndetectable', true));
  assert.throws(() => manager.saveWindowPreference('disguiseMode', 'activity'));
  assert.equal(manager.get('isUndetectable'), false); assert.equal(manager.get('disguiseMode'), 'terminal');
  assert.equal(storage.files.get(SETTINGS_FILE), initial); assert.equal(storage.files.size, 1);
  const restarted = settingsFixture(storage); assert.equal(restarted.get('disguiseMode'), 'terminal');
  storage.fail(undefined); manager.saveWindowPreference('disguiseMode', 'activity');
  assert.deepEqual(JSON.parse(storage.files.get(SETTINGS_FILE)), { isUndetectable: false, disguiseMode: 'activity', verboseLogging: true });
  assert.equal(settingsFixture(storage).get('disguiseMode'), 'activity');
  assert.equal(storage.writes.find(write => write[0] === 'write')[1].flag, 'wx');
});

test('AG61: keybind save failure does not replace memory, disk or OS registrations', () => {
  const storage = disk(); const f = keysFixture(storage); f.manager.registerGlobalShortcuts();
  const before = plain(f.manager.getAllKeybinds()), registered = [...f.registered]; f.calls.length = 0;
  for (const failure of ['write', 'rename']) {
    storage.fail(failure); assert.equal(f.manager.setKeybind('general:toggle-visibility', 'Control+Y').code, 'save_failed');
    assert.equal(f.manager.resetKeybinds().code, 'save_failed');
    assert.deepEqual(plain(f.manager.getAllKeybinds()), before); assert.deepEqual([...f.registered], registered); assert.deepEqual(f.calls, []);
    assert.equal(storage.files.size, 0);
  }
});

test('AG61: invalid IDs, values and duplicate modifier aliases have zero write/registration effects', () => {
  const storage = disk(), f = keysFixture(storage);
  for (const [id, value] of [['unknown', 'Control+Y'], ['general:toggle-visibility', false], ['general:toggle-visibility', 'Control+'], ['general:toggle-visibility', 'Cmd+Command+Y'], ['general:toggle-visibility', 'Ctrl+Control+Y'], ['general:toggle-visibility', 'CommandOrControl+Cmd+Y'], ['general:toggle-visibility', 'Option+Alt+Y']]) {
    assert.equal(f.manager.setKeybind(id, value).code, 'invalid_value', `${id}: ${value}`);
  }
  assert.deepEqual(storage.writes, []); assert.deepEqual(f.calls, []);
});

test('AG61: actual recorder conversion accepts shifted punctuation, arrows, space and unbinding', () => {
  const keyboard = load('src/utils/keyboardUtils.ts', { './platformUtils': { isMac: true, getModifierSymbol: key => key } });
  const f = keysFixture();
  for (const key of ['?', '!', '@', '#', '$', '%', '^', '&', '*', '(', ')', '_', '{', '}', ':', '"', '<', '>', '|', '~', 'ArrowUp', 'Space', 'Enter']) {
    const accelerator = keyboard.keysToAccelerator(['⌘', '⇧', key]);
    assert.equal(f.manager.setKeybind('general:toggle-visibility', accelerator).success, true, accelerator);
  }
  assert.equal(f.manager.setKeybind('general:toggle-visibility', '').success, true);
});

test('AG61: conflict swaps, mode registration and all-action failures survive and recover via health revalidation', () => {
  const f = keysFixture();
  const result = f.manager.setKeybind('general:toggle-visibility', 'Ctrl+Shift+H');
  assert.equal(result.success, true);
  f.manager.setKeybind('general:take-screenshot', 'Shift+Control+H');
  assert.equal(f.manager.getKeybind('general:toggle-visibility'), 'CommandOrControl+H');
  assert.equal(f.manager.getKeybind('general:take-screenshot'), 'Shift+Control+H');
  assert.equal(f.registered.has('CommandOrControl+1'), false);
  f.conflict(true); f.manager.setMode('overlay');
  assert.equal(f.manager.getStatus().code, 'apply_failed');
  assert.ok(f.manager.getStatus().failedActions.some(action => action.id === 'chat:whatToAnswer'));
  assert.ok(f.manager.getStatus().failedActions.some(action => action.id === 'general:take-screenshot'));
  f.conflict(false); const recovered = f.manager.revalidateShortcuts();
  assert.equal(recovered.success, true); assert.equal(recovered.failedActions.length, 0);
  f.manager.setupIpcHandlers();
  assert.equal(f.handlers.get('keybinds:set')({}, 'unknown', 'Control+Y').code, 'invalid_value');
  assert.equal(f.handlers.get('keybinds:get-status')().success, true);
});

test('AG61: healthy OS registrations do not clear a failed menu or update application', () => {
  for (const boundary of ['menu', 'update']) {
    const f = keysFixture(); let fail = true;
    const apply = () => { if (fail) throw Error('native application failed'); };
    if (boundary === 'menu') f.manager.updateMenu = apply;
    else f.manager.onUpdate(apply);
    assert.equal(f.manager.setKeybind('general:toggle-visibility', 'Control+Y').code, 'apply_failed');
    assert.equal(f.manager.revalidateShortcuts().code, 'apply_failed');
    fail = false;
    assert.equal(f.manager.setKeybind('general:toggle-visibility', 'Control+Y').success, true);
  }
});

test('AG72: the recorder rejects the Windows key on Windows and keeps macOS and Linux recordings unchanged', () => {
  const recorder = (isMac, isWindows) => load('src/utils/keyboardUtils.ts', { './platformUtils': { isMac, isWindows, getModifierSymbol: key => key } });
  const press = (key, code, mods = {}) => ({ key, code, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...mods });
  const windows = recorder(false, true), mac = recorder(true, false), linux = recorder(false, false);
  for (const event of [press('k', 'KeyK', { metaKey: true, shiftKey: true }), press('k', 'KeyK', { metaKey: true, ctrlKey: true }), press('Meta', 'MetaLeft', { metaKey: true })]) {
    assert.deepEqual(plain(windows.eventToKeys(event)), { rejected: 'windows-key' });
  }
  assert.deepEqual(plain(windows.eventToKeys(press('k', 'KeyK', { ctrlKey: true, shiftKey: true }))), { keys: ['⌃', '⇧', 'K'], complete: true });
  assert.equal(windows.keysToAccelerator(['⌃', '⇧', 'K']), 'CommandOrControl+Shift+K');
  assert.deepEqual(plain(windows.eventToKeys(press('Control', 'ControlLeft', { ctrlKey: true }))), { keys: ['⌃'], complete: false });
  assert.deepEqual(plain(mac.eventToKeys(press('k', 'KeyK', { metaKey: true, shiftKey: true }))), { keys: ['⌘', '⇧', 'K'], complete: true });
  assert.equal(mac.keysToAccelerator(['⌘', '⇧', 'K']), 'CommandOrControl+Shift+K');
  assert.deepEqual(plain(mac.eventToKeys(press('ArrowUp', 'ArrowUp', { metaKey: true, ctrlKey: true, altKey: true }))), { keys: ['⌘', '⌃', '⌥', 'ArrowUp'], complete: true });
  assert.deepEqual(plain(mac.eventToKeys(press(' ', 'Space', { metaKey: true }))), { keys: ['⌘', 'Space'], complete: true });
  assert.deepEqual(plain(mac.eventToKeys(press('1', 'Digit1', { metaKey: true }))), { keys: ['⌘', '1'], complete: true });
  assert.deepEqual(plain(mac.eventToKeys(press('?', 'Slash', { metaKey: true, shiftKey: true }))), { keys: ['⌘', '⇧', '?'], complete: true });
  // Linux keeps its previous recording of the Super key (outside AG-72).
  assert.deepEqual(plain(linux.eventToKeys(press('k', 'KeyK', { metaKey: true }))), { keys: ['⌘', 'K'], complete: true });
});
