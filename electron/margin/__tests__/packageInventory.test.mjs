import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const asar = require('@electron/asar');
const { assertDiagnosticEnv, collectInventory, classifyCandidates, assertTextArtifacts, nativeToolErrors, inspectDynamicLinks, expectedStop } = require('../../../scripts/margin/package-inventory.cjs');
const root = path.resolve(import.meta.dirname, '../../..');

function write(base, name, value) {
  const file = path.join(base, name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value));
}
function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'margin-package-synthetic-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const app = path.join(directory, 'synthetic.app');
  const input = path.join(directory, 'input');
  const manifest = { components: [
    { id: 'npm:without-metadata@1', kind: 'npm', name: 'without-metadata', version: '1', location: 'node_modules/without-metadata' },
    { id: 'npm:bundled@2', kind: 'npm', name: 'bundled', version: '2', location: 'node_modules/bundled' },
    { id: 'npm:unseen@3', kind: 'npm', name: 'unseen', version: '3', location: 'node_modules/unseen' },
    { id: 'cargo:static@4', kind: 'cargo', name: 'static', version: '4', location: 'Cargo.lock:static@4' },
  ], unresolved: [{ id: 'npm:bundled@2' }] };
  write(directory, 'licenses/manifest.json', manifest);
  write(input, 'node_modules/without-metadata/index.js', 'synthetic standalone fixture\n');
  write(input, 'node_modules/relocated/package.json', { name: 'unseen', version: '99' });
  write(input, 'dist/main.js', 'synthetic bundle fixture\n');
  write(input, 'dist/main.js.map', { sources: ['../node_modules/bundled/index.js'], sourcesContent: ['DO NOT EXPORT THIS SOURCE'] });
  write(input, 'native-module/Cargo.lock', 'synthetic lock, not static linkage evidence\n');
  write(input, 'native-module/fake.node', Buffer.from([1, 2, 0, 4]));
  write(app, 'Contents/Resources/ordinary.txt', 'synthetic resource\n');
  write(app, 'Contents/Frameworks/fake-framework.txt', 'synthetic framework fixture\n');
  return { directory, root: directory, app, input, manifest, nativeTools: false };
}

test('actual asar/unpacked/resources/frameworks have size and hashes without exporting contents', async (t) => {
  const options = fixture(t);
  await asar.createPackageWithOptions(options.input, path.join(options.app, 'Contents/Resources/app.asar'), { unpack: '*.node' });
  const report = await collectInventory(options);
  assert.equal(report.acceptance, false);
  assert.equal(report.collectionComplete, true);
  assert.ok(report.entries.some((entry) => entry.path === 'Frameworks/fake-framework.txt' && entry.sha256));
  assert.ok(report.entries.some((entry) => entry.path === 'Resources/ordinary.txt' && entry.sha256));
  const binary = report.entries.find((entry) => entry.path === 'Resources/app.asar/native-module/fake.node');
  assert.equal(binary.unpacked, true);
  assert.equal(binary.size, 4);
  assert.match(binary.sha256, /^[a-f0-9]{64}$/);
  assert.ok(report.entries.some((entry) => entry.path === 'Resources/app.asar.unpacked/native-module/fake.node'));
  assert.equal(JSON.stringify(report).includes('DO NOT EXPORT THIS SOURCE'), false);
  assert.deepEqual(report.candidates.map((entry) => entry.observation), ['included-files', 'bundle-source-map-only', 'unknown', 'unknown']);
  assert.equal(report.candidates[1].unresolvedNotice, true);
});

