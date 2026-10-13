import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createRequire } from 'node:module';
import ts from 'typescript';

const require = createRequire(import.meta.url);
class Socket extends EventEmitter {
  static OPEN = 1;
  static instances = [];
  readyState = 0;
  sent = [];
  bufferedAmount = 0;
  constructor(url, options) { super(); this.url = url; this.options = options; Socket.instances.push(this); }
  send(data) { this.sent.push(data); }
  open() { this.readyState = 1; this.emit('open'); }
  terminate() { this.readyState = 3; this.emit('close', 1006); }
  close() { this.terminate(); }
}
const modules = new Map();
function load(name) {
  if (modules.has(name)) return modules.get(name);
  const exports = {};
  modules.set(name, exports);
  const source = fs.readFileSync(new URL('../' + name + '.ts', import.meta.url), 'utf8');
  const js = ts.transpileModule(source, { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true,
  } }).outputText;
  new Function('require', 'exports', js)(id => id === 'ws' ? Socket : id.startsWith('./') ? load(id.substring(2)) : require(id), exports);
  return exports;
}

for (const name of ['Aliyun', 'Doubao']) {
  test(name + ': overflow reports once until audio is accepted or the connection recovers', t => {
    const { [name + 'StreamingSTT']: Provider } = load(name + 'StreamingSTT');
    const stt = new Provider('synthetic-secret', { workspaceId: 'workspace' });
    t.after(() => stt.stop(false));
    const errors = [];
    stt.on('error', error => errors.push(error));
    stt.start();
    stt.write(Buffer.alloc(160 * 1024));
    for (let i = 0; i < 20; i++) stt.write(Buffer.alloc(1024));
    assert.equal(errors.length, 1);
    assert.equal(stt.queuedBytes, 160 * 1024);
    const ws = Socket.instances.at(-1);
    ws.open();
    if (name === 'Aliyun') ws.emit('message', Buffer.from(JSON.stringify({ header: { event: 'task-started' } })));
    assert.equal(stt.queuedBytes, 0);
    for (let i = 0; i < 20; i++) stt.write(Buffer.alloc(160 * 1024 + 2));
    assert.equal(errors.length, 2);
    stt.write(Buffer.alloc(2));
    stt.write(Buffer.alloc(160 * 1024 + 2));
    assert.equal(errors.length, 3, 'accepted audio rearms the overflow notification');
  });
  test(name + ': retry budget, drain timeout and permanent authentication failure', async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    Socket.instances = [];
    const { [name + 'StreamingSTT']: Provider } = load(name + 'StreamingSTT');
    const stt = new Provider('synthetic-secret', { workspaceId: 'workspace' });
    t.after(() => stt.stop(false));
    const errors = [];
    stt.on('error', error => errors.push(error.message));
    stt.start();
    for (let attempt = 0; attempt <= 10; attempt++) {
      const ws = Socket.instances.at(-1);
      ws.open();
      ws.terminate();
      t.mock.timers.tick(30000);
    }
    assert.equal(Socket.instances.length, 11);
    assert.match(errors.at(-1), /maximum reconnect/);
    stt.start();
    const auth = Socket.instances.at(-1);
    auth.emit('unexpected-response', {}, { statusCode: 401, resume() {} });
    t.mock.timers.tick(60000);
    assert.equal(Socket.instances.length, 12);
    assert.match(errors.at(-1), /authentication/);
    stt.start();
    stt.write(Buffer.alloc(2));
    const drain = stt.finalize();
    t.mock.timers.tick(4500);
    await assert.rejects(drain, /drain timed out/);
    assert.match(errors.at(-1), /acknowledgement timed out/);
    assert.ok(errors.every(message => !message.includes('synthetic-secret')));
  });
  test(name + ': bounded queue, protocol order, drain, revocation and stale sockets', async t => {
    Socket.instances = [];
    const { [name + 'StreamingSTT']: Provider } = load(name + 'StreamingSTT');
    const stt = new Provider('synthetic-secret', { workspaceId: 'workspace' });
    t.after(() => stt.stop(false));
    const errors = [], transcripts = [];
    stt.on('error', error => errors.push(error.message));
    stt.on('transcript', row => transcripts.push(row));
    stt.start();
    stt.write(Buffer.alloc(160 * 1024 + 2));
    assert.equal(stt.queuedBytes, 0, 'oversized individual chunks must be rejected');
    assert.equal(errors.length, 1);
    stt.write(Buffer.alloc(160 * 1024));
    stt.write(Buffer.alloc(2));
    assert.equal(stt.queuedBytes, 160 * 1024);
    const ws = Socket.instances[0];
    ws.open();
    if (name === 'Aliyun') {
      assert.equal(JSON.parse(ws.sent[0]).header.action, 'run-task');
      assert.equal(ws.sent.length, 1, 'Aliyun must wait for task-started');
      const id = JSON.parse(ws.sent[0]).header.task_id;
      ws.emit('message', Buffer.from(JSON.stringify({ header: { event: 'task-started', task_id: id } })));
    } else {
      assert.equal(ws.sent[0][1], 0x11);
      assert.equal(ws.sent[1][1], 0x21, 'Doubao sends audio without waiting for a result');
    }
    assert.equal(stt.queuedBytes, 0);
    stt.notifySpeechEnded();
    const count = ws.sent.length;
    const draining = stt.finalize();
    assert.equal(ws.sent.length, count + 1);
    if (name === 'Aliyun') {
      assert.equal(JSON.parse(ws.sent.at(-1)).header.action, 'finish-task');
      ws.emit('message', Buffer.from(JSON.stringify({ header: { event: 'task-finished' },
        payload: { output: { sentence: { text: 'tail', sentence_end: true, id: 1 } } } })));
    } else {
      assert.equal(ws.sent.at(-1)[1], 0x23);
      assert.ok(ws.sent.at(-1).readInt32BE(4) < 0);
      const payload = Buffer.from(JSON.stringify({ result: { text: 'tail' } }));
      const frame = Buffer.alloc(8 + payload.length);
      frame.set([0x11, 0x92, 0x10, 0]);
      frame.writeUInt32BE(payload.length, 4);
      payload.copy(frame, 8);
      ws.emit('message', frame);
    }
    await draining;
    assert.equal(transcripts.at(-1).text, 'tail');
    assert.equal(transcripts.at(-1).isFinal, true);
    stt.write(Buffer.alloc(2));
    assert.equal(Socket.instances.length, 2);
    stt.stop(false);
    ws.emit('error', Error('late synthetic-secret'));
    stt.write(Buffer.alloc(2));
    assert.equal(Socket.instances.length, 2);
    assert.ok(errors.every(message => !message.includes('synthetic-secret')));
  });
}

