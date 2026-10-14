import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { LocalContextStore } = require('../../../dist-electron/electron/services/LocalContextStore.js');
const { attachLocalContext } = require('../../../dist-electron/electron/llm/localContextRequest.js');
const { generateOnce } = require('../../../dist-electron/electron/llm/generateOnce.js');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ag50-'));
test.after(() => fs.rmSync(root, { recursive: true, force: true }));
const request = { protocol: 'chat-completions', model: 'gpt-4o', purpose: 'answer', contents: 'QUESTION', maxOutputTokens: 100, dataScopes: [], stream: false };
function fixture(name, bytes) { const file = path.join(root, name); fs.writeFileSync(file, bytes); return file; }
function store(name) { return new LocalContextStore(path.join(root, name)); }

test('AG50 imports complete UTF-8 snapshots, persists locally, and deletes them', () => {
  const s = store('state.json');
  const source = fixture('note.markdown', '# 中文\nFULL TEXT\n');
  const entries = s.addFiles([source]);
  assert.equal(entries[0].content, '# 中文\nFULL TEXT\n');
  fs.writeFileSync(source, 'changed outside app');
  assert.deepEqual(store('state.json').list(), entries);
  assert.equal(fs.readFileSync(path.join(root, 'state.json'), 'utf8').includes(source), false);
  assert.deepEqual(s.remove(entries[0].id), []);
  assert.deepEqual(store('state.json').list(), []);
});

test('AG50 rejects unsupported files, binary, invalid UTF-8, symlinks and oversize without partial saves', () => {
  const s = store('reject.json');
  for (const [name, bytes, error] of [
    ['bad.pdf', 'text', /Only/], ['bad.docx', 'text', /Only/], ['binary.txt', Buffer.from([0, 1, 2]), /UTF-8/],
    ['encoding.md', Buffer.from([0xff, 0xfe]), /UTF-8/], ['large.txt', 'a'.repeat(32769), /32 KiB/],
  ]) assert.throws(() => s.addFiles([fixture('good.txt', 'good'), fixture(name, bytes)]), error);
  const link = path.join(root, 'link.txt'); fs.symlinkSync(path.join(root, 'good.txt'), link);
  assert.throws(() => s.addFiles([link]));
  assert.deepEqual(s.list(), []);
});

test('AG50 enforces inclusive byte and count boundaries', () => {
  const s = store('limits.json');
  const files = [fixture('one.md', 'a'.repeat(32768)), fixture('two.txt', 'b'.repeat(32768))];
  assert.equal(s.addFiles(files).length, 2);
  assert.throws(() => s.addFiles([fixture('extra.md', 'x')]), /64 KiB/);
  const many = store('many.json');
  assert.equal(many.addFiles(Array.from({ length: 8 }, (_, i) => fixture(`${i}.txt`, 'x'))).length, 8);
  assert.throws(() => many.addFiles([fixture('ninth.md', 'x')]), /8 files/);
});

test('AG50 clear replaces unreadable storage without parsing it, including an unreadable file mode', () => {
  const file = path.join(root, 'recovery.json');
  const s = new LocalContextStore(file);
  for (const content of ['{broken', '{}', 'x'.repeat(512 * 1024 + 1), '[]']) {
    fs.writeFileSync(file, content);
    if (content === '[]') fs.chmodSync(file, 0o000);
    try {
      assert.throws(() => s.list(), { name: 'LocalContextError', message: 'Local Context could not be read. Check its local storage.' });
      assert.deepEqual(s.clear(), []);
      assert.deepEqual(s.list(), []);
      assert.equal(fs.readFileSync(file, 'utf8'), '[]');
    } finally { fs.chmodSync(file, 0o600); }
  }
});

test('AG50 mock wire has fixed reference-first position, no scope tag, and changes after removal', async () => {
  const s = store('wire.json');
  s.addFiles([fixture('wire.txt', 'ENTIRE REFERENCE')]);
  const sent = [];
  const access = { beforeSend() {}, client: { chat: { completions: { create: async body => {
    sent.push(body); return { choices: [{ message: { content: 'answer' }, finish_reason: 'stop' }] };
  } } } } };
  for (const policy of [{}, { transcript: false }, { screenshots: false }, { profile_history: false }]) {
    const prepared = attachLocalContext(request, s.list());
    const { assertProviderDataScopes } = require('../../../dist-electron/electron/llm/ProviderRouter.js');
    for await (const event of generateOnce(prepared, { ...access, beforeSend() { assertProviderDataScopes('openai', prepared.dataScopes, policy); } })) {}
    assert.match(JSON.stringify(sent.at(-1).messages[0]), /ENTIRE REFERENCE/);
    assert.match(JSON.stringify(sent.at(-1).messages[1]), /QUESTION/);
    assert.deepEqual(prepared.dataScopes, []);
  }
  s.remove(s.list()[0].id);
  assert.equal(attachLocalContext(request, s.list()), request);
  assert.doesNotMatch(JSON.stringify(attachLocalContext(request, s.list())), /ENTIRE REFERENCE/);
});