test('no metadata or a nonmatching build map never proves component absence', async (t) => {
  const options = fixture(t);
  fs.unlinkSync(path.join(options.input, 'dist/main.js.map'));
  write(options.root, 'dist/main.js', 'different synthetic output\n');
  write(options.root, 'dist/main.js.map', { sources: ['../node_modules/bundled/index.js'] });
  await asar.createPackage(options.input, path.join(options.app, 'Contents/Resources/app.asar'));
  const report = await collectInventory(options);
  assert.equal(report.candidates[0].observation, 'included-files');
  assert.equal(report.candidates[1].observation, 'unknown');
  assert.ok(report.mapErrors.some((entry) => entry.error.includes('byte mismatch')));
  write(options.root, 'dist/main.js', 'synthetic bundle fixture\n');
  const matching = await collectInventory(options);
  assert.equal(matching.candidates[1].observation, 'bundle-source-map-only');
  assert.equal(matching.candidates[1].bundleSources[0].origin, 'build source map with byte-matched packaged output');
  assert.equal(classifyCandidates(options.manifest, [{ type: 'directory', logicalPath: 'node_modules/unseen', path: 'synthetic empty directory' }], [], [])[2].observation, 'unknown');
});

test('an incomplete formed package retains observed files and cannot yield a successful stop', async (t) => {
  const options = fixture(t);
  const report = await collectInventory(options);
  assert.equal(report.collectionComplete, false);
  assert.ok(report.entries.some((entry) => entry.path === 'Resources/ordinary.txt'));
  assert.equal(report.inventoryErrors.length, 1);
  assert.equal(expectedStop({ status: 1, signal: null, stdout: 'MARKER', stderr: '' }, { ...report, stopMarker: 'MARKER', normalVerification: { passed: false } }, 'MARKER'), false);
});

test('CI-only entry rejects local/push/wrong identity and signing inputs', () => {
  const env = { CI: 'true', GITHUB_ACTIONS: 'true', GITHUB_EVENT_NAME: 'workflow_dispatch', MARGIN_PACKAGE_INVENTORY: '1',
    MARGIN_APP_VARIANT: 'temp', RUNNER_TEMP: '/synthetic-runner', GITHUB_WORKSPACE: root };
  assert.doesNotThrow(() => assertDiagnosticEnv(env, 'darwin', 'arm64'));
  for (const changes of [{ CI: 'false' }, { GITHUB_EVENT_NAME: 'push' }, { MARGIN_APP_VARIANT: 'release' }, { CSC_LINK: 'synthetic-forbidden' }, { APPLE_ID: 'synthetic-forbidden' }]) {
    assert.throws(() => assertDiagnosticEnv({ ...env, ...changes }, 'darwin', 'arm64'));
  }
  assert.throws(() => assertDiagnosticEnv(env, 'darwin', 'x64'));
  assert.throws(() => assertDiagnosticEnv(env, 'linux', 'arm64'));
  assert.doesNotThrow(() => assertDiagnosticEnv({ ...env, CSC_IDENTITY_AUTO_DISCOVERY: 'false' }, 'darwin', 'arm64'));
});

test('only an exact nonzero diagnostic receipt is successful; ordinary failures remain failures', () => {
  const receipt = { acceptance: false, collectionComplete: true, stopMarker: 'UNIQUE', normalVerification: { passed: false, error: 'synthetic missing notice' } };
  const result = { status: 1, signal: null, stdout: '', stderr: 'Error: UNIQUE' };
  assert.equal(expectedStop(result, receipt, 'UNIQUE'), true);
  for (const changed of [{ status: 0 }, { signal: 'SIGTERM' }, { stderr: 'unrelated failure' }]) assert.equal(expectedStop({ ...result, ...changed }, receipt, 'UNIQUE'), false);
  for (const changed of [{ acceptance: true }, { collectionComplete: false }, { stopMarker: 'OTHER' }, { normalVerification: {} }]) assert.equal(expectedStop(result, { ...receipt, ...changed }, 'UNIQUE'), false);
});

test('missing native architecture or links is a collection error, not a complete inventory', () => {
  const passed = { status: 0, signal: null };
  assert.deepEqual(nativeToolErrors('Frameworks/synthetic', passed, passed), []);
  const errors = nativeToolErrors('Frameworks/synthetic', { status: 1 }, { status: null, signal: 'SIGTERM' });
  assert.deepEqual(errors.map((item) => item.error), ['lipo inventory tool failed', 'otool inventory tool failed']);
  assert.ok(errors.every((item) => item.path === 'Frameworks/synthetic'));
});

