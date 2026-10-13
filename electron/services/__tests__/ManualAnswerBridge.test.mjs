import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

function bridge() {
  const ipc = new EventEmitter();
  ipc.invoke = async () => {}; ipc.send = () => {};
  let api;
  vm.runInNewContext(readFileSync(new URL('../../../dist-electron/electron/preload.js', import.meta.url), 'utf8'), {
    module: { exports: {} }, exports: {}, require: name => {
      assert.equal(name, 'electron');
      return { ipcRenderer: ipc, contextBridge: { exposeInMainWorld: (_, value) => { api = value; } } };
    },
    window: { addEventListener() {} }, process: { platform: 'darwin' },
    console: { log() {}, warn() {}, error() {}, info() {}, debug() {} }, URL,
  });
  const emit = (name, value) => ipc.emit('intelligence-' + name, {}, value);
  return { api, emit, ipc };
}

test('AG42 actual preload delivers ordered batches, seals terminal and rejects old IDs', async () => {
  const { api, emit } = bridge(); const tokens = [], finals = [], terminals = [];
  api.onIntelligenceTokenBatch(data => tokens.push(...data.items.map(item => item.token)));
  api.onIntelligenceSuggestedAnswer(data => finals.push(data.answer));
  api.onIntelligenceGenerationTerminal(data => terminals.push(data));
  const observer = [];
  api.onIntelligenceGenerationTerminal(data => observer.push(data.status));
  emit('generation-started', { requestId: 'first' });
  emit('token-batch', { requestId: 'first', items: [{ token: 'a' }, { token: 'b' }] });
  emit('suggested-answer', { requestId: 'first', answer: 'ab' });
  emit('generation-terminal', { requestId: 'first', status: 'completed' });
  emit('token-batch', { requestId: 'first', items: [{ token: 'LATE' }] });
  assert.equal(finals[0], tokens.join(''));
  emit('generation-started', { requestId: 'second' });
  emit('generation-terminal', { requestId: 'first', status: 'failed' });
  emit('suggested-answer', { requestId: 'first', answer: 'OLD' });
  emit('token-batch', { requestId: 'first', items: [{ token: 'OLD' }] });
  await api.cancelIntelligenceGeneration();
  emit('token-batch', { requestId: 'second', items: [{ token: 'AFTER CANCEL' }] });
  emit('generation-terminal', { requestId: 'second', status: 'completed' });
  assert.deepEqual(tokens, ['a', 'b']); assert.deepEqual(finals, ['ab']);
  assert.deepEqual(terminals.map(event => event.status), ['completed', 'cancelled']);
  assert.deepEqual(observer, ['completed', 'cancelled']);
  // Session teardown invalidates callbacks already queued for the prior meeting.
  const f = bridge(); const received = [];
  f.api.onIntelligenceTokenBatch(data => received.push(data));
  f.emit('generation-started', { requestId: 'meeting' }); f.ipc.emit('session-reset');
  f.emit('token-batch', { requestId: 'meeting', items: [{ token: 'OLD SESSION' }] });
  assert.equal(received.length, 0);
});

test('S42-04 preload reuses the main capture action and original text submit time, and retries only by ID', async t => {
  const { api, calls, advance } = speechBridge(t, () => Promise.resolve());
  await advance(4000);
  await api.generateWhatToSay(undefined, ['/synthetic.png'], 'main-owned-capture');
  assert.equal(calls.some(call => call.channel === 'speech-action:begin'), false, 'capture must not start a second clock or speech cut');
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0].args[2])), { speechActionId: 'main-owned-capture', stage1EndAt: 4000 });
  await api.streamGeminiChat('typed', undefined, undefined, { clickedAt: 3500 });
  assert.equal(calls.find(call => call.channel === 'gemini-chat-stream').args[3].clickedAt, 3500);
  await api.retryGeneration('failed-request');
  const retry = calls.find(call => call.channel === 'generation:retry');
  assert.deepEqual(Array.from(retry.args), ['failed-request', 4000]);
});

