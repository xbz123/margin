#!/usr/bin/env node
// Runs the Margin ticket gates and keeps reviewable evidence (PLAN.md §5).
//   node scripts/margin/run-gates.mjs --out docs/margin/evidence/AG-13 \
//     [--ref docs/margin/evidence/pre-AG-13] [--only build,tests,...] [--skip regression]
//     [--note "how this run was made"]
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

import { spawn, spawnSync } from 'node:child_process';
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
  // esbuild never deletes outputs, so modules removed from the source would linger in
  // dist-electron and tests importing them could still pass. Start from an empty dir.
  { id: 'clean-dist', cmd: NODE, args: ['-e', "require('fs').rmSync('dist-electron', { recursive: true, force: true })"] },
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
  // One guarded node process per test file (see runTestFiles), so a file that hangs
  // cannot stop the others from reporting and every count comes from a TAP footer.
  { id: 'tests', custom: 'testFiles', compare: 'tests' },
  { id: 'regression', cmd: NODE, args: ['scripts/margin/isolation/run-node.mjs', '--allow-exec', 'Electron', '--test',
    '--test-timeout=180000', 'tests/margin/answer-regression.test.mjs'], timeoutMs: 600_000 },
  { id: 'storage', cmd: NODE, args: ['scripts/margin/isolation/run-node.mjs', '--allow-exec', 'Electron', '--test',
    '--test-timeout=240000', 'tests/margin/meeting-storage.test.mjs'], timeoutMs: 600_000 },
  { id: 'diff-check', cmd: 'git', args: ['diff', 'HEAD', '--check'] },
];

const TEST_FILE_TIMEOUT_MS = 180_000;
const TEST_FOOTER_GRACE_MS = 5_000;
const TEST_CONCURRENCY = 4;

// Runs every test file matched by TEST_GLOBS in its own guarded process
// (run-node.mjs) with a TAP reporter and a wall-clock limit. A file that does not
// finish in time is killed; if its TAP has no "# tests" footer it is reported as
// "file :: <did not finish>" so it counts as a failure instead of vanishing. Some
// baseline test files leave handles open after their last test; once a file's TAP
// footer has arrived (every test reported) it gets TEST_FOOTER_GRACE_MS to exit and
// is then ended, which is recorded as `endedAfterFooter`.
async function runTestFiles() {
  const files = [...new Set(TEST_GLOBS.flatMap((g) => fs.globSync(g, { cwd: REPO })))].sort();
  const results = new Array(files.length);
  let next = 0;
  async function worker() {
    while (next < files.length) {
      const i = next++;
      const file = files[i];
      const t0 = Date.now();
      results[i] = await new Promise((resolve) => {
        const child = spawn(NODE, ['scripts/margin/isolation/run-node.mjs', '--test', '--test-timeout=60000',
          '--test-reporter=tap', file], { cwd: REPO, detached: true });
        // run-node.mjs passes its stdio to the real test process, so end the whole
        // process group; killing only run-node would leave the pipe open.
        const killGroup = () => { try { process.kill(-child.pid, 'SIGKILL'); } catch { /* already gone */ } };
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (d) => { stdout += d; });
        child.stderr.on('data', (d) => { stderr += d; });
        let timedOut = false;
        let endedAfterFooter = false;
        let graceTimer = null;
        const timer = setTimeout(() => { timedOut = true; killGroup(); }, TEST_FILE_TIMEOUT_MS);
        child.stdout.on('data', () => {
          if (!graceTimer && /^# todo \d+\s*$/m.test(stdout)) {
            graceTimer = setTimeout(() => { endedAfterFooter = true; killGroup(); }, TEST_FOOTER_GRACE_MS);
          }
        });
        child.on('close', (code, signal) => {
          clearTimeout(timer);
          if (graceTimer) clearTimeout(graceTimer);
          resolve({ file, exitCode: code, signal, timedOut, endedAfterFooter, durationMs: Date.now() - t0, tap: stdout, stderr });
        });
      });
    }
  }
  await Promise.all(Array.from({ length: TEST_CONCURRENCY }, worker));

  const footer = (tap, key) => Number((tap.match(new RegExp(`^# ${key} (\\d+)`, 'm')) ?? [])[1] ?? NaN);
  const counts = { tests: 0, pass: 0, fail: 0, skipped: 0, cancelled: 0, todo: 0 };
  const failures = [];
  const perFile = [];
  for (const r of results) {
    const finished = Number.isFinite(footer(r.tap, 'tests'));
    for (const k of Object.keys(counts)) if (finished) counts[k] += footer(r.tap, k);
    const fileFailures = tapFailures(r.tap).map((f) => f.replace(/^\? :: /, `${r.file} :: `));
    if (!finished) fileFailures.push(`${r.file} :: <did not finish>`);
    failures.push(...fileFailures);
    perFile.push({ file: r.file, exitCode: r.exitCode, signal: r.signal, timedOut: r.timedOut, endedAfterFooter: r.endedAfterFooter, durationMs: r.durationMs,
      tests: footer(r.tap, 'tests'), pass: footer(r.tap, 'pass'), fail: footer(r.tap, 'fail'), finished });
  }
  const tap = results.map((r) => `# ===== ${r.file}\n${r.tap}`).join('\n');
  const log = results.filter((r) => r.stderr.trim() || r.timedOut)
    .map((r) => `===== ${r.file}${r.timedOut ? ` (killed after ${TEST_FILE_TIMEOUT_MS} ms)` : ''}\n${r.stderr}`).join('\n');
  // A file passes when it exited 0, or was ended after its footer with no failures.
  const status = perFile.every((f) => f.finished && (f.exitCode === 0 || (f.endedAfterFooter && f.fail === 0))) ? 0 : 1;
  return { status, tap, log, counts, failures: [...new Set(failures)].sort(), perFile };
}

