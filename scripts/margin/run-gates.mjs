#!/usr/bin/env node
// Runs the Margin ticket gates and keeps reviewable evidence (PLAN.md §5).
//   node scripts/margin/run-gates.mjs --out docs/margin/evidence/AG-13 \
//     [--only build-electron,tests,...] [--skip regression] [--note "how this run was made"]
//
// For every step it writes <out>/<step>.log (stdout and stderr as produced) and records
// the exact command, exit code and duration in <out>/summary.json. A step passes only on
// its own result: exit code 0, nothing excused by an earlier run. The tests step also
// fails when its globs match no test file, no file reports a test, the isolation guard
// blocked an attempt, or a non-zero exit is not explained by a failing test; its failing
// tests (file + name, from the TAP report) are listed in <out>/test-failures.txt. A step
// marked `counts: 'node-test'` also records the node:test summary counts of its output
// in summary.json (`counts`, null when no complete summary was found); gate-evidence.mjs
// checks them against PINNED_NODE_TEST_STEPS (regression, storage, startup,
// outbound-renderer).
// The runner exits 1 if any step did not pass, and 2 before running anything when --only
// or --skip names an unknown step id or is empty (selectSteps in gate-evidence.mjs).

import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { nodeTestCounts, selectSteps } from './gate-evidence.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const BIN = (name) => path.join(REPO, 'node_modules/.bin', name);
const NODE = process.execPath;

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const out = path.resolve(REPO, arg('--out') ?? 'docs/margin/evidence/latest');

const TEST_GLOBS = [
  'electron/services/__tests__/**/*.test.mjs',
  'electron/llm/__tests__/**/*.test.mjs',
  'electron/audio/__tests__/**/*.test.mjs',
  'electron/margin/__tests__/**/*.test.mjs',
  // Added in PLAN.md AG-17 (they were outside `npm test` before).
  'electron/utils/__tests__/**/*.test.mjs',
  'src/lib/__tests__/**/*.test.mjs',
];

const steps = [
  // esbuild never deletes outputs, so modules removed from the source would linger in
  // dist-electron and tests importing them could still pass. Start from an empty dir.
  { id: 'clean-dist', cmd: NODE, args: ['-e', "require('fs').rmSync('dist-electron', { recursive: true, force: true })"] },
  { id: 'build-electron', cmd: NODE, args: ['scripts/build-electron.js'] },
  { id: 'vite-build', cmd: BIN('vite'), args: ['build'] },
  { id: 'tsc-renderer', cmd: BIN('tsc'), args: ['--noEmit', '-p', '.'] },
  { id: 'tsc-electron', cmd: BIN('tsc'), args: ['-p', 'electron/tsconfig.json', '--noEmit'] },
  // The provenance check (scripts/margin/provenance-check.mjs) is not a gate step: its result
  // depends on the upstream refs fetched at run time, not only on this branch. Run it by hand
  // before a release.
  { id: 'retired', cmd: NODE, args: ['scripts/margin/retired-check.mjs'] },
  { id: 'preload-contract', cmd: NODE, args: ['scripts/margin/preload-contract-check.mjs'] },
  { id: 'ipc-channels', cmd: NODE, args: ['scripts/margin/ipc-channel-check.mjs'] },
  { id: 'guard-selftest', cmd: NODE, args: ['scripts/margin/isolation/run-node.mjs', '--allow-blocked', '--test',
    'scripts/margin/isolation/__tests__/guard.node.test.mjs', 'scripts/margin/isolation/__tests__/native-exports.node.test.mjs'] },
  // One guarded node process per test file (see runTestFiles), so a file that hangs
  // cannot stop the others from reporting and every count comes from a TAP footer.
  { id: 'tests', custom: 'testFiles' },
  { id: 'regression', cmd: NODE, args: ['scripts/margin/isolation/run-node.mjs', '--allow-exec', 'Electron', '--test',
    '--test-timeout=180000', 'tests/margin/answer-regression.test.mjs'], timeoutMs: 600_000, counts: 'node-test' },
  { id: 'storage', cmd: NODE, args: ['scripts/margin/isolation/run-node.mjs', '--allow-exec', 'Electron', '--test',
    '--test-timeout=240000', 'tests/margin/meeting-storage.test.mjs'], timeoutMs: 600_000, counts: 'node-test' },
  { id: 'startup', cmd: NODE, args: ['scripts/margin/isolation/run-node.mjs', '--allow-exec', 'Electron:osascript', '--test',
    '--test-timeout=180000', 'tests/margin/startup-smoke.test.mjs'], timeoutMs: 300_000, counts: 'node-test' },
  { id: 'outbound-renderer', cmd: NODE, args: ['scripts/margin/isolation/run-node.mjs', '--allow-exec', 'Electron:esbuild', '--test',
    '--test-timeout=180000', 'tests/margin/outbound-renderer.test.mjs'], timeoutMs: 300_000, counts: 'node-test' },
  { id: 'diff-check', cmd: 'git', args: ['diff', 'HEAD', '--check'] },
];

