'use strict';

// AG-25 package checks (PLAN §5 phase 2 exit item 6), with the Windows x64 layout
// since AG-73. The same checks run on CI right after packaging and locally on the
// downloaded artifact. Read-only: the app is inspected, never launched here.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const MACHO = new Set(['feedface', 'cefaedfe', 'feedfacf', 'cffaedfe', 'cafebabe', 'bebafeca']);
// Retired or removed content that must not reach the package (PLAN §5 G3 and S21).
// Models are matched where upstream shipped them (extraResources resources/models
// to Resources/models, or resources/models on Windows) or the app's own
// resources/models, not any SDK path such as @elevenlabs/elevenlabs-js/api/resources/models.
const FORBIDDEN = [
  /^[Rr]esources\/(app\.asar(\.unpacked)?\/(resources\/)?)?models(\/|$)/,/\.onnx$/i, /(^|\/)onnxruntime[^/]*(\/|$)/i, /(^|\/)sqlite-vec[^/]*(\/|$)/i,
  /(^|\/)premium(\/|$)/i, /(^|\/)natively-api(\/|$)/i, /eng\.traineddata$/i, /\.gguf$/i,
  /(^|\/)@napi-rs\/canvas[^/]*(\/|$)/, /(^|\/)pdf-parse(\/|$)/, /(^|\/)pdfjs-dist(\/|$)/, /(^|\/)mammoth(\/|$)/,
  // S34: images go through Electron's nativeImage; sharp is a development tool only.
  /(^|\/)sharp(\/|$)/, /(^|\/)@img(\/|$)/, /libvips/i,
];
// AG-73: files the Windows app loads from resources/ (nativeModuleLoader.ts,
// better-sqlite3 and keytar bindings; WindowHelper.ts and main.ts icons and tray).
const WINDOWS_REQUIRED = [
  'app.asar.unpacked/native-module/index.win32-x64-msvc.node',
  'app.asar.unpacked/node_modules/better-sqlite3/build/Release/better_sqlite3.node',
  'app.asar.unpacked/node_modules/keytar/build/Release/keytar.node',
  'assets/icons/win/icon.ico', 'assets/icons/png/icon_16x16.png',
  'assets/fakeicon/win/terminal.png', 'assets/fakeicon/win/settings.png', 'assets/fakeicon/win/activity.png',
];
const PE_MACHINES = { 0x8664: 'x64', 0x14c: 'ia32', 0xaa64: 'arm64' };

const run = (cmd, args) => spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 120_000 });
const sha256File = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const isFile = (file) => { try { return fs.lstatSync(file).isFile(); } catch { return false; } };

// Packaging targets (AG-25, AG-73) as build-local.cjs requests them from
// electron-builder. Windows x64 is packaged on GitHub Actions only, and not with the
// local identity: the Windows test identity has not been decided.
function packageTarget({ platform, arch, identity, env }) {
  const ci = env.CI === 'true' && env.GITHUB_ACTIONS === 'true';
  if (platform === 'darwin' && arch === 'arm64' && (ci || identity.variant === 'local')) {
    return { id: 'darwin-arm64', builderArgs: ['--dir', '--mac', '--arm64'], app: (builder) => path.join(builder, 'mac-arm64', `${identity.name}.app`) };
  }
  if (platform === 'win32' && arch === 'x64' && ci && identity.variant !== 'local') {
    return {
      id: 'win32-x64', builderArgs: ['--win', 'nsis', '--x64'], app: (builder) => path.join(builder, 'win-unpacked'),
      installer: (builder, version) => path.join(builder, `${identity.name}-Setup-${version}.exe`),
    };
  }
  throw new Error('Packaging requires GitHub Actions or the local test identity on macOS arm64, or GitHub Actions with the temp or release identity on Windows x64');
}

function walk(root) {
  const files = [];
  (function visit(dir) {
    for (const item of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const file = path.join(dir, item.name);
      if (item.isSymbolicLink()) files.push({ file, link: true });
      else if (item.isDirectory()) visit(file);
      else if (item.isFile()) files.push({ file, link: false });
    }
  })(root);
  return files;
}

