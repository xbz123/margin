import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';

// AG-73 Windows x64 package checks on synthetic win-unpacked trees. Real packages
// exist only on the Windows runner; these cases pin what its checks accept and refuse.
const require = createRequire(import.meta.url);
const REPO = path.resolve(import.meta.dirname, '../../..');
const { checkPackage, packageTarget, binaryFormat, versionStrings, FORBIDDEN, WINDOWS_REQUIRED } = require('../../../scripts/margin/package-check.cjs');
const { verifyBundle } = require('../../../scripts/margin/license-bundle.cjs');
const asar = require('@electron/asar');
const sha = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const MACHINES = { x64: 0x8664, ia32: 0x14c, arm64: 0xaa64 };

// One VS_VERSIONINFO node: header, NUL-terminated UTF-16 key, value and children,
// each starting on a 32-bit boundary of the block.
function versionNode(key, type, value, children = []) {
  const pad = (parts) => { const length = parts.reduce((n, b) => n + b.length, 0); return length % 4 ? [...parts, Buffer.alloc(4 - (length % 4))] : parts; };
  let parts = pad([Buffer.alloc(6), Buffer.from(`${key}\0`, 'utf16le')]);
  parts.push(value);
  for (const child of children) { parts = pad(parts); parts.push(child); }
  const node = Buffer.concat(parts);
  node.writeUInt16LE(node.length, 0);
  node.writeUInt16LE(type === 1 ? value.length / 2 : value.length, 2);
  node.writeUInt16LE(type, 4);
  return node;
}

function versionBlock(strings) {
  const fixed = Buffer.alloc(52);
  fixed.writeUInt32LE(0xfeef04bd, 0);
  const text = (value) => Buffer.from(`${value}\0`, 'utf16le');
  return versionNode('VS_VERSION_INFO', 0, fixed, [
    versionNode('StringFileInfo', 1, Buffer.alloc(0), [
      versionNode('040904b0', 1, Buffer.alloc(0), Object.entries(strings).map(([key, value]) => versionNode(key, 1, text(value)))),
    ]),
    versionNode('VarFileInfo', 1, Buffer.alloc(0), [versionNode('Translation', 0, Buffer.from([0x09, 0x04, 0xb0, 0x04]))]),
  ]);
}

// A minimal PE32+ file: DOS header, COFF header for `machine`, one .rsrc section
// holding a version resource (type 16, name 1, language 0x409) when `strings` is given.
function peFile(machine = 'x64', strings = null) {
  const rva = 0x1000;
  const raw = 0x200;
  let rsrc = Buffer.alloc(0);
  if (strings) {
    const block = versionBlock(strings);
    rsrc = Buffer.alloc(0x58 + block.length);
    const directory = (at, id, target) => { rsrc.writeUInt16LE(1, at + 14); rsrc.writeUInt32LE(id, at + 16); rsrc.writeUInt32LE(target, at + 20); };
    directory(0x00, 16, 0x80000000 + 0x18);
    directory(0x18, 1, 0x80000000 + 0x30);
    directory(0x30, 0x409, 0x48);
    rsrc.writeUInt32LE(rva + 0x58, 0x48);
    rsrc.writeUInt32LE(block.length, 0x4c);
    block.copy(rsrc, 0x58);
  }
  const file = Buffer.alloc(raw + rsrc.length);
  file.write('MZ', 0, 'latin1');
  file.writeUInt32LE(0x40, 0x3c);
  file.writeUInt32LE(0x4550, 0x40);
  file.writeUInt16LE(MACHINES[machine] ?? machine, 0x44);
  file.writeUInt16LE(1, 0x46);
  file.writeUInt16LE(240, 0x54);
  const optional = 0x58;
  file.writeUInt16LE(0x20b, optional);
  if (strings) { file.writeUInt32LE(rva, optional + 112 + 16); file.writeUInt32LE(rsrc.length, optional + 112 + 20); }
  const section = optional + 240;
  file.write('.rsrc', section, 'latin1');
  file.writeUInt32LE(rsrc.length, section + 8);
  file.writeUInt32LE(rva, section + 12);
  file.writeUInt32LE(rsrc.length, section + 16);
  file.writeUInt32LE(raw, section + 20);
  rsrc.copy(file, raw);
  return file;
}

