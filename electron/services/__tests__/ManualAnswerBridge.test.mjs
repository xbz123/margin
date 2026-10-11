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
