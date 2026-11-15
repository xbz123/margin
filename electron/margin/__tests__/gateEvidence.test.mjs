import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { OUTBOUND_RENDERER_MIN_TESTS, PINNED_NODE_TEST_STEPS, S42_REQUIRED_FILES, nodeTestCounts, requiredFailures, selectGateRef } from '../../../scripts/margin/gate-evidence.mjs';

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
    { id: 'tests', exitCode: 1, passed: true, files: S42_REQUIRED_FILES.length + 1, isolationBlocked: [], unexplainedExits: [] },
    ...[['regression', 24], ['storage', 4], ['startup', 2]].map(([id, n]) => ({ id, exitCode: 0, timedOut: false, passed: true,
      counts: { tests: n, pass: n, fail: 0, cancelled: 0, skipped: 0, todo: 0 } })),
    { id: 'outbound-renderer', exitCode: 0, timedOut: false, passed: true,
      counts: { tests: 17, pass: 17, fail: 0, cancelled: 0, skipped: 0, todo: 0 } },
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

test('outbound-renderer case floor: 17/17 passes, more passing cases pass, and the pin matches the suite', () => {
  const evidence = good();
  const counts = evidence.summary.steps.find((s) => s.id === 'outbound-renderer').counts;
  assert.deepEqual(requiredFailures(evidence.summary, evidence.files), [], '17 run, 17 passed');
  // Deliberate: the pin is a floor, so a case added before the number is raised is
  // accepted as long as every case that ran passed.
  Object.assign(counts, { tests: 18, pass: 18 });
  assert.deepEqual(requiredFailures(evidence.summary, evidence.files), [], '18 run, 18 passed');
  Object.assign(counts, { tests: 18, pass: 17, skipped: 1 });
  assert.notDeepEqual(requiredFailures(evidence.summary, evidence.files), [], '18 run with 1 skipped');
  // The pin must follow the suite: update OUTBOUND_RENDERER_MIN_TESTS when cases change.
  const suite = fs.readFileSync(path.join(REPO, 'tests/margin/outbound-renderer.test.mjs'), 'utf8');
  assert.equal(OUTBOUND_RENDERER_MIN_TESTS, 17);
  assert.equal((suite.match(/^test\(/gm) ?? []).length, OUTBOUND_RENDERER_MIN_TESTS, 'top-level test( cases in outbound-renderer.test.mjs');
});

test('regression, storage and startup case floors: the pins match their suites and run-gates records their counts', () => {
  assert.deepEqual(PINNED_NODE_TEST_STEPS.map(({ id, file, minTests }) => [id, file, minTests]), [
    ['regression', 'tests/margin/answer-regression.test.mjs', 24],
    ['storage', 'tests/margin/meeting-storage.test.mjs', 4],
    ['startup', 'tests/margin/startup-smoke.test.mjs', 2],
    ['outbound-renderer', 'tests/margin/outbound-renderer.test.mjs', OUTBOUND_RENDERER_MIN_TESTS],
  ]);
  const gates = fs.readFileSync(path.join(REPO, 'scripts/margin/run-gates.mjs'), 'utf8');
  for (const { id, file, minTests } of PINNED_NODE_TEST_STEPS) {
    // The pin must follow the suite: update PINNED_NODE_TEST_STEPS when cases change.
    const suite = fs.readFileSync(path.join(REPO, file), 'utf8');
    assert.equal((suite.match(/^test\(/gm) ?? []).length, minTests, `top-level test( cases in ${file}`);
    // The step (its two source lines) runs exactly this file and records its node:test counts.
    const line = gates.match(new RegExp(`\\{ id: '${id}', [^\\n]*\\n[^\\n]*`))?.[0] ?? '';
    assert.ok(line.includes(`'${file}'`) && line.includes("counts: 'node-test'"), `run-gates step ${id}`);
    const evidence = good();
    const counts = evidence.summary.steps.find((s) => s.id === id).counts;
    Object.assign(counts, { tests: minTests + 1, pass: minTests + 1 });
    assert.deepEqual(requiredFailures(evidence.summary, evidence.files), [], `${id}: one more passing case than pinned`);
  }
});

test('node:test summary counts are read from TAP or spec output, and absent without a full summary', () => {
  const expected = { tests: 17, pass: 16, fail: 0, cancelled: 0, skipped: 1, todo: 0 };
  const tap = '# Subtest: a\nok 1 - a\n# tests 3\n# app said this\n# tests 17\n# suites 0\n# pass 16\n# fail 0\n# cancelled 0\n# skipped 1\n# todo 0\n# duration_ms 1.5\n';
  assert.deepEqual(nodeTestCounts(tap), expected);
  const spec = '✔ a (1ms)\nℹ tests 17\nℹ suites 0\nℹ pass 16\nℹ fail 0\nℹ cancelled 0\nℹ skipped 1\nℹ todo 0\nℹ duration_ms 1.5\n';
  assert.deepEqual(nodeTestCounts(spec), expected);
  assert.equal(nodeTestCounts(tap.replace('# skipped 1\n', '')), null, 'one count missing');
  assert.equal(nodeTestCounts('ok 1 - a\n'), null, 'no summary');
  assert.equal(nodeTestCounts(undefined), null);
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
    // node --test exits 0 in all of these, so only the counts show them.
    'outbound renderer ran 16 cases, all passing': (e) => { Object.assign(outbound(e).counts, { tests: 16, pass: 16 }); },
    'outbound renderer ran 17 with 1 skipped': (e) => { Object.assign(outbound(e).counts, { pass: 16, skipped: 1 }); },
    'outbound renderer skip counted as passing': (e) => { outbound(e).counts.skipped = 1; },
    'outbound renderer ran 17 with 16 passed': (e) => { outbound(e).counts.pass = 16; },
    'outbound renderer todo': (e) => { Object.assign(outbound(e).counts, { pass: 16, todo: 1 }); },
    'outbound renderer cancelled': (e) => { Object.assign(outbound(e).counts, { pass: 16, cancelled: 1 }); },
    'outbound renderer counts missing': (e) => { delete outbound(e).counts; },
    'outbound renderer counts null': (e) => { outbound(e).counts = null; },
    'outbound renderer counts incomplete': (e) => { delete outbound(e).counts.skipped; },
    'outbound renderer counts not numbers': (e) => { outbound(e).counts.tests = '17'; },
    'tests step found no test file': (e) => { tests(e).files = 0; },
    'tests step without a file count': (e) => { delete tests(e).files; },
  };
  for (const { id, minTests } of PINNED_NODE_TEST_STEPS.filter((s) => s.id !== 'outbound-renderer')) {
    const s = (e) => e.summary.steps.find((x) => x.id === id);
    Object.assign(cases, {
      [`${id} absent`]: (e) => { e.summary.steps = e.summary.steps.filter((x) => x.id !== id); },
      [`${id} recorded twice`]: (e) => { e.summary.steps.push(structuredClone(s(e))); },
      [`${id} exit 1`]: (e) => { Object.assign(s(e), { exitCode: 1, passed: false }); },
      [`${id} exit 0 but not passed`]: (e) => { s(e).passed = false; },
      [`${id} timed out`]: (e) => { Object.assign(s(e), { exitCode: null, timedOut: true }); },
      // node --test exits 0 in all of these, so only the counts show them.
      [`${id} ran too few cases, all passing`]: (e) => { Object.assign(s(e).counts, { tests: minTests - 1, pass: minTests - 1 }); },
      [`${id} one skipped`]: (e) => { Object.assign(s(e).counts, { pass: minTests - 1, skipped: 1 }); },
      [`${id} skip counted as passing`]: (e) => { s(e).counts.skipped = 1; },
      [`${id} one failed`]: (e) => { Object.assign(s(e).counts, { pass: minTests - 1, fail: 1 }); },
      [`${id} one todo`]: (e) => { Object.assign(s(e).counts, { pass: minTests - 1, todo: 1 }); },
      [`${id} one cancelled`]: (e) => { Object.assign(s(e).counts, { pass: minTests - 1, cancelled: 1 }); },
      [`${id} counts missing`]: (e) => { delete s(e).counts; },
      [`${id} counts null`]: (e) => { s(e).counts = null; },
      [`${id} counts incomplete`]: (e) => { delete s(e).counts.skipped; },
    });
  }
  for (const [name, mutate] of Object.entries(cases)) {
    const evidence = good();
    mutate(evidence);
    const problems = requiredFailures(evidence.summary, evidence.files);
    assert.notDeepEqual(problems, [], name);
    // A case about one pinned step must be rejected for that step, not for another.
    const pinned = PINNED_NODE_TEST_STEPS.find(({ id }) => name.startsWith(`${id} `));
    if (pinned) assert.ok(problems.some((p) => p.startsWith(`${pinned.id} :: `)), `${name}: ${problems.join('; ')}`);
  }
});
