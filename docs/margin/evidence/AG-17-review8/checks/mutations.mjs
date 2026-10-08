// Run from the checkout root after build-electron. Mutates generated files only;
// restores each byte-for-byte in finally. No source or real service is touched.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const out = path.dirname(fileURLToPath(import.meta.url));
const cases = [
  ['m20-sdk-retries', 'LLMHelper', /maxRetries: 0/g, 'maxRetries: 2', 'SDK cannot resend', 8],
  ['m21-vision-refusal', 'llm/visionStreamFallback', /rethrowProviderScopeError\(err\);/g, 'void err;', 'vision denial is terminal', 1],
  ['m22-gemini-refusal', 'LLMHelper', /rethrowProviderScopeError\(error\);/g, 'void error;', 'Gemini fallback preserves', null],
  ['m23-wrapper-refusal', 'llm/WhatToAnswerLLM', /rethrowProviderScopeError\(error\);/g, 'void error;', 'prompt wrappers propagate', null],
  ['m24-engine-refusal', 'IntelligenceEngine', /rethrowProviderScopeError\(error\);/g, 'void error;', 'WhatToSay emits', null],
];
for (const [name, module, pattern, replacement, testName, expected] of cases) {
  const file = `dist-electron/electron/${module}.js`;
  const original = fs.readFileSync(file, 'utf8');
  const hits = [...original.matchAll(pattern)].length;
  assert.ok(hits > 0, `${name}: mutation must apply`);
  if (expected !== null) assert.equal(hits, expected, name);
  try {
    fs.writeFileSync(file, original.replace(pattern, replacement));
    const args = ['scripts/margin/isolation/run-node.mjs', '--test', '--test-reporter=tap', `--test-name-pattern=${testName}`, 'electron/services/__tests__/ScopeLocalFallback.test.mjs'];
    const result = spawnSync(process.execPath, args, { encoding: 'utf8', timeout: 15000 });
    const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
    fs.writeFileSync(path.join(out, `${name}.log`), `mutation: ${name}\nreplacements: ${hits}\ncommand: node ${args.join(' ')}\nexit: ${result.status}\nsignal: ${result.signal}\n${output}`);
    assert.equal(result.status, 1, `${name}: must fail with an assertion, not hang`);
    assert.match(output, /^not ok /m, name);
    assert.match(output, /^# fail [1-9]/m, name);
    console.log(`${name}: detected (${hits} generated-code replacements)`);
  } finally {
    fs.writeFileSync(file, original);
    assert.equal(fs.readFileSync(file, 'utf8'), original);
  }
}