function speechBridge(t, reply) {
  t.mock.timers.reset();
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 });
  const ipc = new EventEmitter(), calls = [];
  ipc.send = () => {};
  ipc.invoke = (channel, ...args) => {
    if (channel !== 'get-verbose-logging') calls.push({ channel, args, at: Date.now() });
    return reply(channel, ...args) ?? Promise.resolve();
  };
  let api;
  vm.runInNewContext(readFileSync(new URL('../../../dist-electron/electron/preload.js', import.meta.url), 'utf8'), {
    module: { exports: {} }, exports: {}, require: () => ({ ipcRenderer: ipc, contextBridge: { exposeInMainWorld: (_, value) => { api = value; } } }),
    window: { addEventListener() {} }, process: { platform: 'darwin' }, setTimeout, clearTimeout, Date, crypto,
    console: { log() {}, warn() {}, error() {}, info() {}, debug() {} }, URL,
  });
  const advance = async ms => { t.mock.timers.tick(ms); for (let i = 0; i < 10; i++) await Promise.resolve(); };
  return { api, calls, advance };
}
const later = ms => new Promise(resolve => setTimeout(() => resolve({ speechActionId: 'ignored' }), ms));

test('S42-03 preload: the action channel follows the begin receipt at 45 ms, not a provider acknowledgement', async t => {
  const { api, calls, advance } = speechBridge(t, channel => channel === 'speech-action:begin' ? later(45) : undefined);
  void api.generateClarify();
  await advance(0);
  const begin = calls[0];
  assert.equal(begin.channel, 'speech-action:begin');
  assert.match(begin.args[0].clientActionId, /^[0-9a-f-]{36}$/);
  assert.equal(begin.args[0].kind, 'clarify'); assert.equal(begin.args[0].clickedAt, 0);
  await advance(44);
  assert.equal(calls.length, 1, 'nothing is sent before the receipt');
  await advance(1);
  assert.deepEqual(JSON.parse(JSON.stringify(calls[1])), { channel: 'generate-clarify', args: [{ speechActionId: begin.args[0].clientActionId, stage1EndAt: 45 }], at: 45 });
});

test('S42-03 preload: without a receipt the action follows at the 750 ms boundary, once; a rejected begin still continues so main can reject it', async t => {
  const { api, calls, advance } = speechBridge(t, channel => channel === 'speech-action:begin' ? later(900) : undefined);
  void api.generateCodeHint(undefined, 'problem');
  await advance(749);
  assert.equal(calls.length, 1);
  await advance(1);
  assert.deepEqual(JSON.parse(JSON.stringify(calls[1].args)), [null, 'problem', { speechActionId: calls[0].args[0].clientActionId, stage1EndAt: 750 }]);
  await advance(500);
  assert.equal(calls.length, 2, 'a late begin reply does not resend');
  const rejected = speechBridge(t, channel => channel === 'speech-action:begin' ? Promise.reject(Error('invalid')) : undefined);
  void rejected.api.generateRecap();
  await rejected.advance(0);
  assert.equal(rejected.calls[1].channel, 'generate-recap');
});

test('S42-03 preload: Stop names its main-owned dictation mark and never waits for the Answer reply; typed questions never wait for speech', async t => {
  const { api, calls, advance } = speechBridge(t, channel => channel === 'dictation:begin' ? new Promise(() => {})
    : channel === 'speech-action:begin' ? new Promise(() => {}) : channel === 'speech-action:freeze' ? Promise.resolve({ speechActionId: 'x', question: 'frozen' }) : undefined);
  await assert.rejects(api.finishDictation(), /not started/);
  void api.beginDictation();
  const mark = calls.find(call => call.channel === 'dictation:begin').args[0];
  assert.match(mark.dictationId, /^[0-9a-f-]{36}$/);
  await advance(100);
  const finished = api.finishDictation();
  await advance(0);
  const begin = calls.find(call => call.channel === 'speech-action:begin');
  assert.deepEqual([begin.args[0].kind, begin.args[0].dictationId, begin.args[0].clickedAt, begin.at], ['answer', mark.dictationId, 100, 100],
    'begin leaves at the Stop trigger although the Answer reply never arrived');
  await advance(749);
  assert.equal(calls.at(-1).channel, 'speech-action:begin');
  await advance(1);
  assert.deepEqual(await finished, { speechActionId: 'x', question: 'frozen' });
  assert.deepEqual(JSON.parse(JSON.stringify(calls.at(-1).args)), [{ speechActionId: begin.args[0].clientActionId, stage1EndAt: 850 }],
    'the bound runs from the Stop trigger');
  await assert.rejects(api.finishDictation(), /not started/, 'a mark is finished once');
  const count = calls.length;
  void api.streamGeminiChat('typed', undefined, undefined, {});
  assert.equal(calls.length, count + 1);
  assert.equal(calls.at(-1).channel, 'gemini-chat-stream');
});
