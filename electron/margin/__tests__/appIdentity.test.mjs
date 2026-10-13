import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { makeSandbox, isolatedEnv, readGuardLog, GUARD, REPO } from '../../../scripts/margin/isolation/env.mjs';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const { selectIdentity } = require('../../../scripts/margin/app-identity.cjs');
const identity = selectIdentity();
const ownData = path.join(process.env.MARGIN_ISOLATION_HOME, 'Library/Application Support', identity.name);

function fakeElectron() {
  const paths = { appData: path.join(process.env.MARGIN_ISOLATION_HOME, 'Library/Application Support') };
  const events = [];
  const app = {
    name: 'wrong-before-bootstrap',
    setName(name) { this.name = name; events.push('name'); },
    getName() { return this.name; },
    getPath(key) {
      if (key === 'userData') {
        assert.equal(this.name, identity.name, 'identity precedes every storage path lookup');
        assert.equal(paths.logs, ownData, 'logging precedes every storage path lookup');
        events.push('storage');
      }
      return paths[key];
    },
    setPath(key, value) { paths[key] = value; },
    setAppLogsPath(value) { paths.logs = value; events.push('logs'); },
    setAppUserModelId(value) { this.appId = value; },
    isReady: () => true,
    on() {},
    whenReady: () => Promise.resolve(),
    commandLine: { appendSwitch() {} },
  };
  const electron = {
    app, paths, events,
    safeStorage: {
      isEncryptionAvailable: () => true,
      encryptString: (s) => Buffer.from(`synthetic-encrypted:${s}`),
      decryptString: (b) => b.toString().slice('synthetic-encrypted:'.length),
    },
    systemPreferences: { askForMediaAccess() {}, getMediaAccessStatus: () => 'denied' },
    desktopCapturer: { getSources() {} },
    session: { defaultSession: { webRequest: { onBeforeRequest() {} } } },
  };
  return electron;
}

function load(file, electron, main) {
  const exports = {};
  const module = { exports };
  const code = file.endsWith('.ts')
    ? ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText
    : fs.readFileSync(file, 'utf8');
  vm.runInNewContext(code, {
    exports, module, process, Buffer, console,
    require(id) {
      if (id === 'electron') return electron;
      if (id === './margin/appIdentity') return load(path.join(REPO, 'dist-electron/electron/margin/appIdentity.js'), electron);
      // This harness tests identity/storage order; real logging initialization is
      // covered separately without mutating the node:test runner's console.
      if (id === './logging') return { installMainLogging: () => () => {} };
      if (id === './services/outbound') {
        assert.equal(electron.app.name, identity.name, 'identity precedes outbound dependency evaluation');
        assert.equal(electron.paths.logs, ownData, 'identity log path precedes outbound dependency evaluation');
        electron.events.push('outbound-import');
        return { installOutboundFetchPolicy() { electron.events.push('outbound-policy'); } };
      }
      if (id === './services/navigationPolicy') {
        assert.equal(electron.app.name, identity.name, 'identity precedes the navigation policy');
        return { installNavigationPolicy() { electron.events.push('navigation-policy'); } };
      }
      if (id === './main') return main();
      return require(id);
    },
  }, { filename: file });
  return module.exports;
}

test('build selection defaults to temp and rejects release outside CI', () => {
  assert.equal(selectIdentity({}).name, 'temp');
  assert.throws(() => selectIdentity({ MARGIN_APP_VARIANT: 'release' }), /GitHub Actions/);
  assert.throws(() => selectIdentity({ MARGIN_APP_VARIANT: 'invalid' }), /Unknown/);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(REPO, 'dist-electron/app-identity.json'))), identity);
  const build = require('../../../electron-builder.config.cjs');
  assert.equal(build.productName, identity.name);
  assert.equal(build.appId, identity.appId);
  assert.equal(build.mac.extendInfo.CFBundleName, identity.name);
  assert.equal(build.mac.extendInfo.CFBundleDisplayName, identity.name);
  assert.equal(require('../../../package.json').main, 'dist-electron/electron/bootstrap.js');
});