test('helper paths disable archive-member parsing without changing input and preserve real errors', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'margin-otool-synthetic-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'Helper (GPU)');
  const bytes = Buffer.from('synthetic native metadata bytes, never executed');
  fs.writeFileSync(file, bytes);
  let inspected;
  const execute = (command, args) => {
    assert.equal(command, '/usr/bin/otool');
    inspected = args.at(-1);
    assert.deepEqual(fs.readFileSync(inspected), bytes);
    return !args.includes('-m') ? { status: 1, stdout: '', stderr: 'archive member path misparsed' } :
      { status: 0, stdout: inspected + ':\nsynthetic link\n', stderr: '' };
  };
  const result = await inspectDynamicLinks(file, execute);
  assert.equal(result.status, 0);
  assert.equal(inspected, file);
  assert.deepEqual(fs.readFileSync(file), bytes);
  assert.equal(result.stdout, file + ':\nsynthetic link\n');
  const plain = path.join(directory, 'Helper');
  fs.copyFileSync(file, plain);
  assert.equal((await inspectDynamicLinks(plain, execute)).status, 0);
  assert.equal(inspected, plain);
  const failure = await inspectDynamicLinks(file, () => ({ status: 1, stdout: '', stderr: 'synthetic malformed Mach-O' }));
  assert.equal(failure.status, 1);
  assert.equal(nativeToolErrors('original-path', { status: 0 }, failure).length, 1);
});

const metadataToolsAllowed = process.platform === 'darwin' && process.env.MARGIN_ISOLATION_ALLOW_EXEC?.split(':').includes('otool');
test('real otool reads a parenthesized same-byte system Mach-O copy without executing it', { skip: !metadataToolsAllowed }, async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'margin-otool-real-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'Helper (GPU)');
  fs.copyFileSync('/usr/bin/true', file);
  const original = fs.readFileSync(file);
  const digest = crypto.createHash('sha256').update(original).digest('hex');
  const result = await inspectDynamicLinks(file);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /libSystem/);
  assert.deepEqual(fs.readFileSync(file), original);
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'), digest);
});

test('upload files are text-only and workflow never uploads diagnostic package paths', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'margin-upload-synthetic-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  write(directory, 'inventory.json', { acceptance: false });
  assert.doesNotThrow(() => assertTextArtifacts(directory));
  write(directory, 'fake.node', Buffer.from([0, 1, 2]));
  assert.throws(() => assertTextArtifacts(directory), /Unexpected/);
  fs.unlinkSync(path.join(directory, 'fake.node'));
  write(directory, 'electron-builder.log', Buffer.from([0, 1, 2]));
  assert.throws(() => assertTextArtifacts(directory), /Binary/);
  const workflow = fs.readFileSync(path.join(root, '.github/workflows/margin-gates.yml'), 'utf8');
  assert.match(workflow, /package_inventory:[\s\S]*?default: false/);
  assert.match(workflow, /if: \$\{\{ !inputs\.package_inventory \}\}[\s\S]*?name: margin-native/);
  const uploads = workflow.match(/margin-package-inventory\/[^\s]+/g);
  assert.equal(uploads.length, 5);
  assert.ok(uploads.every((value) => /^margin-package-inventory\/reports\/[a-z-]+\.(json|log)$/.test(value)));
  assert.match(workflow, /steps\.inventory_texts\.outcome == 'success'/);
  const hook = fs.readFileSync(path.join(root, 'scripts/margin/license-bundle.cjs'), 'utf8');
  assert.match(hook, /if \(manifest\.unresolved\.length\) throw/);
  assert.match(hook, /JSON\.stringify\(verifyBundle\(resources, root\)\)/);
  assert.equal(hook.includes('PACKAGE_INVENTORY'), false);
  const diagnostic = fs.readFileSync(path.join(root, 'scripts/margin/package-inventory.cjs'), 'utf8');
  assert.equal(diagnostic.includes("require('../ad-hoc-sign.js')"), false);
  assert.match(diagnostic, /\['vite-build', [^\n]+, \['build'\]\]/);
  assert.equal(diagnostic.includes('--sourcemap'), false);
});
