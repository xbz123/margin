import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { ROOT, collect, cargoPackages, embeddedMIT, sha256, inventorySummary, electronNotices } from '../../../scripts/margin/collect-licenses.mjs';

const { verifyBundle } = createRequire(import.meta.url)('../../../scripts/margin/license-bundle.cjs');
const json = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
function write(root, file, value) {
  const destination = path.join(root, file);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n');
}
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'margin-license-synthetic-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  write(root, 'package.json', { license: 'AGPL-3.0-only' });
  write(root, 'package-lock.json', { packages: { '': { license: 'AGPL-3.0-only' }, 'node_modules/example': { version: '1.0.0', integrity: 'synthetic-integrity' } } });
  write(root, 'node_modules/example/package.json', { name: 'example', version: '1.0.0', license: 'MIT', repository: 'Example/example' });
  write(root, 'node_modules/example/LICENSE', 'Synthetic notice fixture only\r\nCopyright Synthetic A\r\n');
  write(root, 'node_modules/electron/package.json', { version: '99.0.0' });
  write(root, 'node_modules/electron/dist/LICENSE', 'Synthetic Electron LICENSE\n');
  write(root, 'node_modules/electron/dist/LICENSES.chromium.html', 'Synthetic complete-notice stand-in, tests only\n');
  write(root, 'src/font/Inter-4.1/LICENSE.txt', 'Synthetic OFL fixture\n');
  write(root, 'native-module/Cargo.lock', 'version = 4\n');
  write(root, 'dist-electron/main.js.map', { sources: ['../node_modules/example/index.js'] });
  fs.mkdirSync(path.join(root, 'dist'));
  fs.mkdirSync(path.join(root, 'cargo-cache'));
  write(root, 'LICENSE', 'Synthetic application LICENSE, tests only\n');
  const markers = '<!-- margin-license-inventory:start -->\n<!-- margin-license-inventory:end -->\n';
  write(root, 'NOTICE', 'Synthetic application NOTICE\n' + markers);
  write(root, 'licenses/README.md', 'Synthetic notice documentation\n' + markers);
  return { root, cargoRoot: path.join(root, 'cargo-cache') };
}
function copyResources(root) {
  const resources = path.join(root, 'synthetic-resources');
  fs.mkdirSync(resources);
  fs.cpSync(path.join(root, 'licenses'), path.join(resources, 'licenses'), { recursive: true });
  for (const file of ['LICENSE', 'NOTICE']) fs.copyFileSync(path.join(root, file), path.join(resources, file));
  fs.mkdirSync(path.join(resources, 'licenses/electron'));
  for (const file of ['LICENSE', 'LICENSES.chromium.html']) fs.copyFileSync(path.join(root, 'node_modules/electron/dist', file), path.join(resources, 'licenses/electron', file));
  return resources;
}

test('collection preserves exact CRLF notice bytes and validates copied Resources', async (t) => {
  const options = fixture(t);
  const result = await collect(options);
  assert.deepEqual(result.unresolved, []);
  const notice = result.components.find((item) => item.name === 'example').texts[0];
  assert.deepEqual(fs.readFileSync(path.join(options.root, 'licenses', notice.file)), fs.readFileSync(path.join(options.root, 'node_modules/example/LICENSE')));
  assert.equal(verifyBundle(copyResources(options.root), options.root).candidateInventoryOnly, true);
});

test('README license detection keeps all holders and original surrounding bytes', async (t) => {
  const options = fixture(t);
  fs.unlinkSync(path.join(options.root, 'node_modules/example/LICENSE'));
  const readme = '# Synthetic fixture\r\nCopyright Synthetic A\r\n  multiline attribution\r\nCopyright Synthetic B\r\nPermission is hereby granted\r\nTHE SOFTWARE IS PROVIDED\r\nOTHER DEALINGS IN THE\r\nSOFTWARE.\r\n';
  assert.equal(embeddedMIT(readme), true);
  write(options.root, 'node_modules/example/README.md', readme);
  const result = await collect(options);
  const notice = result.components.find((item) => item.name === 'example').texts[0];
  assert.equal(fs.readFileSync(path.join(options.root, 'licenses', notice.file), 'utf8'), readme);
});