// --only / --skip are checked before anything runs or is written: an unknown or empty
// step id is an error, not a silently smaller run.
// --ref (comparison with an earlier run) was removed; refuse it rather than ignore it.
if (process.argv.includes('--ref')) {
  console.error('[gates] --ref was removed: every step passes only on its own result');
  process.exit(2);
}
let selected;
try { selected = selectSteps(steps.map((s) => s.id), process.argv.slice(2)); } catch (error) {
  console.error(`[gates] ${error.message}`);
  process.exit(2);
}

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
  // Each file's isolation log goes to a known path, read below after the process has
  // ended, so a file that is ended after its footer cannot hide a blocked attempt.
  const isolationDir = fs.mkdtempSync(path.join(os.tmpdir(), 'margin-gates-isolation-'));
  const results = new Array(files.length);
  let next = 0;
  async function worker() {
    while (next < files.length) {
      const i = next++;
      const file = files[i];
      const t0 = Date.now();
      results[i] = await new Promise((resolve) => {
        const isolationLog = path.join(isolationDir, `${i}.jsonl`);
        const child = spawn(NODE, ['scripts/margin/isolation/run-node.mjs', '--test', '--test-timeout=60000',
          '--test-reporter=tap', file], { cwd: REPO, detached: process.platform !== 'win32', windowsHide: true, env: { ...process.env, MARGIN_RUN_NODE_LOG: isolationLog } });
        // run-node.mjs passes its stdio to the real test process, so end the whole
        // process group; killing only run-node would leave the pipe open.
        // Windows has no process groups here (the child is not detached, so it opens no
        // console window), so end the tree with taskkill instead.
        const killGroup = () => {
          if (process.platform === 'win32') { spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true }); return; }
          try { process.kill(-child.pid, 'SIGKILL'); } catch { /* already gone */ }
        };
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
          resolve({ file, exitCode: code, signal, timedOut, endedAfterFooter, durationMs: Date.now() - t0, tap: stdout, stderr, isolationLog, runNodePid: child.pid });
        });
      });
    }
  }
  await Promise.all(Array.from({ length: TEST_CONCURRENCY }, worker));

  const footer = (tap, key) => Number((tap.match(new RegExp(`^# ${key} (\\d+)`, 'm')) ?? [])[1] ?? NaN);
  const counts = { tests: 0, pass: 0, fail: 0, skipped: 0, cancelled: 0, todo: 0 };
  const failures = [];
  const isolation = [];
  const unexplainedExits = [];
  const perFile = [];
  for (const r of results) {
    const finished = Number.isFinite(footer(r.tap, 'tests'));
    for (const k of Object.keys(counts)) if (finished) counts[k] += footer(r.tap, k);
    const fileFailures = tapFailures(r.tap).map((f) => f.replace(/^\? :: /, `${r.file} :: `));
    if (!finished) fileFailures.push(`${r.file} :: <did not finish>`);
    failures.push(...fileFailures);
    // Attempts the isolation guard blocked, read from the file's isolation log. Every
    // kind counts, local ones included: an expected local call needs an explicit
    // stand-in in the test. A log without a guard-loaded record is no evidence that
    // the guard ran, and counts too (PLAN.md AG-17 review). The record must come from
    // the process that ran the file, below the run-node.mjs this run started, which also
    // holds when the file was ended by a kill and run-node.mjs never checked it (third
    // and fourth reviews).
    const isolationBlocked = isolationRecords(r.isolationLog, r.runNodePid, r.file);
    isolation.push(...isolationBlocked.map((b) => `${r.file} :: ${b}`));
    // A non-zero exit must be explained by a failing test in the TAP report.
    const exitOk = r.exitCode === 0 || (r.endedAfterFooter && footer(r.tap, 'fail') === 0);
    if (finished && !exitOk && fileFailures.length === 0) unexplainedExits.push(`${r.file} :: exit ${r.exitCode}${r.signal ? ` signal ${r.signal}` : ''} with no failing test`);
    perFile.push({ file: r.file, exitCode: r.exitCode, signal: r.signal, timedOut: r.timedOut, endedAfterFooter: r.endedAfterFooter, durationMs: r.durationMs,
      tests: footer(r.tap, 'tests'), pass: footer(r.tap, 'pass'), fail: footer(r.tap, 'fail'), finished, isolationBlocked });
  }
  fs.rmSync(isolationDir, { recursive: true, force: true });
  const tap = results.map((r) => `# ===== ${r.file}\n${r.tap}`).join('\n');
  const log = results.filter((r) => r.stderr.trim() || r.timedOut)
    .map((r) => `===== ${r.file}${r.timedOut ? ` (killed after ${TEST_FILE_TIMEOUT_MS} ms)` : ''}\n${r.stderr}`).join('\n');
  // A file passes when it exited 0, or was ended after its footer with no failures. No
  // file found, or no test reported by any file, is a failure: every() is true on an
  // empty list.
  const noTests = files.length === 0 || counts.tests === 0;
  if (files.length === 0) failures.push(`${TEST_GLOBS.join(' ')} :: <no test file found>`);
  else if (counts.tests === 0) failures.push(`${TEST_GLOBS.join(' ')} :: <no test ran>`);
  const status = !noTests && perFile.every((f) => f.finished && (f.exitCode === 0 || (f.endedAfterFooter && f.fail === 0))) ? 0 : 1;
  return { status, noTests, tap, log, counts, failures: [...new Set(failures)].sort(), isolation: isolation.sort(), unexplainedExits: unexplainedExits.sort(), perFile };
}

