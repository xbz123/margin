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