function isMachO(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const head = Buffer.alloc(4);
    return fs.readSync(fd, head, 0, 4, 0) === 4 && MACHO.has(head.toString('hex'));
  } finally { fs.closeSync(fd); }
}

// Object format from the first bytes: PE with its COFF machine, Mach-O or ELF; null otherwise.
function binaryFormat(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const head = Buffer.alloc(64);
    const read = fs.readSync(fd, head, 0, 64, 0);
    if (read >= 4 && MACHO.has(head.subarray(0, 4).toString('hex'))) return { format: 'mach-o' };
    if (read >= 4 && head.readUInt32BE(0) === 0x7f454c46) return { format: 'elf' };
    if (read < 64 || head.toString('latin1', 0, 2) !== 'MZ') return null;
    const signature = Buffer.alloc(6);
    if (fs.readSync(fd, signature, 0, 6, head.readUInt32LE(0x3c)) !== 6 || signature.readUInt32LE(0) !== 0x4550) return null;
    const machine = signature.readUInt16LE(4);
    return { format: 'pe', machine: PE_MACHINES[machine] ?? `0x${machine.toString(16)}` };
  } finally { fs.closeSync(fd); }
}

// StringFileInfo values of a PE file's RT_VERSION resource: what rcedit writes from
// productName and what Windows shows for the program.
function versionStrings(file) {
  const b = fs.readFileSync(file);
  const pe = b.readUInt32LE(0x3c);
  const sectionCount = b.readUInt16LE(pe + 6);
  const optional = pe + 24;
  const directories = optional + (b.readUInt16LE(optional) === 0x20b ? 112 : 96);
  const table = optional + b.readUInt16LE(pe + 20);
  const offset = (rva) => {
    for (let i = 0; i < sectionCount; i++) {
      const section = table + i * 40;
      const address = b.readUInt32LE(section + 12);
      if (rva >= address && rva < address + Math.max(b.readUInt32LE(section + 8), b.readUInt32LE(section + 16))) return b.readUInt32LE(section + 20) + rva - address;
    }
    throw new Error('resource address outside every section');
  };
  if (b.readUInt32LE(directories + 16) === 0) return {};
  const root = offset(b.readUInt32LE(directories + 16));
  // Type, name and language levels; the version resource is type 16 and its first name and language.
  const child = (directory, id) => {
    const count = b.readUInt16LE(directory + 12) + b.readUInt16LE(directory + 14);
    for (let i = 0; i < count; i++) {
      const entry = directory + 16 + i * 8;
      if (id === undefined || b.readUInt32LE(entry) === id) return b.readUInt32LE(entry + 4);
    }
    return null;
  };
  const type = child(root, 16);
  if (type === null) return {};
  const name = child(root + (type & 0x7fffffff));
  const language = name === null ? null : child(root + (name & 0x7fffffff));
  if (!(type & name & 0x80000000) || language === null || language & 0x80000000) throw new Error('malformed version resource directory');
  const start = offset(b.readUInt32LE(root + language));
  const block = b.subarray(start, start + b.readUInt32LE(root + language + 4));
  // VS_VERSIONINFO > StringFileInfo > StringTable > String, each 32-bit aligned in the block.
  const align = (n) => (n + 3) & ~3;
  const strings = {};
  (function nodes(from, to, depth) {
    for (let at = from; at + 6 <= to;) {
      const length = block.readUInt16LE(at);
      if (length < 6 || at + length > to) break;
      let end = at + 6;
      while (end + 2 <= at + length && block.readUInt16LE(end) !== 0) end += 2;
      const key = block.toString('utf16le', at + 6, end);
      const value = align(end + 2);
      if (depth === 3) strings[key] = block.toString('utf16le', value, at + length).split('\0')[0];
      else nodes(align(value + (block.readUInt16LE(at + 4) === 1 ? 2 : 1) * block.readUInt16LE(at + 2)), at + length, depth + 1);
      at = align(at + length);
    }
  })(0, block.length, 0);
  return strings;
}

