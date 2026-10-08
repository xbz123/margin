'use strict';

// CI evidence only: inventory the formed bundle, then stop before signing.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const asar = require('@electron/asar');
const { verifyBundle } = require('./license-bundle.cjs');
const ROOT = path.resolve(__dirname, '../..');
const ARTIFACTS = ['inventory.json', 'diagnostic-run.json', 'build-electron.log', 'vite-build.log', 'electron-builder.log'];
const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const slash = (value) => value.split(path.sep).join('/');
const json = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const writeJSON = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');

function assertDiagnosticEnv(env = process.env, platform = process.platform, arch = process.arch) {
  if (env.CI !== 'true' || env.GITHUB_ACTIONS !== 'true' || env.GITHUB_EVENT_NAME !== 'workflow_dispatch' ||
      env.MARGIN_PACKAGE_INVENTORY !== '1' || env.MARGIN_APP_VARIANT !== 'temp' || platform !== 'darwin' || arch !== 'arm64') {
    throw new Error('Package inventory is manual GitHub Actions macOS arm64 temp-identity only');
  }
  if (!env.RUNNER_TEMP || !env.GITHUB_WORKSPACE || path.resolve(env.GITHUB_WORKSPACE) !== ROOT) throw new Error('Missing diagnostic runner paths');
  for (const [key, value] of Object.entries(env)) {
    if (key === 'CSC_IDENTITY_AUTO_DISCOVERY' && value === 'false') continue;
    if (value && (/^(CSC_|APPLE_|NATIVELY_SIGN_)/.test(key) || key === 'NATIVELY_PRODUCTION_SIGN')) throw new Error('Signing credentials/flags are forbidden in diagnostics');
  }
}

function scrub(value, root = ROOT) {
  let result = String(value);
  for (const [prefix, label] of [[root, '<workspace>'], [process.env.RUNNER_TEMP, '<runner-temp>'], [os.homedir(), '<home>']]) {
    if (prefix) result = result.split(prefix).join(label);
  }
  return result;
}

async function hashFile(file) {
  const hash = crypto.createHash('sha256');
  for await (const bytes of fs.createReadStream(file)) hash.update(bytes);
  return hash.digest('hex');
}

// Never follow an unpacked path through a link supplied by an archive header.
function regularFile(root, relative) {
  const destination = path.resolve(root, relative);
  if (!destination.startsWith(path.resolve(root) + path.sep)) throw new Error('Inventory path escapes root');
  let current = root;
  for (const part of path.relative(root, destination).split(path.sep)) {
    current = path.join(current, part);
    if (fs.lstatSync(current).isSymbolicLink()) throw new Error('Inventory file traverses symlink');
  }
  if (!fs.statSync(destination).isFile()) throw new Error('Inventory entry is not a file');
  return destination;
}

function classifyCandidates(manifest, entries, packages, sources) {
  return manifest.components.map((component) => {
    const files = component.kind === 'npm' ? entries.filter((entry) => entry.type === 'file' && entry.logicalPath &&
      (entry.logicalPath === component.location || entry.logicalPath.startsWith(component.location + '/'))) : [];
    const metadata = packages.filter((pkg) => component.kind === 'npm' && pkg.name === component.name && pkg.version === component.version);
    const bundled = component.kind === 'npm' ? sources.filter((source) => source.source.startsWith(component.location + '/')) : [];
    const observed = files.length || metadata.length;
    return { id: component.id, kind: component.kind, name: component.name, candidateVersion: component.version,
      candidateLocation: component.location ?? null,
      unresolvedNotice: manifest.unresolved.some((item) => item.id === component.id),
      observation: observed ? 'included-files' : bundled.length ? 'bundle-source-map-only' : 'unknown',
      files: files.map((entry) => entry.path), packageMetadata: metadata.map((pkg) => pkg.path),
      bundleSources: bundled,
      limitation: component.kind === 'cargo' ? 'Native static constituents cannot be inferred from wrapper metadata, Cargo.lock or dynamic links.' :
        observed ? 'Observed files do not establish runtime use or license compliance.' : bundled.length ? 'Source-map evidence only; no standalone package files observed.' :
          'Not observed in paths/metadata/maps; absence is not established (bundles and native embedding may hide it).' };
  });
}

