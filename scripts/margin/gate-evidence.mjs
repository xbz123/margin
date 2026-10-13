#!/usr/bin/env node
// Gate reference selection and the S42 required-check evidence (PLAN.md S42-05).
//   node scripts/margin/gate-evidence.mjs select-ref      prints the reference directory (GATE_REF from the env)
//   node scripts/margin/gate-evidence.mjs required <out>  checks <out>/summary.json and <out>/tests.files.json
// select-ref keeps the earlier rule: an explicit reference must be one of the listed
// directory names and hold summary.json; otherwise the newest AG-<n> directory.
// required only reads the evidence the gates run just wrote. It runs nothing again and
// accepts no failure, inherited or new, in the listed checks.
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
  if (tests && (tests.passed !== true || !Array.isArray(tests.isolationBlocked) || tests.isolationBlocked.length
    || !Array.isArray(tests.unexplainedExits) || tests.unexplainedExits.length)) {
    problems.push('tests :: step did not pass cleanly');
  }
  const outbound = step('outbound-renderer');
  if (outbound && (outbound.exitCode !== 0 || outbound.passed !== true || outbound.timedOut !== false)) {
    problems.push(`outbound-renderer :: exit ${outbound.exitCode}${outbound.timedOut ? ' (timed out)' : ''}`);
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
    console.log(`[gates] S42 required checks ran and passed: ${S42_REQUIRED_FILES.join(' ')} outbound-renderer`);
  } else {
    console.error('usage: gate-evidence.mjs select-ref | required <evidence dir>');
    process.exit(2);
  }
}