function write(root, file, value) {
  const destination = path.join(root, file);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value, null, 2) + '\n');
  return destination;
}

// Synthetic source tree for verifyBundle: one notice text and the two Electron
// notices, whose Chromium notice differs between the macOS and Windows targets.
const NOTICES = { 'electron/LICENSE': 'Synthetic Electron LICENSE\n', mac: 'Synthetic macOS Chromium notices\n', win: 'Synthetic Windows Chromium notices\n' };
function sourceTree(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'margin-win-source-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  write(root, 'package.json', { license: 'AGPL-3.0-only' });
  const lock = write(root, 'package-lock.json', { packages: { '': { license: 'AGPL-3.0-only' } } });
  const cargo = write(root, 'native-module/Cargo.lock', 'version = 4\n');
  write(root, 'node_modules/electron/package.json', { version: '99.0.0' });
  write(root, 'LICENSE', 'Synthetic application LICENSE\n');
  write(root, 'NOTICE', 'Synthetic application NOTICE\n');
  const text = 'Synthetic component notice\n';
  write(root, `licenses/texts/${sha(text)}.txt`, text);
  const license = sha(NOTICES['electron/LICENSE']);
  write(root, 'licenses/manifest.json', {
    schemaVersion: 1, packageLockSHA256: sha(fs.readFileSync(lock)), cargoLockSHA256: sha(fs.readFileSync(cargo)), sourceConfigSHA256: null,
    electronVersion: '99.0.0', components: [{ id: 'npm:synthetic', texts: [{ file: `texts/${sha(text)}.txt`, sha256: sha(text) }] }],
    attachments: [], excluded: [], unresolved: [],
    deferred: [
      { file: 'electron/LICENSE', sha256: license, targets: { 'darwin-arm64': license, 'win32-x64': license } },
      { file: 'electron/LICENSES.chromium.html', sha256: sha(NOTICES.mac), targets: { 'darwin-arm64': sha(NOTICES.mac), 'win32-x64': sha(NOTICES.win) } },
    ],
  });
  return root;
}

const IDENTITY = { variant: 'temp', name: 'temp', appId: 'io.github.xbz123.temp' };

// A win-unpacked tree that passes every Windows check; `change` edits the staged
// tree before app.asar is written.
async function winApp(t, sourceRoot, change = () => {}) {
  const app = fs.mkdtempSync(path.join(os.tmpdir(), 'margin-win-unpacked-'));
  t.after(() => fs.rmSync(app, { recursive: true, force: true }));
  const resources = path.join(app, 'resources');
  const archive = path.join(app, 'asar-input');
  write(app, `${IDENTITY.name}.exe`, peFile('x64', { ProductName: IDENTITY.name, FileDescription: IDENTITY.name, InternalName: IDENTITY.name }));
  write(app, 'ffmpeg.dll', peFile('x64'));
  write(app, 'LICENSES.chromium.html', NOTICES.win);
  // electron-builder.config.cjs gives a Windows package the identity's own package name.
  write(archive, 'package.json', { name: IDENTITY.name, main: 'dist-electron/electron/bootstrap.js' });
  write(archive, 'dist-electron/app-identity.json', IDENTITY);
  for (const file of WINDOWS_REQUIRED) write(resources, file, file.endsWith('.node') ? peFile('x64') : 'synthetic resource');
  for (const file of ['LICENSE', 'NOTICE']) fs.copyFileSync(path.join(sourceRoot, file), path.join(resources, file));
  fs.cpSync(path.join(sourceRoot, 'licenses'), path.join(resources, 'licenses'), { recursive: true });
  write(resources, 'licenses/electron/LICENSE', NOTICES['electron/LICENSE']);
  write(resources, 'licenses/electron/LICENSES.chromium.html', NOTICES.win);
  change({ app, resources, archive });
  if (fs.existsSync(archive)) {
    await asar.createPackage(archive, path.join(resources, 'app.asar'));
    fs.rmSync(archive, { recursive: true, force: true });
  }
  return app;
}

const failed = (report) => report.checks.filter((check) => !check.passed).map((check) => check.id);

