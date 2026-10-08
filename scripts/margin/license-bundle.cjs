// electron-builder afterPack: verify actual copied notice bytes before signing.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const hash = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

function checkedFile(root, relative) {
  const file = path.resolve(root, relative);
  if (file === root || !file.startsWith(path.resolve(root) + path.sep)) throw new Error('notice path escapes Resources');
  const parts = path.relative(root, file).split(path.sep);
  let current = root;
  for (const part of parts) {
    current = path.join(current, part);
    if (fs.lstatSync(current).isSymbolicLink()) throw new Error('notice path is a symlink');
  }
  if (!fs.statSync(file).isFile()) throw new Error('notice path is not a file');
  return fs.readFileSync(file);
}

function verifyBundle(resources, sourceRoot) {
  const manifestBytes = checkedFile(resources, 'licenses/manifest.json');
  const source = fs.readFileSync(path.join(sourceRoot, 'licenses/manifest.json'));
  if (hash(manifestBytes) !== hash(source)) throw new Error('packaged notice inventory differs from source');
  const manifest = JSON.parse(manifestBytes);
  if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.components) || !Array.isArray(manifest.deferred)) throw new Error('unsupported notice inventory');
  for (const name of ['LICENSE', 'NOTICE']) {
    if (hash(checkedFile(resources, name)) !== hash(fs.readFileSync(path.join(sourceRoot, name)))) throw new Error(`packaged ${name} differs from source`);
  }
  const pkg = JSON.parse(fs.readFileSync(path.join(sourceRoot, 'package.json')));
  const lock = JSON.parse(fs.readFileSync(path.join(sourceRoot, 'package-lock.json')));
  if (pkg.license !== 'AGPL-3.0-only' || lock.packages[''].license !== pkg.license) throw new Error('application license metadata mismatch');
  if (hash(fs.readFileSync(path.join(sourceRoot, 'package-lock.json'))) !== manifest.packageLockSHA256 || hash(fs.readFileSync(path.join(sourceRoot, 'native-module/Cargo.lock'))) !== manifest.cargoLockSHA256) throw new Error('notice inventory is stale for current lockfiles');
  if (manifest.sourceConfigSHA256 && hash(fs.readFileSync(path.join(sourceRoot, 'scripts/margin/license-sources.json'))) !== manifest.sourceConfigSHA256) throw new Error('supplemental notice sources changed');
  const electron = JSON.parse(fs.readFileSync(path.join(sourceRoot, 'node_modules/electron/package.json')));
  if (electron.version !== manifest.electronVersion) throw new Error('Electron version differs from notice inventory');
  const notices = [...manifest.components.flatMap((item) => item.texts), ...(manifest.attachments ?? []).map((item) => item.text), ...manifest.deferred];
  if (!notices.length || manifest.deferred.length !== 2) throw new Error('missing fixed Electron notices');
  if (manifest.deferred.map((item) => item.file).sort().join(',') !== 'electron/LICENSE,electron/LICENSES.chromium.html') throw new Error('missing full fixed Electron/Chromium notices');
  for (const notice of notices) {
    if (!/^(texts\/[0-9a-f]{64}\.txt|electron\/(LICENSE|LICENSES\.chromium\.html))$/.test(notice.file)) throw new Error('invalid notice destination');
    if (!/^[0-9a-f]{64}$/.test(notice.sha256) || hash(checkedFile(resources, `licenses/${notice.file}`)) !== notice.sha256) throw new Error(`missing/changed notice: ${notice.file}`);
  }
  // The conservative candidate list may contain non-shipped entries. Resolve or
  // explicitly exclude them with artifact evidence; never hide them at packaging.
  if (manifest.unresolved.length) throw new Error(`unresolved notice candidates: ${manifest.unresolved.length}; inspect the package before distribution`);
  return { checkedNotices: notices.length, candidateInventoryOnly: true };
}

module.exports.verifyBundle = verifyBundle;
module.exports.default = async (context) => {
  const root = context.packager.info.projectDir;
  const resources = context.packager.getResourcesDir(context.appOutDir);
  console.log('[License notices]', JSON.stringify(verifyBundle(resources, root)));
  await require('../ad-hoc-sign.js').default(context);
};
