// S48: one capability table feeds the image guard and the reasoning control; the request snapshot
// sends exactly the chosen level's fields. Official endpoints only; every client here is a fake that
// records the request body and fails, so nothing leaves the process.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const load = (file, modules = {}) => {
  const module = { exports: {} };
  const source = ts.transpileModule(fs.readFileSync(path.join(repoRoot, file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  vm.runInNewContext(source, { module, exports: module.exports, URL, require: id => { if (id in modules) return modules[id]; throw Error(`unmapped ${id}`); } });
  return module.exports;
};
const caps = load('src/types/modelCapabilities.ts');
const images = load('src/types/modelImageSupport.ts', { './modelCapabilities': caps });
const plain = value => JSON.parse(JSON.stringify(value));
const official = (provider, protocol, model, extra = {}) => ({ provider, protocol, model, ...extra });
const SONNET_46 = official('claude', 'messages', 'claude-sonnet-4-6'), OPUS = official('claude', 'messages', 'claude-opus-5-5');
const HAIKU = official('claude', 'messages', 'claude-haiku-5-5'), FLASH = official('deepseek', 'chat-completions', 'deepseek-flash');
const V4_PRO = official('deepseek', 'chat-completions', 'deepseek-v4-pro'), LITE = official('gemini', 'gemini', 'gemini-3.1-flash-lite');
const PRO = official('gemini', 'gemini', 'gemini-3.1-pro-preview'), GPT54 = official('openai', 'responses', 'gpt-5.4');
const LUNA = official('openai', 'chat-completions', 'gpt-6-luna'), PREVIEW = official('gemini', 'gemini', 'gemini-3.1-flash-lite-preview');

test('S48 capability records match only the exact official endpoint, protocol and model ID', () => {
  assert.equal(caps.officialCapability(LITE).images, true);
  assert.equal(caps.officialCapability(V4_PRO).images, false, 'Pro does not inherit Flash image input');
  assert.equal(caps.officialCapability(FLASH).images, true);
  assert.equal(caps.officialCapability(SONNET_46).images, true);
  assert.match(caps.officialCapability(PREVIEW).retired, /shut down.*2026-05-25/);
  for (const unknown of [
    official('gemini', 'gemini', 'gemini-unlisted'), official('gemini', 'gemini', 'GEMINI-3.1-FLASH-LITE'), official('gemini', 'gemini', 'gemini-3.1-flash-lite-001'),
    official('gemini', 'gemini', 'gemini-3.1'), official('openai', 'responses', 'toString'), official('openai', 'responses', '__proto__'),
    official('claude', 'chat-completions', 'claude-opus-5-5'), official('openai', 'messages', 'gpt-5.4'),
    // A gateway or the development loopback with the same ID is not the vendor.
    { provider: 'gateway', gatewayId: 'gw', protocol: 'responses', baseUrl: 'https://api.openai.com/v1', model: 'gpt-5.4' },
    { ...GPT54, baseUrl: 'http://127.0.0.1:9999/v1' }, { ...LITE, baseUrl: 'https://generativelanguage.googleapis.com.evil.invalid' },
  ]) {
    assert.equal(caps.officialCapability(unknown), undefined, JSON.stringify(unknown));
    assert.deepEqual(plain(caps.reasoningChoices(unknown)), ['default'], 'unknown targets offer only the provider default');
  }
  assert.ok(caps.officialCapability({ ...GPT54, baseUrl: 'https://api.openai.com/v1/' }), 'a trailing slash is the same endpoint');
});

test('S48 image guard: listed allows, documented false refuses, unknown refuses, and no older confirmation bypasses either', () => {
  const legacy = target => ({ ...target, imageSupportConfirmedFor: images.imageSupportTarget(target) });
  images.assertModelImageSupport(LITE); images.assertModelImageSupport(PREVIEW); images.assertModelImageSupport(LUNA);
  for (const refused of [V4_PRO, legacy(V4_PRO), official('groq', 'chat-completions', 'llama-3.3-70b-versatile')]) {
    assert.throws(() => images.assertModelImageSupport(refused), /does not support images.*attachments were kept/);
  }
  for (const unknown of [official('gemini', 'gemini', 'gemini-unlisted'), legacy(official('gemini', 'gemini', 'gemini-unlisted')),
    legacy({ ...GPT54, baseUrl: 'http://127.0.0.1:9999/v1' })]) {
    assert.throws(() => images.assertModelImageSupport(unknown), /not been verified yet.*attachments were kept/);
  }
  // A gateway keeps its own confirmation rule.
  const gateway = { provider: 'gateway', gatewayId: 'gw-1', protocol: 'responses', baseUrl: 'https://api.openai.com/v1', model: 'gpt-5.4' };
  assert.throws(() => images.assertModelImageSupport(gateway), /unconfirmed/);
  images.assertModelImageSupport(legacy(gateway));
  assert.throws(() => images.assertModelImageSupport({ ...legacy(gateway), gatewayId: 'gw-2' }), /unconfirmed/, 'another gateway cannot reuse it');
});

test('S48 each model offers its own native levels: default first, off only where documented, no normalising', () => {
  const choices = target => plain(caps.reasoningChoices(target));
  assert.deepEqual(choices(LITE), ['default', 'minimal', 'low', 'medium', 'high'], 'minimal is a level, not off');
  assert.deepEqual(choices(PRO), ['default', 'low', 'medium', 'high']);
  assert.deepEqual(choices(GPT54), ['default', 'none', 'low', 'medium', 'high', 'xhigh']);
  assert.deepEqual(choices(official('openai', 'responses', 'gpt-6-astra')), ['default', 'low', 'medium', 'high', 'xhigh', 'max']);
  assert.deepEqual(choices(official('openai', 'chat-completions', 'gpt-6.1-sol')), ['default', 'low', 'medium', 'high', 'xhigh', 'max']);
  assert.deepEqual(choices(LUNA), ['default', 'none', 'low', 'medium', 'high', 'xhigh', 'max']);
  assert.deepEqual(choices(OPUS), ['default', 'low', 'medium', 'high', 'xhigh', 'max'], 'Opus 5.5 cannot turn reasoning off');
  assert.deepEqual(choices(HAIKU), ['default', 'off', 'low', 'medium', 'high', 'xhigh', 'max']);
  assert.deepEqual(choices(SONNET_46), ['default', 'off', 'low', 'medium', 'high', 'max'], 'no xhigh on Sonnet 4.6');
  assert.deepEqual(choices(FLASH), ['default', 'off', 'low', 'high', 'max']);
  assert.deepEqual(choices(V4_PRO), ['default', 'off', 'low', 'high', 'max']);
  assert.deepEqual(choices(PREVIEW), ['default'], 'the retired preview has no verified levels');
});

test('S49 coverage: reviewed model families and exact aliases have image facts and native choices', () => {
  const groups = [
    ['gemini', 'gemini', ['gemini-4-argon', 'gemini-3.8-flash', 'gemini-3.7-flash', 'gemini-3.1-pro-preview', 'gemini-3.1-pro-preview-customtools'], ['low', 'medium', 'high']],
    ['gemini', 'gemini', ['gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite'], ['minimal', 'low', 'medium', 'high']],
    ['openai', 'responses', ['gpt-5.4', 'gpt-5.4-mini', 'gpt-5.4-nano', 'gpt-5.5', 'gpt-5.4-2026-03-05', 'gpt-5.4-mini-2026-03-17', 'gpt-5.4-nano-2026-03-17', 'gpt-5.5-2026-04-23'], ['none', 'low', 'medium', 'high', 'xhigh']],
    ['openai', 'responses', ['gpt-5.4-pro', 'gpt-5.5-pro', 'gpt-5.4-pro-2026-03-05', 'gpt-5.5-pro-2026-04-23'], ['medium', 'high', 'xhigh']],
    ['openai', 'responses', ['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna', 'gpt-6-sol', 'gpt-6-luna'], ['none', 'low', 'medium', 'high', 'xhigh', 'max']],
    ['openai', 'responses', ['gpt-6-astra', 'gpt-6.1-sol'], ['low', 'medium', 'high', 'xhigh', 'max']],
    ['openai', 'responses', ['gpt-5.6-cyber'], []],
    ['claude', 'messages', ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-fable-5', 'claude-fable-5-1', 'claude-mythos-5', 'claude-mythos-5-1'], ['low', 'medium', 'high', 'xhigh', 'max']],
    ['claude', 'messages', ['claude-opus-5', 'claude-sonnet-5', 'claude-haiku-5-5', 'claude-opus-4-8', 'claude-opus-4-7'], ['off', 'low', 'medium', 'high', 'xhigh', 'max']],
    ['claude', 'messages', ['claude-opus-4-6', 'claude-sonnet-4-6'], ['off', 'low', 'medium', 'high', 'max']],
    ['claude', 'messages', ['claude-opus-4-5', 'claude-opus-4-5-20251101'], ['off', 'low', 'medium', 'high']],
    ['claude', 'messages', ['claude-sonnet-4-5', 'claude-sonnet-4-5-20250929', 'claude-haiku-4-5', 'claude-haiku-4-5-20251001'], ['off']],
    ['deepseek', 'chat-completions', ['deepseek-flash', 'deepseek-v4-flash', 'deepseek-v4-flash-vision-exp'], ['off', 'low', 'high', 'max']],
  ];
  for (const [provider, protocol, ids, choices] of groups) for (const id of ids) {
    const target = official(provider, protocol, id), record = caps.officialCapability(target);
    assert.equal(record?.images, true, id);
    assert.ok(record.sources.every(source => source.startsWith('https://')), id);
    assert.deepEqual(plain(caps.reasoningChoices(target)), ['default', ...choices], id);
    assert.equal(caps.isOfficialAnswerCandidate(target), !id.startsWith('gpt-5.5-pro'), id);
    images.assertModelImageSupport(target);
  }
  assert.equal(caps.isOfficialAnswerCandidate(V4_PRO), true);
  assert.equal(caps.officialCapability(V4_PRO).images, false);
  assert.equal(caps.isOfficialAnswerCandidate(PREVIEW), false, 'saved retired preview retains facts but is not offered for new selections');
  assert.equal(caps.isOfficialAnswerCandidate(official('openai', 'responses', 'gpt-5.4-cyber')), false);
  for (const target of [official('openai', 'chat-completions', 'gpt-5.4-pro'), official('openai', 'responses', 'gpt-5.4-mini-2099-01-01'),
    official('gemini', 'gemini', 'gemini-3-flash-preview'), official('gemini', 'gemini', 'gemini-2.5-pro'),
    official('openai', 'responses', 'gpt-5.3-codex'), official('claude', 'messages', 'claude-sonnet-4-20250514')]) {
    assert.equal(caps.isOfficialAnswerCandidate(target), false, target.model);
    assert.equal(caps.officialCapability(target), undefined, target.model);
  }
});

test('S48 a choice sends the complete legal combination; default sends nothing; illegal choices are refused', () => {
  const fields = (target, choice) => plain(caps.reasoningForChoice(target, choice) ?? null);
  assert.deepEqual(fields(SONNET_46, 'high'), { thinking: 'adaptive', effort: 'high' });
  assert.deepEqual(fields(SONNET_46, 'off'), { thinking: 'disabled' });
  assert.deepEqual(fields(FLASH, 'max'), { thinking: 'enabled', effort: 'max' });
  assert.deepEqual(fields(FLASH, 'off'), { thinking: 'disabled' });
  assert.deepEqual(fields(OPUS, 'max'), { effort: 'max' }, 'Opus never receives disabled');
  assert.deepEqual(fields(HAIKU, 'off'), { thinking: 'disabled' });
  assert.deepEqual(fields(LITE, 'minimal'), { effort: 'minimal' });
  assert.deepEqual(fields(GPT54, 'none'), { effort: 'none' }, 'none is a level, distinct from the default');
  for (const target of [SONNET_46, OPUS, FLASH, LITE, GPT54, official('gemini', 'gemini', 'gemini-unlisted')]) assert.equal(fields(target, 'default'), null);
  for (const [target, choice] of [[OPUS, 'off'], [SONNET_46, 'xhigh'], [PRO, 'minimal'], [GPT54, 'max'], [FLASH, 'medium'], [official('gemini', 'gemini', 'gemini-unlisted'), 'high']]) {
    assert.throws(() => caps.reasoningForChoice(target, choice), /not available/, `${target.model} ${choice}`);
  }
  // Older per-model settings are read without loss, or not at all.
  assert.equal(caps.choiceForSetting(SONNET_46, { thinking: 'adaptive', effort: 'high' }), 'high');
  assert.equal(caps.choiceForSetting(SONNET_46, { effort: 'high' }), undefined, 'effort without adaptive sends something else');
  assert.equal(caps.choiceForSetting(SONNET_46, { thinking: 'disabled', effort: 'low' }), undefined);
  assert.equal(caps.choiceForSetting(FLASH, { thinking: 'disabled' }), 'off');
  assert.equal(caps.choiceForSetting(GPT54, { effort: 'xhigh' }), 'xhigh');
  assert.equal(caps.choiceForSetting(GPT54, undefined), 'default');
});

// ---- The real built LLMHelper with fake clients at the official endpoints ----
const SEND_STUB = 'synthetic-send-stub';
function runtime(t) {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 's48-reasoning-'));
  const electronId = require.resolve('electron'), cached = require.cache[electronId];
  const built = require.resolve('../../../dist-electron/electron/LLMHelper.js'), cachedHelper = require.cache[built];
  delete require.cache[built];
  require.cache[electronId] = { id: electronId, filename: electronId, loaded: true, exports: { app: { getPath: () => userData, isPackaged: true } } };
  let LLMHelper;
  try { ({ LLMHelper } = require(built)); }
  finally {
    if (cached) require.cache[electronId] = cached; else delete require.cache[electronId];
    if (cachedHelper) require.cache[built] = cachedHelper; else delete require.cache[built];
  }
  const helper = new LLMHelper(), bodies = [];
  helper.getProviderScopePolicy = () => ({});
  helper.processImage = async () => ({ mimeType: 'image/png', data: 'AAAA' });
  const configs = { gemini: LITE, openai: GPT54, claude: SONNET_46, deepseek: FLASH };
  for (const config of Object.values(configs)) helper.configureProvider(config, 'synthetic-key');
  const fake = () => { const send = async body => { bodies.push(body); throw Error(SEND_STUB); };
    return { chat: { completions: { create: send } }, responses: { create: send }, messages: { create: send, stream: send }, models: { generateContent: send, generateContentStream: send } }; };
  const install = () => { helper.client = fake(); helper.openaiClient = fake(); helper.claudeClient = fake(); helper.deepseekClient = fake(); };
  install();
  t.after(() => { helper.scrubKeys(); fs.rmSync(userData, { recursive: true, force: true }); });
  const select = target => { helper.configureProvider(target, 'synthetic-key'); install(); helper.setModel(`llm-target:${target.provider}:${target.protocol}:${target.model}`); };
  const ask = async (imagePaths) => {
    const before = bodies.length;
    await assert.rejects(async () => { for await (const _ of helper.streamChat('QUESTION', imagePaths)) { /* drain */ } }, error => String(error?.message).includes(SEND_STUB) || error?.name === 'GenerationResultError' || /not been verified|does not support/.test(error?.message));
    return bodies.slice(before);
  };
  return { helper, bodies, select, ask };
}
const wire = body => {
  const out = {};
  for (const key of ['reasoning_effort', 'thinking', 'output_config', 'reasoning']) if (Object.hasOwn(body, key)) out[key] = body[key];
  if (body.config?.thinkingConfig) out.thinkingConfig = body.config.thinkingConfig;
  return plain(out);
};

test('S48 mock wire fields are exact per model and absent for the provider default', async t => {
  const r = runtime(t);
  for (const [target, choice, expected] of [
    [SONNET_46, 'high', { thinking: { type: 'adaptive' }, output_config: { effort: 'high' } }],
    [SONNET_46, 'off', { thinking: { type: 'disabled' } }],
    [OPUS, 'max', { output_config: { effort: 'max' } }],
    [HAIKU, 'off', { thinking: { type: 'disabled' } }],
    [FLASH, 'high', { reasoning_effort: 'high', thinking: { type: 'enabled' } }],
    [FLASH, 'off', { thinking: { type: 'disabled' } }],
    [LITE, 'minimal', { thinkingConfig: { thinkingLevel: 'MINIMAL' } }],
    [GPT54, 'xhigh', { reasoning: { effort: 'xhigh' } }],
    [LUNA, 'none', { reasoning_effort: 'none' }],
    [official('gemini', 'gemini', 'gemini-3.8-flash'), 'medium', { thinkingConfig: { thinkingLevel: 'MEDIUM' } }],
    [official('openai', 'responses', 'gpt-5.4-pro-2026-03-05'), 'xhigh', { reasoning: { effort: 'xhigh' } }],
    [official('openai', 'chat-completions', 'gpt-5.4-mini'), 'none', { reasoning_effort: 'none' }],
    [official('claude', 'messages', 'claude-opus-4-7'), 'xhigh', { thinking: { type: 'adaptive' }, output_config: { effort: 'xhigh' } }],
    [official('claude', 'messages', 'claude-opus-4-5-20251101'), 'high', { output_config: { effort: 'high' } }],
    [official('claude', 'messages', 'claude-sonnet-4-5'), 'off', { thinking: { type: 'disabled' } }],
    [official('deepseek', 'chat-completions', 'deepseek-v4-flash-vision-exp'), 'low', { reasoning_effort: 'low', thinking: { type: 'enabled' } }],
    ...[SONNET_46, OPUS, FLASH, LITE, GPT54].map(target => [target, 'default', {}]),
  ]) {
    r.select(target); r.helper.setSavedReasoning({ choice });
    const sent = await r.ask();
    assert.ok(sent.length >= 1, `${target.model} ${choice} reached the fake client`);
    for (const body of sent) {
      assert.equal(body.model, target.model);
      assert.deepEqual(wire(body), expected, `${target.model} ${choice}`);
    }
  }
});

test('S48 image refusals happen before any send and the text path still works', async t => {
  const r = runtime(t);
  const image = path.join(os.tmpdir(), 's48-synthetic.png');
  for (const target of [V4_PRO, official('gemini', 'gemini', 'gemini-unlisted')]) {
    r.select(target);
    const before = r.bodies.length;
    await assert.rejects(async () => { for await (const _ of r.helper.streamChat('QUESTION', [image])) { /* drain */ } }, /does not support images|not been verified yet/);
    assert.equal(r.bodies.length, before, `${target.model}: zero outbound`);
    assert.ok((await r.ask()).length >= 1, 'text still goes to the model');
  }
  r.select(LITE);
  assert.ok((await r.ask([image])).some(body => JSON.stringify(body.contents).includes('inlineData')), 'a listed image model receives the image');
});

test('S49 non-streaming-only Pro stays identifiable but is not offered or sent on the streaming answer path', async t => {
  const r = runtime(t);
  for (const id of ['gpt-5.5-pro', 'gpt-5.5-pro-2026-04-23']) {
    const target = official('openai', 'responses', id);
    assert.equal(caps.officialCapability(target).images, true, 'keep the documented capability, not a false image claim');
    assert.equal(caps.isOfficialAnswerCandidate(target), false);
    r.select(target);
    assert.equal(r.helper.getCurrentModelSelection(), `llm-target:openai:responses:${id}`, 'never delete or substitute the saved selection');
    await assert.rejects(async () => { for await (const _ of r.helper.streamChat('QUESTION')) {} }, /requires non-streaming/);
    assert.equal(r.bodies.length, 0, 'refuse before a client call');
  }
  assert.equal(caps.isOfficialAnswerCandidate(official('openai', 'responses', 'gpt-5.4-pro')), true, 'streaming Pro is still offered');
});

test('S49 an unsupported saved backup does not block the primary and is refused only when fallback is attempted', async t => {
  const r = runtime(t), h = r.helper;
  r.select(GPT54);
  h.setGenerationPolicy({ ...h.getGenerationPolicy(), backupModel: 'llm-target:openai:responses:gpt-5.5-pro' });
  const task = h.beginGenerationTask('interview');
  try { assert.equal(task.primary.target.model, 'gpt-5.4'); assert.equal(task.backup.target.model, 'gpt-5.5-pro'); }
  finally { task.close(); }
  h.openaiClient.responses.create = async function* (body) {
    r.bodies.push(body);
    yield { type: 'response.output_text.delta', delta: 'PRIMARY ANSWER' };
    yield { type: 'response.completed', response: { status: 'completed' } };
  };
  let answer = '';
  for await (const part of h.streamChat('QUESTION')) answer += part;
  assert.equal(answer, 'PRIMARY ANSWER');
  assert.deepEqual(r.bodies.map(body => body.model), ['gpt-5.4'], 'the primary reaches its client despite the old backup');
  r.bodies.length = 0;
  h.openaiClient.responses.create = async body => { r.bodies.push(body); throw Object.assign(new Error('synthetic primary unavailable'), { status: 503 }); };
  await assert.rejects(async () => { for await (const _ of h.streamChat('QUESTION')) {} }, /requires non-streaming/);
  assert.deepEqual(r.bodies.map(body => body.model), ['gpt-5.4'], 'fallback is refused before sending to the unsupported model');
  assert.equal(h.getGenerationPolicy().backupModel, 'llm-target:openai:responses:gpt-5.5-pro', 'stored intent is not silently removed');
});

test('S48 the snapshot is fixed at task start; backups, explicit targets and gateways never take the primary level', async t => {
  const r = runtime(t), h = r.helper;
  r.select(SONNET_46); h.setSavedReasoning({ choice: 'high' });
  const first = h.beginGenerationTask('interview');
  h.setSessionReasoning('llm-target:claude:messages:claude-sonnet-4-6', 'low');
  const second = h.beginGenerationTask('interview');
  try {
    assert.deepEqual(plain(first.primary.target.reasoning), { thinking: 'adaptive', effort: 'high' }, 'in-flight task keeps its level');
    assert.deepEqual(plain(second.primary.target.reasoning), { thinking: 'adaptive', effort: 'low' }, 'the next task takes the new level');
  } finally { first.close(); second.close(); }
  h.setGenerationPolicy({ ...h.getGenerationPolicy(), backupModel: 'llm-target:claude:messages:claude-opus-5-5' });
  const withBackup = h.beginGenerationTask('interview');
  try { assert.equal('reasoning' in withBackup.backup.target, false, 'an official backup uses the provider default'); } finally { withBackup.close(); }
  const explicit = h.beginGenerationTask('compatibility', undefined, { ...SONNET_46, reasoning: { thinking: 'adaptive', effort: 'max' } });
  try { assert.equal('reasoning' in explicit.primary.target, false, 'an explicit target never sends the primary or stored level'); } finally { explicit.close(); }
  // The Save-and-test connection request sends no reasoning field.
  h.setGenerationPolicy({ ...h.getGenerationPolicy(), backupModel: undefined });
  const before = r.bodies.length;
  await assert.rejects(() => h.testProviderConnection('claude'), new RegExp(SEND_STUB));
  assert.deepEqual(wire(r.bodies[before]), {});
  // A gateway keeps its own configuration and refuses the shared control.
  h.configureGateway({ id: 'gw-s48', protocol: 'chat-completions', baseUrl: 'https://gateway.invalid/v1', model: 'opaque', reasoning: { effort: 'low' } }, 'synthetic-gateway');
  h.setModel('llm-gateway:gw-s48:chat-completions:opaque');
  const gateway = h.beginGenerationTask('interview');
  try { assert.deepEqual(plain(gateway.primary.target.reasoning), { effort: 'low' }); } finally { gateway.close(); }
  assert.throws(() => h.setSessionReasoning('llm-gateway:gw-s48:chat-completions:opaque', 'high'), /own configuration/);
  assert.equal(h.getSessionReasoningState().mode, 'source');
});

test('S48 session override: inherit vs explicit default, stale and illegal writes refused, A→B→A never restores a hidden level', t => {
  const r = runtime(t), h = r.helper;
  const A = 'llm-target:claude:messages:claude-sonnet-4-6', B = 'llm-target:openai:responses:gpt-5.4';
  r.select(SONNET_46); h.setSavedReasoning({ choice: 'max' });
  assert.deepEqual(plain(h.getSessionReasoningState()), { target: A, mode: 'official', options: ['default', 'off', 'low', 'medium', 'high', 'max'], value: 'max', overridden: false });
  h.setSessionReasoning(A, 'default');
  assert.deepEqual(plain(h.getSessionReasoningState()).value, 'default'); assert.equal(h.getSessionReasoningState().overridden, true, 'explicit default is not inheritance');
  assert.equal(h.beginGenerationTask('interview').primary.target.reasoning, undefined);
  h.clearSessionReasoning();
  assert.equal(h.getSessionReasoningState().value, 'max'); assert.equal(h.getSessionReasoningState().overridden, false);
  for (const [expected, value, error] of [[B, 'high', /changed/], [A, 'xhigh', /not available/], [A, 'turbo', /Invalid/], [7, 'high', /Invalid/]]) {
    assert.throws(() => h.setSessionReasoning(expected, value), error);
    assert.equal(h.getSessionReasoningState().value, 'max', 'a refused write changes nothing');
  }
  // Inherited saved max on A → B (no max): the control shows the default with a notice, nothing is sent; back on A it is max again.
  r.select(GPT54); assert.equal(h.reconcileSessionReasoning(), undefined);
  assert.deepEqual(plain(h.getSessionReasoningState()), { target: B, mode: 'official', options: ['default', 'none', 'low', 'medium', 'high', 'xhigh'], value: 'default',
    notice: 'The selected reasoning level is not available for this model, so the provider default is used.', overridden: false });
  assert.equal(h.beginGenerationTask('interview').primary.target.reasoning, undefined);
  r.select(SONNET_46); assert.equal(h.getSessionReasoningState().value, 'max');
  // An explicit session max on A → B becomes an explicit default with a notice, and stays default back on A.
  h.setSessionReasoning(A, 'high'); h.clearSessionReasoning(); h.setSessionReasoning(A, 'max');
  r.select(GPT54); assert.match(h.reconcileSessionReasoning(), /not available/);
  assert.equal(h.getSessionReasoningState().value, 'default'); assert.equal(h.getSessionReasoningState().overridden, true);
  r.select(SONNET_46); assert.equal(h.reconcileSessionReasoning(), undefined);
  assert.equal(h.getSessionReasoningState().value, 'default', 'no hidden per-model memory is restored');
  // A level both models take is kept.
  h.setSessionReasoning(A, 'high'); r.select(GPT54); assert.equal(h.reconcileSessionReasoning(), undefined); assert.equal(h.getSessionReasoningState().value, 'high');
});

test('S48 an older setting that no choice expresses stays pending and applies only to its own target', t => {
  const r = runtime(t), h = r.helper;
  const A = 'llm-target:claude:messages:claude-sonnet-4-6';
  r.select(SONNET_46); h.setSavedReasoning({ legacy: { effort: 'high' }, target: A });
  const state = plain(h.getSessionReasoningState());
  assert.equal(state.value, 'legacy'); assert.equal(state.pendingLegacy, 'effort high');
  assert.deepEqual(plain(h.beginGenerationTask('interview').primary.target.reasoning), { effort: 'high' }, 'original behaviour until the user chooses');
  r.select(OPUS);
  assert.equal(h.beginGenerationTask('interview').primary.target.reasoning, undefined, 'another model never inherits it');
  assert.equal(h.getSessionReasoningState().value, 'default'); assert.match(h.getSessionReasoningState().notice, /not available/);
});