test('Windows packaging is x64 on GitHub Actions only, never with the undecided local identity', () => {
  const ci = { CI: 'true', GITHUB_ACTIONS: 'true' };
  const identity = (variant) => ({ variant, name: variant === 'release' ? 'Margin' : variant, appId: `synthetic.${variant}` });
  const win = packageTarget({ platform: 'win32', arch: 'x64', identity: identity('temp'), env: ci });
  assert.equal(win.id, 'win32-x64');
  assert.deepEqual(win.builderArgs, ['--win', 'nsis', '--x64']);
  assert.equal(win.app(path.join('out', 'builder')), path.join('out', 'builder', 'win-unpacked'));
  assert.equal(win.installer(path.join('out', 'builder'), '2.7.0'), path.join('out', 'builder', 'temp-Setup-2.7.0.exe'));
  assert.equal(packageTarget({ platform: 'win32', arch: 'x64', identity: identity('release'), env: ci }).id, 'win32-x64');
  for (const refused of [
    { platform: 'win32', arch: 'x64', identity: identity('local'), env: ci },
    { platform: 'win32', arch: 'x64', identity: identity('temp'), env: {} },
    { platform: 'win32', arch: 'x64', identity: identity('temp'), env: { CI: 'true' } },
    { platform: 'win32', arch: 'ia32', identity: identity('temp'), env: ci },
    { platform: 'win32', arch: 'arm64', identity: identity('temp'), env: ci },
    { platform: 'darwin', arch: 'x64', identity: identity('temp'), env: ci },
    { platform: 'darwin', arch: 'arm64', identity: identity('temp'), env: {} },
    { platform: 'linux', arch: 'x64', identity: identity('temp'), env: ci },
  ]) assert.throws(() => packageTarget(refused), /Packaging requires GitHub Actions/, JSON.stringify(refused));
  // The macOS rules are unchanged: CI for any identity, locally only the local identity.
  const mac = packageTarget({ platform: 'darwin', arch: 'arm64', identity: identity('local'), env: {} });
  assert.deepEqual([mac.id, mac.builderArgs, mac.installer], ['darwin-arm64', ['--dir', '--mac', '--arm64'], undefined]);
  assert.equal(mac.app('builder'), path.join('builder', 'mac-arm64', 'local.app'));
  assert.equal(packageTarget({ platform: 'darwin', arch: 'arm64', identity: identity('release'), env: ci }).id, 'darwin-arm64');
});

test('binary formats: PE machine, Mach-O and ELF are told apart; other files are not binaries', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'margin-pe-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const cases = {
    'x64.node': [peFile('x64'), { format: 'pe', machine: 'x64' }],
    'ia32.node': [peFile('ia32'), { format: 'pe', machine: 'ia32' }],
    'arm64.dll': [peFile('arm64'), { format: 'pe', machine: 'arm64' }],
    'unknown.dll': [peFile(0x1c4), { format: 'pe', machine: '0x1c4' }],
    'mac.node': [Buffer.from('cffaedfe0c000001', 'hex'), { format: 'mach-o' }],
    'linux.node': [Buffer.from('7f454c4602010100', 'hex'), { format: 'elf' }],
    'dos-only.exe': [Buffer.concat([Buffer.from('MZ'), Buffer.alloc(62)]), null],
    'notes.txt': [Buffer.from('MZ is a text file here, not a program header at all.............'), null],
    'empty.bin': [Buffer.alloc(0), null],
  };
  for (const [name, [bytes, expected]] of Object.entries(cases)) assert.deepEqual(binaryFormat(write(dir, name, bytes)), expected, name);
});

test('version resource strings are read from the PE resource directory', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'margin-pe-version-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const strings = { CompanyName: 'Synthetic', FileDescription: 'temp', ProductName: 'temp', InternalName: 'temp', OriginalFilename: '' };
  assert.deepEqual(versionStrings(write(dir, 'app.exe', peFile('x64', strings))), strings);
  assert.deepEqual(versionStrings(write(dir, 'odd.exe', peFile('x64', { ProductName: 'Natively Local' }))), { ProductName: 'Natively Local' });
  assert.deepEqual(versionStrings(write(dir, 'bare.exe', peFile('x64'))), {});
});

