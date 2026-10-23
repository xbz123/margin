// AG-72: which display a screenshot reads and how a selection maps onto the
// thumbnail, on Windows and macOS, with a stubbed desktopCapturer. Real pixels
// and real DPI behaviour need a Windows host.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const sourcePath = path.resolve(import.meta.dirname, '../../ScreenshotHelper.ts');
const compiled = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText;

// Primary 1920x1080 at 100%; secondary to its right, 1600x900 DIP at 150%.
const PRIMARY = { id: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 }, scaleFactor: 1 };
const SECONDARY = { id: 2, bounds: { x: 1920, y: 0, width: 1600, height: 900 }, scaleFactor: 1.5 };

function thumbnail(name, width, height, crops) {
  return { getSize: () => ({ width, height }), toPNG: () => Buffer.from(name), crop(rect) { crops.push({ name, rect: plain(rect) }); return thumbnail(`${name}:crop`, rect.width, rect.height, crops); } };
}

// The helper runs in its own vm realm; copy what it hands out into this realm.
const plain = value => JSON.parse(JSON.stringify(value));

// sizeFor(display, requested) decides what the fake desktopCapturer hands back.
function load(platform, sizeFor) {
  const requests = [], writes = [], crops = [];
  const electron = {
    app: { getPath: () => '/synthetic/userData', isPackaged: true },
    systemPreferences: { getMediaAccessStatus: () => 'granted' },
    screen: { getAllDisplays: () => [PRIMARY, SECONDARY], getPrimaryDisplay: () => PRIMARY },
    desktopCapturer: {
      async getSources(options) {
        requests.push(plain(options.thumbnailSize));
        return [PRIMARY, SECONDARY].map(d => {
          const { width, height } = sizeFor(d, options.thumbnailSize);
          return { id: `screen:${d.id}`, name: `screen ${d.id}`, display_id: String(d.id), thumbnail: thumbnail(`screen ${d.id}`, width, height, crops) };
        });
      },
    },
  };
  const fakeFs = { existsSync: () => true, mkdirSync() {}, promises: { async writeFile(file, bytes) { writes.push({ file, bytes: String(bytes) }); }, async unlink() {}, async copyFile() {} } };
  const module = { exports: {} };
  vm.runInNewContext(compiled, {
    module, exports: module.exports, Buffer, console: { log() {}, warn() {}, error() {} },
    process: { platform, env: {} },
    require(id) {
      if (id === 'electron') return electron;
      if (id === 'node:fs') return fakeFs;
      if (id === 'node:path') return path.posix;
      if (id === './margin/devOverrides') return { devScreenshotFixture: () => undefined };
      if (id === './margin/appIdentity') return { APP_IDENTITY: { name: 'Synthetic' } };
      if (id === 'uuid') return { v4: () => 'fixed' };
      if (id === './services/screen/imageCodec') return { stitchPng() { throw new Error('not used'); } };
      if (id === 'util' || id === 'child_process') return require(id);
      throw new Error(`unexpected require ${id}`);
    },
  });
  return { helper: new module.exports.ScreenshotHelper('queue'), requests, writes, crops };
}

const native = d => ({ width: Math.round(d.bounds.width * d.scaleFactor), height: Math.round(d.bounds.height * d.scaleFactor) });
const asRequested = (_d, requested) => requested;

test('AG72 Windows full-screen capture reads the target display at its native size', async () => {
  const f = load('win32', asRequested);
  await f.helper.takeScreenshot(SECONDARY);
  assert.deepEqual(f.requests, [{ width: 2400, height: 1350 }]);
  assert.deepEqual(f.writes.map(w => w.bytes), ['screen 2']);
});

test('AG72 Windows full-screen capture without a target display keeps the primary display', async () => {
  const f = load('win32', asRequested);
  await f.helper.takeScreenshot();
  assert.deepEqual(f.requests, [{ width: 1920, height: 1080 }]);
  assert.deepEqual(f.writes.map(w => w.bytes), ['screen 1']);
});

test('AG72 Windows selection crop follows the thumbnail Electron actually returns', async () => {
  const area = { x: 1920 + 100, y: 50, width: 400, height: 200 };
  const nativeThumb = load('win32', native);
  await nativeThumb.helper.takeSelectiveScreenshot(area);
  assert.deepEqual(nativeThumb.crops, [{ name: 'screen 2', rect: { x: 150, y: 75, width: 600, height: 300 } }]);
  // Electron gives no size guarantee; a DIP-sized thumbnail must still crop the selection.
  const dipThumb = load('win32', d => ({ width: d.bounds.width, height: d.bounds.height }));
  await dipThumb.helper.takeSelectiveScreenshot(area);
  assert.deepEqual(dipThumb.crops, [{ name: 'screen 2', rect: { x: 100, y: 50, width: 400, height: 200 } }]);
});

test('AG72 macOS keeps DIP thumbnail requests and scaleFactor crops', async () => {
  const full = load('darwin', native);
  await full.helper.takeScreenshot(SECONDARY);
  assert.deepEqual(full.requests, [{ width: 1600, height: 900 }]);
  assert.deepEqual(full.writes.map(w => w.bytes), ['screen 2']);
  const area = { x: 1920 + 100, y: 50, width: 400, height: 200 };
  const selective = load('darwin', native);
  await selective.helper.takeSelectiveScreenshot(area);
  assert.deepEqual(selective.requests, [{ width: 1600, height: 900 }]);
  assert.deepEqual(selective.crops, [{ name: 'screen 2', rect: { x: 150, y: 75, width: 600, height: 300 } }]);
  // A thumbnail that is not bounds*scaleFactor still gets the scaleFactor crop on macOS.
  const dip = load('darwin', d => ({ width: d.bounds.width, height: d.bounds.height }));
  await dip.helper.takeSelectiveScreenshot(area);
  assert.deepEqual(dip.crops, [{ name: 'screen 2', rect: { x: 150, y: 75, width: 600, height: 300 } }]);
});
