#!/usr/bin/env node
// Gate reference selection and the S42 required-check evidence (PLAN.md S42-05).
//   node scripts/margin/gate-evidence.mjs select-ref      prints the reference directory (GATE_REF from the env)
//   node scripts/margin/gate-evidence.mjs required <out>  checks <out>/summary.json and <out>/tests.files.json
// select-ref keeps the earlier rule: an explicit reference must be one of the listed
// directory names and hold summary.json; otherwise the newest AG-<n> directory.
// required only reads the evidence the gates run just wrote. It runs nothing again and
// accepts no failure, inherited or new, in the listed checks. For each Electron suite in
// PINNED_NODE_TEST_STEPS (regression, storage, startup, outbound-renderer) it also needs
// the step's recorded case counts: at least the pinned number run, all passed, none
// failed, cancelled, skipped or todo.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const GATE_REF = /^docs\/margin\/evidence\/(AG-\d+|S42-(ready|\d+))$/;

export const S42_REQUIRED_FILES = [
  'electron/audio/__tests__/DomesticStreamingLifecycle.test.mjs',
  'electron/audio/__tests__/MeetingSttSession.test.mjs',
  'electron/audio/__tests__/OutboundSttRevocation.test.mjs',
  'electron/llm/__tests__/generationInterfaces.test.mjs',
  'electron/llm/__tests__/generateTask.test.mjs',
  'electron/margin/__tests__/gateEvidence.test.mjs',
  'electron/services/__tests__/DomesticSttSettings.test.mjs',
  'electron/services/__tests__/ImagePathValidation.test.mjs',
  'electron/services/__tests__/IntelligenceEnginePreparedContext.test.mjs',
  'electron/services/__tests__/ManualAnswerBridge.test.mjs',
  'electron/services/__tests__/Mg21StopConsumer2026_09_27.test.mjs',
  'electron/services/__tests__/OpenAIRealtimeGAProtocol.test.mjs',
  'electron/services/__tests__/PromptSkillConsumerChain.test.mjs',
  'electron/services/__tests__/SpeechActions.test.mjs',
  'src/lib/__tests__/manualAnswerRenderer.test.mjs',
  'src/lib/__tests__/settingsFoundation.test.mjs',
];

// The gate steps that run one node:test file each, with the number of cases (top-level
// test() calls) in that file. UPDATE A NUMBER WHEN CASES ARE ADDED TO OR REMOVED FROM ITS
// FILE; gateEvidence.test.mjs fails until each matches its file. run-gates.mjs records the
// node:test counts of these steps (`counts: 'node-test'`). The required check treats each
// number as a floor: the step must have run once, exited 0 without timing out, run at least
// this many cases and passed every one it ran, with none failed, skipped, todo or cancelled.
// More cases are accepted on purpose (a case added before the number is raised still has to
// pass); fewer means a case was deleted or not reached.
// startup-smoke.test.mjs skips its native-termination case off macOS ({ skip: platform }).
// The gates run on macOS only, where it runs, so a skip there is a failure like any other.
export const PINNED_NODE_TEST_STEPS = [
  { id: 'regression', file: 'tests/margin/answer-regression.test.mjs', minTests: 24 },
  { id: 'storage', file: 'tests/margin/meeting-storage.test.mjs', minTests: 4 },
  { id: 'startup', file: 'tests/margin/startup-smoke.test.mjs', minTests: 2 },
  { id: 'outbound-renderer', file: 'tests/margin/outbound-renderer.test.mjs', minTests: 17 },
];
export const OUTBOUND_RENDERER_MIN_TESTS = PINNED_NODE_TEST_STEPS.find((s) => s.id === 'outbound-renderer').minTests;

// The summary counts node:test prints at the end of a run, from the TAP ("# tests 17")
// or the spec ("ℹ tests 17") reporter, whichever is the default for the Node and stdout
// in use; run-gates.mjs records them for a step marked `counts: 'node-test'`. The last
// line of each kind wins, as the summary comes after all test output. Null unless every
// count is present, so a missing summary cannot read as zero skips.
export const NODE_TEST_COUNTS = ['tests', 'pass', 'fail', 'cancelled', 'skipped', 'todo'];
export function nodeTestCounts(text) {
  const counts = {};
  for (const key of NODE_TEST_COUNTS) {
    const all = [...String(text ?? '').matchAll(new RegExp(`^(?:#|\\u2139) ${key} (\\d+)\\s*$`, 'gm'))];
    if (!all.length) return null;
    counts[key] = Number(all.at(-1)[1]);
  }
  return counts;
}

