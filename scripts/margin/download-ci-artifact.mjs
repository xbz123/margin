#!/usr/bin/env node
// AG-25: downloads one workflow artifact with `gh run download` and checks every
// file listed in its BUILD-INFO.txt against the recorded sha256 before anything
// uses it. With --install-native the verified CI native module replaces the local
// one (PLAN S11 item 5: local development stops using the X3 cargo cache build).
//   node scripts/margin/download-ci-artifact.mjs --run <id> --name <artifact> --out <dir>
//     [--commit <sha>] [--install-native]
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const REPO = 'xbz123/Assessment-Assistant';

export function readBuildInfo(text) {
  const fields = {};
  const files = [];
  for (const line of text.split('\n')) {
    const digest = line.match(/^([0-9a-f]{64})\s+\*?(.+)$/);
    if (digest) files.push({ sha256: digest[1], file: path.basename(digest[2].trim()) });
    else {
      const field = line.match(/^([\w ]+):\s*(.*)$/);
      if (field) fields[field[1].trim()] = field[2].trim();
    }
  }
  return { fields, files };
}

export function verifyDirectory(dir, { commit } = {}) {
  const info = readBuildInfo(fs.readFileSync(path.join(dir, 'BUILD-INFO.txt'), 'utf8'));
  if (!info.files.length) throw new Error('BUILD-INFO.txt lists no sha256');
  if (commit && info.fields.commit !== commit) throw new Error(`artifact commit ${info.fields.commit} is not ${commit}`);
  for (const { file, sha256 } of info.files) {
    const actual = crypto.createHash('sha256').update(fs.readFileSync(path.join(dir, file))).digest('hex');
    if (actual !== sha256) throw new Error(`sha256 mismatch: ${file}`);
  }
  return info;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arg = (name) => { const i = process.argv.indexOf(name); return i < 0 ? undefined : process.argv[i + 1]; };
  const run = arg('--run');
  const name = arg('--name');
  const out = arg('--out') && path.resolve(arg('--out'));
  if (!run || !name || !out) throw new Error('usage: --run <id> --name <artifact> --out <dir> [--commit <sha>] [--install-native]');
  if (fs.existsSync(out) && fs.readdirSync(out).length) throw new Error(`refusing non-empty output: ${out}`);
  execFileSync('gh', ['run', 'download', run, '--repo', REPO, '--name', name, '--dir', out], { stdio: 'inherit' });
  const info = verifyDirectory(out, { commit: arg('--commit') });
  console.log(JSON.stringify({ verified: info.files, commit: info.fields.commit, run: info.fields.run }));
  if (process.argv.includes('--install-native')) {
    if (!info.files.some((item) => item.file === 'index.darwin-arm64.node')) throw new Error('artifact has no verified native module');
    const target = path.join(ROOT, 'native-module/index.darwin-arm64.node');
    if (fs.existsSync(target)) fs.copyFileSync(target, path.join(out, 'previous-index.darwin-arm64.node'));
    fs.copyFileSync(path.join(out, 'index.darwin-arm64.node'), target);
    console.log(`installed the verified CI native module from run ${info.fields.run}`);
  }
}
