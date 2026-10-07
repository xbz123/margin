#!/usr/bin/env node
// Runs the Margin ticket gates and keeps reviewable evidence (PLAN.md §5).
//   node scripts/margin/run-gates.mjs --out docs/margin/evidence/AG-13 \
//     [--ref docs/margin/evidence/pre-AG-13] [--only build,tests,...] [--skip regression]
//
// For every step it writes <out>/<step>.log (stdout and stderr as produced) and records
// the exact command, exit code and duration in <out>/summary.json. Two steps are
// compared with a reference run (--ref) instead of judged by exit code alone:
//   - tsc-electron: diagnostics are normalized (file + code + message, no line
//     numbers) and split into inherited / new / resolved;
//   - tests: failing tests (file + name, from the TAP report) are split the same way;
//   - preload-contract, ipc-channels: the listed gaps (indented lines) likewise.
// A step "passes" when its exit code is 0, or, for the compared steps, when nothing
// is new.
// The runner exits 1 if any step did not pass.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const BIN = (name) => path.join(REPO, 'node_modules/.bin', name);
const NODE = process.execPath;

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const out = path.resolve(REPO, arg('--out') ?? 'docs/margin/evidence/latest');
const ref = arg('--ref') ? path.resolve(REPO, arg('--ref')) : null;
const only = arg('--only')?.split(',');
const skip = arg('--skip')?.split(',') ?? [];

const TEST_GLOBS = [
  'electron/services/__tests__/**/*.test.mjs',
  'electron/llm/__tests__/**/*.test.mjs',
  'electron/audio/__tests__/**/*.test.mjs',
  'electron/margin/__tests__/**/*.test.mjs',
];

const steps = [
  { id: 'build-electron', cmd: NODE, args: ['scripts/build-electron.js'] },
  { id: 'vite-build', cmd: BIN('vite'), args: ['build'] },
  { id: 'tsc-renderer', cmd: BIN('tsc'), args: ['--noEmit', '-p', '.'] },
  { id: 'tsc-electron', cmd: BIN('tsc'), args: ['-p', 'electron/tsconfig.json', '--noEmit'], compare: 'diagnostics' },
  { id: 'provenance', cmd: NODE, args: ['scripts/margin/provenance-check.mjs'] },
  { id: 'retired', cmd: NODE, args: ['scripts/margin/retired-check.mjs'] },
  { id: 'preload-contract', cmd: NODE, args: ['scripts/margin/preload-contract-check.mjs'], compare: 'gaps' },
  { id: 'ipc-channels', cmd: NODE, args: ['scripts/margin/ipc-channel-check.mjs'], compare: 'gaps' },
  { id: 'guard-selftest', cmd: NODE, args: ['scripts/margin/isolation/run-node.mjs', '--allow-blocked', '--test',
    'scripts/margin/isolation/__tests__/guard.node.test.mjs', 'scripts/margin/isolation/__tests__/native-exports.node.test.mjs'] },
  { id: 'tests', cmd: NODE, compare: 'tests', timeoutMs: 1_800_000, args: ['scripts/margin/isolation/run-node.mjs', '--test',
    '--test-force-exit', '--test-timeout=60000',
    '--test-reporter=tap', `--test-reporter-destination=${path.join(out, 'tests.tap')}`, ...TEST_GLOBS] },
  { id: 'regression', cmd: NODE, args: ['scripts/margin/isolation/run-node.mjs', '--allow-exec', 'Electron', '--test',
    '--test-timeout=180000', 'tests/margin/answer-regression.test.mjs'], timeoutMs: 600_000 },
  { id: 'diff-check', cmd: 'git', args: ['diff', 'HEAD', '--check'] },
];

// "file(line,col): error TS1234: message" -> "file error TS1234: message ×count"
function tscDiagnostics(log) {
  const counts = new Map();
  for (const m of log.split('\n').map((l) => l.match(/^(\S+?)\(\d+,\d+\): (error TS\d+: .*)$/)).filter(Boolean)) {
    const key = `${m[1]} ${m[2].trim()}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts].map(([k, n]) => `${k} ×${n}`).sort();
}

// Failing tests from a node:test TAP report, as "file :: name". Parents of failing
// subtests are kept too; the comparison is still exact because both sides are
// produced the same way.
function tapFailures(tap) {
  const lines = tap.split('\n');
  const result = new Set();
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(\s*)not ok \d+ - (.*?)(\s+#.*)?$/);
    if (!m) continue;
    let file = '?';
    for (let j = i + 1; j < Math.min(lines.length, i + 40); j++) {
      const loc = lines[j].match(/^\s*location: '(.+?):\d+:\d+'/);
      if (loc) { file = path.relative(REPO, loc[1]); break; }
      if (/^\s*\.\.\.\s*$/.test(lines[j])) break;
    }
    result.add(`${file} :: ${m[2].replace(/\\#/g, '#')}`);
  }
  return [...result].sort();
}

function split(now, before) {
  const b = new Set(before);
  const n = new Set(now);
  return { inherited: now.filter((x) => b.has(x)), new: now.filter((x) => !b.has(x)), resolved: before.filter((x) => !n.has(x)) };
}

function readList(file) {
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean) : null;
}

fs.mkdirSync(out, { recursive: true });
const head = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: REPO, encoding: 'utf8' }).stdout.trim();
const dirty = spawnSync('git', ['status', '--porcelain'], { cwd: REPO, encoding: 'utf8' }).stdout.trim().split('\n').filter(Boolean);
const summary = { startedAt: new Date().toISOString(), head, uncommittedPaths: dirty.length, reference: ref ? path.relative(REPO, ref) : null, steps: [] };