test('missing required and compatible optional candidates remain unresolved', async (t) => {
  const options = fixture(t);
  const lock = json(path.join(options.root, 'package-lock.json'));
  lock.packages['node_modules/required'] = { version: '1.0.0' };
  lock.packages['node_modules/negative-os'] = { version: '1.0.0', optional: true, os: ['!never-a-real-host'] };
  lock.packages['node_modules/current-cpu'] = { version: '1.0.0', optional: true, cpu: [process.arch] };
  lock.packages['node_modules/other-os'] = { version: '1.0.0', optional: true, os: ['never-a-real-host'] };
  write(options.root, 'package-lock.json', lock);
  const result = await collect(options);
  assert.deepEqual(result.unresolved.map((item) => item.id).sort(), ['lock:node_modules/current-cpu', 'lock:node_modules/negative-os', 'lock:node_modules/required']);
  assert.deepEqual(result.excluded.map((item) => item.location), ['node_modules/other-os']);
  assert.throws(() => verifyBundle(copyResources(options.root), options.root), /unresolved notice candidates/);
});

test('installed version cannot borrow a different lock version integrity', async (t) => {
  const options = fixture(t);
  write(options.root, 'node_modules/example/package.json', { name: 'example', version: '2.0.0', license: 'MIT' });
  await assert.rejects(collect(options), /installed package version differs from lock/);
});

test('cached remote notices require matching integrity and exact Git metadata', async (t) => {
  const options = fixture(t);
  const result = await collect(options);
  const component = result.components.find((item) => item.name === 'example');
  fs.unlinkSync(path.join(options.root, 'node_modules/example/LICENSE'));
  component.vcs = 'a'.repeat(40);
  const text = component.texts[0];
  text.sourcePath = 'LICENSE';
  text.url = `https://raw.githubusercontent.com/${component.repo}/${component.vcs}/LICENSE`;
  const bytes = fs.readFileSync(path.join(options.root, 'licenses', text.file));
  text.gitBlob = crypto.createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
  write(options.root, 'licenses/manifest.json', result);
  assert.deepEqual((await collect(options)).unresolved, []);
  const lock = json(path.join(options.root, 'package-lock.json'));
  lock.packages['node_modules/example'].integrity = 'changed-synthetic-integrity';
  write(options.root, 'package-lock.json', lock);
  assert.equal((await collect(options)).unresolved.length, 1);
});

test('missing or substituted Chromium notice cannot pass package checks', async (t) => {
  const options = fixture(t);
  await collect(options);
  const resources = copyResources(options.root);
  const file = path.join(resources, 'licenses/electron/LICENSES.chromium.html');
  fs.unlinkSync(file);
  assert.throws(() => verifyBundle(resources, options.root), /ENOENT/);
  fs.writeFileSync(file, 'MIT placeholder');
  assert.throws(() => verifyBundle(resources, options.root), /missing\/changed notice/);
});

test('Electron notices record a digest for each packaged target (AG-73)', (t) => {
  // The inventory is collected on macOS arm64 from the installed distribution; the
  // Windows x64 digests are pinned from the official release zip.
  const manifest = json(path.join(ROOT, 'licenses/manifest.json'));
  assert.deepEqual(electronNotices(ROOT, manifest.electronVersion, 'darwin-arm64'), manifest.deferred);
  const chromium = manifest.deferred.find((item) => item.file === 'electron/LICENSES.chromium.html');
  assert.notEqual(chromium.targets['darwin-arm64'], chromium.targets['win32-x64']);
  const options = fixture(t);
  assert.deepEqual(electronNotices(options.root, '99.0.0', 'darwin-arm64').map((item) => Object.keys(item.targets)), [['darwin-arm64'], ['darwin-arm64']]);
  assert.throws(() => electronNotices(options.root, '43.1.0', 'win32-x64'), /installed Electron LICENSE differs from the pinned win32-x64 release/);
});