test('S42-01 Aliyun workspace selects general or dedicated Beijing endpoint; invalid values open nothing', t => {
  const { AliyunStreamingSTT } = load('AliyunStreamingSTT');
  const opened = workspaceId => {
    const before = Socket.instances.length;
    const stt = new AliyunStreamingSTT('synthetic-secret', { workspaceId });
    t.after(() => stt.stop(false));
    const errors = [];
    stt.on('error', error => errors.push(error));
    stt.start();
    return Socket.instances.length > before ? Socket.instances.at(-1) : errors;
  };
  const general = opened('');
  assert.equal(general.url, 'wss://dashscope.aliyuncs.com/api-ws/v1/inference');
  assert.equal(general.options.headers.Authorization, 'Bearer synthetic-secret');
  general.open();
  assert.equal(JSON.parse(general.sent[0]).payload.model, 'qwen-audio-3.1-asr-flash-streaming', 'default model is unchanged');
  assert.equal(opened('ws_01-a').url, 'wss://ws_01-a.cn-beijing.maas.aliyuncs.com/api-ws/v1/inference');
  for (const workspaceId of ['evil.example', 'a/b', 'x@y', '-lead', 'a'.repeat(64), 'w\r\nX-Injected: 1', 'w#', undefined]) {
    const errors = opened(workspaceId);
    assert.ok(Array.isArray(errors) && errors.length === 1, String(workspaceId));
    assert.equal(errors[0].code, 'configuration');
  }
});