export function selectGateRef(explicit, { exists, list }) {
  if (explicit) {
    if (typeof explicit !== 'string' || explicit.trim() !== explicit || !GATE_REF.test(explicit) || !exists(explicit + '/summary.json')) throw new Error('Invalid gate_ref');
    return explicit;
  }
  const dirs = list('docs/margin/evidence').filter((d) => /^AG-\d+$/.test(d));
  dirs.sort((a, b) => Number(a.slice(3)) - Number(b.slice(3)));
  return 'docs/margin/evidence/' + dirs.at(-1);
}

// Problems with the required checks, as "<check> :: <reason>"; empty when all ran and passed.
export function requiredFailures(summary, perFile, files = S42_REQUIRED_FILES) {
  const problems = [];
  const steps = Array.isArray(summary?.steps) ? summary.steps : null;
  if (!steps) problems.push('summary.json :: missing or unreadable');
  const step = (id) => {
    const rows = steps ? steps.filter((s) => s?.id === id) : [];
    if (steps && rows.length !== 1) problems.push(`${id} :: step recorded ${rows.length} times`);
    return rows.length === 1 ? rows[0] : null;
  };
  const tests = step('tests');
  if (tests && (tests.passed !== true || !(Number.isInteger(tests.files) && tests.files > 0) || !Array.isArray(tests.isolationBlocked) || tests.isolationBlocked.length
    || !Array.isArray(tests.unexplainedExits) || tests.unexplainedExits.length)) {
    problems.push('tests :: step did not pass cleanly');
  }
  for (const { id, minTests } of PINNED_NODE_TEST_STEPS) {
    const s = step(id);
    if (!s) continue;
    if (s.exitCode !== 0 || s.passed !== true || s.timedOut !== false) {
      problems.push(`${id} :: exit ${s.exitCode}${s.timedOut ? ' (timed out)' : ''}`);
    }
    // node --test exits 0 when cases are skipped or missing, so the exit code alone does
    // not show that every case ran. The counts come from run-gates.mjs; without them the
    // step fails.
    const c = s.counts;
    const n = (k) => Number.isInteger(c?.[k]) && c[k] >= 0;
    if (!c || !NODE_TEST_COUNTS.every(n)) {
      problems.push(`${id} :: case counts missing`);
    } else if (c.tests < minTests || c.pass !== c.tests || c.fail || c.cancelled || c.skipped || c.todo) {
      problems.push(`${id} :: ${c.pass}/${c.tests} passed (at least ${minTests} required), `
        + `${c.fail} failed, ${c.cancelled} cancelled, ${c.skipped} skipped, ${c.todo} todo`);
    }
  }
  if (!Array.isArray(perFile)) {
    problems.push('tests.files.json :: missing or unreadable');
    return problems;
  }
  for (const file of files) {
    const rows = perFile.filter((r) => r?.file === file);
    if (rows.length !== 1) { problems.push(`${file} :: recorded ${rows.length} times`); continue; }
    const r = rows[0];
    const exitOk = r.exitCode === 0 || (r.endedAfterFooter === true && r.fail === 0);
    if (r.finished !== true || r.timedOut !== false || !exitOk) problems.push(`${file} :: did not finish cleanly (exit ${r.exitCode})`);
    else if (!(r.tests > 0) || r.pass !== r.tests || r.fail !== 0) problems.push(`${file} :: ${r.pass}/${r.tests} passed, ${r.fail} failed`);
    if (!Array.isArray(r.isolationBlocked) || r.isolationBlocked.length) problems.push(`${file} :: isolation blocked an attempt`);
  }
  return problems;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, dir] = process.argv.slice(2);
  if (command === 'select-ref') {
    console.log(selectGateRef(process.env.GATE_REF ?? '', { exists: fs.existsSync, list: fs.readdirSync }));
  } else if (command === 'required' && dir) {
    const read = (name) => { try { return JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')); } catch { return null; } };
    const problems = requiredFailures(read('summary.json'), read('tests.files.json'));
    for (const problem of problems) console.error(problem);
    if (problems.length) process.exit(1);
    console.log(`[gates] S42 required checks ran and passed: ${S42_REQUIRED_FILES.join(' ')} ${PINNED_NODE_TEST_STEPS.map((s) => `${s.id} (at least ${s.minTests} cases)`).join(' ')}`);
  } else {
    console.error('usage: gate-evidence.mjs select-ref | required <evidence dir>');
    process.exit(2);
  }
}
