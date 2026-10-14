import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import sharp from 'sharp';
import { makeSandbox, isolatedEnv, readBlocked, REPO } from '../../../scripts/margin/isolation/env.mjs';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const manifest = JSON.parse(fs.readFileSync(path.join(REPO, 'scripts/icons/generated-assets.json'), 'utf8'));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const read = file => fs.readFileSync(path.join(REPO, file));
const rasterSizes = {
  'assets/icon.png': 512,
  'assets/iconTemplate.png': 16,
  'assets/iconTemplate@2x.png': 32,
  'src/components/icon.png': 644,
  'src/assets/logo.png': 644,
  'src/assets/logo.webp': 644,
  ...Object.fromEntries([16, 32, 64, 128, 256, 512, 1024].map(size => [`assets/icons/png/icon_${size}x${size}.png`, size])),
};

test('generated inventory, raster dimensions and ICNS/ICO structures are intact', async () => {
  const expected = [...Object.keys(rasterSizes), 'assets/margin.icns', 'assets/icons/win/icon.ico'].sort();
  assert.deepEqual(manifest.artifacts.map(a => a.path).sort(), expected);
  for (const source of manifest.sources) assert.equal(digest(read(source.path)), source.sha256, `source changed without regeneration: ${source.path}`);
  for (const artifact of manifest.artifacts) {
    const bytes = read(artifact.path);
    assert.equal(bytes.length, artifact.bytes, artifact.path);
    assert.equal(digest(bytes), artifact.sha256, artifact.path);
    if (rasterSizes[artifact.path]) {
      const metadata = await sharp(bytes).metadata();
      assert.equal(metadata.width, rasterSizes[artifact.path], artifact.path);
      assert.equal(metadata.height, rasterSizes[artifact.path], artifact.path);
      assert.equal(metadata.hasAlpha, true, artifact.path);
    }
  }
  const icns = read('assets/margin.icns');
  assert.equal(icns.toString('ascii', 0, 4), 'icns');
  assert.equal(icns.readUInt32BE(4), icns.length);
  const chunks = new Set();
  let cursor = 8;
  while (cursor < icns.length) {
    const length = icns.readUInt32BE(cursor + 4);
    assert.ok(length > 8 && cursor + length <= icns.length, 'ICNS chunk bounds');
    chunks.add(icns.toString('ascii', cursor, cursor + 4));
    cursor += length;
  }
  assert.equal(cursor, icns.length);
  assert.ok(chunks.has('ic10'), 'ICNS includes its 1024px representation');

  const ico = read('assets/icons/win/icon.ico');
  assert.equal(ico.readUInt16LE(0), 0);
  assert.equal(ico.readUInt16LE(2), 1);
  const sizes = [16, 24, 32, 48, 64, 128, 256];
  assert.equal(ico.readUInt16LE(4), sizes.length);
  let offset = 6 + 16 * sizes.length;
  for (let i = 0; i < sizes.length; i++) {
    const entry = 6 + 16 * i, size = sizes[i];
    assert.equal(ico[entry] || 256, size);
    assert.equal(ico[entry + 1] || 256, size);
    assert.equal(ico.readUInt16LE(entry + 4), 1);
    assert.equal(ico.readUInt16LE(entry + 6), 32);
    assert.equal(ico.readUInt32LE(entry + 12), offset);
    const length = ico.readUInt32LE(entry + 8);
    assert.ok(offset + length <= ico.length);
    const image = await sharp(ico.subarray(offset, offset + length)).metadata();
    assert.equal(image.width, size);
    assert.equal(image.height, size);
    offset += length;
  }
  assert.equal(offset, ico.length);
});

test('inline logo renders the approved two-line glyph and resource references exist', async () => {
  const source = read('src/components/NativelyLogoMark.tsx').toString();
  const exports = {};
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true } }).outputText,
    { exports, require });
  const React = require('react');
  const inline = require('react-dom/server').renderToStaticMarkup(React.createElement(exports.NativelyLogoMark, { size: 22 }));
  const pixels = svg => sharp(Buffer.from(svg), { density: 288 }).resize(22, 22).raw().toBuffer();
  assert.deepEqual(await pixels(inline), await pixels(read('scripts/icons/glyph.svg')));
  const build = require('../../../electron-builder.config.cjs');
  for (const file of [build.mac.icon, build.win.icon]) assert.ok(fs.existsSync(path.join(REPO, file)), file);
  assert.equal(build.mac.icon, 'assets/margin.icns');
  assert.ok(build.extraResources.some(r => r.from === 'assets/' && r.to === 'assets/'));
  assert.ok(build.extraResources.some(r => r.from === 'assets/margin.icns' && r.to === 'margin.icns'));
});