for (const step of steps) {
  if (only && !only.includes(step.id)) continue;
  if (skip.includes(step.id)) continue;
  const log = path.join(out, `${step.id}.log`);
  const t0 = Date.now();
  process.stdout.write(`[gates] ${step.id} ... `);
  const res = spawnSync(step.cmd, step.args, { cwd: REPO, encoding: 'utf8', maxBuffer: 512 * 1024 * 1024, timeout: step.timeoutMs ?? 900_000 });
  const text = (res.stdout ?? '') + (res.stderr ? `\n--- stderr ---\n${res.stderr}` : '');
  fs.writeFileSync(log, text);
  const entry = {
    id: step.id,
    command: [path.relative(REPO, step.cmd) || step.cmd, ...step.args].join(' ').replace(REPO + '/', ''),
    exitCode: res.status,
    signal: res.signal ?? null,
    timedOut: res.error?.code === 'ETIMEDOUT',
    durationMs: Date.now() - t0,
    log: path.relative(REPO, log),
  };
  let passed = res.status === 0;
  if (step.compare === 'diagnostics') {
    const now = tscDiagnostics(text);
    fs.writeFileSync(path.join(out, 'tsc-electron.diagnostics.txt'), now.join('\n') + '\n');
    const before = ref && readList(path.join(ref, 'tsc-electron.diagnostics.txt'));
    entry.diagnostics = { total: now.length };
    if (before) {
      const s = split(now, before);
      entry.diagnostics = { total: now.length, inherited: s.inherited.length, new: s.new, resolved: s.resolved };
      passed = passed || s.new.length === 0;
    }
  }
  if (step.compare === 'gaps') {
    const now = [...new Set(text.split('\n').filter((l) => /^  \S/.test(l)).map((l) => l.trim()))].sort();
    const listFile = path.join(out, `${step.id}.gaps.txt`);
    fs.writeFileSync(listFile, now.join('\n') + (now.length ? '\n' : ''));
    const before = ref && readList(path.join(ref, `${step.id}.gaps.txt`));
    entry.gaps = { total: now.length };
    if (before) {
      const s = split(now, before);
      entry.gaps = { total: now.length, inherited: s.inherited.length, new: s.new, resolved: s.resolved };
      passed = passed || s.new.length === 0;
    }
  }
  if (step.compare === 'tests') {
    const tapFile = path.join(out, 'tests.tap');
    const tap = fs.existsSync(tapFile) ? fs.readFileSync(tapFile, 'utf8') : '';
    const counts = Object.fromEntries(['tests', 'pass', 'fail', 'skipped', 'cancelled', 'todo']
      .map((k) => [k, Number((tap.match(new RegExp(`^# ${k} (\\d+)`, 'm')) ?? [])[1] ?? NaN)]));
    const now = tapFailures(tap);
    fs.writeFileSync(path.join(out, 'test-failures.txt'), now.join('\n') + (now.length ? '\n' : ''));
    entry.tap = path.relative(REPO, tapFile);
    entry.counts = counts;
    const before = ref && readList(path.join(ref, 'test-failures.txt'));
    if (before) {
      const s = split(now, before);
      entry.failures = { total: now.length, inherited: s.inherited.length, new: s.new, resolved: s.resolved };
      passed = (res.status === 0 || s.new.length === 0) && !entry.timedOut && tap.length > 0;
    }
  }
  entry.passed = passed;
  summary.steps.push(entry);
  process.stdout.write(`exit ${res.status}${entry.timedOut ? ' (timed out)' : ''} ${passed ? 'PASS' : 'FAIL'} (${Math.round(entry.durationMs / 1000)}s)\n`);
}

summary.finishedAt = new Date().toISOString();
summary.allPassed = summary.steps.every((s) => s.passed);
fs.writeFileSync(path.join(out, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
console.log(`[gates] ${summary.allPassed ? 'all passed' : 'FAILED'}; summary: ${path.relative(REPO, path.join(out, 'summary.json'))}`);
process.exit(summary.allPassed ? 0 : 1);
