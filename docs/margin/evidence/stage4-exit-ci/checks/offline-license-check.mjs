// Offline check of the source-bundle npm precondition and actual notice bundle.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../../../', import.meta.url));
const { verifyBundle } = createRequire(import.meta.url)(path.join(root, 'scripts/margin/license-bundle.cjs'));
const read = file => JSON.parse(fs.readFileSync(path.join(root, file)));
const manifest = read('licenses/manifest.json');
const lock = read('package-lock.json');
const seen = new Set();
for (const component of manifest.components.filter(item => item.kind === 'npm')) {
  const entry = lock.packages[component.location];
  assert.ok(entry?.resolved && entry.integrity, `no locked tarball: ${component.id}`);
  assert.equal(entry.version, component.version);
  assert.equal(entry.integrity, component.integrity);
  seen.add(`${component.name}@${component.version}`);
}
const used = new Set([...manifest.components.flatMap(item => item.texts), ...manifest.attachments.map(item => item.text)].map(item => item.file));
assert.deepEqual(fs.readdirSync(path.join(root, 'licenses/texts')).map(file => `texts/${file}`).sort(), [...used].sort());
assert.equal(manifest.unresolved.length, 0);
const resources = fs.mkdtempSync(path.join(os.tmpdir(), 'stage4-notices-'));
try {
  fs.cpSync(path.join(root, 'licenses'), path.join(resources, 'licenses'), { recursive: true });
  for (const name of ['LICENSE', 'NOTICE']) fs.copyFileSync(path.join(root, name), path.join(resources, name));
  fs.mkdirSync(path.join(resources, 'licenses/electron'), { recursive: true });
  for (const item of manifest.deferred) fs.copyFileSync(path.join(root, item.sourcePath), path.join(resources, 'licenses', item.file));
  console.log(JSON.stringify({ lockedNpmTarballs: seen.size, candidates: manifest.components.length, uniqueTexts: used.size, unresolved: 0, ...verifyBundle(resources, root) }));
} finally {
  fs.rmSync(resources, { recursive: true, force: true });
}
