#!/usr/bin/env node
// Collects notice candidates, not proof of what a packaged application distributes.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const noticeName = /^(licen[cs]e|copying|notice|copyright|patents)([._-]|$)/i;
const readJSON = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const slash = (value) => value.split(path.sep).join('/');
let githubViaGh = false;
const officialRepos = {
  '@alcalzone/ansi-tokenize': 'AlCalzone/ansi-tokenize',
  'node-options-to-argv': 'isaacs/node-options-to-argv',
  'cidre-macros': 'yury/cidre',
};

// S19-B accepts this weaker evidence only for these exact published artifacts.
const metadataMIT = {
  'npm:react-remove-scroll-bar@2.3.8': {
    artifactIntegrity: 'sha512-9r+yi9+mgU33AKcj6IbT9oRCO78WriSj6t/cF8DWBZJ9aOGPOTEDvdUDz1FwKim7QXWwmHqtdHnRJfhAxEG46Q==',
    metadataSHA256: 'e372f857ce05f266137c65293436b5380fec42ac311e6acb9378ed78b98d75d0',
  },
  'cargo:realfft@3.5.0': {
    artifactChecksum: 'f821338fddb99d089116342c46e9f1fbf3828dba077674613e734e01d6ea8677',
    metadataSHA256: 'd72ddbadf9bb55ed21ae973ac97f0bb4e8df2064af628c54b802b2c7d764c8de',
  },
};
const metadataMITCategory = 'approved-metadata-MIT';
const fixedMIT = {
  url: 'https://raw.githubusercontent.com/spdx/license-list-data/d46e94e2c78ceede1cfc63cfa0396472d2798d4c/text/MIT.txt',
  sha256: 'b05785f9f18e6716bab63424b11454513b9943a222595b70411009202fc592b5',
  gitBlob: 'd817195dad53ec992418c28ffca5fbd1cd86502a',
};

