import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { sliceSafeHandleBlock } from './ipcTestUtils.mjs';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(dirname, '../../..');
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');
const loadPreview = () => import(pathToFileURL(path.join(root, 'dist-electron/electron/utils/sttKeyPreview.js')).href);

// Synthetic keys only; the settings box is pre-filled with sttKeyPreview(saved) after a save.
const SAVED = 'gsk_SYNTHETIC_saved_key_9f3c';

test('Test Connection with the pre-filled preview or an empty box tests the saved STT key', async () => {
  const { sttKeyPreview, sttKeyToTest } = await loadPreview();
  const shown = sttKeyPreview(SAVED);
  assert.equal(shown, 'sk-...9f3c');
  assert.ok(!shown.includes(SAVED.slice(0, -4)), 'the preview carries only the last four characters');
  assert.equal(sttKeyToTest(shown, SAVED), SAVED);
  assert.equal(sttKeyToTest(` ${shown} `, SAVED), SAVED);
  assert.equal(sttKeyToTest('', SAVED), SAVED);
  assert.equal(sttKeyToTest(undefined, SAVED), SAVED);
  assert.equal(sttKeyToTest('sk-...0000', SAVED), SAVED, 'a stale preview from another window still means the saved key');
});

test('a newly typed STT key is tested as typed, and a preview or empty box with nothing saved tests nothing', async () => {
  const { sttKeyPreview, sttKeyToTest } = await loadPreview();
  assert.equal(sttKeyToTest(' gsk_SYNTHETIC_new_key_1111 ', SAVED), 'gsk_SYNTHETIC_new_key_1111');
  assert.equal(sttKeyToTest('sk-proj-SYNTHETIC-1111', SAVED), 'sk-proj-SYNTHETIC-1111', 'a real sk- key is not a preview');
  assert.equal(sttKeyToTest('gsk_SYNTHETIC_new_key_1111', undefined), 'gsk_SYNTHETIC_new_key_1111');
  assert.equal(sttKeyToTest('sk-...9f3c', undefined), '');
  assert.equal(sttKeyToTest('', undefined), '');
  assert.equal(sttKeyToTest('   ', ''), '');
  assert.equal(sttKeyPreview(undefined), '');
  assert.equal(sttKeyPreview(''), '');
});

test('only the preview shape counts as the preview, and saving it keeps a saved key or is refused', async () => {
  const { sttKeyPreview, isSttKeyPreview, sttPreviewSaveResult } = await loadPreview();
  assert.equal(isSttKeyPreview(sttKeyPreview(SAVED)), true);
  assert.equal(isSttKeyPreview(sttKeyPreview('ab')), true);
  assert.equal(isSttKeyPreview(SAVED), false);
  assert.equal(isSttKeyPreview('sk-...'), false);
  assert.equal(isSttKeyPreview('sk-...12345'), false);
  assert.equal(isSttKeyPreview(''), false);
  assert.equal(isSttKeyPreview(null), false);
  assert.deepEqual(sttPreviewSaveResult(SAVED), { ok: true });
  assert.deepEqual(sttPreviewSaveResult(undefined), { ok: false, code: 'write_failed', message: 'Please enter an API key first' });
});

test('get-stored-credentials returns the STT keys only through sttKeyPreview', () => {
  const stored = sliceSafeHandleBlock(read('electron/ipcHandlers.ts'), 'get-stored-credentials');
  assert.match(stored, /sttGroqKey: sttKeyPreview\(creds\.groqSttApiKey\)/);
  assert.match(stored, /sttOpenaiKey: sttKeyPreview\(creds\.openAiSttApiKey\)/);
  assert.match(stored, /sttSonioxKey: sttKeyPreview\(creds\.sonioxApiKey\)/);
  assert.doesNotMatch(stored, /`sk-\.\.\./, 'the preview format is written only in sttKeyPreview');
});