async function collectInventory({ app, root, manifest, nativeTools = true }) {
  const contents = path.join(app, 'Contents');
  const entries = [];
  const packages = [];
  const sources = [];
  const mapErrors = [];
  const inventoryErrors = [];
  const readers = new Map();
  async function walk(directory) {
    for (const name of fs.readdirSync(directory).sort()) {
      const file = path.join(directory, name);
      const stat = fs.lstatSync(file);
      const relative = slash(path.relative(contents, file));
      const entry = { path: relative, container: 'filesystem', type: stat.isSymbolicLink() ? 'symlink' : stat.isDirectory() ? 'directory' : 'file', size: stat.size };
      if (stat.isSymbolicLink()) {
        const target = fs.readlinkSync(file);
        entry.link = path.isAbsolute(target) ? '<absolute-link>' : target;
      } else if (stat.isDirectory()) {
        entries.push(entry);
        await walk(file);
        continue;
      } else if (stat.isFile()) {
        entry.sha256 = await hashFile(file);
        if (relative.startsWith('Resources/app.asar.unpacked/')) entry.logicalPath = relative.slice('Resources/app.asar.unpacked/'.length);
        readers.set(relative, () => fs.readFileSync(regularFile(contents, relative)));
      } else throw new Error('Unsupported package filesystem entry');
      entries.push(entry);
    }
  }
  await walk(contents);
  try {
    const archive = regularFile(contents, 'Resources/app.asar');
    for (const listed of asar.listPackage(archive).sort()) {
      const relative = listed.replace(/^\//, '');
      if (path.posix.isAbsolute(relative) || relative.split('/').some((part) => part === '..')) throw new Error('Unsafe asar path');
      const stat = asar.statFile(archive, relative, false);
      const entry = { path: 'Resources/app.asar/' + relative, logicalPath: relative, container: 'asar',
        type: stat.link ? 'symlink' : stat.files ? 'directory' : 'file', size: stat.size ?? null, unpacked: !!stat.unpacked };
      if (stat.link) entry.link = path.posix.isAbsolute(stat.link) ? '<absolute-link>' : stat.link;
      else if (!stat.files) {
        const read = stat.unpacked ? () => fs.readFileSync(regularFile(contents, 'Resources/app.asar.unpacked/' + relative)) : () => asar.extractFile(archive, relative, false);
        const bytes = read();
        if (bytes.length !== stat.size) throw new Error('Asar size differs from actual file');
        entry.sha256 = sha256(bytes);
        readers.set(entry.path, read);
      }
      entries.push(entry);
    }
  } catch (error) {
    inventoryErrors.push({ scope: 'asar', error: scrub(error.message, root) });
  }
  const logicalFiles = new Map(entries.filter((entry) => entry.logicalPath && entry.type === 'file').map((entry) => [entry.logicalPath, entry]));
  function readMetadata(entry, read) {
    if (entry.path.endsWith('/package.json')) {
      const pkg = JSON.parse(read().toString('utf8'));
      packages.push({ path: entry.path, location: entry.logicalPath ? path.posix.dirname(entry.logicalPath) : path.posix.dirname(entry.path),
        name: typeof pkg.name === 'string' ? pkg.name : null, version: typeof pkg.version === 'string' ? pkg.version : null,
        source: entry.container, sha256: entry.sha256 });
    }
  }
  function readMap(mapPath, logicalPath, bytes, origin) {
    try {
      const map = JSON.parse(bytes);
      if (!Array.isArray(map.sources)) throw new Error('missing sources array');
      const js = logicalFiles.get(logicalPath.slice(0, -4));
      if (!js) throw new Error('mapped output not observed in package');
      for (const source of map.sources) {
        if (typeof source !== 'string') throw new Error('invalid map source');
        const resolved = path.resolve(root, path.dirname(logicalPath), map.sourceRoot ?? '', source);
        const relative = slash(path.relative(root, resolved));
        sources.push({ map: mapPath, origin, output: js.path, outputSHA256: js.sha256,
          source: relative.startsWith('../') || path.isAbsolute(relative) ? '<outside-workspace>' : relative });
      }
    } catch (error) { mapErrors.push({ path: mapPath, error: scrub(error.message, root) }); }
  }
  for (const entry of entries.filter((item) => item.type === 'file')) {
    const read = readers.get(entry.path);
    if (!read) continue;
    try { readMetadata(entry, read); }
    catch (error) { inventoryErrors.push({ path: entry.path, error: scrub(error.message, root) }); }
    if (entry.logicalPath?.endsWith('.map')) readMap(entry.path, entry.logicalPath, read(), 'packaged source map');
  }
  // A build map not shipped in the app is evidence only when its output bytes match.
  for (const directory of ['dist', 'dist-electron']) {
    function walkMaps(dir) {
      if (!fs.existsSync(dir)) return;
      for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
        const file = path.join(dir, item.name);
        if (item.isDirectory()) walkMaps(file);
        else if (item.isFile() && item.name.endsWith('.map')) {
          const relative = slash(path.relative(root, file));
          if (logicalFiles.has(relative)) continue;
          const js = logicalFiles.get(relative.slice(0, -4));
          if (!js || !fs.existsSync(file.slice(0, -4)) || sha256(fs.readFileSync(file.slice(0, -4))) !== js.sha256) {
            mapErrors.push({ path: relative, error: 'build map output absent or byte mismatch; not component evidence' });
            continue;
          }
          readMap(relative, relative, fs.readFileSync(file), 'build source map with byte-matched packaged output');
        }
      }
    }
    walkMaps(path.join(root, directory));
  }
  const native = [];
  if (nativeTools) {
    for (const entry of entries.filter((item) => item.container === 'filesystem' && item.type === 'file')) {
      const file = regularFile(contents, entry.path);
      const sample = Buffer.alloc(4);
      const descriptor = fs.openSync(file, 'r');
      try { fs.readSync(descriptor, sample, 0, 4, 0); } finally { fs.closeSync(descriptor); }
      if (!['feedface', 'cefaedfe', 'feedfacf', 'cffaedfe', 'cafebabe', 'bebafeca', 'cafebabf', 'bfbafeca'].includes(sample.toString('hex'))) continue;
      const options = { encoding: 'utf8', timeout: 10000, maxBuffer: 4 * 1024 * 1024 };
      const type = spawnSync('/usr/bin/file', ['-b', file], options);
      if (type.status !== 0 || type.error) {
        inventoryErrors.push({ path: entry.path, error: 'file inventory tool failed', exitCode: type.status });
        continue;
      }
      if (!type.stdout.includes('Mach-O')) continue;
      const architecture = spawnSync('/usr/bin/lipo', ['-archs', file], options);
      const links = inspectDynamicLinks(file);
      inventoryErrors.push(...nativeToolErrors(entry.path, architecture, links));
      native.push({ path: entry.path, file: scrub(type.stdout.trim(), root),
        architecture: { exitCode: architecture.status, output: scrub((architecture.stdout ?? '') + (architecture.stderr ?? ''), root) },
        dynamicLinks: { exitCode: links.status, output: scrub(((links.stdout ?? '') + (links.stderr ?? '')).split(file).join(entry.path), root) },
        limitation: 'Dynamic links and architecture do not identify statically embedded vendor libraries.' });
    }
  }
  return { schemaVersion: 1, acceptance: false, status: 'not-accepted', collectionComplete: inventoryErrors.length === 0,
    scope: 'Formed temp app before signing; CI diagnostic evidence only, not a distributable or compliance verdict.',
    manifestSHA256: sha256(fs.readFileSync(path.join(root, 'licenses/manifest.json'))),
    entries, packages, bundleSources: sources, mapErrors, inventoryErrors, native,
    candidates: classifyCandidates(manifest, entries, packages, sources) };
}