test('S42-01 Doubao sends the selected resource header, keeps App ID auth and never enables a second pass', t => {
  const { DoubaoStreamingSTT } = load('DoubaoStreamingSTT');
  const opened = options => {
    const before = Socket.instances.length;
    const stt = new DoubaoStreamingSTT('synthetic-secret', options);
    t.after(() => stt.stop(false));
    const errors = [];
    stt.on('error', error => errors.push(error));
    stt.start();
    return Socket.instances.length > before ? Socket.instances.at(-1) : errors;
  };
  const hourly = opened({ appId: '', resourceId: 'volc.seedasr.sauc.duration' });
  assert.equal(hourly.url, 'wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async');
  assert.equal(hourly.options.headers['X-Api-Resource-Id'], 'volc.seedasr.sauc.duration');
  assert.equal(hourly.options.headers['X-Api-Key'], 'synthetic-secret');
  assert.equal(hourly.options.headers['X-Api-App-Key'], undefined);
  hourly.open();
  const request = JSON.parse(gunzipSync(hourly.sent[0].subarray(12)).toString());
  assert.equal(request.request.model_name, 'bigmodel');
  assert.doesNotMatch(JSON.stringify(request), /nonstream/);
  const concurrent = opened({ appId: 'synthetic-app', resourceId: 'volc.seedasr.sauc.concurrent' });
  assert.equal(concurrent.options.headers['X-Api-Resource-Id'], 'volc.seedasr.sauc.concurrent');
  assert.equal(concurrent.options.headers['X-Api-App-Key'], 'synthetic-app');
  assert.equal(concurrent.options.headers['X-Api-Access-Key'], 'synthetic-secret');
  assert.equal(concurrent.options.headers['X-Api-Key'], undefined);
  for (const resourceId of [null, '', 'volc.bigasr.sauc.duration', 'volc.seedasr.sauc.Duration']) {
    const errors = opened({ resourceId });
    assert.ok(Array.isArray(errors) && errors.length === 1, String(resourceId));
    assert.equal(errors[0].code, 'configuration');
  }
});

test('PCM downmix is chunk-invariant at 48kHz stereo, including partial frames', () => {
  const { AliyunStreamingSTT } = load('AliyunStreamingSTT');
  const pcm = Buffer.alloc(48);
  for (let i = 0; i < 24; i++) pcm.writeInt16LE(i * 100, i * 2);
  const convert = chunks => {
    const stt = new AliyunStreamingSTT('synthetic', { workspaceId: 'workspace' });
    stt.setSampleRate(48000);
    stt.setAudioChannelCount(2);
    return Buffer.concat(chunks.map(chunk => stt.convert(chunk)));
  };
  const whole = convert([pcm]);
  assert.deepEqual(convert([pcm.subarray(0, 7), pcm.subarray(7, 21), pcm.subarray(21)]), whole);
  assert.equal(whole.length, 8);
  assert.equal(whole.readInt16LE(0), 50);
  assert.equal(whole.readInt16LE(6), 1850);
});

test('Doubao decoder rejects truncated and invalid compression frames', () => {
  const { decodeDoubaoResponse } = load('DoubaoStreamingSTT');
  assert.throws(() => decodeDoubaoResponse(Buffer.from([0x11, 0x91, 0x11, 0, 0, 0, 0, 1])), /Invalid/);
  assert.throws(() => decodeDoubaoResponse(Buffer.from([0x11, 0x92, 0x12, 0, 0, 0, 0, 0])), /Invalid/);
});