test('known official repo mapping preserves a missing-repository crate cache offline', async (t) => {
  const options = fixture(t);
  write(options.root, 'native-module/Cargo.lock', 'version = 4\n[[package]]\nname = "cidre-macros"\nversion = "0.3.0"\nsource = "registry+synthetic"\nchecksum = "synthetic"\n');
  write(options.cargoRoot, 'cidre-macros-0.3.0/Cargo.toml', '[package]\nname = "cidre-macros"\nversion = "0.3.0"\nlicense = "MIT"\n');
  write(options.cargoRoot, 'cidre-macros-0.3.0/.cargo_vcs_info.json', { git: { sha1: 'a'.repeat(40) }, path_in_vcs: 'cidre-macros' });
  const first = await collect(options);
  const crate = first.components.find((item) => item.name === 'cidre-macros');
  const notice = { ...first.components.find((item) => item.name === 'example').texts[0] };
  const bytes = fs.readFileSync(path.join(options.root, 'licenses', notice.file));
  notice.sourcePath = 'LICENSE.txt';
  notice.url = `https://raw.githubusercontent.com/yury/cidre/${crate.vcs}/LICENSE.txt`;
  notice.gitBlob = crypto.createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
  crate.repo = 'yury/cidre';
  crate.texts = [notice];
  write(options.root, 'licenses/manifest.json', first);
  const offline = await collect(options);
  assert.deepEqual(offline.unresolved, []);
  assert.equal(offline.components.find((item) => item.name === 'cidre-macros').texts[0].sha256, notice.sha256);
});

test('notice symlinks and escaped destinations fail closed', async (t) => {
  const options = fixture(t);
  const result = await collect(options);
  const resources = copyResources(options.root);
  const notice = result.components.find((item) => item.name === 'example').texts[0];
  const file = path.join(resources, 'licenses', notice.file);
  fs.unlinkSync(file);
  fs.symlinkSync(path.join(options.root, 'node_modules/example/LICENSE'), file);
  assert.throws(() => verifyBundle(resources, options.root), /symlink/);
  fs.unlinkSync(file);
  fs.writeFileSync(file, fs.readFileSync(path.join(options.root, 'node_modules/example/LICENSE')));
  notice.file = '../NOTICE';
  for (const base of [options.root, resources]) write(base, 'licenses/manifest.json', result);
  assert.throws(() => verifyBundle(resources, options.root), /invalid notice destination/);
});

test('changed locks invalidate inventory and generated Cargo metadata is strict', async (t) => {
  const options = fixture(t);
  await collect(options);
  const resources = copyResources(options.root);
  fs.appendFileSync(path.join(options.root, 'package-lock.json'), '\n');
  assert.throws(() => verifyBundle(resources, options.root), /stale/);
  assert.deepEqual(cargoPackages('version = 4\n[[package]]\nname = "example"\nversion = "1.0.0"\nsource = "registry+synthetic"\nchecksum = "synthetic"\n'), [{ name: 'example', version: '1.0.0', source: 'registry+synthetic', checksum: 'synthetic' }]);
  assert.throws(() => cargoPackages('[[package]]\nname = "example"\n'), /unsupported/);
  assert.equal(sha256(Buffer.from('synthetic')), sha256(Buffer.from('synthetic')));
});

test('summary regeneration preserves legal prose, ignores unlisted leftovers and includes mapped dev candidates', async (t) => {
  const options = fixture(t);
  write(options.root, 'node_modules/retired/package.json', { name: 'retired', version: '1.0.0', license: 'MIT' });
  write(options.root, 'node_modules/retired/LICENSE', 'Synthetic retired notice\n');
  const lock = json(path.join(options.root, 'package-lock.json'));
  lock.packages['node_modules/dev-only'] = { version: '1.0.0', dev: true };
  write(options.root, 'package-lock.json', lock);
  write(options.root, 'node_modules/dev-only/package.json', { name: 'dev-only', version: '1.0.0', license: 'MIT' });
  write(options.root, 'node_modules/dev-only/LICENSE', 'Synthetic mapped notice\n');
  const prefix = 'Synthetic original copyright and license prose\n';
  const suffix = '\nSynthetic distribution obligations\n';
  const start = '<!-- margin-license-inventory:start -->';
  const end = '<!-- margin-license-inventory:end -->';
  for (const file of ['NOTICE', 'licenses/README.md']) write(options.root, file, prefix + start + '\nSTALE inventory\n' + end + suffix);
  const first = await collect(options);
  assert.deepEqual(first.components.map((item) => item.name), ['example', 'Inter']);
  for (const file of ['NOTICE', 'licenses/README.md']) assert.equal(fs.readFileSync(path.join(options.root, file), 'utf8'), prefix + start + '\n' + inventorySummary(first) + '\n' + end + suffix);
  write(options.root, 'dist-electron/main.js.map', { sources: ['../node_modules/dev-only/index.js'] });
  const mapped = await collect(options);
  assert.deepEqual(mapped.components.map((item) => item.name), ['dev-only', 'example', 'Inter']);
  assert.equal(mapped.components[0].basis, 'embedded in current main bundle source maps');
  assert.equal(fs.readFileSync(path.join(options.root, 'NOTICE'), 'utf8'), prefix + start + '\n' + inventorySummary(mapped) + '\n' + end + suffix);
});