test('tray uses generated 16pt/@2x files without resizing and restore uses packaged resources', () => {
  const main = read('electron/main.ts').toString();
  const ast = ts.createSourceFile('main.ts', main, ts.ScriptTarget.Latest, true);
  const klass = ast.statements.find(s => ts.isClassDeclaration(s) && s.name?.text === 'AppState');
  const methods = ['showTray', '_applyDisguise', 'getDisguiseName', 'getDisguiseIconPath', 'preferenceWindows'].map(name => klass.members.find(m => m.name?.getText(ast) === name).getText(ast));
  const code = ts.transpileModule(`class IconConsumer { ${methods.join('\n')} } exports.IconConsumer = IconConsumer;`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText;
  for (const platform of ['darwin', 'win32', 'linux']) {
    for (const packaged of [false, true]) {
      const root = packaged ? '/synthetic-package/resources' : REPO;
      const loaded = [];
      const exports = {};
      const window = { isDestroyed: () => false, setTitle() {}, setIcon() {}, webContents: { send() {} } };
      vm.runInNewContext(code, {
        exports, path, APP_IDENTITY: { name: 'temp', appId: 'io.github.xbz123.temp' },
        process: { platform, resourcesPath: root, env: {} },
        app: { isPackaged: packaged, getAppPath: () => root, setName() {}, setAppUserModelId() {}, dock: { setIcon() {} } },
        fs: { existsSync: () => true },
        nativeImage: { createFromPath(file) { loaded.push(file); return { isEmpty: () => platform === 'darwin' && file.endsWith('.icns'), setTemplateImage(value) { this.template = value; } }; } },
        Tray: class { constructor(image) { this.image = image; } setToolTip() {} on() {} },
        console: { log() {}, warn() {} }, setTimeout: () => 1, clearTimeout() {},
      });
      const state = new exports.IconConsumer();
      Object.assign(state, {
        updateTrayMenu() {}, _disguiseTimers: [], isUndetectable: false, disguiseMode: 'none',
        windowHelper: { getMainWindow: () => window, getLauncherWindow: () => window, getOverlayWindow: () => window },
        settingsWindowHelper: { getSettingsWindow: () => window },
        modelSelectorWindowHelper: { getWindow: () => window }, cropperWindowHelper: { getWindow: () => window },
      });
      state.showTray();
      assert.equal(loaded[0], path.join(root, 'assets', platform === 'darwin' ? 'iconTemplate.png' : 'icons/png/icon_16x16.png'));
      assert.equal(state.tray.image.template, platform === 'darwin');
      state._applyDisguise('none');
      const restore = platform === 'win32' ? 'assets/icons/win/icon.ico' : 'assets/icon.png';
      assert.equal(loaded[1], path.join(root, restore));
    }
  }
});

test('generation is repeatable in synthetic directories and system iconutil decodes the ICNS', () => {
  assert.equal(process.env.MARGIN_ISOLATION_ACTIVE, '1', 'run asset checks under the isolation guard');
  const runs = [];
  for (const label of ['icons-first', 'icons-second']) {
    const sandbox = makeSandbox(label);
    const result = spawnSync(process.execPath, [path.join(REPO, 'scripts/icons/generate.mjs')], {
      cwd: sandbox.work, env: isolatedEnv(sandbox, { MARGIN_ISOLATION_ALLOW_EXEC: 'iconutil' }), encoding: 'utf8', timeout: 60_000,
    });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(readBlocked(sandbox, { pid: result.pid }), []);
    runs.push({ sandbox, manifest: JSON.parse(fs.readFileSync(path.join(sandbox.work, 'scripts/icons/generated-assets.json'), 'utf8')) });
  }
  assert.deepEqual(runs[0].manifest, runs[1].manifest);
  for (const artifact of runs[0].manifest.artifacts) {
    assert.deepEqual(fs.readFileSync(path.join(runs[0].sandbox.work, artifact.path)), fs.readFileSync(path.join(runs[1].sandbox.work, artifact.path)), artifact.path);
  }
  const sandbox = runs[0].sandbox;
  const decoder = `require('node:child_process').execFileSync('iconutil', ['-c', 'iconset', ${JSON.stringify(path.join(sandbox.work, 'assets/margin.icns'))}, '-o', ${JSON.stringify(path.join(sandbox.work, 'decoded.iconset'))}]);`;
  const decoded = spawnSync(process.execPath, ['-e', decoder], {
    cwd: sandbox.work, env: isolatedEnv(sandbox, { MARGIN_ISOLATION_ALLOW_EXEC: 'iconutil' }), encoding: 'utf8', timeout: 30_000,
  });
  assert.equal(decoded.status, 0, decoded.stderr);
  assert.deepEqual(readBlocked(sandbox, { pid: decoded.pid }), []);
  for (const base of [16, 32, 128, 256, 512]) {
    for (const scale of [1, 2]) {
      const image = fs.readFileSync(path.join(sandbox.work, 'decoded.iconset', `icon_${base}x${base}${scale === 2 ? '@2x' : ''}.png`));
      assert.equal(image.readUInt32BE(16), base * scale);
      assert.equal(image.readUInt32BE(20), base * scale);
    }
  }
});