test('Doubao parameter and empty-audio errors are not authentication failures; empty finalize can resume', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { DoubaoStreamingSTT } = load('DoubaoStreamingSTT');
  for (const code of [45000001, 45000002]) {
    const stt = new DoubaoStreamingSTT('synthetic-secret');
    t.after(() => stt.stop(false));
    const errors = [];
    stt.on('error', error => errors.push(error));
    stt.start();
    const ws = Socket.instances.at(-1);
    ws.open();
    const drain = stt.finalize();
    const payload = Buffer.from(JSON.stringify({ message: 'synthetic-secret' }));
    const frame = Buffer.alloc(12 + payload.length);
    frame.set([0x11, 0xf0, 0x10, 0]);
    frame.writeUInt32BE(code, 4);
    frame.writeUInt32BE(payload.length, 8);
    payload.copy(frame, 12);
    ws.emit('message', frame);
    await assert.rejects(drain);
    assert.equal(errors[0].code, code === 45000001 ? 'configuration' : 'empty-audio');
    assert.doesNotMatch(errors[0].message, /auth|credential|synthetic-secret/i);
    const before = Socket.instances.length;
    t.mock.timers.tick(30000);
    assert.equal(Socket.instances.length, before, 'empty audio must not create a retry loop');
    stt.write(Buffer.alloc(320));
    assert.equal(Socket.instances.length, before + (code === 45000002 ? 1 : 0));
    if (code === 45000002) {
      const resumed = Socket.instances.at(-1);
      resumed.open();
      assert.equal(resumed.sent[1][1], 0x21, 'same provider sends audio again after empty finalize');
    }
  }
});

test('Doubao repeated multi-utterance results emit each final only once', t => {
  const { DoubaoStreamingSTT } = load('DoubaoStreamingSTT');
  const stt = new DoubaoStreamingSTT('synthetic-secret');
  t.after(() => stt.stop(false));
  const rows = [];
  stt.on('transcript', row => rows.push(row));
  stt.start();
  const ws = Socket.instances.at(-1);
  ws.open();
  const body = Buffer.from(JSON.stringify({ result: { utterances: [
    { text: 'first', start_time: 0, definite: true }, { text: 'second', start_time: 100, definite: true },
  ] } }));
  const frame = Buffer.alloc(8 + body.length);
  frame.set([0x11, 0x90, 0x10, 0]);
  frame.writeUInt32BE(body.length, 4);
  body.copy(frame, 8);
  ws.emit('message', frame);
  ws.emit('message', frame);
  assert.deepEqual(rows.map(row => row.text), ['first', 'second']);
});

test('MeetingSttSession drains a domestic provider final before disposing its listener', async t => {
  const { MeetingSttSession } = load('MeetingSttSession');
  const { AliyunStreamingSTT } = load('AliyunStreamingSTT');
  const provider = new AliyunStreamingSTT('synthetic', { workspaceId: 'workspace' });
  t.after(() => provider.stop(false));
  const rows = [];
  const session = new MeetingSttSession({ create: () => provider, onTranscript: row => rows.push(row) });
  session.begin('meeting');
  session.ensure('user');
  provider.start();
  const ws = Socket.instances.at(-1);
  ws.open();
  ws.emit('message', Buffer.from(JSON.stringify({ header: { event: 'task-started' } })));
  const drain = session.drain(1000, 0);
  ws.emit('message', Buffer.from(JSON.stringify({ header: { event: 'task-finished' },
    payload: { output: { sentence: { text: 'final tail', sentence_end: true, id: 1 } } } })));
  assert.equal((await drain).timedOut, false);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].final, true);
  assert.equal(session.get('user'), null);
  session.begin('interrupted-meeting');
  session.ensure('user');
  provider.start();
  const interrupted = session.drain(1000, 0);
  Socket.instances.at(-1).terminate();
  assert.deepEqual((await interrupted).failedChannels, ['user']);
});