// "file(line,col): error TS1234: message" -> "file error TS1234: message ×count"
function tscDiagnostics(log) {
  const counts = new Map();
  for (const m of log.split('\n').map((l) => l.match(/^(\S+?)\(\d+,\d+\): (error TS\d+: .*)$/)).filter(Boolean)) {
    const key = `${m[1]} ${m[2].trim().split(REPO + '/').join('<repo>/')}`;
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
const summary = { startedAt: new Date().toISOString(), head, uncommittedPaths: dirty.length, reference: ref ? path.relative(REPO, ref) : null,
  ...(arg('--note') ? { note: arg('--note') } : {}), steps: [] };

for (const step of steps) {
  if (only && !only.includes(step.id)) continue;
  if (skip.includes(step.id)) continue;
  const log = path.join(out, `${step.id}.log`);
  const t0 = Date.now();
  process.stdout.write(`[gates] ${step.id} ... `);
  const testRun = step.custom === 'testFiles' ? await runTestFiles() : null;
  const res = testRun
    ? { status: testRun.status, stdout: testRun.log, stderr: '' }
    : spawnSync(step.cmd, step.args, { cwd: REPO, encoding: 'utf8', maxBuffer: 512 * 1024 * 1024, timeout: step.timeoutMs ?? 900_000 });
  const text = (res.stdout ?? '') + (res.stderr ? `\n--- stderr ---\n${res.stderr}` : '');
  fs.writeFileSync(log, text);
  const entry = {
    id: step.id,
    command: testRun
      ? `per file: ${path.relative(REPO, NODE) || NODE} scripts/margin/isolation/run-node.mjs --test --test-timeout=60000 --test-reporter=tap <file> (limit ${TEST_FILE_TIMEOUT_MS} ms, ${TEST_CONCURRENCY} at a time); files: ${TEST_GLOBS.join(' ')}`
      : [path.relative(REPO, step.cmd) || step.cmd, ...step.args].join(' ').replace(REPO + '/', ''),
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
    fs.writeFileSync(tapFile, testRun.tap);
    fs.writeFileSync(path.join(out, 'tests.files.json'), JSON.stringify(testRun.perFile, null, 2) + '\n');
    const now = testRun.failures;
    fs.writeFileSync(path.join(out, 'test-failures.txt'), now.join('\n') + (now.length ? '\n' : ''));
    entry.tap = path.relative(REPO, tapFile);
    entry.perFile = path.relative(REPO, path.join(out, 'tests.files.json'));
    entry.files = testRun.perFile.length;
    entry.filesNotFinished = testRun.perFile.filter((f) => !f.finished).map((f) => f.file);
    entry.filesEndedAfterFooter = testRun.perFile.filter((f) => f.endedAfterFooter).map((f) => f.file);
    entry.counts = testRun.counts;
    const before = ref && readList(path.join(ref, 'test-failures.txt'));
    if (before) {
      const s = split(now, before);
      entry.failures = { total: now.length, inherited: s.inherited.length, new: s.new, resolved: s.resolved };
      passed = res.status === 0 || s.new.length === 0;
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