function verifiedMITMetadata(source, component, attachments, root, cargoRoot, output) {
  const policy = metadataMIT[component.kind + ':' + component.name + '@' + component.version];
  if (!policy || source.evidenceCategory !== metadataMITCategory || source.license !== 'MIT' ||
      source.metadataSHA256 !== policy.metadataSHA256 || source.localPath ||
      Object.entries(fixedMIT).some(([key, value]) => source[key] !== value)) throw new Error('metadata-MIT approval mismatch: ' + source.id);
  const artifactField = component.kind === 'npm' ? 'artifactIntegrity' : 'artifactChecksum';
  const componentField = component.kind === 'npm' ? 'integrity' : 'checksum';
  if (source[artifactField] !== policy[artifactField] || component[componentField] !== policy[artifactField]) throw new Error('metadata-MIT artifact mismatch: ' + source.id);
  const declarations = attachments.filter(item => item.id === source.metadataSourceId);
  const metadata = declarations[0];
  if (declarations.length !== 1 || metadata.id !== 'metadata:' + component.name || metadata.closesMissing !== false ||
      metadata.bind?.kind !== component.kind || metadata.bind?.name !== component.name ||
      metadata.version !== component.version || metadata.license !== 'MIT' ||
      metadata[artifactField] !== policy[artifactField] || metadata.sha256 !== policy.metadataSHA256) throw new Error('metadata-MIT declaration mismatch: ' + source.id);
  const bytes = fs.readFileSync(path.join(output, metadata.text.file));
  const metadataPath = component.kind === 'npm'
    ? path.join(root, component.location, 'package.json')
    : path.join(cargoRoot, component.name + '-' + component.version, 'Cargo.toml.orig');
  if (!fs.lstatSync(metadataPath).isFile()) throw new Error('metadata-MIT installed metadata must be a regular non-symlink file');
  const installed = fs.readFileSync(metadataPath);
  if (sha256(bytes) !== policy.metadataSHA256 || sha256(installed) !== policy.metadataSHA256 || !bytes.equals(installed)) throw new Error('metadata-MIT bytes changed: ' + source.id);
  let declared;
  if (component.kind === 'npm') declared = JSON.parse(bytes);
  else {
    const block = bytes.toString('utf8').split(/^\[package\]\s*$/m)[1]?.split(/^\[/m)[0];
    if (!block) throw new Error('metadata-MIT original Cargo package section missing');
    declared = Object.fromEntries(['name', 'version', 'license'].map(key => [key, JSON.parse(block.match(new RegExp('^' + key + ' = ("[^\\n]+")$', 'm'))?.[1] ?? 'null')]));
  }
  if (declared.name !== component.name || declared.version !== component.version || declared.license !== 'MIT') throw new Error('metadata-MIT identity/license mismatch: ' + source.id);
  return metadata.text;
}

export function noticeFiles(root) {
  const result = [];
  function visit(dir) {
    for (const item of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (['node_modules', 'target', '.git'].includes(item.name) || item.isSymbolicLink()) continue;
      const file = path.join(dir, item.name);
      if (item.isDirectory()) visit(file);
      else if (item.isFile() && noticeName.test(item.name)) result.push(file);
    }
  }
  visit(root);
  return result;
}

export function embeddedMIT(text) {
  return /Copyright/i.test(text) && /Permission is hereby granted/i.test(text) && /THE SOFTWARE IS PROVIDED/i.test(text) && /OTHER\s+DEALINGS\s+IN\s+THE\s+SOFTWARE\./i.test(text);
}

function embeddedNotices(root, addText, sourcePrefix) {
  const result = [];
  for (const name of fs.readdirSync(root).filter((value) => /^readme(?:\.[^.]+)?$/i.test(value))) {
    const bytes = fs.readFileSync(path.join(root, name));
    const text = bytes.toString('utf8');
    if (embeddedMIT(text)) result.push(addText(bytes, { sourcePath: `${sourcePrefix}/${name}`, origin: 'original installed README with complete embedded MIT license' }));
  }
  return result;
}

// Cargo's generated lock/manifests use JSON-compatible quoted scalar strings for
// these fields. This reads that subset only, not arbitrary TOML or dependency cfgs.
export function cargoPackages(text) {
  return text.split(/^\[\[package\]\]\s*$/m).slice(1).map((block) => {
    const field = (key) => {
      const value = block.match(new RegExp(`^${key} = ("[^\\n]+")$`, 'm'))?.[1];
      return value ? JSON.parse(value) : undefined;
    };
    const item = { name: field('name'), version: field('version'), source: field('source'), checksum: field('checksum') };
    if (!item.name || !item.version) throw new Error('unsupported Cargo.lock package metadata');
    return item;
  });
}

function bundledPackages(root) {
  const found = new Set();
  function visit(dir) {
    if (!fs.existsSync(dir)) throw new Error('build outputs are required before collecting bundled dependencies');
    for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, item.name);
      if (item.isDirectory()) visit(file);
      else if (item.name.endsWith('.map')) {
        for (const source of readJSON(file).sources ?? []) {
          const relative = slash(path.relative(root, path.resolve(path.dirname(file), source)));
          if (!relative.startsWith('node_modules/')) continue;
          const index = relative.lastIndexOf('node_modules/') + 'node_modules/'.length;
          const parts = relative.slice(index).split('/');
          found.add(relative.slice(0, index) + parts.slice(0, parts[0].startsWith('@') ? 2 : 1).join('/'));
        }
      }
    }
  }
  visit(path.join(root, 'dist-electron'));
  visit(path.join(root, 'dist'));
  return found;
}