test('guard first-launch preflight uses the built identity before path setup', () => {
  const electron = fakeElectron();
  require(GUARD).installChromiumGuard(electron);
  assert.equal(electron.app.getName(), identity.name);
  assert.equal(electron.paths.appData, path.dirname(ownData));
  assert.equal(electron.paths.userData, ownData);
  assert.equal(electron.paths.sessionData, ownData);
  assert.equal(electron.paths.logs, ownData);
});

test('bootstrap precedes real credentials/storage imports and settings survive a restart', () => {
  const boot = () => {
    const electron = fakeElectron();
    let storage;
    load(path.join(REPO, 'electron/bootstrap.ts'), electron, () => {
      assert.ok(electron.events.includes('outbound-policy'), 'fetch policy is installed before main/storage imports');
      assert.ok(electron.events.includes('navigation-policy'), 'navigation policy is installed before main creates any window');
      const { CredentialsManager } = load(path.join(REPO, 'dist-electron/electron/services/CredentialsManager.js'), electron);
      const { SettingsManager } = load(path.join(REPO, 'dist-electron/electron/services/SettingsManager.js'), electron);
      const credentials = CredentialsManager.getInstance();
      credentials.init();
      storage = { settings: SettingsManager.getInstance(), credentials };
    });
    assert.equal(electron.app.name, identity.name);
    assert.equal(electron.app.appId, identity.appId);
    assert.equal(electron.paths.userData, ownData);
    assert.equal(electron.paths.logs, ownData);
    assert.ok(electron.events.indexOf('logs') < electron.events.indexOf('storage'));
    assert.ok(electron.events.indexOf('logs') < electron.events.indexOf('outbound-import'));
    assert.ok(electron.events.indexOf('outbound-import') < electron.events.indexOf('outbound-policy'));
    return { ...storage, electron };
  };
  const first = boot();
  first.settings.set('verboseLogging', true);
  first.credentials.setOpenaiApiKey('identity-check-synthetic-key');
  assert.ok(fs.existsSync(path.join(ownData, 'settings.json')));
  assert.ok(fs.existsSync(path.join(ownData, 'credentials.enc')));
  fs.appendFileSync(path.join(first.electron.paths.logs, 'debug.log'), 'synthetic identity log\n');
  const restarted = boot();
  assert.equal(restarted.settings.get('verboseLogging'), true);
  assert.equal(restarted.credentials.getOpenaiApiKey(), 'identity-check-synthetic-key');
  assert.match(fs.readFileSync(path.join(ownData, 'debug.log'), 'utf8'), /synthetic identity log/);
});

