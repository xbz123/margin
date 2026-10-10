'use strict';

// AG-25 package checks (PLAN §5 phase 2 exit item 6). The same checks run on CI
// right after packaging and locally on the downloaded artifact. Read-only: the
// app is inspected, never launched here.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const MACHO = new Set(['feedface', 'cefaedfe', 'feedfacf', 'cffaedfe', 'cafebabe', 'bebafeca']);
// Retired or removed content that must not reach the package (PLAN §5 G3 and S21).
// Models are matched where upstream shipped them (extraResources resources/models
// to Resources/models) or the app's own resources/models, not any SDK path such
// as @elevenlabs/elevenlabs-js/api/resources/models.
const FORBIDDEN = [
  /^Resources\/(app\.asar(\.unpacked)?\/(resources\/)?)?models(\/|$)/,/\.onnx$/i, /(^|\/)onnxruntime[^/]*(\/|$)/i, /(^|\/)sqlite-vec[^/]*(\/|$)/i,
  /(^|\/)premium(\/|$)/i, /(^|\/)natively-api(\/|$)/i, /eng\.traineddata$/i, /\.gguf$/i,
  /(^|\/)@napi-rs\/canvas[^/]*(\/|$)/, /(^|\/)pdf-parse(\/|$)/, /(^|\/)pdfjs-dist(\/|$)/, /(^|\/)mammoth(\/|$)/,
  // S34: images go through Electron's nativeImage; sharp is a development tool only.
  /(^|\/)sharp(\/|$)/, /(^|\/)@img(\/|$)/, /libvips/i,
];

const run = (cmd, args) => spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 120_000 });
const sha256File = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

function walk(root) {
  const files = [];
  (function visit(dir) {
    for (const item of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const file = path.join(dir, item.name);
      if (item.isSymbolicLink()) files.push({ file, link: true });
      else if (item.isDirectory()) visit(file);
      else if (item.isFile()) files.push({ file, link: false });
    }
  })(root);
  return files;
}

function isMachO(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const head = Buffer.alloc(4);
    return fs.readSync(fd, head, 0, 4, 0) === 4 && MACHO.has(head.toString('hex'));
  } finally { fs.closeSync(fd); }
}

function plist(app, key) {
  const result = run('/usr/bin/plutil', ['-extract', key, 'raw', '-o', '-', path.join(app, 'Contents/Info.plist')]);
  return result.status === 0 ? result.stdout.trim() : null;
}

// identity: { name, appId } of the variant this app must carry.
function checkPackage(app, identity, { sourceRoot } = {}) {
  const checks = [];
  const add = (id, passed, detail) => checks.push({ id, passed: !!passed, detail });
  const contents = path.join(app, 'Contents');
  const resources = path.join(contents, 'Resources');

  for (const [key, expected] of [['CFBundleName', identity.name], ['CFBundleDisplayName', identity.name], ['CFBundleIdentifier', identity.appId]]) {
    const actual = plist(app, key);
    add(`info-plist:${key}`, actual === expected, { expected, actual });
  }
  add('executable-name', fs.existsSync(path.join(contents, 'MacOS', identity.name)), { expected: `MacOS/${identity.name}` });
  add('no-update-config', !fs.existsSync(path.join(resources, 'app-update.yml')), 'electron-builder writes app-update.yml only for a publish target');

  const asar = require('@electron/asar');
  const archive = path.join(resources, 'app.asar');
  const asarPaths = asar.listPackage(archive).map((entry) => entry.replace(/^\//, ''));
  const packaged = JSON.parse(asar.extractFile(archive, 'package.json').toString('utf8'));
  add('publish-null', packaged.build === undefined || packaged.build.publish === null || packaged.build.publish === undefined,
    { packagedBuildPublish: packaged.build?.publish ?? 'absent' });
  const builtIdentity = JSON.parse(asar.extractFile(archive, 'dist-electron/app-identity.json').toString('utf8'));
  add('built-identity', builtIdentity.name === identity.name && builtIdentity.appId === identity.appId, builtIdentity);

  const files = walk(contents);
  const relative = (file) => path.relative(contents, file).split(path.sep).join('/');
  const everything = [...files.map((item) => relative(item.file)), ...asarPaths.map((entry) => `Resources/app.asar/${entry}`)];
  const forbidden = everything.filter((entry) => FORBIDDEN.some((re) => re.test(entry)));
  add('forbidden-content', forbidden.length === 0, { matches: forbidden.slice(0, 50), count: forbidden.length, scanned: everything.length });

  const native = [];
  for (const item of files) {
    if (item.link || !isMachO(item.file)) continue;
    const archs = run('/usr/bin/lipo', ['-archs', item.file]);
    native.push({ path: relative(item.file), archs: archs.stdout.trim(), sha256: sha256File(item.file) });
  }
  const wrongArch = native.filter((entry) => entry.archs !== 'arm64');
  add('native-arm64', native.length > 0 && wrongArch.length === 0, { count: native.length, wrongArch });

  const verify = run('/usr/bin/codesign', ['--verify', '--deep', '--strict', '--verbose=2', app]);
  add('codesign-verify', verify.status === 0, (verify.stderr || verify.stdout).trim().split('\n').slice(-3));
  const info = run('/usr/bin/codesign', ['-dv', app]);
  add('ad-hoc-signature', /Signature=adhoc/.test(info.stderr), (info.stderr.match(/^(Signature|TeamIdentifier|Identifier)=.*$/gm) ?? []));

  if (sourceRoot) {
    try {
      const result = require('./license-bundle.cjs').verifyBundle(resources, sourceRoot);
      add('license-files', true, result);
    } catch (error) { add('license-files', false, error.message); }
  }
  return { passed: checks.every((check) => check.passed), identity, checks, native };
}

module.exports = { checkPackage, FORBIDDEN };

if (require.main === module) {
  const [app, name, appId, sourceRoot] = process.argv.slice(2);
  if (!app || !name || !appId) {
    console.error('usage: package-check.cjs <app> <name> <appId> [sourceRoot]');
    process.exit(2);
  }
  const report = checkPackage(path.resolve(app), { name, appId }, { sourceRoot: sourceRoot && path.resolve(sourceRoot) });
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = report.passed ? 0 : 1;
}
