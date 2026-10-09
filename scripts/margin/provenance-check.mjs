#!/usr/bin/env node
// Provenance audit aid for the Margin AGPL branch (PLAN.md X1 / gate G2).
//
// Flags "substantive" lines (trimmed, longer than MIN_LEN characters) that this
// branch adds on top of the AGPL baseline and that also appear in upstream code
// outside the approved sources. A hit means "look at this"; no hit does not prove a
// right to use the code. Rewritten code, short lines and binary assets are not
// detected; binary files that were added or changed are listed for manual review.
//
// Usage:
//   node scripts/margin/provenance-check.mjs                 # HEAD + working tree vs baseline
//   node scripts/margin/provenance-check.mjs --target <ref>  # a commit vs baseline
//   node scripts/margin/provenance-check.mjs --files a.ts b.ts  # treat every line of these files as added
//   options: --json, --max-hits <n> (lines printed per file, default 20), --no-cache

import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
const CONFIG_PATH = path.join(ROOT, 'docs/margin/provenance-config.json');
const CACHE_DIR = path.join(ROOT, '.margin-cache/provenance');
const MIN_LEN = 12;
const TEXT_EXT = /\.(ts|tsx|js|jsx|mjs|cjs|rs|mm|m|swift|c|cc|cpp|h|css|scss|html|md|py|sh|toml|yml|yaml)$/i;

const args = process.argv.slice(2);
const opt = (name) => args.includes(name);
const val = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
const git = (...a) => execFileSync('git', a, { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 30 });
const resolve = (ref) => git('rev-parse', '--verify', `${ref}^{commit}`).trim();

const norm = (line) => line.trim();
const key = (line) => createHash('sha1').update(line).digest('base64').slice(0, 16);

// Reads many blobs through one `git cat-file --batch` process.
function readBlobs(shas) {
  const out = new Map();
  const chunk = 2000;
  for (let i = 0; i < shas.length; i += chunk) {
    const part = shas.slice(i, i + chunk);
    const res = spawnSync('git', ['cat-file', '--batch'], {
      cwd: ROOT, input: part.join('\n') + '\n', maxBuffer: 2 ** 31,
    });
    const buf = res.stdout;
    let pos = 0;
    while (pos < buf.length) {
      const nl = buf.indexOf(10, pos);
      const [sha, type, sizeStr] = buf.subarray(pos, nl).toString().split(' ');
      if (type === 'missing') { pos = nl + 1; continue; }
      const size = Number(sizeStr);
      out.set(sha, buf.subarray(nl + 1, nl + 1 + size));
      pos = nl + 1 + size + 1;
    }
  }
  return out;
}

const isBinary = (buf) => buf.subarray(0, 8000).includes(0);

function addLines(set, text) {
  for (const raw of text.split('\n')) {
    const l = norm(raw);
    if (l.length > MIN_LEN) set.add(key(l));
  }
}

// Line keys of every text blob reachable from `refs` but not from `notRefs`.
function blobPool(refs, notRefs) {
  const list = git('rev-list', '--objects', ...refs, ...(notRefs.length ? ['--not', ...notRefs] : []));
  const shas = new Set();
  for (const row of list.split('\n')) {
    const sp = row.indexOf(' ');
    if (sp < 0) continue;
    if (TEXT_EXT.test(row.slice(sp + 1))) shas.add(row.slice(0, sp));
  }
  const pool = new Set();
  for (const buf of readBlobs([...shas]).values()) {
    if (!isBinary(buf)) addLines(pool, buf.toString('utf8'));
  }
  return { pool, blobs: shas.size };
}

function cached(name, inputs, build) {
  const file = path.join(CACHE_DIR, `${name}-${createHash('sha1').update(JSON.stringify(inputs)).digest('hex').slice(0, 12)}.txt`);
  if (!opt('--no-cache') && fs.existsSync(file)) {
    return new Set(fs.readFileSync(file, 'utf8').split('\n').filter(Boolean));
  }
  const set = build();
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(file, [...set].join('\n'));
  return set;
}

// ---- pools -------------------------------------------------------------------
const base = resolve(config.baseline);
const approvedRefs = [base];
const restrictedRefs = [
  ...git('for-each-ref', '--format=%(objectname)', ...config.restrictedRefPrefixes).split('\n').filter(Boolean),
  ...config.restrictedExtraRefs.map(resolve),
];

// Individually reviewed files from other commits (PROVENANCE.md). Such a commit may be
// missing from a clone: the public repository holds only this branch (PLAN S25). So
// each entry names a checked-in copy and its git blob id. The copy must hash to that
// id, and so must the file at the commit whenever the commit is present.
function approvedFileText({ ref, path: p, blob, copy }) {
  const file = path.join(ROOT, copy);
  const copyBlob = git('hash-object', '--no-filters', file).trim();
  if (copyBlob !== blob) throw new Error(`approved copy ${copy} is ${copyBlob}, not ${blob}`);
  if (spawnSync('git', ['cat-file', '-e', `${ref}^{commit}`], { cwd: ROOT }).status === 0) {
    const atRef = git('rev-parse', `${ref}:${p}`).trim();
    if (atRef !== blob) throw new Error(`${ref}:${p} is ${atRef}, not ${blob}`);
  }
  return fs.readFileSync(file, 'utf8');
}
const approvedFileTexts = config.approvedFiles.map(approvedFileText);

