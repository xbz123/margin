// Local STT was removed in PLAN.md AG-15. A stored sttProvider of 'local-whisper'
// must read back as 'none' (no transcription), never as a cloud provider the user
// did not pick. Loads the built CredentialsManager against a stub `electron`
// module (seeded into the require cache) and a credentials file in a temporary
// directory.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const built = require.resolve('../../../dist-electron/electron/services/CredentialsManager.js');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'margin-stt-retired-'));
const credFile = path.join(dir, 'credentials.enc');
// The stub "encrypts" with the identity, so the credentials file is plain JSON.
fs.writeFileSync(credFile, JSON.stringify({ sttProvider: 'local-whisper' }));

const electronId = require.resolve('electron', { paths: [path.dirname(built)] });
const stub = {
  app: { getPath: (name) => (name === 'userData' ? dir : os.tmpdir()) },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (text) => Buffer.from(String(text)),
    decryptString: (buf) => String(buf),
  },
};
require.cache[electronId] = { id: electronId, filename: electronId, loaded: true, exports: stub };
const manager = require(built).CredentialsManager.getInstance();

test('a stored local-whisper STT provider reads back as none', () => {
  manager.init();
  assert.strictEqual(manager.getSttProvider(), 'none');
});

test('choosing a provider afterwards stores and returns it', () => {
  manager.setSttProvider('groq');
  assert.strictEqual(manager.getSttProvider(), 'groq');
  assert.strictEqual(JSON.parse(fs.readFileSync(credFile, 'utf8')).sttProvider, 'groq');
});

test.after(() => {
  delete require.cache[electronId];
  fs.rmSync(dir, { recursive: true, force: true });
});