test('a complete synthetic win-unpacked tree passes every Windows check', async (t) => {
  const sourceRoot = sourceTree(t);
  const report = checkPackage(await winApp(t, sourceRoot), IDENTITY, { sourceRoot });
  assert.deepEqual(failed(report), []);
  assert.equal(report.passed, true);
  assert.deepEqual(report.checks.map((check) => check.id), [
    'executable-name', 'version-info:ProductName', 'version-info:FileDescription', 'version-info:InternalName',
    'no-update-config', 'publish-null', 'built-identity', 'forbidden-content', 'package-name', 'native-x64', 'required-files', 'required-native-x64', 'license-files',
  ]);
  assert.equal(report.checks.find((check) => check.id === 'license-files').detail.target, 'win32-x64');
  assert.deepEqual(report.native.map((item) => item.machine), Array(5).fill('x64'));
});

test('missing natives, wrong PE architecture, foreign binaries, notices and resources fail', async (t) => {
  const sourceRoot = sourceTree(t);
  const nativeModule = 'app.asar.unpacked/native-module/index.win32-x64-msvc.node';
  const keytar = 'app.asar.unpacked/node_modules/keytar/build/Release/keytar.node';
  const cases = [
    ['missing native module', ({ resources }) => fs.rmSync(path.join(resources, nativeModule)), ['required-files']],
    ['missing keytar', ({ resources }) => fs.rmSync(path.join(resources, 'app.asar.unpacked/node_modules/keytar/build/Release/keytar.node')), ['required-files']],
    ['ia32 native module', ({ resources }) => write(resources, nativeModule, peFile('ia32')), ['native-x64', 'required-native-x64']],
    ['arm64 sqlite binding', ({ resources }) => write(resources, 'app.asar.unpacked/node_modules/better-sqlite3/build/Release/better_sqlite3.node', peFile('arm64')), ['native-x64', 'required-native-x64']],
    // A present but unusable binding is not a PE at all, so only the required-binding check sees it.
    ['empty keytar binding', ({ resources }) => write(resources, keytar, Buffer.alloc(0)), ['required-native-x64']],
    ['text keytar binding', ({ resources }) => write(resources, keytar, 'not a PE library'), ['required-native-x64']],
    ['damaged PE signature in the native module', ({ resources }) => { const bytes = peFile('x64'); bytes.write('XX', 0x40, 'latin1'); write(resources, nativeModule, bytes); }, ['required-native-x64']],
    ['ia32 executable', ({ app }) => write(app, 'temp.exe', peFile('ia32', { ProductName: 'temp', FileDescription: 'temp', InternalName: 'temp' })), ['native-x64']],
    ['macOS module in the package', ({ resources }) => write(resources, 'app.asar.unpacked/native-module/index.darwin-arm64.node', Buffer.from('cffaedfe0c000001', 'hex')), ['native-x64']],
    ['missing Chromium notice', ({ resources }) => fs.rmSync(path.join(resources, 'licenses/electron/LICENSES.chromium.html')), ['license-files']],
    ['macOS Chromium notice in a Windows package', ({ resources }) => write(resources, 'licenses/electron/LICENSES.chromium.html', NOTICES.mac), ['license-files']],
    ['missing NOTICE', ({ resources }) => fs.rmSync(path.join(resources, 'NOTICE')), ['license-files']],
    ['missing disguise icon', ({ resources }) => fs.rmSync(path.join(resources, 'assets/fakeicon/win/settings.png')), ['required-files']],
    ['missing tray icon', ({ resources }) => fs.rmSync(path.join(resources, 'assets/icons/png/icon_16x16.png')), ['required-files']],
    ['unedited Electron version strings', ({ app }) => write(app, 'temp.exe', peFile('x64', { ProductName: 'Electron', FileDescription: 'Electron', InternalName: 'temp' })), ['version-info:ProductName', 'version-info:FileDescription']],
    ['executable named for another identity', ({ app }) => fs.renameSync(path.join(app, 'temp.exe'), path.join(app, 'Margin.exe')), ['executable-name', 'version-info:ProductName', 'version-info:FileDescription', 'version-info:InternalName']],
    ['another built identity', ({ archive }) => write(archive, 'dist-electron/app-identity.json', { variant: 'release', name: 'Margin', appId: 'io.github.xbz123.margin' }), ['built-identity']],
    ['update configuration', ({ resources }) => write(resources, 'app-update.yml', 'provider: generic\n'), ['no-update-config']],
    ['publish configuration', ({ archive }) => write(archive, 'package.json', { name: IDENTITY.name, build: { publish: [{ provider: 'github' }] } }), ['publish-null']],
    ['repository package name', ({ archive }) => write(archive, 'package.json', { name: 'natively' }), ['package-name']],
    ['shipped model', ({ resources }) => write(resources, 'models/synthetic.bin', 'synthetic'), ['forbidden-content']],
  ];
  for (const [name, change, expected] of cases) {
    const report = checkPackage(await winApp(t, sourceRoot, change), IDENTITY, { sourceRoot });
    assert.equal(report.passed, false, name);
    assert.deepEqual(failed(report), expected, name);
  }
  const noArchive = checkPackage(await winApp(t, sourceRoot, ({ archive }) => fs.rmSync(archive, { recursive: true })), IDENTITY, { sourceRoot });
  assert.deepEqual([noArchive.passed, failed(noArchive)], [false, ['app-archive']]);
});