const approved = cached('approved', { approvedRefs, extra: config.approvedFiles, ext: TEXT_EXT.source, MIN_LEN }, () => {
  const { pool } = blobPool(approvedRefs, []);
  // Extra approved sources: line-key files checked in next to the config, and
  // individually reviewed files from other commits (recorded in PROVENANCE.md).
  for (const f of config.approvedLineKeyFiles) {
    for (const k of fs.readFileSync(path.join(ROOT, f), 'utf8').split('\n')) if (k) pool.add(k);
  }
  for (const text of approvedFileTexts) addLines(pool, text);
  return pool;
});

const restricted = cached('restricted', { restrictedRefs, base, ext: TEXT_EXT.source, MIN_LEN }, () => {
  const { pool } = blobPool(restrictedRefs, approvedRefs);
  for (const k of approved) pool.delete(k);
  return pool;
});

// ---- added lines -------------------------------------------------------------
const excluded = (p) => config.excludePaths.some((e) => p === e || p.startsWith(e.endsWith('/') ? e : e + '/'));
const added = []; // { file, line, text }
const binaries = [];

function collectDiff(diffArgs) {
  const diff = git('diff', '--no-color', '--no-renames', '--unified=0', ...diffArgs);
  let file = null;
  let lineNo = 0;
  for (const row of diff.split('\n')) {
    if (row.startsWith('+++ ')) { file = row.startsWith('+++ b/') ? row.slice(6) : null; continue; }
    if (row.startsWith('Binary files ')) {
      const m = row.match(/ and b\/(.+) differ$/);
      if (m && !excluded(m[1])) binaries.push(m[1]);
      continue;
    }
    if (row.startsWith('@@')) { lineNo = Number(row.match(/\+(\d+)/)[1]); continue; }
    if (row.startsWith('+') && file) {
      if (!excluded(file)) added.push({ file, line: lineNo, text: row.slice(1) });
      lineNo++;
    }
  }
}

let targetLabel;
if (opt('--files')) {
  const files = args.slice(args.indexOf('--files') + 1).filter((a) => !a.startsWith('--'));
  targetLabel = `files: ${files.join(', ')}`;
  for (const f of files) {
    fs.readFileSync(f, 'utf8').split('\n').forEach((text, i) => added.push({ file: f, line: i + 1, text }));
  }
} else if (val('--target')) {
  const t = resolve(val('--target'));
  targetLabel = `${val('--target')} (${t.slice(0, 10)})`;
  collectDiff([base, t]);
} else {
  targetLabel = 'HEAD + working tree';
  collectDiff([base]);
  const untracked = git('ls-files', '--others', '--exclude-standard').split('\n').filter((p) => p && !excluded(p));
  for (const p of untracked) {
    const buf = fs.readFileSync(path.join(ROOT, p));
    if (isBinary(buf)) { binaries.push(p); continue; }
    buf.toString('utf8').split('\n').forEach((text, i) => added.push({ file: p, line: i + 1, text }));
  }
}

// ---- compare -----------------------------------------------------------------
// Generic idioms carry no authorship: imports of Node built-ins or packages (never
// relative paths, which name upstream modules), 'use strict', empty initialisers and
// argv slicing. They are reported separately, not hidden.
const GENERIC = [
  /^import\s+[\w{}\s,*]+\s+from\s+['"](node:[\w/]+|@?[\w][\w./-]*)['"];?$/,
  /^(const|let|var)\s+[\w{}\s,:]+\s*=\s*require\(['"](node:[\w/]+|@?[\w][\w./-]*)['"]\)(\.\w+)?;?$/,
  /^['"]use strict['"];?$/,
  /^(const|let|var)\s+\w+\s*=\s*(\{\}|\[\]|null|0|''|""|false|true|new Map\(\)|new Set\(\));$/,
  /^(const|let)\s+\w+\s*=\s*process\.argv\.slice\(2\);$/,
];
const isGeneric = (l) => GENERIC.some((re) => re.test(l));

const allow = new Map(config.allowLines.map((a) => [norm(a.line), a.reason]));
const byFile = new Map();
const generic = [];
let substantive = 0;
let allowed = 0;
for (const a of added) {
  const l = norm(a.text);
  if (l.length <= MIN_LEN) continue;
  substantive++;
  const k = key(l);
  if (!restricted.has(k)) continue;
  if (allow.has(l)) { allowed++; continue; }
  if (isGeneric(l)) { generic.push({ file: a.file, line: a.line, text: l }); continue; }
  if (!byFile.has(a.file)) byFile.set(a.file, []);
  byFile.get(a.file).push(a);
}
const hits = [...byFile.values()].reduce((n, v) => n + v.length, 0);

const summary = {
  target: targetLabel,
  baseline: base,
  approvedLineKeys: approved.size,
  restrictedLineKeys: restricted.size,
  addedSubstantiveLines: substantive,
  hits,
  genericIdiomHits: generic.length,
  allowlistedHits: allowed,
  filesWithHits: byFile.size,
  binariesToReviewByHand: binaries,
};

if (opt('--json')) {
  console.log(JSON.stringify({ ...summary, genericIdioms: generic, hitsByFile: Object.fromEntries([...byFile].map(([f, v]) => [f, v.map(({ line, text }) => ({ line, text: norm(text) }))])) }, null, 2));
} else {
  const max = Number(val('--max-hits', 20));
  for (const [f, v] of [...byFile].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`\n${f}: ${v.length} hit(s)`);
    for (const h of v.slice(0, max)) console.log(`  ${h.line}: ${norm(h.text).slice(0, 140)}`);
    if (v.length > max) console.log(`  ... ${v.length - max} more`);
  }
  console.log('\n' + JSON.stringify(summary, null, 2));
}
process.exitCode = hits === 0 ? 0 : 1; // not process.exit(): let piped stdout flush
