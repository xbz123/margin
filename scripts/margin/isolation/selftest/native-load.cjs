// X3 build check: loads every native dependency the kept features use inside the
// Electron main process, without touching audio devices, the screen or the keychain.
//   node scripts/margin/isolation/run-electron.mjs --app scripts/margin/isolation/selftest/native-load.cjs --ready NATIVE_LOAD_RESULT
// Prints one NATIVE_LOAD_RESULT line and exits 0 only if every module loaded and
// passed its smoke call.

'use strict';

const { app } = require('electron');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../../../..');
const req = (m) => require(require.resolve(m, { paths: [ROOT] }));
const results = {};

async function check(name, fn) {
  try {
    results[name] = { ok: true, detail: await fn() };
  } catch (err) {
    results[name] = { ok: false, detail: String(err && err.message).slice(0, 200) };
  }
}

app.whenReady().then(async () => {
  results.electron = { ok: true, detail: `${process.versions.electron} (node ${process.versions.node}, modules ${process.versions.modules}, ${process.arch})` };

  await check('better-sqlite3', () => {
    const Database = req('better-sqlite3');
    const db = new Database(':memory:');
    const row = db.prepare('select sqlite_version() as v').get();
    db.close();
    return `sqlite ${row.v}`;
  });

  // Screenshots are resized and encoded with nativeImage since S34 (no sharp).
  await check('nativeImage', () => {
    const { nativeImage } = require('electron');
    const png = nativeImage.createFromBitmap(Buffer.alloc(4 * 4 * 4, 0x80), { width: 4, height: 4 }).toPNG();
    const jpeg = nativeImage.createFromBuffer(png).resize({ width: 2, height: 2, quality: 'best' }).toJPEG(80);
    const size = nativeImage.createFromBuffer(jpeg).getSize();
    if (size.width !== 2 || size.height !== 2) throw new Error(`resized to ${size.width}x${size.height}`);
    return `png ${png.length} bytes, jpeg ${jpeg.length} bytes`;
  });

  await check('native-module', () => {
    const native = require(path.join(ROOT, 'native-module'));
    const exported = Object.keys(native).sort();
    return `${exported.length} exports: ${exported.slice(0, 12).join(', ')}${exported.length > 12 ? ', …' : ''}`;
  });

  const ok = Object.values(results).every((r) => r.ok);
  console.log('NATIVE_LOAD_RESULT ' + JSON.stringify({ ok, results }));
  app.exit(ok ? 0 : 1);
});
