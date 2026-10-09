#!/usr/bin/env node
// S19-C corresponding source for one CI build (PLAN S19 item 3). GitHub Actions
// only, after `npm ci` and `setup:native` for the same commit. Writes <out>/ with:
//   app-<commit>.tar.gz      git archive of the commit (the AGPL work, its build
//                            scripts, lockfiles and notice inputs)
//   npm/                     published tarballs of every npm package in the
//                            notice inventory, checked against package-lock integrity
//   cargo/                   .crate files for the macOS arm64 native build, checked
//                            against Cargo.lock checksums
//   electron/                ffmpeg (LGPL) at the revision Chromium pins for this
//                            Electron, plus Electron's ffmpeg patch
//   MANIFEST.json            every file with sha256, plus where the libvips sources
//                            of the same run are kept
// Private CI artifact only; public availability is a separate decision (S19 item 3).
//   node scripts/margin/source-bundle.mjs <out>
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
if (process.env.CI !== 'true' || process.env.GITHUB_ACTIONS !== 'true') throw new Error('Source bundle runs only on GitHub Actions');
const out = path.resolve(process.argv[2]);
if (fs.existsSync(out)) throw new Error(`refusing existing output: ${out}`);
for (const dir of ['npm', 'cargo', 'electron']) fs.mkdirSync(path.join(out, dir), { recursive: true });
const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
// Build outputs are untracked or ignored; a tracked change would mean the build used
// something other than the commit, so it is kept as a diff and reported.
const status = execFileSync('git', ['status', '--porcelain', '--untracked-files=all'], { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean);
const trackedChanges = status.filter((line) => !line.startsWith('??'));
const json = (file) => JSON.parse(fs.readFileSync(path.join(ROOT, file), 'utf8'));
const sha = (algorithm, bytes, encoding = 'hex') => crypto.createHash(algorithm).update(bytes).digest(encoding);

async function download(url) {
  for (let attempt = 1; ; attempt++) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(300_000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return Buffer.from(await response.arrayBuffer());
    } catch (error) {
      if (attempt >= 3) throw new Error(`${url}: ${error.message}`);
      await new Promise((resolve) => setTimeout(resolve, attempt * 2000));
    }
  }
}

async function pool(items, limit, task) {
  const results = [];
  let next = 0;
  await Promise.all(Array.from({ length: limit }, async () => {
    while (next < items.length) { const index = next++; results[index] = await task(items[index]); }
  }));
  return results;
}

const manifest = { schemaVersion: 1, commit, run: `${process.env.GITHUB_RUN_ID}/${process.env.GITHUB_RUN_ATTEMPT}`,
  cleanTree: trackedChanges.length === 0, trackedChanges, untracked: status.filter((line) => line.startsWith('??')).map((line) => line.slice(3)), scope: 'Private CI corresponding-source artifact for this commit; not a public offer or legal verdict.', files: [] };
const record = (relative, extra = {}) => {
  const bytes = fs.readFileSync(path.join(out, relative));
  manifest.files.push({ path: relative, bytes: bytes.length, sha256: sha('sha256', bytes), ...extra });
};

// 1. The work itself.
const appArchive = `app-${commit}.tar.gz`;
execFileSync('git', ['archive', '--format=tar.gz', `--prefix=margin-${commit}/`, '-o', path.join(out, appArchive), commit], { cwd: ROOT });
record(appArchive, { kind: 'app', note: 'git archive of the built commit' });

if (trackedChanges.length) {
  fs.writeFileSync(path.join(out, 'working-tree.diff'), execFileSync('git', ['diff', 'HEAD'], { cwd: ROOT, maxBuffer: 256 * 1024 * 1024 }));
  record('working-tree.diff', { kind: 'app', note: 'tracked changes present when the bundle was made' });
}

// 2. npm packages of the notice inventory, by their locked tarball and integrity.
const lock = json('package-lock.json');
const seen = new Set();
const npm = json('licenses/manifest.json').components.filter((item) => item.kind === 'npm')
  .filter((item) => !seen.has(`${item.name}@${item.version}`) && seen.add(`${item.name}@${item.version}`));
await pool(npm, 8, async (component) => {
  const entry = lock.packages[component.location];
  if (!entry?.resolved || !entry.integrity) throw new Error(`no locked tarball: ${component.id}`);
  const bytes = await download(entry.resolved);
  const [algorithm, expected] = entry.integrity.split(' ')[0].split(/-(.*)/s);
  if (sha(algorithm, bytes, 'base64') !== expected) throw new Error(`integrity mismatch: ${component.id}`);
  const file = `npm/${component.name.replace('/', '__')}-${component.version}.tgz`;
  fs.writeFileSync(path.join(out, file), bytes);
  record(file, { kind: 'npm', package: `${component.name}@${component.version}`, resolved: entry.resolved, integrity: entry.integrity });
});

// 3. Crates of the macOS arm64 native build, from the registry cache setup:native filled.
const metadata = JSON.parse(execFileSync('cargo', ['metadata', '--offline', '--locked', '--format-version', '1', '--filter-platform', 'aarch64-apple-darwin'],
  { cwd: path.join(ROOT, 'native-module'), encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 }));
