import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { S42_REQUIRED_FILES, requiredFailures, selectGateRef } from '../../../scripts/margin/gate-evidence.mjs';

const REPO = fileURLToPath(new URL('../../../', import.meta.url));

test('S42-05 gate_ref accepts only listed evidence directories that hold a summary', () => {
  const anything = { list: () => [], exists: () => true };
  for (const ref of ['docs/margin/evidence/AG-26', 'docs/margin/evidence/S42-ready', 'docs/margin/evidence/S42-01']) {
    assert.equal(selectGateRef(ref, anything), ref);
  }
  for (const ref of ['docs/margin/evidence/S42-ready/../AG-26', 'docs/margin/evidence/S42-ready/', 'docs/margin/evidence/S42-ready\n',
    './docs/margin/evidence/S42-ready', '/docs/margin/evidence/S42-ready', 'docs/margin/evidence/S42-', 'docs/margin/evidence/S42-readyx',
    'docs/margin/evidence/S43-ready', 'docs/margin/evidence/s42-ready', 'docs/margin/evidence/AG-51/gates', 'docs/margin/evidence/AG-17-review',
    'docs/margin/evidence/../../../etc', 'docs/margin/evidence/S42-ready/summary.json']) {
    assert.throws(() => selectGateRef(ref, anything), /Invalid gate_ref/, JSON.stringify(ref));
  }
  const evidence = { list: () => ['AG-9', 'AG-51', 'AG-10-review', 'S42-ready', 'S42-99'],
    exists: (file) => file === 'docs/margin/evidence/S42-ready/summary.json' };
  assert.throws(() => selectGateRef('docs/margin/evidence/S42-01', evidence), /Invalid gate_ref/);
  assert.equal(selectGateRef('docs/margin/evidence/S42-ready', evidence), 'docs/margin/evidence/S42-ready');
  assert.equal(selectGateRef('', evidence), 'docs/margin/evidence/AG-51', 'the automatic choice still takes the newest AG-<n>');
});

const row = (file, patch = {}) => ({ file, exitCode: 0, signal: null, timedOut: false, endedAfterFooter: false, durationMs: 1,
  tests: 2, pass: 2, fail: 0, finished: true, isolationBlocked: [], ...patch });
const good = () => ({
  summary: { steps: [
    // An inherited failure in an unrelated file keeps the step passed with exit 1.
    { id: 'tests', exitCode: 1, passed: true, isolationBlocked: [], unexplainedExits: [] },
    { id: 'outbound-renderer', exitCode: 0, timedOut: false, passed: true },
  ] },
  files: [...S42_REQUIRED_FILES.map((file) => row(file)), row('electron/services/__tests__/Unrelated.test.mjs', { exitCode: 1, pass: 1, fail: 1 })],
});

test('S42-05 required checks pass on complete evidence, including a file ended after its footer', () => {
  const evidence = good();
  assert.deepEqual(requiredFailures(evidence.summary, evidence.files), []);
  Object.assign(evidence.files[0], { exitCode: null, signal: 'SIGKILL', endedAfterFooter: true });
  assert.deepEqual(requiredFailures(evidence.summary, evidence.files), []);
  for (const file of S42_REQUIRED_FILES) assert.ok(fs.existsSync(path.join(REPO, file)), file);
});

test('S42-05 required checks reject missing, failed, unfinished, skipped or isolated evidence', () => {
  const tests = (e) => e.summary.steps.find((s) => s.id === 'tests');
  const outbound = (e) => e.summary.steps.find((s) => s.id === 'outbound-renderer');
  const cases = {
    'summary missing': (e) => { e.summary = null; },
    'per-file list missing': (e) => { e.files = null; },
    'required file not run': (e) => { e.files = e.files.filter((r) => !r.file.endsWith('DomesticSttSettings.test.mjs')); },
    'required file recorded twice': (e) => { e.files.push({ ...e.files[0] }); },
    'required file failed': (e) => { Object.assign(e.files[0], { exitCode: 1, pass: 1, fail: 1 }); },
    'inherited-style failure ended after footer': (e) => { Object.assign(e.files[0], { exitCode: null, endedAfterFooter: true, pass: 1, fail: 1 }); },
    'required file did not finish': (e) => { Object.assign(e.files[1], { exitCode: null, signal: 'SIGKILL', timedOut: true, finished: false, tests: null, pass: null, fail: null }); },
    'required file ran no test': (e) => { Object.assign(e.files[2], { tests: 0, pass: 0 }); },
    'required file skipped a test': (e) => { Object.assign(e.files[3], { pass: 1 }); },
    'required file isolation block': (e) => { e.files[4].isolationBlocked = ['net synthetic.invalid:443']; },
    'required file without isolation record': (e) => { delete e.files[4].isolationBlocked; },
    'tests step absent': (e) => { e.summary.steps = e.summary.steps.filter((s) => s.id !== 'tests'); },
    'tests step has new failures': (e) => { tests(e).passed = false; },
    'tests step isolation block': (e) => { tests(e).isolationBlocked = ['x :: <no guard-loaded record>']; },
    'tests step unexplained exit': (e) => { tests(e).unexplainedExits = ['x :: exit 1 with no failing test']; },
    'outbound renderer absent': (e) => { e.summary.steps = e.summary.steps.filter((s) => s.id !== 'outbound-renderer'); },
    'outbound renderer failed': (e) => { Object.assign(outbound(e), { exitCode: 1, passed: false }); },
    'outbound renderer timed out': (e) => { Object.assign(outbound(e), { exitCode: null, timedOut: true }); },
  };
  for (const [name, mutate] of Object.entries(cases)) {
    const evidence = good();
    mutate(evidence);
    assert.notDeepEqual(requiredFailures(evidence.summary, evidence.files), [], name);
  }
});