function nativeToolErrors(relative, architecture, links) {
  return [['lipo', architecture], ['otool', links]].filter(([, result]) => result.status !== 0 || result.error || result.signal)
    .map(([tool, result]) => ({ path: relative, error: `${tool} inventory tool failed`, exitCode: result.status, signal: result.signal ?? null }));
}

function inspectDynamicLinks(file, execute = spawnSync) {
  const options = { encoding: 'utf8', timeout: 10000, maxBuffer: 4 * 1024 * 1024 };
  // These are individual Mach-O files; helper basenames are not archive members.
  return execute('/usr/bin/otool', ['-m', '-L', file], options);
}

function assertTextArtifacts(directory) {
  for (const name of fs.readdirSync(directory)) {
    if (!ARTIFACTS.includes(name)) throw new Error('Unexpected diagnostic upload file');
    const file = regularFile(directory, name);
    const bytes = fs.readFileSync(file);
    if (bytes.includes(0)) throw new Error('Binary diagnostic upload rejected');
    if (name.endsWith('.json')) JSON.parse(bytes);
  }
}

async function afterPack(context) {
  assertDiagnosticEnv();
  const reportDir = path.join(process.env.RUNNER_TEMP, 'margin-package-inventory', 'reports');
  const root = context.packager.info.projectDir;
  if (path.resolve(root) !== ROOT || !process.env.MARGIN_INVENTORY_NONCE) throw new Error('Invalid diagnostic hook context');
  const resources = context.packager.getResourcesDir(context.appOutDir);
  const app = path.resolve(resources, '../..');
  const expected = path.join(process.env.RUNNER_TEMP, 'margin-package-inventory', 'package');
  if (!app.startsWith(expected + path.sep)) throw new Error('Diagnostic package outside dedicated runner output');
  let normalVerification;
  try { normalVerification = { passed: true, result: verifyBundle(resources, root) }; }
  catch (error) { normalVerification = { passed: false, error: scrub(error.message, root) }; }
  const manifest = json(path.join(root, 'licenses/manifest.json'));
  const report = await collectInventory({ app, root, manifest });
  report.normalVerification = normalVerification;
  report.status = normalVerification.passed ? 'not-accepted' : 'blocked/not-accepted';
  report.stopMarker = `MARGIN_PACKAGE_INVENTORY_STOP:${process.env.MARGIN_INVENTORY_NONCE}`;
  report.commit = process.env.GITHUB_SHA;
  report.run = process.env.GITHUB_RUN_ID;
  writeJSON(path.join(reportDir, 'inventory.json'), report);
  if (!report.collectionComplete) throw new Error('Package inventory is incomplete; inspect inventoryErrors');
  // No original signing hook is called; builder must stop before its own signing.
  throw new Error(report.stopMarker);
}