function githubRepo(repository) {
  const value = typeof repository === 'string' ? repository : repository?.url;
  if (!value) return null;
  const match = value.match(/github\.com[:/]([^/]+\/[^/#]+?)(?:\.git)?(?:\/|$)/);
  return match ? match[1] : /^[\w.-]+\/[\w.-]+$/.test(value) ? value : null;
}

async function jsonURL(url) {
  if (githubViaGh && url.startsWith('https://api.github.com/')) {
    return JSON.parse(execFileSync('gh', ['api', url.slice('https://api.github.com/'.length)], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 20_000 }));
  }
  const response = await fetch(url, { headers: { 'user-agent': 'Margin-license-inventory' }, signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`license metadata HTTP ${response.status}: ${url}`);
  return response.json();
}

async function remoteNotices(component, addText) {
  let repo = component.repo;
  let ref = component.vcs;
  if (component.kind === 'npm') {
    const registry = await jsonURL(`https://registry.npmjs.org/${component.name.replace('/', '%2f')}/${component.version}`);
    if (registry.version !== component.version || registry.name !== component.name) throw new Error('registry version identity mismatch');
    ref = registry.gitHead;
    repo = githubRepo(registry.repository) ?? repo;
  }
  repo ??= officialRepos[component.name];
  if (!repo) throw new Error(`no versioned license repository for ${component.name}`);
  if (!ref) {
    const short = component.name.replace(/^@[^/]+\//, '');
    const tags = [`${component.name}@${component.version}`, `${short}-v${component.version}`, `${short}@${component.version}`, `v${component.version}`, component.version, `js-${component.version}`];
    for (const tag of tags) {
      try {
        let object = (await jsonURL(`https://api.github.com/repos/${repo}/git/ref/tags/${encodeURIComponent(tag)}`)).object;
        while (object.type === 'tag') object = (await jsonURL(object.url)).object;
        if (object.type === 'commit') { ref = object.sha; component.sourceTag = tag; break; }
      } catch { /* try the next exact-version tag */ }
    }
  }
  if (!/^[0-9a-f]{40}$/.test(ref ?? '')) throw new Error(`no immutable version reference for ${component.name}@${component.version}`);
  const tree = await jsonURL(`https://api.github.com/repos/${repo}/git/trees/${ref}?recursive=1`);
  if (tree.truncated) throw new Error(`truncated license tree for ${repo}`);
  const directories = new Set(['', component.directory ?? '']);
  if (component.name === '@bufbuild/protobuf') directories.add('packages/protobuf/src/google/protobuf');
  const candidates = tree.tree.filter((entry) => entry.type === 'blob' && noticeName.test(path.posix.basename(entry.path)) && directories.has(path.posix.dirname(entry.path) === '.' ? '' : path.posix.dirname(entry.path)));
  component.repo = repo;
  component.vcs = ref;
  for (const entry of candidates) {
    const url = `https://raw.githubusercontent.com/${repo}/${ref}/${entry.path}`;
    const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    if (!response.ok) throw new Error(`license text HTTP ${response.status}: ${url}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    const blob = crypto.createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
    if (blob !== entry.sha) throw new Error(`license Git blob mismatch: ${url}`);
    component.texts.push(addText(bytes, { url, gitBlob: entry.sha, sourcePath: entry.path }));
  }
  if (!component.texts.length) {
    for (const entry of tree.tree.filter((item) => item.type === 'blob' && /^readme(?:\.[^.]+)?$/i.test(path.posix.basename(item.path)) && directories.has(path.posix.dirname(item.path) === '.' ? '' : path.posix.dirname(item.path)))) {
      const url = `https://raw.githubusercontent.com/${repo}/${ref}/${entry.path}`;
      const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
      if (!response.ok) continue;
      const bytes = Buffer.from(await response.arrayBuffer());
      const blob = crypto.createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
      if (blob !== entry.sha) throw new Error(`license README Git blob mismatch: ${url}`);
      if (embeddedMIT(bytes.toString('utf8'))) component.texts.push(addText(bytes, { url, gitBlob: entry.sha, sourcePath: entry.path, origin: 'original official version README with complete embedded MIT license' }));
    }
  }
  if (!component.texts.length) throw new Error(`no full license text at version reference for ${component.name}`);
}

export function inventorySummary(manifest) {
  const texts = new Set([...manifest.components.flatMap((item) => item.texts), ...manifest.attachments.map((item) => item.text)].map((item) => item.file));
  const bindings = manifest.attachments.filter((item) => item.bind && item.closesMissing).map((item) =>
    `- ${item.bind.kind}:${item.bind.name}@${item.version}: ${item.license}${item.selectedLicense ? ` (selected ${item.selectedLicense})` : ''}${item.evidenceCategory === metadataMITCategory ? ' (published MIT metadata + standard terms; not a complete original notice)' : ''}`);
  const unresolved = manifest.unresolved.map((item) => `- ${item.id}`);
  return [
    'Generated from licenses/manifest.json; candidate inventory, not distribution acceptance.',
    `${manifest.components.length} candidates; ${texts.size} unique stored texts; ${manifest.excluded.length} excluded paths; ${manifest.unresolved.length} unresolved candidates; ${manifest.deferred.length} deferred notices.`,
    '', 'Current supplemental notice bindings:', ...(bindings.length ? bindings : ['None.']),
    '', 'Unresolved candidates:', ...(unresolved.length ? unresolved : ['None recorded; separate distribution obligations still require review.']),
  ].join('\n');
}

// AG-73: a package copies these notices from its own target's Electron distribution
// (package.json extraResources), and LICENSES.chromium.html differs by target. Targets
// other than the collection host are pinned from the official release zip, whose
// sha256 matched the release's SHASUMS256.txt.
const electronTargetNotices = {
  '43.1.0': {
    'win32-x64': {
      zip: 'https://github.com/electron/electron/releases/download/v43.1.0/electron-v43.1.0-win32-x64.zip',
      zipSHA256: 'a07dc1e3d5e589593d37e3b19d1b373e02bb58270e2eb0d6633eee0198ad09f0',
      'LICENSE': '5154e165bd6c2cc0cfbcd8916498c7abab0497923bafcd5cb07673fe8480087d',
      'LICENSES.chromium.html': 'b911161e6594ec76b872498b423c54406168f2974e0d407a847f7de1e5ff94dd',
    },
  },
};

export function electronNotices(root, version, host = `${process.platform}-${process.arch}`) {
  const pinned = electronTargetNotices[version] ?? {};
  return ['LICENSE', 'LICENSES.chromium.html'].map((file) => {
    const sourcePath = `node_modules/electron/dist/${file}`;
    const digest = sha256(fs.readFileSync(path.join(root, sourcePath)));
    if (pinned[host] && pinned[host][file] !== digest) throw new Error(`installed Electron ${file} differs from the pinned ${host} release`);
    const targets = { [host]: digest };
    for (const [target, notices] of Object.entries(pinned)) targets[target] = notices[file];
    return { sourcePath, file: `electron/${file}`, sha256: digest, targets, origin: `Electron ${version} installed distribution`, sourceURL: `https://github.com/electron/electron/releases/tag/v${version}` };
  });
}

function refreshInventorySummaries(root, manifest) {
  const start = '<!-- margin-license-inventory:start -->';
  const end = '<!-- margin-license-inventory:end -->';
  const summary = inventorySummary(manifest);
  const updates = ['licenses/README.md', 'NOTICE'].map((file) => {
    const destination = path.join(root, file);
    const text = fs.readFileSync(destination, 'utf8');
    const first = text.indexOf(start);
    const last = text.indexOf(end);
    if (first < 0 || last <= first || text.indexOf(start, first + start.length) >= 0 || text.indexOf(end, last + end.length) >= 0) throw new Error(`missing/ambiguous inventory summary markers: ${file}`);
    return [destination, text.slice(0, first + start.length) + '\n' + summary + '\n' + text.slice(last)];
  });
  for (const [destination, text] of updates) fs.writeFileSync(destination, text);
}

export async function collect({ root = ROOT, cargoRoot, fetchMissing = false, fetchOnly } = {}) {
  const output = path.join(root, 'licenses');
  fs.mkdirSync(path.join(output, 'texts'), { recursive: true });
  const old = fs.existsSync(path.join(output, 'manifest.json')) ? readJSON(path.join(output, 'manifest.json')) : null;
  const oldById = new Map((old?.components ?? []).map((item) => [item.id, item]));
  const texts = new Map();
  function addText(bytes, source) {
    if (!bytes.length || bytes.includes(0)) throw new Error('empty or binary notice text');
    const hash = sha256(bytes);
    const file = `texts/${hash}.txt`;
    fs.writeFileSync(path.join(output, file), bytes);
    texts.set(hash, file);
    return { file, sha256: hash, ...source };
  }
  const components = [];
  const excluded = [];
  const unresolved = [];
  const lock = readJSON(path.join(root, 'package-lock.json'));
  const bundled = bundledPackages(root);
  for (const [location, entry] of Object.entries(lock.packages).sort(([a], [b]) => a.localeCompare(b))) {
    if (!location || (entry.dev && !bundled.has(location))) continue;
    const manifest = path.join(root, location, 'package.json');
    if (!location.startsWith('node_modules/') || !fs.existsSync(manifest)) {
      const supports = (values, current) => !values?.length || (!values.includes(`!${current}`) && (!values.some((value) => !value.startsWith('!')) || values.includes(current) || values.includes('any')));
      const incompatible = entry.optional && (!supports(entry.os, process.platform) || !supports(entry.cpu, process.arch));
      if (incompatible) excluded.push({ location, version: entry.version, reason: 'not installed; optional OS/CPU does not match collection host' });
      else unresolved.push({ id: `lock:${location}`, reason: 'required/current-platform installed package metadata is missing' });
      continue;
    }
    const pkg = readJSON(manifest);
    if (pkg.version !== entry.version) throw new Error(`installed package version differs from lock: ${location}`);
    const component = { id: `npm:${pkg.name}@${pkg.version}:${location}`, kind: 'npm', name: pkg.name, version: pkg.version, location, license: pkg.license ?? pkg.licenses?.map((value) => value.type).join(' OR ') ?? null, integrity: entry.integrity ?? null, repo: githubRepo(pkg.repository) ?? officialRepos[pkg.name] ?? null, directory: pkg.repository?.directory, texts: [], basis: entry.dev ? 'embedded in current main bundle source maps' : 'installed non-dev lock candidate' };
    for (const file of noticeFiles(path.dirname(manifest))) component.texts.push(addText(fs.readFileSync(file), { sourcePath: slash(path.relative(root, file)), origin: 'installed package' }));
    if (!component.texts.length) component.texts.push(...embeddedNotices(path.dirname(manifest), addText, location));
    components.push(component);
  }
  if (!cargoRoot) {
    const registry = path.join(os.homedir(), '.cargo', 'registry', 'src');
    const folders = fs.existsSync(registry) ? fs.readdirSync(registry) : [];
    if (folders.length !== 1) throw new Error('pass --cargo-root for the existing registry source cache');
    cargoRoot = path.join(registry, folders[0]);
  }
  for (const item of cargoPackages(fs.readFileSync(path.join(root, 'native-module/Cargo.lock'), 'utf8'))) {
    if (!item.source?.startsWith('registry+')) continue;
    const dir = path.join(cargoRoot, `${item.name}-${item.version}`);
    if (!fs.existsSync(dir)) throw new Error(`cached crate missing: ${item.name}@${item.version}`);
    const packageBlock = fs.readFileSync(path.join(dir, 'Cargo.toml'), 'utf8').split(/^\[package\]\s*$/m)[1]?.split(/^\[/m)[0];
    if (!packageBlock) throw new Error('unsupported cached Cargo manifest');
    const field = (name) => JSON.parse(packageBlock.match(new RegExp(`^${name} = ("[^\\n]+")$`, 'm'))?.[1] ?? 'null');
    const vcs = fs.existsSync(path.join(dir, '.cargo_vcs_info.json')) ? readJSON(path.join(dir, '.cargo_vcs_info.json')) : {};
    const component = { id: `cargo:${item.name}@${item.version}`, kind: 'cargo', name: item.name, version: item.version, location: `Cargo.lock:${item.name}@${item.version}`, license: field('license'), checksum: item.checksum, repo: githubRepo(field('repository')) ?? officialRepos[item.name] ?? null, vcs: vcs.git?.sha1, directory: vcs.path_in_vcs, texts: [], basis: 'Cargo.lock candidate across all target platforms; not linked-binary inventory' };
    for (const file of noticeFiles(dir)) component.texts.push(addText(fs.readFileSync(file), { sourcePath: `${item.name}-${item.version}/${slash(path.relative(dir, file))}`, origin: 'cached crate' }));
    if (!component.texts.length) component.texts.push(...embeddedNotices(dir, addText, `${item.name}-${item.version}`));
    components.push(component);
  }
  for (const [name, version, file, license] of [['Inter', '4.1', 'src/font/Inter-4.1/LICENSE.txt', 'OFL-1.1']]) {
    components.push({ id: `asset:${name}@${version}`, kind: 'asset', name, version, license, texts: [addText(fs.readFileSync(path.join(root, file)), { sourcePath: file, origin: 'repository asset' })], basis: 'bundled font' });
  }
  const attachments = [];
  const sourcesFile = path.join(root, 'scripts/margin/license-sources.json');
  const sourceConfig = fs.existsSync(sourcesFile) ? readJSON(sourcesFile) : [];
  if (new Set(sourceConfig.map((source) => source.id)).size !== sourceConfig.length) throw new Error('duplicate supplemental notice id');
  for (const source of sourceConfig) {
    const previous = old?.attachments?.find((item) => item.id === source.id && item.url === source.url && item.version === source.version && item.license === source.license && item.role === source.role);
    let bytes;
    if (source.localPath) {
      const sourceFile = path.resolve(root, source.localPath);
      if (!sourceFile.startsWith(path.resolve(root) + path.sep)) throw new Error('local license source escapes repository');
      const original = fs.readFileSync(sourceFile);
      if (sha256(original) !== source.sourceSHA256) throw new Error('local license source changed');
      if (source.endBefore) {
        const text = original.toString('utf8');
        const end = text.indexOf(source.endBefore);
        if (end <= 0) throw new Error('license header boundary not found');
        bytes = Buffer.from(text.slice(0, end));
      } else bytes = original; // a verbatim original file
    } else if (previous) {
      bytes = fs.readFileSync(path.join(output, previous.text.file));
      if (sha256(bytes) !== previous.text.sha256) throw new Error('stored supplemental notice changed');
    } else {
      if (!fetchMissing) throw new Error(`supplemental notice not cached: ${source.id}`);
      const response = await fetch(source.url, { signal: AbortSignal.timeout(20_000) });
      if (!response.ok) throw new Error(`supplemental license HTTP ${response.status}: ${source.url}`);
      bytes = Buffer.from(await response.arrayBuffer());
      if (/<!doctype html|<html/i.test(bytes.toString('utf8', 0, 200))) throw new Error('HTML instead of license text');
    }
    const blob = crypto.createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
    if ((source.sha256 && sha256(bytes) !== source.sha256) || (source.gitBlob && blob !== source.gitBlob)) throw new Error(`supplemental license hash mismatch: ${source.id}`);
    const attachment = { ...source, text: addText(bytes, { url: source.url, gitBlob: blob, origin: source.role }) };
    attachments.push(attachment);
  }
  // Resolve supplemental bindings after loading declarations, independent of source order.
  for (const source of attachments) {
    if (source.bind && source.closesMissing) {
      const component = components.find((item) => item.kind === source.bind.kind && item.name === source.bind.name && item.version === source.version && item.license === source.license);
      if (!component) throw new Error(`canonical license binding identity mismatch: ${source.id}`);
      if (source.evidenceCategory === metadataMITCategory || metadataMIT[component.kind + ':' + component.name + '@' + component.version]) {
        component.texts.push(verifiedMITMetadata(source, component, attachments, root, cargoRoot, output));
        component.evidenceCategory = metadataMITCategory;
        component.noticeBasis = 'published MIT metadata + fixed official standard terms; not a complete original notice/copyright grant, legal verdict or native distribution acceptance';
      } else component.noticeBasis = 'exact-version declared standard license plus authoritative standard full text; not a substituted copyright grant';
      component.texts.push(source.text);
    }
  }
  for (const component of components) {
    if (component.texts.length) continue;
    const previous = oldById.get(component.id);
    if (previous?.texts?.length && previous.vcs && /^[0-9a-f]{40}$/.test(previous.vcs) && previous.version === component.version && previous.license === component.license && previous.integrity === component.integrity && previous.checksum === component.checksum && previous.repo === component.repo && previous.directory === component.directory && previous.texts.every((text) => text.url === `https://raw.githubusercontent.com/${previous.repo}/${previous.vcs}/${text.sourcePath}`)) {
      for (const text of previous.texts) {
        const bytes = fs.readFileSync(path.join(output, text.file));
        if (sha256(bytes) !== text.sha256) throw new Error(`stored notice changed: ${text.file}`);
        if (crypto.createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex') !== text.gitBlob) throw new Error('stored notice Git blob metadata mismatch');
        component.texts.push(addText(bytes, text));
      }
      for (const key of ['repo', 'vcs', 'sourceTag']) if (previous[key]) component[key] = previous[key];
    } else if (fetchMissing && (!fetchOnly || fetchOnly === component.id)) {
      try { await remoteNotices(component, addText); }
      catch (error) { unresolved.push({ id: component.id, reason: error.message }); }
    } else unresolved.push({ id: component.id, reason: 'no local full notice; retrieve an immutable official license source' });
  }
  const electron = readJSON(path.join(root, 'node_modules/electron/package.json'));
  const deferred = electronNotices(root, electron.version);
  const manifest = { schemaVersion: 1, scope: 'Candidate notice inventory, not an actual app package or legal-compliance verdict. Native vendored dependencies and copyleft obligations require the documented package review.', packageLockSHA256: sha256(fs.readFileSync(path.join(root, 'package-lock.json'))), cargoLockSHA256: sha256(fs.readFileSync(path.join(root, 'native-module/Cargo.lock'))), sourceConfigSHA256: fs.existsSync(sourcesFile) ? sha256(fs.readFileSync(sourcesFile)) : null, electronVersion: electron.version, components, attachments, excluded, unresolved, deferred };
  fs.writeFileSync(path.join(output, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  refreshInventorySummaries(root, manifest);
  console.log(JSON.stringify({ candidates: components.length, uniqueTexts: texts.size, excluded: excluded.length, unresolved: unresolved.length, deferred: deferred.length }));
  return manifest;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  githubViaGh = process.argv.includes('--github-via-gh');
  const index = process.argv.indexOf('--cargo-root');
  const onlyIndex = process.argv.indexOf('--fetch-only');
  const result = await collect({ cargoRoot: index < 0 ? undefined : process.argv[index + 1], fetchMissing: process.argv.includes('--fetch-missing'), fetchOnly: onlyIndex < 0 ? undefined : process.argv[onlyIndex + 1] });
  for (const item of result.unresolved) console.error(`${item.id}: ${item.reason}`);
  if (result.unresolved.length) process.exitCode = 1;
}
