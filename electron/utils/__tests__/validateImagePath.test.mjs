// electron/utils/__tests__/validateImagePath.test.mjs
//
// Regression tests for the validateImagePath ordering fix (observation 2631).
//
// On macOS, app.getPath('userData') resolves to a path like
//   /Users/<user>/Library/Application Support/<AppName>/
// The function MUST allow this prefix BEFORE the generic `/Users/` block,
// otherwise every legitimate screenshot path is rejected at the IPC layer.
//
// ScreenshotHelper writes to <userData>/screenshots and <userData>/extra_screenshots,
// so this ordering is what unblocks the screenshot → vision pipeline end to end.

import { test, describe, after } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const modPath = path.resolve(__dirname, '../../../dist-electron/electron/utils/imagePathValidation.js');
const { validateImagePath } = await import(pathToFileURL(modPath).href);

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ag33-image-path-'));
after(() => fs.rmSync(temp, { recursive: true, force: true }));
const MAC_USER_DATA = path.join(temp, 'Users/alice/Library/Application Support/Natively');
for (const folder of ['screenshots', 'extra_screenshots']) {
  fs.mkdirSync(path.join(MAC_USER_DATA, folder), { recursive: true });
  fs.writeFileSync(path.join(MAC_USER_DATA, folder, 'abc-123.png'), Buffer.from('iVBORw0KGgo=', 'base64'));
}

describe('validateImagePath — macOS userData ordering (obs 2631)', () => {
  test('allows screenshot path inside userData even though it starts with /Users/', () => {
    const p = `${MAC_USER_DATA}/screenshots/abc-123.png`;
    const r = validateImagePath(p, MAC_USER_DATA);
    assert.equal(r.isValid, true, `should allow ${p}, got ${r.reason}`);
  });

  test('allows extra_screenshots path inside userData', () => {
    const p = `${MAC_USER_DATA}/extra_screenshots/abc-123.png`;
    const r = validateImagePath(p, MAC_USER_DATA);
    assert.equal(r.isValid, true, `should allow ${p}, got ${r.reason}`);
  });

  test('blocks /Users/ path outside userData', () => {
    const r = validateImagePath('/Users/alice/Desktop/secret.png', MAC_USER_DATA);
    assert.equal(r.isValid, false, 'arbitrary user home paths must remain blocked');
  });

  test('blocks /etc/ regardless of userData', () => {
    const r = validateImagePath('/etc/passwd', MAC_USER_DATA);
    assert.equal(r.isValid, false);
  });

  test('blocks path traversal even when prefix matches userData', () => {
    const p = `${MAC_USER_DATA}/screenshots/../../../etc/passwd`;
    const r = validateImagePath(p, MAC_USER_DATA);
    assert.equal(r.isValid, false, 'traversal escape must be blocked even under userData prefix');
  });

  test('blocks Windows drive paths', () => {
    const r = validateImagePath('C:\\Windows\\System32\\config\\SAM', MAC_USER_DATA);
    assert.equal(r.isValid, false);
  });

  test('rejects empty / non-string input', () => {
    assert.equal(validateImagePath('', MAC_USER_DATA).isValid, false);
    assert.equal(validateImagePath(undefined, MAC_USER_DATA).isValid, false);
    assert.equal(validateImagePath(null, MAC_USER_DATA).isValid, false);
  });

  test('blocks /etc/passwd via realpath resolution', () => {
    const r = validateImagePath('/etc/passwd', MAC_USER_DATA);
    assert.equal(r.isValid, false);
  });

  test('blocks Unix home paths via realpath resolution', () => {
    const r = validateImagePath('/home/user/secret.png', MAC_USER_DATA);
    assert.equal(r.isValid, false);
  });

  test('blocks /tmp arbitrary paths via realpath resolution', () => {
    const r = validateImagePath('/tmp/malicious.png', MAC_USER_DATA);
    assert.equal(r.isValid, false);
  });
});

// AG-72: the same checks on Windows rules. A fake NTFS view stands in for the disk:
// names compare case-insensitively, realpath keeps the given case (as Node's
// non-native realpathSync does) and follows the listed junctions.
const { validateImagePathOn } = await import(pathToFileURL(modPath).href);

function windowsHost({ dirs = [], files = [], junctions = {} } = {}) {
  const w = path.win32;
  const key = (p) => w.resolve(p).toLowerCase();
  const dirSet = new Set(dirs.map(key));
  const fileSet = new Set(files.map(key));
  const links = Object.fromEntries(Object.entries(junctions).map(([from, to]) => [key(from), w.resolve(to)]));
  const realpath = (p) => {
    let resolved = w.resolve(p);
    for (const [from, to] of Object.entries(links)) {
      const lower = resolved.toLowerCase();
      if (lower === from || lower.startsWith(from + '\\')) resolved = to + resolved.slice(from.length);
    }
    if (!dirSet.has(resolved.toLowerCase()) && !fileSet.has(resolved.toLowerCase())) {
      throw Object.assign(new Error(`ENOENT: ${resolved}`), { code: 'ENOENT' });
    }
    return resolved;
  };
  return { platform: 'win32', realpath, isFile: (p) => fileSet.has(key(p)) };
}

const WIN_ROOT = 'C:\\Users\\alice\\AppData\\Roaming\\Margin';
const WIN_SHOT = `${WIN_ROOT}\\screenshots\\abc-123.png`;
const winHost = windowsHost({
  dirs: [WIN_ROOT, `${WIN_ROOT}\\screenshots`, `${WIN_ROOT}\\extra_screenshots`, `${WIN_ROOT}\\screenshots\\folder.png`, 'D:\\outside'],
  files: [WIN_SHOT, `${WIN_ROOT}\\extra_screenshots\\x.jpg`, `${WIN_ROOT}\\notes.txt`, 'C:\\Users\\alice\\Desktop\\secret.png', 'D:\\outside\\secret.png'],
  junctions: { [`${WIN_ROOT}\\screenshots\\escape`]: 'D:\\outside' },
});