function plist(app, key) {
  const result = run('/usr/bin/plutil', ['-extract', key, 'raw', '-o', '-', path.join(app, 'Contents/Info.plist')]);
  return result.status === 0 ? result.stdout.trim() : null;
}

// Checks shared by both layouts: no updater, publish null, the built identity and no
// forbidden content.
function commonChecks(add, { root, resources, prefix, identity }) {
  add('no-update-config', !fs.existsSync(path.join(resources, 'app-update.yml')), 'electron-builder writes app-update.yml only for a publish target');
  const asar = require('@electron/asar');
  const archive = path.join(resources, 'app.asar');
  const asarPaths = asar.listPackage(archive).map((entry) => entry.replace(/^[\\/]/, '').split('\\').join('/'));
  const packaged = JSON.parse(asar.extractFile(archive, 'package.json').toString('utf8'));
  add('publish-null', packaged.build === undefined || packaged.build.publish === null || packaged.build.publish === undefined,
    { packagedBuildPublish: packaged.build?.publish ?? 'absent' });
  // asar looks entries up by host path separators.
  const builtIdentity = JSON.parse(asar.extractFile(archive, path.join('dist-electron', 'app-identity.json')).toString('utf8'));
  add('built-identity', builtIdentity.name === identity.name && builtIdentity.appId === identity.appId, builtIdentity);

  const files = walk(root);
  const relative = (file) => path.relative(root, file).split(path.sep).join('/');
  const everything = [...files.map((item) => relative(item.file)), ...asarPaths.map((entry) => `${prefix}/app.asar/${entry}`)];
  const forbidden = everything.filter((entry) => FORBIDDEN.some((re) => re.test(entry)));
  add('forbidden-content', forbidden.length === 0, { matches: forbidden.slice(0, 50), count: forbidden.length, scanned: everything.length });
  return { files, relative, packaged };
}

// The packaged notices of the target (license-bundle.cjs, also run by afterPack).
function licenseCheck(add, resources, sourceRoot, target) {
  if (!sourceRoot) return;
  try {
    const result = require('./license-bundle.cjs').verifyBundle(resources, sourceRoot, target);
    add('license-files', true, result);
  } catch (error) { add('license-files', false, error.message); }
}

// identity: { name, appId } of the variant this app must carry. app is the .app
// bundle on macOS and the win-unpacked directory on Windows.
function checkPackage(app, identity, { sourceRoot } = {}) {
  return fs.existsSync(path.join(app, 'Contents')) ? checkMacPackage(app, identity, { sourceRoot }) : checkWindowsPackage(app, identity, { sourceRoot });
}

function checkMacPackage(app, identity, { sourceRoot }) {
  const checks = [];
  const add = (id, passed, detail) => checks.push({ id, passed: !!passed, detail });
  const contents = path.join(app, 'Contents');
  const resources = path.join(contents, 'Resources');

  for (const [key, expected] of [['CFBundleName', identity.name], ['CFBundleDisplayName', identity.name], ['CFBundleIdentifier', identity.appId]]) {
    const actual = plist(app, key);
    add(`info-plist:${key}`, actual === expected, { expected, actual });
  }
  add('executable-name', fs.existsSync(path.join(contents, 'MacOS', identity.name)), { expected: `MacOS/${identity.name}` });
  const { files, relative } = commonChecks(add, { root: contents, resources, prefix: 'Resources', identity });

  const native = [];
  for (const item of files) {
    if (item.link || !isMachO(item.file)) continue;
    const archs = run('/usr/bin/lipo', ['-archs', item.file]);
    native.push({ path: relative(item.file), archs: archs.stdout.trim(), sha256: sha256File(item.file) });
  }
  const wrongArch = native.filter((entry) => entry.archs !== 'arm64');
  add('native-arm64', native.length > 0 && wrongArch.length === 0, { count: native.length, wrongArch });

  const verify = run('/usr/bin/codesign', ['--verify', '--deep', '--strict', '--verbose=2', app]);
  add('codesign-verify', verify.status === 0, (verify.stderr || verify.stdout).trim().split('\n').slice(-3));
  const info = run('/usr/bin/codesign', ['-dv', app]);
  add('ad-hoc-signature', /Signature=adhoc/.test(info.stderr), (info.stderr.match(/^(Signature|TeamIdentifier|Identifier)=.*$/gm) ?? []));
  licenseCheck(add, resources, sourceRoot, 'darwin-arm64');
  return { passed: checks.every((check) => check.passed), identity, checks, native };
}