test('synthetic protected directories reject reads, writes, alternate APIs and symlink aliases', () => {
  const sandbox = makeSandbox('identity-access');
  const other = identity.variant === 'release' ? 'temp' : 'Margin';
  const protectedFile = path.join(sandbox.home, 'Library/Application Support', other, 'identity-sentinel');
  const canonicalProtectedFile = fs.realpathSync(protectedFile);
  const alias = path.join(sandbox.work, 'alias');
  fs.symlinkSync(path.dirname(protectedFile), alias);
  const script = `
    const fs = require('node:fs'), assert = require('node:assert/strict');
    const file = ${JSON.stringify(protectedFile)}, alias = ${JSON.stringify(path.join(alias, 'identity-sentinel'))};
    const operations = [
      () => fs.readFileSync(file), () => fs.readFile(file, () => {}),
      () => fs.openSync(file, 'r'), () => fs.createReadStream(file),
      () => fs.writeFileSync(file, 'bad'), () => fs.renameSync(${JSON.stringify(path.join(sandbox.work, 'missing'))}, file),
      () => fs.realpathSync.native(file), () => fs.readFileSync(new URL('file://' + file)),
      () => fs.readFileSync(Buffer.from(file)), () => fs.readFileSync(alias),
      () => fs.readFileSync(file.replace('/${other}/', '/${other.toUpperCase()}/')),
      () => fs.readFileSync(${JSON.stringify(canonicalProtectedFile)}),
      () => fs.symlinkSync('../home/Library/Application Support/${other}', ${JSON.stringify(path.join(sandbox.work, 'link'))}),
    ];
    for (const operation of operations) assert.throws(operation, { code: 'EMARGINISOLATION' });
    (async () => {
      await assert.rejects(fs.promises.readFile(file), { code: 'EMARGINISOLATION' });
      await assert.rejects(fs.promises.open(file, 'r'), { code: 'EMARGINISOLATION' });
    })().catch(() => process.exitCode = 1);
  `;
  const result = spawnSync(process.execPath, ['-e', script], { env: isolatedEnv(sandbox), encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const blocks = readGuardLog(sandbox, { pid: result.pid }).filter((r) => r.kind === 'storage');
  assert.equal(blocks.length, 15);
  assert.ok(blocks.every((r) => r.detail.startsWith(sandbox.root) || r.detail.startsWith(fs.realpathSync(sandbox.root))), 'only synthetic paths were provoked');
  assert.equal(fs.readFileSync(protectedFile, 'utf8'), 'synthetic protected data\n');
});

test('recursive and directory operations refuse parents containing protected data', () => {
  const sandbox = makeSandbox('identity-recursive');
  const parent = path.join(sandbox.home, 'Library/Application Support');
  const other = identity.variant === 'release' ? 'temp' : 'Margin';
  const alias = path.join(sandbox.work, 'parent-alias');
  fs.symlinkSync(parent, alias);
  const copiedSentinel = path.join(sandbox.work, 'copy', other, 'identity-sentinel');
  const script = `
    const fs = require('node:fs'), assert = require('node:assert/strict');
    const parent = ${JSON.stringify(parent)}, copy = ${JSON.stringify(path.join(sandbox.work, 'copy'))};
    let refused = false;
    try { fs.cpSync(parent, copy, { recursive: true }); }
    catch (e) { assert.equal(e.code, 'EMARGINISOLATION'); refused = true; }
    assert.equal(fs.existsSync(${JSON.stringify(copiedSentinel)}), false, 'cpSync must not copy the protected sentinel through its parent');
    assert.equal(refused, true, 'cpSync parent access must be refused');
    let enumerationRefused = false, listed = [];
    try { listed = fs.readdirSync(${JSON.stringify(sandbox.work)}, { recursive: true }); }
    catch (e) { assert.equal(e.code, 'EMARGINISOLATION'); enumerationRefused = true; }
    assert.equal(listed.some((file) => file.endsWith('/${other}/identity-sentinel')), false, 'native recursive enumeration must not follow a buried alias into protected data');
    assert.equal(enumerationRefused, true, 'native recursive enumeration must be refused');
    const operations = [
      () => fs.cp(parent, copy, { recursive: true }, () => {}),
      () => fs.cpSync(${JSON.stringify(alias)}, copy, { recursive: true }),
      () => fs.cpSync(${JSON.stringify(fs.realpathSync(parent))}, copy, { recursive: true }),
      () => fs.cpSync(parent.toUpperCase(), copy, { recursive: true }),
      () => fs.cpSync(${JSON.stringify(sandbox.work)}, parent, { recursive: true }),
      () => fs.cpSync(${JSON.stringify(sandbox.work)}, ${JSON.stringify(path.join(sandbox.tmp, 'dereferenced-copy'))}, { recursive: true, dereference: true }),
      () => fs.rmSync(parent, { recursive: true, force: true }),
      () => fs.rmdirSync(parent, { recursive: true }),
      () => fs.renameSync(parent, copy),
      () => fs.readdirSync(parent, { recursive: true }),
      () => fs.opendirSync(parent, { recursive: true }),
      () => fs.watch(parent, { recursive: true }),
      () => fs.globSync('**/*', { cwd: parent }),
      () => fs.globSync(parent + '/**/*'),
      () => fs.globSync(${JSON.stringify(alias)} + '/**/*'),
      () => fs.glob('**/*', { cwd: parent }, () => {}),
      () => fs.globSync('*', { cwd: ${JSON.stringify(sandbox.work)} }),
    ];
    for (const operation of operations) assert.throws(operation, { code: 'EMARGINISOLATION' });
    assert.ok(fs.statSync(parent).isDirectory(), 'ordinary appData stat remains usable');
    fs.mkdirSync(parent, { recursive: true });
    assert.ok(fs.readdirSync(parent).includes('${other}'), 'ordinary appData enumeration remains usable');
    const directory = fs.opendirSync(parent); directory.closeSync();
    (async () => {
      await assert.rejects(fs.promises.cp(parent, copy, { recursive: true }), { code: 'EMARGINISOLATION' });
      await assert.rejects(fs.promises.rm(parent, { recursive: true }), { code: 'EMARGINISOLATION' });
      await assert.rejects(fs.promises.readdir(parent, { recursive: true }), { code: 'EMARGINISOLATION' });
      await assert.rejects(fs.promises.opendir(parent, { recursive: true }), { code: 'EMARGINISOLATION' });
      await assert.rejects(async () => { for await (const file of fs.promises.glob('**/*', { cwd: parent })) {} }, { code: 'EMARGINISOLATION' });
      await assert.rejects(async () => { for await (const event of fs.promises.watch(parent, { recursive: true })) {} }, { code: 'EMARGINISOLATION' });
    })().catch((e) => { console.error(e); process.exitCode = 1; });
  `;
  const result = spawnSync(process.execPath, ['-e', script], { env: isolatedEnv(sandbox), encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.existsSync(copiedSentinel), false);
  assert.equal(fs.readFileSync(path.join(parent, other, 'identity-sentinel'), 'utf8'), 'synthetic protected data\n');
  const blocks = readGuardLog(sandbox, { pid: result.pid }).filter((r) => r.kind === 'storage');
  assert.equal(blocks.length, 25);
});

test('disguise restores the build name and leaves persisted paths in its own directory', () => {
  const source = fs.readFileSync(path.join(REPO, 'electron/main.ts'), 'utf8');
  const ast = ts.createSourceFile('main.ts', source, ts.ScriptTarget.Latest, true);
  const appState = ast.statements.find((s) => ts.isClassDeclaration(s) && s.name?.text === 'AppState');
  const methods = ['_applyDisguise', 'getDisguiseName', 'getDisguiseIconPath', 'preferenceWindows'].map(name => appState.members.find(m => m.name?.getText(ast) === name).getText(ast));
  const code = ts.transpileModule(`class DisguiseCheck { ${methods.join('\n')} } exports.DisguiseCheck = DisguiseCheck;`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText;
  const electron = fakeElectron();
  load(path.join(REPO, 'dist-electron/electron/margin/appIdentity.js'), electron).initializeAppIdentity();
  electron.app.getAppPath = () => REPO;
  const processDouble = { platform: 'win32', env: {}, title: '' };
  const window = { isDestroyed: () => false, setTitle(title) { this.title = title; }, setIcon() {}, webContents: { send() {} } };
  const exports = {};
  vm.runInNewContext(code, {
    exports, APP_IDENTITY: identity, app: electron.app, process: processDouble, path,
    fs: { existsSync: () => true }, nativeImage: { createFromPath: () => ({ isEmpty: () => false }) }, console: { log() {}, warn() {} },
    setTimeout: () => 1, clearTimeout() {},
  });
  const state = new exports.DisguiseCheck();
  Object.assign(state, {
    _disguiseTimers: [], isUndetectable: false, disguiseMode: 'terminal',
    windowHelper: { getMainWindow: () => window, getLauncherWindow: () => window, getOverlayWindow: () => window },
    settingsWindowHelper: { getSettingsWindow: () => window },
    modelSelectorWindowHelper: { getWindow: () => window }, cropperWindowHelper: { getWindow: () => window },
  });
  state._applyDisguise('terminal');
  assert.equal(window.title, 'Command Prompt');
  state.disguiseMode = 'none';
  state._applyDisguise('none');
  assert.equal(electron.app.getName(), identity.name);
  assert.equal(electron.app.appId, identity.appId);
  assert.equal(processDouble.title, identity.name);
  assert.equal(window.title, identity.name);
  assert.equal(electron.paths.userData, ownData);
  assert.equal(electron.paths.logs, ownData);
});