describe('validateImagePath — Windows rules (AG-72)', () => {
  const ok = (p, host = winHost, root = WIN_ROOT) => {
    const r = validateImagePathOn(host, p, root);
    assert.equal(r.isValid, true, `should allow ${p}, got ${r.reason}`);
    return r;
  };
  const no = (p, host = winHost, root = WIN_ROOT) => {
    const r = validateImagePathOn(host, p, root);
    assert.equal(r.isValid, false, `should reject ${p}`);
    return r;
  };

  test('allows app-owned screenshot paths with a drive letter', () => {
    assert.equal(ok(WIN_SHOT).resolvedPath, WIN_SHOT);
    ok(`${WIN_ROOT}\\extra_screenshots\\x.jpg`);
  });

  test('drive letter and name case do not matter; forward slashes are accepted', () => {
    ok(WIN_SHOT.toLowerCase());
    ok(WIN_SHOT.toUpperCase().replace('.PNG', '.png'));
    ok(WIN_SHOT.replace(/\\/g, '/'));
  });

  test('a redirected AppData on a share is accepted only by containment', () => {
    const share = '\\\\fileserver\\profiles$\\alice\\AppData\\Roaming\\Margin';
    const host = windowsHost({ dirs: [share, `${share}\\screenshots`], files: [`${share}\\screenshots\\a.png`, '\\\\other\\share\\a.png'] });
    ok(`${share}\\screenshots\\a.png`, host, share);
    no('\\\\other\\share\\a.png', host, share);
    no('\\\\other\\share\\a.png');
  });

  test('paths outside the app folder are refused before any lookup, so no foreign share is contacted', () => {
    const looked = [];
    const host = { ...winHost, realpath: (p) => { looked.push(p); return winHost.realpath(p); } };
    for (const p of ['\\\\attacker.example\\share\\a.png', '//attacker.example/share/a.png', 'D:\\outside\\secret.png', 'C:\\Users\\alice\\Desktop\\secret.png']) {
      looked.length = 0;
      assert.match(no(p, host).reason, /outside app directory/, p);
      assert.deepEqual(looked, [WIN_ROOT], p);
    }
  });

  test('an app folder that is itself a junction accepts paths through either name', () => {
    const real = 'D:\\data\\Margin';
    const host = windowsHost({ dirs: [real, `${real}\\screenshots`], files: [`${real}\\screenshots\\a.png`], junctions: { [WIN_ROOT]: real } });
    assert.equal(ok(`${WIN_ROOT}\\screenshots\\a.png`, host).resolvedPath, `${real}\\screenshots\\a.png`);
    ok(`${real}\\screenshots\\a.png`, host);
  });

  test('device and namespace forms are refused before any filesystem access', () => {
    for (const p of [`\\\\?\\${WIN_SHOT}`, `\\\\.\\${WIN_SHOT}`, `//?/${WIN_SHOT}`, `\\??\\${WIN_SHOT}`, '\\\\?\\UNC\\fileserver\\share\\a.png', '\\\\.\\PhysicalDrive0']) {
      assert.match(no(p).reason, /namespace/, p);
    }
  });

  test('rooted and drive-relative paths are refused by form, not by lookup', () => {
    // On a real C: drive the rooted forms would resolve into userData; refuse them first.
    for (const p of ['\\Users\\alice\\AppData\\Roaming\\Margin\\screenshots\\abc-123.png',
      '/Users/alice/AppData/Roaming/Margin/screenshots/abc-123.png',
      'C:Users\\alice\\AppData\\Roaming\\Margin\\screenshots\\abc-123.png']) {
      assert.match(no(p).reason, /absolute app-owned path/, p);
    }
  });

  test('alternate data streams and device names are refused', () => {
    assert.match(no(`${WIN_ROOT}\\notes.txt:hidden.png`).reason, /data streams/);
    assert.match(no(`${WIN_SHOT}:Zone.Identifier`).reason, /data streams/);
    for (const name of ['NUL.png', 'con.jpg', 'COM1.png', 'lpt9.jpeg', 'AUX']) {
      assert.match(no(`${WIN_ROOT}\\screenshots\\${name}`).reason, /Device names/, name);
    }
  });

  test('a junction that leaves the app directory is refused after resolving it', () => {
    assert.match(no(`${WIN_ROOT}\\screenshots\\escape\\secret.png`).reason, /outside app directory/);
  });

  test('traversal, other folders, directories and other types are refused', () => {
    no(`${WIN_ROOT}\\screenshots\\..\\..\\..\\Desktop\\secret.png`);
    no('C:\\Users\\alice\\Desktop\\secret.png');
    no('D:\\outside\\secret.png');
    assert.match(no(`${WIN_ROOT}\\screenshots\\folder.png`).reason, /regular file/);
    assert.match(no(`${WIN_ROOT}\\notes.txt`).reason, /Unsupported image file type/);
    assert.match(no(`${WIN_ROOT}\\screenshots\\missing.png`).reason, /missing or unreadable/);
    no('');
  });

  test('the macOS rules still refuse Windows drive paths', () => {
    const r = validateImagePathOn({ platform: 'darwin', realpath: () => WIN_SHOT, isFile: () => true }, WIN_SHOT, WIN_ROOT);
    assert.equal(r.isValid, false);
  });
});