function expectedStop(result, report, marker) {
  return result.status !== null && result.status !== 0 && !result.signal && report?.collectionComplete === true &&
    report.acceptance === false && report.stopMarker === marker && typeof report.normalVerification?.passed === 'boolean' &&
    (result.stdout + result.stderr).includes(marker);
}

async function run() {
  assertDiagnosticEnv();
  const taskRoot = path.join(process.env.RUNNER_TEMP, 'margin-package-inventory');
  if (fs.existsSync(taskRoot)) throw new Error('Diagnostic output already exists; refusing stale evidence');
  const reportDir = path.join(taskRoot, 'reports');
  fs.mkdirSync(reportDir, { recursive: true });
  const nonce = crypto.randomUUID();
  const env = { ...process.env, MARGIN_INVENTORY_NONCE: nonce, CSC_IDENTITY_AUTO_DISCOVERY: 'false' };
  const commands = [
    ['build-electron', process.execPath, ['scripts/build-electron.js']],
    ['vite-build', path.join(ROOT, 'node_modules/.bin/vite'), ['build']],
    ['electron-builder', path.join(ROOT, 'node_modules/.bin/electron-builder'), ['--dir', '--mac', '--arm64', '--publish', 'never', '--config', 'scripts/margin/package-inventory.config.cjs']],
  ];
  const record = { schemaVersion: 1, acceptance: false, status: 'blocked/not-accepted', diagnosticSucceeded: false, commands: [] };
  try {
    // Rebuild temp identity from empty generated directories, not the release-contract outputs.
    for (const name of ['dist', 'dist-electron']) fs.rmSync(path.join(ROOT, name), { recursive: true, force: true });
    for (const [name, command, args] of commands) {
      const result = spawnSync(command, args, { cwd: ROOT, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 20 * 60 * 1000 });
      fs.writeFileSync(path.join(reportDir, name + '.log'), scrub((result.stdout ?? '') + (result.stderr ?? '')));
      record.commands.push({ name, command: path.basename(command), args, exitCode: result.status, signal: result.signal, error: result.error ? scrub(result.error.message) : null });
      if (name === 'electron-builder') {
        const reportFile = path.join(reportDir, 'inventory.json');
        const report = fs.existsSync(reportFile) ? json(reportFile) : null;
        if (!result.error && expectedStop(result, report, `MARGIN_PACKAGE_INVENTORY_STOP:${nonce}`)) record.diagnosticSucceeded = true;
        else {
          if (!report) {
            const app = path.join(taskRoot, 'package/mac-arm64/temp.app');
            let partial = { schemaVersion: 1, acceptance: false, status: 'blocked/not-accepted', collectionComplete: false };
            try {
              partial = { ...await collectInventory({ app, root: ROOT, manifest: json(path.join(ROOT, 'licenses/manifest.json')) }), status: 'blocked/not-accepted' };
              try { partial.normalVerification = { passed: true, result: verifyBundle(path.join(app, 'Contents/Resources'), ROOT) }; }
              catch (error) { partial.normalVerification = { passed: false, error: scrub(error.message) }; }
            } catch (error) { partial.error = scrub(error.message); }
            partial.builderFailedBeforeDiagnosticStop = true;
            writeJSON(reportFile, partial);
          }
          throw new Error('Builder did not terminate with a complete, uniquely matched diagnostic receipt');
        }
      } else if (result.status !== 0 || result.error) throw new Error(`${name} failed`);
    }
  } catch (error) { record.error = scrub(error.message); }
  writeJSON(path.join(reportDir, 'diagnostic-run.json'), record);
  assertTextArtifacts(reportDir);
  console.log(JSON.stringify({ diagnosticSucceeded: record.diagnosticSucceeded, acceptance: false, status: record.status }));
  return record.diagnosticSucceeded ? 0 : 1;
}

module.exports = { assertDiagnosticEnv, collectInventory, classifyCandidates, assertTextArtifacts, nativeToolErrors, inspectDynamicLinks, expectedStop, afterPack, run };
if (require.main === module) run().then((code) => { process.exitCode = code; }).catch((error) => { console.error(scrub(error.message)); process.exitCode = 1; });