// AG-73: the win-unpacked directory electron-builder builds the NSIS installer from.
// Unsigned: no certificate is used, so there is no signature to check.
function checkWindowsPackage(app, identity, { sourceRoot }) {
  const checks = [];
  const add = (id, passed, detail) => checks.push({ id, passed: !!passed, detail });
  const resources = path.join(app, 'resources');
  const exe = path.join(app, `${identity.name}.exe`);
  add('executable-name', isFile(exe), { expected: `${identity.name}.exe` });
  let strings = {};
  try { if (isFile(exe)) strings = versionStrings(exe); } catch (error) { strings = { error: error.message }; }
  for (const key of ['ProductName', 'FileDescription', 'InternalName']) {
    add(`version-info:${key}`, strings[key] === identity.name, { expected: identity.name, actual: strings[key] ?? strings.error ?? null });
  }
  if (!fs.existsSync(path.join(resources, 'app.asar'))) {
    add('app-archive', false, 'resources/app.asar is missing');
    return { passed: false, identity, checks, native: [] };
  }
  const { files, relative, packaged } = commonChecks(add, { root: app, resources, prefix: 'resources', identity });
  // electron-builder derives the NSIS data directories (--delete-app-data) and the
  // installer cache from this name; electron-builder.config.cjs sets it on Windows.
  add('package-name', packaged.name === identity.name, { expected: identity.name, actual: packaged.name ?? null });

  const native = [];
  const foreign = [];
  for (const item of files) {
    if (item.link) continue;
    const format = binaryFormat(item.file);
    if (format?.format === 'pe') native.push({ path: relative(item.file), machine: format.machine, sha256: sha256File(item.file) });
    else if (format) foreign.push({ path: relative(item.file), format: format.format });
  }
  const wrongArch = native.filter((entry) => entry.machine !== 'x64');
  add('native-x64', native.length > 0 && wrongArch.length === 0 && foreign.length === 0, { count: native.length, wrongArch, foreign });
  const missing = WINDOWS_REQUIRED.filter((file) => !isFile(path.join(resources, file)));
  add('required-files', missing.length === 0, { required: WINDOWS_REQUIRED.length, missing });
  // Each required binding must itself be an x64 PE: an empty, text or damaged file is
  // not counted as native above and would otherwise pass on the other PE files.
  const unusable = WINDOWS_REQUIRED.filter((file) => file.endsWith('.node') && !missing.includes(file))
    .map((file) => ({ path: file, format: binaryFormat(path.join(resources, file)) }))
    .filter((entry) => entry.format?.format !== 'pe' || entry.format.machine !== 'x64');
  add('required-native-x64', unusable.length === 0, { unusable });
  licenseCheck(add, resources, sourceRoot, 'win32-x64');
  return { passed: checks.every((check) => check.passed), identity, checks, native };
}

module.exports = { checkPackage, packageTarget, binaryFormat, versionStrings, FORBIDDEN, WINDOWS_REQUIRED };

if (require.main === module) {
  const [app, name, appId, sourceRoot] = process.argv.slice(2);
  if (!app || !name || !appId) {
    console.error('usage: package-check.cjs <app or win-unpacked> <name> <appId> [sourceRoot]');
    process.exit(2);
  }
  const report = checkPackage(path.resolve(app), { name, appId }, { sourceRoot: sourceRoot && path.resolve(sourceRoot) });
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = report.passed ? 0 : 1;
}