// The blocked attempts in one isolation log, as unique "<kind> <detail>" lines, plus
// "<no guard-loaded record>" when the guard left no evidence that it ran in the process
// that executed `file`. With `node --test` that is a chain: run-node.mjs (pid
// `runNodePid`) starts the test runner, and the runner starts a child process per file
// whose script is the file itself. Both are guarded; the record must come from that
// child (PLAN.md AG-17 fourth review).
function isolationRecords(log, runNodePid, file) {
  const records = fs.existsSync(log)
    ? fs.readFileSync(log, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return { kind: 'unreadable', detail: l }; } })
    : [];
  const blocked = [...new Set(records.filter((r) => r.kind !== 'guard-loaded').map((r) => `${r.kind} ${r.detail}`))];
  const loads = records.filter((r) => r.kind === 'guard-loaded');
  const runners = new Set(loads.filter((r) => r.ppid === runNodePid).map((r) => r.pid));
  const target = path.resolve(REPO, file);
  const ranFile = loads.some((r) => runners.has(r.ppid) && typeof r.script === 'string' && path.resolve(REPO, r.script) === target);
  if (!ranFile) blocked.push('<no guard-loaded record>');
  return blocked;
}

// Failing tests from a node:test TAP report, as "file :: name". Parents of failing
// subtests are kept too.
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

// Every live descendant of `root` (children, grandchildren, ...), read from ps. Playwright
// starts Electron detached, in a process group of its own, so killing the step's group
// alone does not reach the app; walking the parent links does.
function descendants(root) {
  const ps = spawnSync('ps', ['-A', '-o', 'pid=', '-o', 'ppid='], { encoding: 'utf8' });
  const children = new Map();
  for (const line of (ps.stdout ?? '').split('\n')) {
    const [pid, ppid] = line.trim().split(/\s+/).map(Number);
    if (!pid) continue;
    if (!children.has(ppid)) children.set(ppid, []);
    children.get(ppid).push(pid);
  }
  const found = [];
  for (let queue = [root]; queue.length;) for (const pid of children.get(queue.shift()) ?? []) { found.push(pid); queue.push(pid); }
  return found;
}