const checksums = new Map();
for (const block of fs.readFileSync(path.join(ROOT, 'native-module/Cargo.lock'), 'utf8').split('[[package]]')) {
  const field = (name) => block.match(new RegExp(`^${name} = "([^"]+)"`, 'm'))?.[1];
  if (field('checksum')) checksums.set(`${field('name')}@${field('version')}`, field('checksum'));
}
const cacheRoot = path.join(os.homedir(), '.cargo/registry/cache');
const caches = fs.readdirSync(cacheRoot).map((dir) => path.join(cacheRoot, dir));
const resolved = new Set(metadata.resolve.nodes.map((node) => node.id));
for (const pkg of metadata.packages.filter((item) => resolved.has(item.id) && item.source?.startsWith('registry+'))) {
  const key = `${pkg.name}@${pkg.version}`;
  const found = caches.map((dir) => path.join(dir, `${pkg.name}-${pkg.version}.crate`)).find((file) => fs.existsSync(file));
  if (!found) throw new Error(`crate not in registry cache: ${key}`);
  const bytes = fs.readFileSync(found);
  if (sha('sha256', bytes) !== checksums.get(key)) throw new Error(`Cargo.lock checksum mismatch: ${key}`);
  fs.writeFileSync(path.join(out, 'cargo', path.basename(found)), bytes);
  record(`cargo/${path.basename(found)}`, { kind: 'cargo', crate: key });
}

// 4. Electron's LGPL ffmpeg: the Chromium-pinned revision and Electron's patch.
const electronVersion = json('node_modules/electron/package.json').version;
const deps = (await download(`https://raw.githubusercontent.com/electron/electron/v${electronVersion}/DEPS`)).toString('utf8');
const chromium = deps.match(/'chromium_version':\s*'([^']+)'/)?.[1];
const chromiumDeps = Buffer.from((await download(`https://chromium.googlesource.com/chromium/src/+/refs/tags/${chromium}/DEPS?format=TEXT`)).toString('utf8'), 'base64').toString('utf8');
const ffmpeg = chromiumDeps.match(/'ffmpeg_revision':\s*'([0-9a-f]{40})'/)?.[1];
if (!chromium || !ffmpeg) throw new Error('could not resolve the Chromium ffmpeg revision');
fs.writeFileSync(path.join(out, `electron/ffmpeg-${ffmpeg}.tar.gz`), await download(`https://chromium.googlesource.com/chromium/third_party/ffmpeg/+archive/${ffmpeg}.tar.gz`));
record(`electron/ffmpeg-${ffmpeg}.tar.gz`, { kind: 'electron-ffmpeg', revision: ffmpeg, chromium });
const patchList = (await download(`https://raw.githubusercontent.com/electron/electron/v${electronVersion}/patches/ffmpeg/.patches`)).toString('utf8').split('\n').filter(Boolean);
for (const name of patchList) {
  fs.writeFileSync(path.join(out, `electron/ffmpeg-patch-${name}`), await download(`https://raw.githubusercontent.com/electron/electron/v${electronVersion}/patches/ffmpeg/${name}`));
  record(`electron/ffmpeg-patch-${name}`, { kind: 'electron-ffmpeg-patch' });
}
manifest.electron = {
  version: electronVersion, source: `https://github.com/electron/electron/tree/v${electronVersion}`, chromium,
  chromiumSource: `https://chromium.googlesource.com/chromium/src/+/refs/tags/${chromium}`, ffmpegRevision: ffmpeg,
  note: 'Electron is shipped unmodified from its release; its full source and Chromium build system are at the URLs above. ffmpeg is the LGPL library inside it (libffmpeg.dylib) and is included here with Electron\'s patch.',
};
manifest.libvips = {
  artifact: `margin-libvips-sources-${commit}`, binary: `margin-libvips-${commit}`, recipe: 'https://github.com/lovell/sharp-libvips/tree/20b5e899954907a3039d6e3d4c200aaa0ec52c4c',
  note: 'corresponding source of the libvips-cpp this package ships (S22): the recipe archive, every archive and patch it downloaded with manifest.tsv, and the crates compiled for librsvg with its Cargo.lock; the build log and the built tarball are in the binary artifact',
};
manifest.counts = Object.fromEntries(['app', 'npm', 'cargo', 'electron-ffmpeg', 'electron-ffmpeg-patch'].map((kind) => [kind, manifest.files.filter((item) => item.kind === kind).length]));
manifest.files.sort((a, b) => a.path.localeCompare(b.path));
fs.writeFileSync(path.join(out, 'MANIFEST.json'), JSON.stringify(manifest, null, 2) + '\n');
const manifestSHA = sha('sha256', fs.readFileSync(path.join(out, 'MANIFEST.json')));
fs.writeFileSync(path.join(out, 'BUILD-INFO.txt'), `commit: ${commit}\nrun: ${manifest.run}\n${manifestSHA}  MANIFEST.json\n`);
console.log(JSON.stringify({ commit, cleanTree: manifest.cleanTree, trackedChanges, untracked: manifest.untracked.length, counts: manifest.counts, bytes: manifest.files.reduce((n, item) => n + item.bytes, 0) }));
