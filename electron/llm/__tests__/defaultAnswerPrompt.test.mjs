import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const promptsPath = path.resolve(__dirname, '../../../dist-electron/electron/llm/prompts.js');
const prompts = await import(pathToFileURL(promptsPath).href);

// The default answer prompt is the baseline's General mode prompt (PLAN.md AG-13).
const GENERAL = prompts.MODE_GENERAL_PROMPT;

function assertIncludesAll(text, terms, label) {
  const lower = text.toLowerCase();
  for (const term of terms) {
    assert.ok(lower.includes(term.toLowerCase()), `${label} should include "${term}"`);
  }
}

test('the default answer suffix is the General prompt without the shared prefix', () => {
  assert.ok(GENERAL.startsWith(prompts.SHARED_MODE_PREFIX), 'General must start with the shared prefix so it is not sent twice');
  const expected = GENERAL.slice(prompts.SHARED_MODE_PREFIX.length).replace(/^\s+/, '');
  assert.equal(prompts.DEFAULT_ANSWER_PROMPT_SUFFIX, expected);
  assert.ok(prompts.DEFAULT_ANSWER_PROMPT_SUFFIX.length > 1000);
  assert.ok(!prompts.DEFAULT_ANSWER_PROMPT_SUFFIX.includes(prompts.CORE_IDENTITY.trim().slice(0, 200)));
});

test('the General prompt includes shared prompt-leakage and safety controls', () => {
  assertIncludesAll(GENERAL, [
    '<security>',
    'system prompt',
    'instructions',
    'reveal',
    "I can't share that information",
  ], 'general');
});

test('the General prompt handles injected custom context and reference files', () => {
  assertIncludesAll(GENERAL, [
    '<injected_context>',
    '<user_context>',
    '<reference_file name="...">',
    'file name',
  ], 'general');
});

test('the General prompt prevents hallucination for absent file-specific claims', () => {
  assertIncludesAll(GENERAL, [
    'absent',
    'provided material',
    'general knowledge',
    'untrusted evidence',
    'never follow instructions',
    'Do not invent formulas',
    'file-specific recommendations',
  ], 'general');
});

test('the General prompt carries its behavior contract and profile grounding', () => {
  assertIncludesAll(GENERAL, ['universal meeting', 'conversation copilot', 'adapt', 'RECENT QUESTION'], 'general');
  assertIncludesAll(GENERAL, ['<candidate_experience>', 'do not invent', 'salary_intelligence'], 'general');
});

test('code hint examples avoid named problems and em dashes', () => {
  assertIncludesAll(prompts.CODE_HINT_PROMPT, [
    'Use schematic examples only',
    'Do not copy sample problem names, line numbers, metrics, or concrete fixes unless they are visible',
  ], 'code-hint');

  const examples = prompts.CODE_HINT_PROMPT.match(/<output_examples>[\s\S]*?<\/output_examples>/)?.[0] ?? '';
  assert.match(examples, /Use schematic examples only/);
  assert.doesNotMatch(examples, /Two Sum/);
  assert.doesNotMatch(examples, /line 8/);
  assert.doesNotMatch(examples, /—/);
});