test('missing or duplicated inventory markers fail rather than overwrite legal prose', async (t) => {
  const options = fixture(t);
  const missing = 'Synthetic original notice without generator markers\n';
  const readme = fs.readFileSync(path.join(options.root, 'licenses/README.md'), 'utf8');
  write(options.root, 'NOTICE', missing);
  await assert.rejects(collect(options), /missing\/ambiguous inventory summary markers: NOTICE/);
  assert.equal(fs.readFileSync(path.join(options.root, 'NOTICE'), 'utf8'), missing);
  assert.equal(fs.readFileSync(path.join(options.root, 'licenses/README.md'), 'utf8'), readme);
  const duplicate = '<!-- margin-license-inventory:start -->\n<!-- margin-license-inventory:start -->\n<!-- margin-license-inventory:end -->\n';
  write(options.root, 'NOTICE', duplicate);
  await assert.rejects(collect(options), /missing\/ambiguous inventory summary markers: NOTICE/);
  assert.equal(fs.readFileSync(path.join(options.root, 'NOTICE'), 'utf8'), duplicate);
});

function metadataFixture(t, kind) {
  const options = fixture(t);
  const sources = json(path.join(ROOT, 'scripts/margin/license-sources.json'));
  const standard = sources.find(item => item.evidenceCategory === 'approved-metadata-MIT' && item.bind.kind === kind);
  const metadata = sources.find(item => item.id === standard.metadataSourceId);
  const container = fs.readFileSync(path.join(ROOT, metadata.localPath), 'utf8');
  const original = container.slice(0, container.indexOf(metadata.endBefore));
  write(options.root, metadata.localPath, container);
  const name = standard.bind.name;
  const version = standard.version;
  const installedMetadata = kind === 'npm' ? 'node_modules/' + name + '/package.json' : 'cargo-cache/' + name + '-' + version + '/Cargo.toml.orig';
  write(options.root, installedMetadata, original);
  if (kind === 'npm') {
    const lock = json(path.join(options.root, 'package-lock.json'));
    lock.packages['node_modules/' + name] = { version, integrity: standard.artifactIntegrity };
    write(options.root, 'package-lock.json', lock);
  } else {
    write(options.root, 'cargo-cache/' + name + '-' + version + '/Cargo.toml', original);
    write(options.root, 'native-module/Cargo.lock', 'version = 4\n[[package]]\nname = "' + name + '"\nversion = "' + version + '"\nsource = "registry+synthetic"\nchecksum = "' + standard.artifactChecksum + '"\n');
  }
  const file = 'texts/' + standard.sha256 + '.txt';
  write(options.root, 'licenses/' + file, fs.readFileSync(path.join(ROOT, 'licenses', file), 'utf8'));
  write(options.root, 'scripts/margin/license-sources.json', [metadata, standard]);
  write(options.root, 'licenses/manifest.json', { attachments: [{ ...standard, text: { file, sha256: standard.sha256 } }] });
  return { ...options, metadata, standard, installedMetadata, sources: [metadata, standard] };
}

test('approved exact MIT metadata and standard terms remain a separate evidence category', async (t) => {
  for (const kind of ['npm', 'cargo']) {
    const options = metadataFixture(t, kind);
    const result = await collect(options);
    assert.deepEqual(result.unresolved, []);
    const component = result.components.find(item => item.kind === kind && item.name === options.standard.bind.name);
    assert.equal(component.evidenceCategory, 'approved-metadata-MIT');
    assert.equal(component.texts.length, 2);
    assert.match(inventorySummary(result), /published MIT metadata \+ standard terms; not a complete original notice/);
    assert.equal(verifyBundle(copyResources(options.root), options.root).candidateInventoryOnly, true);
    write(options.root, 'scripts/margin/license-sources.json', [...options.sources].reverse());
    const reordered = await collect(options);
    assert.deepEqual(reordered.components, result.components);
    assert.deepEqual(reordered.unresolved, []);
  }
});