// Runs one command step. On timeout it kills the step's whole process tree: the direct
// child, its process group, and every descendant (an Electron suite's app, helpers and
// mock servers), where spawnSync's timeout signalled only the direct child and left
// the rest running into the next step. Returns the spawnSync result fields read below.
function runStep(step) {
  const timeoutMs = step.timeoutMs ?? 900_000;
  return new Promise((resolve) => {
    const posix = process.platform !== 'win32';
    const child = spawn(step.cmd, step.args, { cwd: REPO, detached: posix, windowsHide: true });
    const killTree = () => {
      // Collect before killing: once a parent dies its children are re-parented and lost.
      const tree = posix ? descendants(child.pid) : [];
      for (const pid of [child.pid, ...tree]) { try { process.kill(pid, 'SIGKILL'); } catch { /* already gone */ } }
      if (posix) { try { process.kill(-child.pid, 'SIGKILL'); } catch { /* already gone */ } }
    };
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (d) => { stdout += d; });
    child.stderr.setEncoding('utf8').on('data', (d) => { stderr += d; });
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; killTree(); }, timeoutMs);
    child.on('error', (error) => { clearTimeout(timer); resolve({ status: null, signal: null, stdout, stderr: stderr + String(error), error }); });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      resolve({ status: code, signal, stdout, stderr, ...(timedOut ? { error: { code: 'ETIMEDOUT' } } : {}) });
    });
  });
}

// Electron suites save failure screenshots here (inside the repo, so the isolation
// sandbox's temporary root is not the only copy); they are copied into the evidence
// directory after the run, which CI uploads.
const FAILURE_SHOTS = path.join(REPO, '.margin-cache', 'failure-shots');
fs.rmSync(FAILURE_SHOTS, { recursive: true, force: true });

fs.mkdirSync(out, { recursive: true });
const head = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: REPO, encoding: 'utf8' }).stdout.trim();
const dirty = spawnSync('git', ['status', '--porcelain'], { cwd: REPO, encoding: 'utf8' }).stdout.trim().split('\n').filter(Boolean);
// The paths themselves are kept too, so a non-zero count can be checked (PLAN.md AG-17
// fourth review).
const summary = { startedAt: new Date().toISOString(), head, uncommittedPaths: dirty.length, uncommittedPathList: dirty.slice(0, 200),
  ...(arg('--note') ? { note: arg('--note') } : {}), steps: [] };

for (const step of steps) {
  if (!selected.includes(step.id)) continue;
  const log = path.join(out, `${step.id}.log`);
  const t0 = Date.now();
  process.stdout.write(`[gates] ${step.id} ... `);
  const testRun = step.custom === 'testFiles' ? await runTestFiles() : null;
  const res = testRun
    ? { status: testRun.status, stdout: testRun.log, stderr: '' }
    : await runStep(step);
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
  if (step.counts === 'node-test') entry.counts = nodeTestCounts(res.stdout ?? '');
  // A step passes on its own result only; nothing is excused by an earlier run.
  let passed = res.status === 0;
  if (testRun) {
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
    entry.isolationBlocked = testRun.isolation;
    entry.unexplainedExits = testRun.unexplainedExits;
    entry.failures = { total: now.length };
    // Besides a non-zero exit, any blocked attempt, a non-zero exit that no failing test
    // explains (PLAN.md AG-17 review), or a run that found no test file or ran no test
    // fails the step.
    entry.noTests = testRun.noTests;
    if (testRun.isolation.length || testRun.unexplainedExits.length || testRun.noTests) passed = false;
  }
  entry.passed = passed;
  summary.steps.push(entry);
  process.stdout.write(`exit ${res.status}${entry.timedOut ? ' (timed out)' : ''} ${passed ? 'PASS' : 'FAIL'} (${Math.round(entry.durationMs / 1000)}s)\n`);
}

if (fs.existsSync(FAILURE_SHOTS) && fs.readdirSync(FAILURE_SHOTS).length) {
  fs.cpSync(FAILURE_SHOTS, path.join(out, 'failure-shots'), { recursive: true });
  summary.failureShots = path.relative(REPO, path.join(out, 'failure-shots'));
}
summary.finishedAt = new Date().toISOString();
summary.allPassed = summary.steps.every((s) => s.passed);
fs.writeFileSync(path.join(out, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
console.log(`[gates] ${summary.allPassed ? 'all passed' : 'FAILED'}; summary: ${path.relative(REPO, path.join(out, 'summary.json'))}`);
process.exit(summary.allPassed ? 0 : 1);