test('Electron notices are verified against the digest of the package target', async (t) => {
  const sourceRoot = sourceTree(t);
  const resources = path.join(await winApp(t, sourceRoot), 'resources');
  assert.equal(verifyBundle(resources, sourceRoot, 'win32-x64').target, 'win32-x64');
  assert.throws(() => verifyBundle(resources, sourceRoot, 'darwin-arm64'), /missing\/changed notice: electron\/LICENSES\.chromium\.html/);
  assert.throws(() => verifyBundle(resources, sourceRoot, 'win32-ia32'), /no win32-ia32 digest for notice: electron\/LICENSE/);
  write(resources, 'licenses/electron/LICENSES.chromium.html', NOTICES.mac);
  assert.equal(verifyBundle(resources, sourceRoot, 'darwin-arm64').target, 'darwin-arm64');
});

test('Windows resource paths are matched by the same forbidden-content rules', () => {
  const forbidden = (entry) => FORBIDDEN.some((re) => re.test(entry));
  for (const entry of ['resources/models/silero_vad.onnx', 'resources/app.asar/resources/models/x.bin', 'resources/app.asar.unpacked/node_modules/sharp/build/Release/sharp-win32-x64.node']) {
    assert.equal(forbidden(entry), true, entry);
  }
  assert.equal(forbidden('resources/app.asar/node_modules/@anthropic-ai/sdk/resources/models.js'), false);
});

test('the Windows target is NSIS x64 per user, keeps app data and derives its upgrade key from the identity', () => {
  const pkg = require('../../../package.json');
  assert.deepEqual(pkg.build.win.target, [{ target: 'nsis', arch: ['x64'] }]);
  const nsis = pkg.build.nsis;
  assert.equal(nsis.oneClick, false);
  assert.equal(nsis.perMachine, false);
  assert.equal(nsis.deleteAppDataOnUninstall, false);
  for (const key of ['guid', 'include', 'script', 'installerHeader']) assert.equal(Object.hasOwn(nsis, key), false, key);
  for (const key of ['certificateFile', 'certificateSubjectName', 'signtoolOptions', 'azureSignOptions']) assert.equal(Object.hasOwn(pkg.build.win, key), false, key);
  // electron-builder names the uninstall/upgrade registry key with a UUID v5 of the
  // appId unless nsis.guid is set (app-builder-lib NsisTarget). Each identity, and the
  // upstream Natively baseline appId, therefore gets a separate install and data directory.
  const nsisTarget = fs.readFileSync(path.join(REPO, 'node_modules/app-builder-lib/out/targets/nsis/NsisTarget.js'), 'utf8');
  assert.match(nsisTarget, /UUID\.parse\("50e065bc-3134-11e6-9bab-38c9862bdaf3"\)/);
  assert.match(nsisTarget, /options\.guid \|\| builder_util_runtime_1\.UUID\.v5\(appInfo\.id, ELECTRON_BUILDER_NS_UUID\)/);
  const { UUID } = require('builder-util-runtime');
  const namespace = UUID.parse('50e065bc-3134-11e6-9bab-38c9862bdaf3');
  const appIds = ['io.github.xbz123.temp', 'local.natively.desktop', 'io.github.xbz123.margin', 'com.electron.meeting-notes'];
  assert.equal(new Set(appIds.map((id) => UUID.v5(id, namespace))).size, appIds.length);
});