test('metadata acceptance rejects unapproved identities and incomplete or changed evidence', async (t) => {
  const cases = [
    ['missing category cannot use the ordinary binding', o => { delete o.standard.evidenceCategory; }],
    ['wrong package', o => { o.standard.bind = { kind: 'npm', name: 'example' }; o.standard.version = '1.0.0'; }],
    ['wrong version', (o, kind) => {
      o.standard.version = o.metadata.version = '9.0.0';
      const name = o.standard.bind.name;
      if (kind === 'npm') {
        const pkg = json(path.join(o.root, o.installedMetadata)); pkg.version = '9.0.0';
        write(o.root, o.installedMetadata, pkg);
        const lock = json(path.join(o.root, 'package-lock.json')); lock.packages['node_modules/' + name].version = '9.0.0';
        write(o.root, 'package-lock.json', lock);
      } else {
        fs.renameSync(path.join(o.cargoRoot, name + '-3.5.0'), path.join(o.cargoRoot, name + '-9.0.0'));
        write(o.root, 'native-module/Cargo.lock', fs.readFileSync(path.join(o.root, 'native-module/Cargo.lock'), 'utf8').replace('3.5.0', '9.0.0'));
      }
    }],
    ['missing approval artifact pin', (o, kind) => { delete o.standard[kind === 'npm' ? 'artifactIntegrity' : 'artifactChecksum']; }],
    ['changed approval artifact pin', (o, kind) => { o.standard[kind === 'npm' ? 'artifactIntegrity' : 'artifactChecksum'] = 'changed'; }],
    ['missing current artifact pin', (o, kind) => {
      if (kind === 'npm') {
        const lock = json(path.join(o.root, 'package-lock.json')); delete lock.packages['node_modules/' + o.standard.bind.name].integrity;
        write(o.root, 'package-lock.json', lock);
      } else write(o.root, 'native-module/Cargo.lock', fs.readFileSync(path.join(o.root, 'native-module/Cargo.lock'), 'utf8').replace(/^checksum = .*\n/m, ''));
    }],
    ['changed current artifact pin', (o, kind) => {
      if (kind === 'npm') {
        const lock = json(path.join(o.root, 'package-lock.json')); lock.packages['node_modules/' + o.standard.bind.name].integrity = 'changed';
        write(o.root, 'package-lock.json', lock);
      } else write(o.root, 'native-module/Cargo.lock', fs.readFileSync(path.join(o.root, 'native-module/Cargo.lock'), 'utf8').replace(/^checksum = .*$/m, 'checksum = "changed"'));
    }],
    ['missing metadata pin', o => { delete o.standard.metadataSHA256; }],
    ['changed metadata pin', o => { o.standard.metadataSHA256 = 'changed'; }],
    ['changed installed metadata bytes', o => { write(o.root, o.installedMetadata, fs.readFileSync(path.join(o.root, o.installedMetadata), 'utf8') + '\n'); }],
    ['installed metadata is a file symlink', o => {
      const file = path.join(o.root, o.installedMetadata);
      fs.renameSync(file, file + '.original');
      fs.symlinkSync(path.basename(file) + '.original', file);
    }],
    ['changed original metadata even with updated container hashes', o => {
      const container = fs.readFileSync(path.join(o.root, o.metadata.localPath), 'utf8');
      const changed = '\n' + container;
      write(o.root, o.metadata.localPath, changed);
      o.metadata.sourceSHA256 = sha256(Buffer.from(changed));
      o.metadata.sha256 = sha256(Buffer.from('\n' + container.slice(0, container.indexOf(o.metadata.endBefore))));
    }],
    ['metadata license mismatch', (o, kind) => {
      if (kind === 'npm') {
        const pkg = json(path.join(o.root, o.installedMetadata)); pkg.license = 'Apache-2.0'; write(o.root, o.installedMetadata, pkg);
      } else {
        const file = 'cargo-cache/realfft-3.5.0/Cargo.toml';
        write(o.root, file, fs.readFileSync(path.join(o.root, file), 'utf8').replace('license = "MIT"', 'license = "Apache-2.0"'));
      }
    }],
    ['missing original declaration', o => { o.sources = [o.standard]; }],
    ['missing SPDX hash', o => { delete o.standard.sha256; }],
    ['missing SPDX Git blob', o => { delete o.standard.gitBlob; }],
    ['changed SPDX Git blob', o => { o.standard.gitBlob = '0'.repeat(40); }],
    ['changed SPDX reference', o => { o.standard.url = 'https://example.invalid/other-MIT.txt'; }],
    ['replaced SPDX text with matching invented hashes', o => {
      const bytes = Buffer.from('Synthetic substituted standard text, not MIT\n');
      o.standard.sha256 = sha256(bytes);
      o.standard.gitBlob = crypto.createHash('sha1').update('blob ' + bytes.length + '\0').update(bytes).digest('hex');
      o.standardBytes = bytes.toString('utf8');
    }],
  ];
  for (const kind of ['npm', 'cargo']) for (const [name, mutate] of cases) await t.test(kind + ': ' + name, async (st) => {
    const options = metadataFixture(st, kind);
    const cached = json(path.join(options.root, 'licenses/manifest.json')).attachments[0].text;
    options.standardBytes = fs.readFileSync(path.join(options.root, 'licenses', cached.file), 'utf8');
    mutate(options, kind);
    write(options.root, 'scripts/margin/license-sources.json', options.sources);
    const hash = sha256(Buffer.from(options.standardBytes));
    const file = 'texts/' + hash + '.txt';
    write(options.root, 'licenses/' + file, options.standardBytes);
    write(options.root, 'licenses/manifest.json', { attachments: [{ ...options.standard, text: { file, sha256: hash } }] });
    await assert.rejects(collect(options), /metadata-MIT|canonical license binding|local license source|supplemental license hash/);
  });
});