test('S44 large Local Context is attached whole for a small model, with no capacity refusal, and preserves caller contents and roles', () => {
  const content = 'x'.repeat(32757) + 'TAIL_MARKER';
  const entries = [{ id: 'x', name: 'x.txt', content }];
  const small = attachLocalContext({ ...request, model: 'llama-3.1-8b-instant', maxOutputTokens: 1_000_000 }, entries);
  assert.equal(JSON.parse(small.contents[0].parts[0].text.split('\n').slice(1).join('\n'))[0].content, content, 'no truncation');
  const contents = [{ role: 'user', parts: [{ text: 'earlier' }] }, { role: 'model', parts: [{ text: 'reply' }] }, { role: 'user', parts: [{ text: 'now' }] }];
  const prepared = attachLocalContext({ ...request, contents }, entries);
  assert.deepEqual(prepared.contents.slice(1), contents);
  assert.equal(contents.length, 3);
  const { manualAnswerError } = require('../../../dist-electron/electron/direct-assist/errors.js');
  assert.doesNotMatch(manualAnswerError({ name: 'LocalContextCapacityError', message: 'UNTRUSTED' }), /capacity|UNTRUSTED/);
  assert.doesNotMatch(manualAnswerError({ name: 'LocalContextError', message: 'UNTRUSTED' }), /UNTRUSTED/);
});

test('AG50 shared generation covers manual answer and text chat; existing scope denial stays terminal', async () => {
  const electronId = require.resolve('electron');
  const previous = require.cache[electronId];
  require.cache[electronId] = { exports: { app: { getPath: () => root, isPackaged: false } } };
  let LLMHelper, WhatToAnswerLLM;
  try {
    ({ LLMHelper } = require('../../../dist-electron/electron/LLMHelper.js'));
    ({ WhatToAnswerLLM } = require('../../../dist-electron/electron/llm/WhatToAnswerLLM.js'));
  } finally { if (previous) require.cache[electronId] = previous; else delete require.cache[electronId]; }
  const s = store('local-context.json');
  s.addFiles([fixture('shared.txt', 'SHARED_LOCAL_CONTEXT')]);
  const sent = [];
  let policy = {};
  const helper = Object.assign(Object.create(LLMHelper.prototype), {
    selectedTarget: { provider: 'openai', protocol: 'chat-completions', model: 'gpt-4o' },
    currentModelId: 'gpt-4o', aiResponseLanguage: 'auto', personaPrompt: '', customNotes: '',
    getProviderScopePolicy: () => policy,
    openaiClient: { chat: { completions: { create: async body => {
      sent.push(body);
      return body.stream ? [{ choices: [{ delta: { content: 'ANSWER' }, finish_reason: 'stop' }] }]
        : { choices: [{ message: { content: 'ANSWER' }, finish_reason: 'stop' }] };
    } } } },
  });
  const collect = async source => { let value = ''; for await (const chunk of source) value += chunk; return value; };
  assert.equal(await helper.chat('TEXT QUESTION'), 'ANSWER');
  assert.equal(await collect(new WhatToAnswerLLM(helper).generateStream('MANUAL QUESTION')), 'ANSWER');
  assert.equal(sent.length, 2);
  for (const body of sent) {
    const users = body.messages.filter(message => message.role === 'user');
    assert.match(JSON.stringify(users[0]), /SHARED_LOCAL_CONTEXT/);
    assert.match(JSON.stringify(users[1]), /QUESTION/);
  }
  for (const scope of ['transcript', 'screenshots', 'profile_history']) {
    policy = { [scope]: false };
    assert.equal(await collect(helper.selectedGeneration('', undefined, undefined, true, 'answer')), 'ANSWER');
    assert.match(JSON.stringify(sent.at(-1)), /SHARED_LOCAL_CONTEXT/);
  }
  policy = { transcript: false };
  const count = sent.length;
  await assert.rejects(() => helper.chat('TEXT QUESTION'), { name: 'ProviderScopeError' });
  assert.equal(sent.length, count);
  policy = {};
  s.remove(s.list()[0].id);
  await helper.chat('AFTER DELETE');
  assert.doesNotMatch(JSON.stringify(sent.at(-1)), /SHARED_LOCAL_CONTEXT/);
  s.addFiles([fixture('capacity.txt', 'x'.repeat(32758) + 'LARGE_TAIL')]);
  helper.selectedTarget = { provider: 'openai', protocol: 'chat-completions', model: 'llama-3.1-8b-instant' };
  assert.equal(await helper.chat('LARGE CONTEXT'), 'ANSWER');
  assert.match(JSON.stringify(sent.at(-1).messages), /x{32758}LARGE_TAIL/, 'sent whole to a small model');
  // The provider, not a local estimate, decides capacity; its overflow stays a terminal failure.
  const create = helper.openaiClient.chat.completions.create;
  helper.openaiClient.chat.completions.create = async body => { sent.push(body); throw Object.assign(new Error('synthetic overflow'), { status: 400, error: { code: 'context_length_exceeded' } }); };
  const beforeOverflow = sent.length;
  await assert.rejects(() => helper.chat('OVERFLOW'), /synthetic overflow/);
  assert.equal(sent.length, beforeOverflow + 1, 'no hidden retry or trimmed resend');
  helper.openaiClient.chat.completions.create = create;
  s.clear();
  const beforeBudgetFailure = sent.length;
  helper.selectedTarget = { provider: 'openai', protocol: 'chat-completions', model: 'gpt-4o' };
  fs.writeFileSync(path.join(root, 'local-context.json'), '{CORRUPTED');
  const unreadable = { name: 'LocalContextError', message: 'Local Context could not be read. Check its local storage.' };
  await assert.rejects(() => helper.chat('TEXT WHILE CORRUPT'), unreadable);
  await assert.rejects(() => collect(new WhatToAnswerLLM(helper).generateStream('MANUAL WHILE CORRUPT')), unreadable);
  assert.equal(sent.length, beforeBudgetFailure);
  s.clear();
  assert.equal(await helper.chat('RECOVERED QUESTION'), 'ANSWER');
  assert.doesNotMatch(JSON.stringify(sent.at(-1)), /LOCAL CONTEXT|CORRUPTED/);
});