// Builds the real electron-builder.config.cjs for `variant` as a Windows host would
// load it, then reads every directory electron-builder's NSIS template touches for
// that package: --delete-app-data removes $APPDATA\{APP_FILENAME, APP_PRODUCT_FILENAME,
// APP_PACKAGE_NAME} and the installer copies itself to $LOCALAPPDATA\<updater cache>.
async function nsisDirectories(variant, platform) {
  const file = path.join(REPO, 'electron-builder.config.cjs');
  const saved = { variant: process.env.MARGIN_APP_VARIANT, platform: Object.getOwnPropertyDescriptor(process, 'platform') };
  let config;
  try {
    process.env.MARGIN_APP_VARIANT = variant;
    Object.defineProperty(process, 'platform', { ...saved.platform, value: platform });
    delete require.cache[file];
    config = require(file);
  } finally {
    Object.defineProperty(process, 'platform', saved.platform);
    if (saved.variant === undefined) delete process.env.MARGIN_APP_VARIANT;
    else process.env.MARGIN_APP_VARIANT = saved.variant;
    delete require.cache[file];
  }
  const { Packager, AppInfo } = require('app-builder-lib');
  const { getWindowsInstallationDirName, getWindowsInstallationAppPackageName } = require('app-builder-lib/out/targets/targetUtil');
  const packager = new Packager({ projectDir: REPO, config });
  await packager.validateConfig();
  const appInfo = new AppInfo(packager, null);
  const nsis = packager.config.nsis;
  const appFilename = getWindowsInstallationDirName(appInfo, nsis.oneClick === false || nsis.perMachine === true);
  const appData = [appFilename, ...(appFilename !== appInfo.productFilename ? [appInfo.productFilename] : []), getWindowsInstallationAppPackageName(appInfo.name)];
  return { name: appInfo.name, appData, localAppData: [appInfo.updaterCacheDirName] };
}

test('NSIS --delete-app-data and the installer cache touch only directories of the package identity', async () => {
  // The template and define lines whose names are computed above.
  const template = fs.readFileSync(path.join(REPO, 'node_modules/app-builder-lib/templates/nsis/uninstaller.nsh'), 'utf8');
  assert.deepEqual(template.match(/RMDir \/r "\$APPDATA\\\$\{[A-Z_]+\}"/g), ['RMDir /r "$APPDATA\\${APP_FILENAME}"', 'RMDir /r "$APPDATA\\${APP_PRODUCT_FILENAME}"', 'RMDir /r "$APPDATA\\${APP_PACKAGE_NAME}"']);
  const nsisTarget = fs.readFileSync(path.join(REPO, 'node_modules/app-builder-lib/out/targets/nsis/NsisTarget.js'), 'utf8');
  for (const line of ['APP_FILENAME: (0, targetUtil_1.getWindowsInstallationDirName)(appInfo, !oneClick || isPerMachine),',
    'APP_PACKAGE_NAME: (0, targetUtil_1.getWindowsInstallationAppPackageName)(appInfo.name),',
    'if (defines.APP_FILENAME !== appInfo.productFilename) {',
    'defines.APP_INSTALLER_STORE_FILE = `${appInfo.updaterCacheDirName}\\\\${builder_util_runtime_1.CURRENT_APP_INSTALLER_FILE_NAME}`;']) {
    assert.ok(nsisTarget.includes(line), line);
  }
  // Synthetic %APPDATA% / %LOCALAPPDATA% entries of the old app and the other identities.
  const existing = ['Natively', 'natively', 'NATIVELY', 'Natively Local', 'natively-local', 'temp', 'Margin', 'margin', 'natively-updater', 'temp-updater', 'margin-updater'];
  const touched = (names) => existing.filter((entry) => names.some((name) => name.toLowerCase() === entry.toLowerCase()));
  for (const [variant, own] of [['temp', 'temp'], ['local', 'Natively Local']]) {
    const windows = await nsisDirectories(variant, 'win32');
    assert.equal(windows.name, own, variant);
    assert.deepEqual([...new Set(windows.appData.map((name) => name.toLowerCase()))], [own.toLowerCase()], variant);
    assert.deepEqual(touched(windows.appData), existing.filter((entry) => entry.toLowerCase() === own.toLowerCase()), variant);
    assert.equal(touched(windows.localAppData).some((entry) => entry.toLowerCase().startsWith('natively-updater')), false, variant);
  }
  // macOS keeps the repository package name; only the Windows build changes it.
  assert.equal((await nsisDirectories('temp', 'darwin')).name, 'natively');
});