test('metadata alone and a remaining unrelated missing notice cannot pass inventory checks', async (t) => {
  for (const kind of ['npm', 'cargo']) {
    const options = metadataFixture(t, kind);
    const cachedStandard = json(path.join(options.root, 'licenses/manifest.json')).attachments[0];
    write(options.root, 'scripts/margin/license-sources.json', [options.metadata]);
    const metadataOnly = await collect(options);
    assert.equal(metadataOnly.unresolved.length, 1);
    assert.throws(() => verifyBundle(copyResources(options.root), options.root), /unresolved notice candidates: 1/);
    write(options.root, 'scripts/margin/license-sources.json', options.sources);
    write(options.root, 'licenses/manifest.json', { ...metadataOnly, attachments: [...metadataOnly.attachments, cachedStandard] });
    const lock = json(path.join(options.root, 'package-lock.json'));
    lock.packages['node_modules/unapproved'] = { version: '1.0.0', integrity: 'synthetic-other-artifact' };
    write(options.root, 'package-lock.json', lock);
    write(options.root, 'node_modules/unapproved/package.json', { name: 'unapproved', version: '1.0.0', license: 'MIT' });
    const result = await collect(options);
    assert.deepEqual(result.unresolved.map(item => item.id), ['npm:unapproved@1.0.0:node_modules/unapproved']);
    fs.rmSync(path.join(options.root, 'synthetic-resources'), { recursive: true });
    assert.throws(() => verifyBundle(copyResources(options.root), options.root), /unresolved notice candidates: 1/);
  }
});

test('local supplemental notices keep verbatim bytes, reject changed inputs and bind the packaged inventory', async (t) => {
  const options = fixture(t);
  const bytes = Buffer.from('Synthetic dependency notice\r\n\xA9 latin-1 byte kept\n', 'latin1');
  const digest = sha256(bytes);
  const localPath = `scripts/margin/license-inputs/original-notices/${digest}.txt`;
  write(options.root, localPath, '');
  fs.writeFileSync(path.join(options.root, localPath), bytes);
  const entry = { id: 'original:synthetic@1.0', version: '1.0', license: 'MIT', url: 'https://example.invalid/synthetic-1.0.tar.gz',
    localPath, sourceSHA256: digest, sha256: digest, role: 'synthetic test notice', closesMissing: false };
  write(options.root, 'scripts/margin/license-sources.json', [entry]);
  const manifest = await collect(options);
  const attachment = manifest.attachments.find((item) => item.id === entry.id);
  assert.ok(fs.readFileSync(path.join(options.root, 'licenses', attachment.text.file)).equals(bytes));
  const resources = copyResources(options.root);
  assert.equal(verifyBundle(resources, options.root).candidateInventoryOnly, true);
  write(options.root, 'scripts/margin/license-sources.json', [{ ...entry, role: 'changed after packaging' }]);
  assert.throws(() => verifyBundle(resources, options.root), /supplemental notice sources changed/);
  write(options.root, 'scripts/margin/license-sources.json', [entry, entry]);
  await assert.rejects(collect(options), /duplicate supplemental notice id/);
  fs.writeFileSync(path.join(options.root, localPath), 'substituted text\n');
  write(options.root, 'scripts/margin/license-sources.json', [entry]);
  await assert.rejects(collect(options), /local license source changed/);
});
