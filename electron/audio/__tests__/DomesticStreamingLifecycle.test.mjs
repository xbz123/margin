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

const doubaoFrame = (body, flags = 0x90) => {
  const payload = Buffer.from(JSON.stringify(body));
  const frame = Buffer.alloc(8 + payload.length);
  frame.set([0x11, flags, 0x10, 0]);
  frame.writeUInt32BE(payload.length, 4);
  payload.copy(frame, 8);
  return frame;
};

test('S42-03 Aliyun prefers sentence_id over id, ignores heartbeats, treats an empty sentence_begin as a start, and tags task epoch and media times', t => {
  Socket.instances = [];
  const { AliyunStreamingSTT } = load('AliyunStreamingSTT');
  const stt = new AliyunStreamingSTT('synthetic', { workspaceId: 'workspace' });
  t.after(() => stt.stop(false));
  const rows = [];
  stt.on('transcript', row => rows.push(row));
  stt.start();
  const ws = Socket.instances.at(-1);
  ws.open();
  const task = JSON.parse(ws.sent[0]).header.task_id;
  const result = sentence => ws.emit('message', Buffer.from(JSON.stringify({ header: { event: 'result-generated', task_id: task }, payload: { output: { sentence } } })));
  ws.emit('message', Buffer.from(JSON.stringify({ header: { event: 'task-started', task_id: task } })));
  result({ sentence_id: 3, id: 99, text: '', sentence_begin: true, begin_time: 120 });
  result({ sentence_id: 0, text: '', heartbeat: true });
  result({ sentence_id: 0, text: 'heartbeat payload' });
  result({ sentence_id: 3, id: 99, text: 'hello', begin_time: 120, end_time: 900, sentence_end: false });
  result({ id: 7, text: 'fallback id', sentence_end: true });
  assert.deepEqual(JSON.parse(JSON.stringify(rows)), [
    { text: '', started: true, segmentId: '3', epoch: task, scope: task, media: { basis: 'aliyun-task-audio', startMs: 120 } },
    { text: 'hello', isFinal: false, segmentId: '3', epoch: task, scope: task, media: { basis: 'aliyun-task-audio', startMs: 120, endMs: 900 }, identityReliable: true },
    { text: 'fallback id', isFinal: true, segmentId: '7', epoch: task, scope: task, media: { basis: 'aliyun-task-audio' }, identityReliable: true },
  ]);
});

test('S42-03 Doubao tags each request as an epoch, so a reconnect cannot collide with an earlier utterance', t => {
  Socket.instances = [];
  const { DoubaoStreamingSTT } = load('DoubaoStreamingSTT');
  const stt = new DoubaoStreamingSTT('synthetic');
  t.after(() => stt.stop(false));
  const rows = [];
  stt.on('transcript', row => rows.push(row));
  for (let connection = 0; connection < 2; connection++) {
    stt.start();
    const ws = Socket.instances.at(-1);
    ws.open();
    ws.emit('message', doubaoFrame({ result: { utterances: [{ text: 'same start', start_time: 0, end_time: 500, definite: false }] } }));
    assert.equal(rows.at(-1).epoch, ws.options.headers['X-Api-Request-Id']);
    stt.stop(false);
  }
  assert.deepEqual(JSON.parse(JSON.stringify(rows.map(row => [row.segmentId, row.media]))), [
    ['0', { basis: 'doubao-request-audio', startMs: 0, endMs: 500 }], ['0', { basis: 'doubao-request-audio', startMs: 0, endMs: 500 }]]);
  assert.notEqual(rows[0].epoch, rows[1].epoch);
});


// Recorded Doubao shape: the first response of a request carries a start time later ones do not; the
// next sentence is appended to the open one until its predecessor's definite result arrives in the
// same response as the newcomer's first interim.
test('S42-03 Doubao keys sentences by their order in the request, not by start_time', t => {
  Socket.instances = [];
  const { DoubaoStreamingSTT } = load('DoubaoStreamingSTT');
  const stt = new DoubaoStreamingSTT('synthetic');
  t.after(() => stt.stop(false));
  const rows = [];
  stt.on('transcript', row => rows.push(row));
  stt.start();
  const ws = Socket.instances.at(-1);
  ws.open();
  const respond = (utterances, flags) => ws.emit('message', doubaoFrame({ result: { utterances } }, flags));
  const first = '请问你在上一家公司主要负责哪些工作内容？';
  respond([{ text: '请', start_time: 1300, end_time: 1500, definite: false }]);
  respond([{ text: '请问你', start_time: 1600, end_time: 1900, definite: false }]);
  respond([{ text: first + '那 TCP 的三次握手过程', start_time: 1600, end_time: 25200, definite: false }]);
  respond([{ text: first, start_time: 1600, end_time: 6900, definite: true },
    { text: '那 TCP 的三次握手过程是怎样', start_time: 26600, end_time: 27900, definite: false }]);
  respond([{ text: first, start_time: 1600, end_time: 6900, definite: true },
    { text: '那 TCP 的3次握手过程是怎样的', start_time: 26600, end_time: 28100, definite: false }]);
  ws.emit('message', doubaoFrame({ result: { text: '那 TCP 的三次握手过程是怎样的？' } }, 0x92));
  assert.deepEqual(rows.map(row => [row.segmentId, row.text, row.isFinal]), [
    ['0', '请', false], ['0', '请问你', false], ['0', first + '那 TCP 的三次握手过程', false],
    ['0', first, true], ['1', '那 TCP 的三次握手过程是怎样', false],
    ['1', '那 TCP 的3次握手过程是怎样的', false], ['1', '那 TCP 的三次握手过程是怎样的？', true]]);
  const request = ws.options.headers['X-Api-Request-Id'];
  assert.ok(rows.every(row => row.epoch === request && row.scope === request && row.identityReliable === true));
  assert.deepEqual(JSON.parse(JSON.stringify(rows[3].media)), { basis: 'doubao-request-audio', startMs: 1600, endMs: 6900 });
});

const domestic = {
  open(name, ws) {
    ws.open();
    if (name === 'Aliyun') ws.emit('message', Buffer.from(JSON.stringify({ header: { event: 'task-started', task_id: this.scope(name, ws) } })));
  },
  scope: (name, ws) => name === 'Aliyun' ? JSON.parse(ws.sent[0]).header.task_id : ws.options.headers['X-Api-Request-Id'],
  finishes: (name, ws) => ws.sent.filter(data => name === 'Aliyun' ? /finish-task/.test(String(data)) : Buffer.isBuffer(data) && data.readInt32BE(4) < 0).length,
  audio: (name, ws) => ws.sent.filter(data => Buffer.isBuffer(data) && (name === 'Aliyun' || data[1] === 0x21)).length,
  result(name, ws, text, last) {
    if (name === 'Aliyun') {
      ws.emit('message', Buffer.from(JSON.stringify({ header: { event: last ? 'task-finished' : 'result-generated', task_id: this.scope(name, ws) },
        payload: { output: { sentence: { sentence_id: 1, text, sentence_end: !!last } } } })));
    } else ws.emit('message', doubaoFrame({ result: { utterances: [{ text, start_time: 0, end_time: 900, definite: !!last }] } }, last ? 0x92 : 0x90));
  },
};

for (const name of ['Aliyun', 'Doubao']) test(`S42-03 ${name}: seal ends the request with its finish frame, scopes its results and continues on a new request`, async t => {
  Socket.instances = [];
  const { [name + 'StreamingSTT']: Provider } = load(name + 'StreamingSTT');
  const stt = new Provider('synthetic', { workspaceId: 'workspace' });
  t.after(() => stt.stop(false));
  const rows = [], errors = [];
  stt.on('transcript', row => rows.push(row));
  stt.on('error', error => errors.push(error));
  stt.start();
  const ws = Socket.instances.at(-1);
  assert.equal(stt.seal(0), undefined, 'a connection not yet ready is not sealed');
  domestic.open(name, ws);
  assert.equal(stt.seal(0), undefined, 'a request without audio is not finished: that is an empty-audio error');
  assert.equal(domestic.finishes(name, ws), 0);
  stt.write(Buffer.alloc(320));
  domestic.result(name, ws, 'hello');
  const scope = domestic.scope(name, ws);
  assert.equal(rows.at(-1).scope, scope);
  const seal = stt.seal(Date.now());
  assert.deepEqual([...seal.scopes], [scope]);
  assert.equal(seal.pending, true);
  assert.equal(domestic.finishes(name, ws), 1);
  const again = stt.seal(Date.now());
  assert.deepEqual([...again.scopes], [scope]);
  assert.equal(again.done, seal.done, 'nothing queued since: the ending request is all there is to seal');
  assert.equal(domestic.finishes(name, ws), 1, 'one finish frame per request');
  const sent = domestic.audio(name, ws);
  stt.write(Buffer.alloc(320));
  assert.equal(domestic.audio(name, ws), sent, 'audio after the seal waits for the next request');
  domestic.result(name, ws, 'hello world', true);
  assert.deepEqual([rows.at(-1).text, rows.at(-1).isFinal, rows.at(-1).scope], ['hello world', true, scope]);
  assert.equal(await seal.done, 'complete');
  assert.equal(Socket.instances.length, 2, 'the queued audio opens a new request at once');
  const next = Socket.instances.at(-1);
  domestic.open(name, next);
  assert.equal(domestic.audio(name, next), 1, 'the queued audio is sent on the new request');
  assert.notEqual(domestic.scope(name, next), scope);
  domestic.result(name, next, 'next turn');
  assert.equal(rows.at(-1).scope, domestic.scope(name, next));
  assert.deepEqual(errors, [], 'sealing raises no provider error');
});

test('S42-03 Doubao seal: no last result in time gives up the request quietly; empty audio is no error', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  Socket.instances = [];
  const { DoubaoStreamingSTT } = load('DoubaoStreamingSTT');
  const stt = new DoubaoStreamingSTT('synthetic');
  t.after(() => stt.stop(false));
  const errors = [], warnings = [];
  stt.on('error', error => errors.push(error));
  stt.on('warning', warning => warnings.push(warning));
  stt.start();
  domestic.open('Doubao', Socket.instances.at(-1));
  stt.write(Buffer.alloc(320));
  const seal = stt.seal(0);
  stt.write(Buffer.alloc(320));
  t.mock.timers.tick(2999);
  assert.equal(Socket.instances.length, 1);
  t.mock.timers.tick(1);
  assert.equal(await seal.done, 'failed');
  assert.equal(warnings.at(-1).code, 'seal-timeout');
  assert.equal(Socket.instances.length, 2, 'queued audio continues on a new request');
  const next = Socket.instances.at(-1);
  domestic.open('Doubao', next);
  assert.equal(domestic.audio('Doubao', next), 1);
  const quiet = stt.seal(0);
  const payload = Buffer.from(JSON.stringify({ message: 'empty' }));
  const frame = Buffer.alloc(12 + payload.length);
  frame.set([0x11, 0xf0, 0x10, 0]);
  frame.writeUInt32BE(45000002, 4);
  frame.writeUInt32BE(payload.length, 8);
  payload.copy(frame, 12);
  next.emit('message', frame);
  assert.equal(await quiet.done, 'complete');
  assert.deepEqual(errors, [], 'neither the timeout nor the empty request is reported as an error');
});

for (const name of ['Aliyun', 'Doubao']) test(`S42-03 ${name}: a manual action seals the request; the meeting drain still finishes the next one`, async t => {
  Socket.instances = [];
  const { MeetingSttSession } = load('MeetingSttSession');
  const { [name + 'StreamingSTT']: Provider } = load(name + 'StreamingSTT');
  const provider = new Provider('synthetic', { workspaceId: 'workspace' });
  t.after(() => provider.stop(false));
  const session = new MeetingSttSession({ create: () => provider, onTranscript() {} });
  session.begin('meeting');
  session.ensure('user');
  provider.start();
  const ws = Socket.instances.at(-1);
  domestic.open(name, ws);
  provider.write(Buffer.alloc(320));
  domestic.result(name, ws, 'what is');
  const collector = session.collect({ cutoffAt: Date.now(), deadline: Date.now() + 10_000, signal: new AbortController().signal });
  assert.equal(domestic.finishes(name, ws), 1);
  domestic.result(name, ws, 'what is a heap', true);
  const frozen = await collector.frozen;
  assert.equal(frozen.channels.user.reason, 'complete', 'the last result of the sealed request ends the wait');
  assert.deepEqual(frozen.channels.user.segments.map(segment => segment.text), ['what is a heap']);
  provider.write(Buffer.alloc(320));
  const next = Socket.instances.at(-1);
  assert.notEqual(next, ws);
  domestic.open(name, next);
  const drain = session.drain(1000, 0);
  assert.equal(domestic.finishes(name, next), 1);
  domestic.result(name, next, 'tail', true);
  assert.equal((await drain).timedOut, false);
});

// Doubao adapter: the result shapes of a request's last package.
const respondTo = ws => (utterances, last = false) => ws.emit('message', doubaoFrame({ result: { utterances } }, last ? 0x92 : 0x90));
const said = (text, definite = false, start = 0, end = 0) => ({ text, definite, start_time: start, end_time: end });
function doubaoRows(t) {
  Socket.instances = [];
  const { DoubaoStreamingSTT } = load('DoubaoStreamingSTT');
  const stt = new DoubaoStreamingSTT('synthetic');
  t.after(() => stt.stop(false));
  const rows = [];
  stt.on('transcript', row => rows.push([row.segmentId, row.text, row.isFinal]));
  stt.start();
  const ws = Socket.instances.at(-1);
  ws.open();
  return { stt, rows, ws, respond: respondTo(ws), text: (text, last = true) => ws.emit('message', doubaoFrame({ result: { text } }, last ? 0x92 : 0x90)) };
}

test('S42-03 Doubao: a last package with only result.text never lands an older sentence on the open one', t => {
  // Repeats a definite already emitted: skipped, the open sentence keeps the new words.
  let { rows, respond, text } = doubaoRows(t);
  respond([said('旧句。', true, 100, 900)]);
  respond([said('新话', false, 2000)]);
  text('旧句');
  assert.deepEqual(rows, [['0', '旧句。', true], ['1', '新话', false]]);
  // The whole request text of a request already split: without the definites emitted, the rest is the
  // open sentence's final (S8); a rest that is not the open sentence is dropped.
  ({ rows, respond, text } = doubaoRows(t));
  respond([said('旧句。', true, 100, 900)]);
  respond([said('新话', false, 2000)]);
  text('旧句。新话完整。');
  assert.deepEqual(rows, [['0', '旧句。', true], ['1', '新话', false], ['1', '新话完整。', true]]);
  ({ rows, respond, text } = doubaoRows(t));
  respond([said('旧句。', true, 100, 900)]);
  respond([said('新话', false, 2000)]);
  text('旧句。别的话。');
  assert.deepEqual(rows, [['0', '旧句。', true], ['1', '新话', false]]);
  // Its own extension (a numeral rewritten) closes the open sentence; with none open it starts one.
  ({ rows, respond, text } = doubaoRows(t));
  respond([said('那 TCP 的3次握手', false, 100)]);
  text('那 TCP 的三次握手过程？');
  assert.deepEqual(rows, [['0', '那 TCP 的3次握手', false], ['0', '那 TCP 的三次握手过程？', true]]);
  ({ rows, text } = doubaoRows(t));
  text('还有一个问题。');
  assert.deepEqual(rows, [['0', '还有一个问题。', true]]);
});

test('S42-03 Doubao: a re-sent definite is one sentence though its end_time moved; a changed text corrects it; an earlier one keeps its own identity', t => {
  const { rows, respond } = doubaoRows(t);
  respond([said('那缓存怎么设计？', true, 100, 3000), said('还有', false, 4000)]);
  respond([said('那缓存怎么设计？', true, 100, 3040), said('还有呢？', true, 4000, 5000)]);
  respond([said('那缓存怎么设计呀？', true, 100, 3040)]);
  respond([said('第三句', false, 9000)]);
  respond([said('迟到的一句。', true, 6000, 8000), said('第三句', false, 9000)]);
  respond([said('第三句。', true, 9000, 9800)]);
  assert.deepEqual(rows, [['0', '那缓存怎么设计？', true], ['1', '还有', false], ['1', '还有呢？', true],
    ['0', '那缓存怎么设计呀？', true], ['2', '第三句', false], ['at6000', '迟到的一句。', true], ['2', '第三句', false], ['2', '第三句。', true]]);
});

test('S42-03 Domestic seal while the previous seal is ending seals the queued audio on the next request', async t => {
  Socket.instances = [];
  const { DoubaoStreamingSTT } = load('DoubaoStreamingSTT');
  const stt = new DoubaoStreamingSTT('synthetic');
  t.after(() => stt.stop(false));
  const errors = [];
  stt.on('error', error => errors.push(error));
  stt.start();
  const first = Socket.instances.at(-1);
  assert.equal(stt.seal(0), undefined, 'connecting, nothing queued: nothing to seal');
  first.open();
  stt.write(Buffer.alloc(320));
  const previous = stt.seal(0); // the previous action's Stop
  assert.deepEqual([...previous.scopes], [domestic.scope('Doubao', first)]);
  stt.write(Buffer.alloc(320));
  stt.write(Buffer.alloc(320));
  const stop = stt.seal(0);
  assert.equal(stop.scopes.length, 2);
  assert.equal(stop.scopes[0], domestic.scope('Doubao', first));
  stt.write(Buffer.alloc(320)); // after Stop: not part of this seal
  let outcome;
  stop.done.then(value => { outcome = value; });
  respondTo(first)([said('上一轮的回答。', true, 0, 900)], true);
  assert.equal(await previous.done, 'complete');
  const next = Socket.instances.at(-1);
  assert.equal(next.options.headers['X-Api-Request-Id'], stop.scopes[1], 'the queued audio goes to the request named by the seal');
  next.open();
  assert.equal(domestic.audio('Doubao', next), 2, 'only the audio queued by Stop');
  assert.equal(domestic.finishes('Doubao', next), 1, 'then the request is finished at once');
  await Promise.resolve();
  assert.equal(outcome, undefined, 'done follows the later request');
  respondTo(next)([said('红黑树和AVL树的区别？', true, 0, 600)], true);
  assert.equal(await stop.done, 'complete');
  const after = Socket.instances.at(-1);
  assert.notEqual(after, next);
  after.open();
  assert.equal(domestic.audio('Doubao', after), 1, 'audio after Stop continues on a third request');
  assert.deepEqual(errors, []);
});

// Doubao on the microphone channel of a real session, the interviewer channel settled.
function doubaoMeeting(t) {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000_000 });
  Socket.instances = [];
  const { MeetingSttSession } = load('MeetingSttSession');
  const { DoubaoStreamingSTT } = load('DoubaoStreamingSTT');
  const interviewer = Object.assign(new EventEmitter(), { write() {}, stop() {}, seal: () => ({ scopes: [], pending: false, done: Promise.resolve('no-pending') }) });
  const rows = [];
  const session = new MeetingSttSession({ create: channel => channel === 'user' ? new DoubaoStreamingSTT('synthetic') : interviewer,
    onTranscript: row => rows.push(row) });
  session.begin('meeting');
  const user = session.ensure('user');
  session.ensure('interviewer');
  const errors = [];
  user.on('error', error => errors.push(error));
  user.start();
  t.after(() => user.stop(false));
  const drainMicrotasks = async (rounds = 20) => { while (rounds-- > 0) await Promise.resolve(); };
  const advance = async ms => { await drainMicrotasks(); t.mock.timers.tick(ms); await drainMicrotasks(); };
  const stop = mark => {
    const cut = Date.now();
    return session.collect({ cutoffAt: cut, deadline: cut + 10_000, signal: new AbortController().signal, dictation: mark });
  };
  const open = () => { const ws = Socket.instances.at(-1); ws.open(); return { ws, respond: respondTo(ws) }; };
  return { session, user, rows, errors, advance, stop, open, audio: () => user.write(Buffer.alloc(3200)) };
}
const texts = frozen => frozen.channels.user.segments.map(segment => segment.text);
const emptyAudio = () => {
  const payload = Buffer.from(JSON.stringify({ message: 'empty' }));
  const frame = Buffer.alloc(12 + payload.length);
  frame.set([0x11, 0xf0, 0x10, 0]);
  frame.writeUInt32BE(45000002, 4);
  frame.writeUInt32BE(payload.length, 8);
  payload.copy(frame, 12);
  return frame;
};

test('S42-03 Doubao multi-round dictation: each Stop ends its request, so the next question holds only its own words', async t => {
  const { session, advance, stop, open, audio, errors } = doubaoMeeting(t);
  const one = open();
  let mark = session.markDictation(Date.now());
  assert.equal(domestic.finishes('Doubao', one.ws), 0, 'Answer does not touch the provider');
  audio();
  one.respond([said('主要负责后端服务', false, 300)]);
  await advance(600);
  one.respond([said('主要负责后端服务的性能优化', false, 300)]);
  await advance(600);
  let collector = stop(mark);
  assert.equal(domestic.finishes('Doubao', one.ws), 1, 'Stop ends the request');
  audio(); // after Stop: waits for the next request
  await advance(300);
  one.respond([said('主要负责后端服务的性能优化。', true, 300, 2600)], true);
  await advance(0);
  let frozen = await collector.frozen;
  assert.equal(frozen.dictation, '主要负责后端服务的性能优化。');
  assert.equal(frozen.channels.user.reason, 'complete');
  const two = open();
  assert.notEqual(two.ws, one.ws);
  assert.equal(domestic.audio('Doubao', two.ws), 1, 'speech after Stop is on the new request');
  await advance(20_000);
  mark = session.markDictation(Date.now());
  audio();
  two.respond([said('另外我还带领了一个5人的', false, 200)]);
  await advance(800);
  two.respond([said('另外我还带领了一个5人的小团队', false, 200)]);
  collector = stop(mark);
  assert.equal(domestic.finishes('Doubao', two.ws), 1);
  await advance(300);
  two.respond([said('另外我还带领了一个5人的小团队。', true, 200, 2400)], true);
  await advance(0);
  frozen = await collector.frozen;
  assert.equal(frozen.dictation, '另外我还带领了一个5人的小团队。');
  assert.equal(frozen.dictationKeys.length, 1);
  assert.deepEqual(texts(frozen), ['主要负责后端服务的性能优化。', '另外我还带领了一个5人的小团队。'], 'the first question stays in the background');
  assert.equal(frozen.channels.user.reason, 'complete');
  assert.deepEqual(errors, []);
});

test('S42-03 Doubao: the sentence being said when Answer is pressed joins the question whole', async t => {
  const { session, advance, stop, open, audio, errors } = doubaoMeeting(t);
  const one = open();
  audio();
  one.respond([said('上一轮的回答。', true, 0, 900)]);
  await advance(20_000);
  one.respond([said('红黑树和', false, 21_000)]);
  await advance(400);
  const mark = session.markDictation(Date.now());
  assert.equal(domestic.finishes('Doubao', one.ws), 0, 'the request goes on: nothing is cut at Answer');
  audio();
  await advance(300);
  one.respond([said('红黑树和AVL树的区别', false, 21_000)]);
  await advance(800);
  const collector = stop(mark);
  await advance(300);
  one.respond([said('上一轮的回答。', true, 0, 900), said('红黑树和AVL树的区别？', true, 21_000, 23_000)], true);
  await advance(0);
  const frozen = await collector.frozen;
  assert.equal(frozen.dictation, '红黑树和AVL树的区别？');
  assert.equal(frozen.dictationKeys.length, 1);
  assert.deepEqual(texts(frozen), ['上一轮的回答。', '红黑树和AVL树的区别？']);
  assert.deepEqual(errors, []);
});

test('S42-03 Doubao: sentences the Stop request splits off only in its last package stay in that question, not the next (T3)', async t => {
  const { session, advance, stop, open, audio, errors } = doubaoMeeting(t);
  const one = open();
  let mark = session.markDictation(Date.now());
  audio();
  one.respond([said('我会先看监控', false, 100)]);
  await advance(3000);
  one.respond([said('我会先看监控。然后再查日志', false, 100)]);
  await advance(500);
  let collector = stop(mark);
  audio();
  await advance(500);
  // The split lags a sentence: the second sentence gets a key of its own only in the last package.
  one.respond([said('我会先看监控。', true, 100, 2000), said('然后再查日志', false, 3000)]);
  one.respond([said('我会先看监控。', true, 100, 2000), said('然后再查日志。', true, 3000, 5000)], true);
  await advance(0);
  let frozen = await collector.frozen;
  assert.equal(frozen.dictation, '我会先看监控。 然后再查日志。', 'a key first seen after Stop is kept by the seal scope');
  const two = open();
  await advance(1000);
  mark = session.markDictation(Date.now());
  audio();
  two.respond([said('那缓存怎么设计', false, 100)]);
  await advance(1000);
  collector = stop(mark);
  await advance(200);
  two.respond([said('那缓存怎么设计？', true, 100, 1500)], true);
  await advance(0);
  frozen = await collector.frozen;
  assert.equal(frozen.dictation, '那缓存怎么设计？');
  assert.deepEqual(texts(frozen), ['我会先看监控。', '然后再查日志。', '那缓存怎么设计？']);
  assert.deepEqual(errors, []);
});

test('S42-03 Doubao: Answer then silence is an empty question; the previous round, ended at its Stop, stays out (T5)', async t => {
  const { session, advance, stop, open, audio, errors } = doubaoMeeting(t);
  const one = open();
  let mark = session.markDictation(Date.now());
  audio();
  one.respond([said('我认为分布式锁', false, 100)]);
  await advance(800);
  let collector = stop(mark);
  audio();
  await advance(300);
  one.respond([said('我认为分布式锁。', true, 100, 900)], true);
  await advance(0);
  assert.equal((await collector.frozen).dictation, '我认为分布式锁。');
  const two = open();
  await advance(1500);
  mark = session.markDictation(Date.now());
  audio(); // silence keeps streaming
  await advance(3000);
  collector = stop(mark);
  two.ws.emit('message', emptyAudio()); // the new request had nothing to recognise
  await advance(0);
  const frozen = await collector.frozen;
  assert.equal(frozen.dictation, '');
  assert.deepEqual(frozen.dictationKeys, []);
  assert.deepEqual(texts(frozen), ['我认为分布式锁。']);
  assert.equal(frozen.channels.user.reason, 'complete');
  assert.deepEqual(errors, []);
});

test('S42-03 Doubao: Answer under a second after Stop leaves the previous question out of this one', async t => {
  const { session, advance, stop, open, audio, errors } = doubaoMeeting(t);
  const one = open();
  const first = session.markDictation(Date.now());
  audio();
  one.respond([said('第一个问题是什么', false, 0)]);
  await advance(800);
  const previous = stop(first);
  assert.equal(domestic.finishes('Doubao', one.ws), 1, 'Stop ends the request of the first question');
  audio();
  await advance(400);
  const mark = session.markDictation(Date.now());
  assert.equal(Socket.instances.length, 1, 'the first request is still ending');
  audio();
  await advance(300);
  // The last package of the first question arrives only after the second Answer.
  one.respond([said('第一个问题是什么？', true, 0, 900)], true);
  const two = open();
  assert.equal(domestic.audio('Doubao', two.ws), 2, 'the audio after Stop went to the next request');
  two.respond([said('第二个问题', false, 0)]);
  await advance(1500);
  const collector = stop(mark);
  await advance(200);
  two.respond([said('第二个问题？', true, 0, 1200)], true);
  await advance(0);
  assert.equal((await previous.frozen).dictation, '第一个问题是什么？');
  const frozen = await collector.frozen;
  assert.equal(frozen.dictation, '第二个问题？');
  assert.deepEqual(texts(frozen), ['第一个问题是什么？', '第二个问题？'], 'the first question stays in the background');
  assert.deepEqual(errors, []);
});

test('S42-03 Doubao: Stop again before the previous request ended keeps the question (seal chain)', async t => {
  const { session, advance, stop, open, audio, errors } = doubaoMeeting(t);
  const one = open();
  const first = session.markDictation(Date.now());
  audio();
  one.respond([said('上一轮的回答', false, 100)]);
  await advance(1000);
  const previous = stop(first);
  await advance(300);
  const mark = session.markDictation(Date.now());
  audio();
  audio();
  await advance(800);
  const collector = stop(mark);
  audio(); // after Stop
  assert.equal(domestic.finishes('Doubao', one.ws), 1, 'the old request is still ending');
  await advance(1000);
  one.respond([said('上一轮的回答。', true, 100, 1500)], true);
  const two = open();
  assert.equal(domestic.audio('Doubao', two.ws), 2, 'the audio between Answer and Stop');
  assert.equal(domestic.finishes('Doubao', two.ws), 1);
  two.respond([said('红黑树和AVL树的区别', false, 0)]);
  await advance(300);
  two.respond([said('红黑树和AVL树的区别？', true, 0, 1600)], true);
  await advance(0);
  assert.equal((await previous.frozen).dictation, '上一轮的回答。');
  const frozen = await collector.frozen;
  assert.equal(frozen.dictation, '红黑树和AVL树的区别？');
  assert.equal(frozen.channels.user.reason, 'complete');
  assert.deepEqual(texts(frozen), ['上一轮的回答。', '红黑树和AVL树的区别？']);
  assert.notEqual(Socket.instances.at(-1), two.ws, 'audio after Stop goes on to a further request');
  assert.deepEqual(errors, []);
});

test('S42-03 Doubao: Answer soon after What to Answer leaves the words before it out', async t => {
  const { session, advance, stop, open, audio, errors } = doubaoMeeting(t);
  const one = open();
  audio();
  one.respond([said('上一轮我自己说的话', false, 0)]);
  await advance(1500);
  const whatToAnswer = stop(undefined);
  assert.equal(domestic.finishes('Doubao', one.ws), 1);
  await advance(500);
  const mark = session.markDictation(Date.now());
  audio();
  await advance(700);
  one.respond([said('上一轮我自己说的话。', true, 0, 1400)], true);
  const two = open();
  two.respond([said('红黑树和AVL树的区别', false, 0)]);
  await advance(1500);
  const collector = stop(mark);
  await advance(200);
  two.respond([said('红黑树和AVL树的区别？', true, 0, 1600)], true);
  await advance(0);
  assert.equal((await whatToAnswer.frozen).dictation, undefined);
  const frozen = await collector.frozen;
  assert.equal(frozen.dictation, '红黑树和AVL树的区别？');
  assert.deepEqual(texts(frozen), ['上一轮我自己说的话。', '红黑树和AVL树的区别？']);
  assert.deepEqual(errors, []);
});

test('S42-03 Doubao: the meeting drain does not wait out a seal; the tail behind it drains within the budget', async t => {
  const { session, advance, stop, open, audio, rows } = doubaoMeeting(t);
  const one = open();
  audio();
  one.respond([said('最后一个问题', false, 0)]);
  await advance(1000);
  stop(undefined); // a manual action seals the request
  audio(); // the tail, queued behind the sealed request
  const started = Date.now();
  let result;
  session.drain(5000, 0).then(value => { result = value; });
  await advance(999);
  assert.equal(Socket.instances.length, 1, 'the sealed request still has a moment to answer');
  await advance(1);
  const two = open();
  assert.notEqual(two.ws, one.ws, 'given up: the tail starts on a new request');
  assert.equal(domestic.audio('Doubao', two.ws), 1);
  assert.equal(domestic.finishes('Doubao', two.ws), 1, 'and the drain finishes it');
  await advance(500);
  two.respond([said('尾音', true, 0, 300)], true);
  await advance(0);
  assert.deepEqual(JSON.parse(JSON.stringify(result)), { timedOut: false, failedChannels: [] });
  assert.ok(Date.now() - started < 5000);
  assert.equal(rows.at(-1).text, '尾音');
});

test('S42-03 Doubao: a seal that answers while the drain waits hands the tail over at once', async t => {
  const { session, advance, stop, open, audio, rows } = doubaoMeeting(t);
  const one = open();
  audio();
  one.respond([said('最后一个问题', false, 0)]);
  await advance(1000);
  stop(undefined);
  audio();
  const started = Date.now();
  let result;
  session.drain(5000, 0).then(value => { result = value; });
  await advance(400);
  one.respond([said('最后一个问题。', true, 0, 900)], true);
  await advance(0);
  const two = open();
  assert.equal(Date.now() - started, 400, 'no wait beyond the last result');
  assert.equal(domestic.audio('Doubao', two.ws), 1);
  assert.equal(domestic.finishes('Doubao', two.ws), 1);
  await advance(600);
  two.respond([said('尾音', true, 0, 300)], true);
  await advance(0);
  assert.deepEqual(JSON.parse(JSON.stringify(result)), { timedOut: false, failedChannels: [] });
  assert.ok(Date.now() - started < 5000);
  assert.ok(rows.some(row => row.final && row.text === '最后一个问题。'), 'the sealed request\'s last result is not lost');
  assert.equal(rows.at(-1).text, '尾音');
});

test('S42-03 Doubao: a definite whose start_time differs from its interims or moved on a resend is not a second copy', t => {
  // Its definite reports a start 100 ms before the interims of the open sentence: that sentence, closed.
  let { rows, respond } = doubaoRows(t);
  respond([said('旧句。', true, 100, 2000), said('新话', false, 26_600)]);
  respond([said('旧句。', true, 100, 2000), said('新话完整', false, 26_600)]);
  respond([said('旧句。', true, 100, 2000), said('新话完整。', true, 26_500, 28_000)], true);
  assert.deepEqual(rows, [['0', '旧句。', true], ['1', '新话', false], ['1', '新话完整', false], ['1', '新话完整。', true]]);
  // A definite already emitted is re-sent with a start_time 20 ms later: a repeat, skipped.
  ({ rows, respond } = doubaoRows(t));
  respond([said('旧句。', true, 1600, 2000), said('新话', false, 26_600)]);
  respond([said('旧句。', true, 1620, 2040), said('新话。', true, 26_600, 28_000)], true);
  assert.deepEqual(rows, [['0', '旧句。', true], ['1', '新话', false], ['1', '新话。', true]]);
  // Moved by more than a second, well before the open sentence: its text repeats a final, so still no new identity.
  ({ rows, respond } = doubaoRows(t));
  respond([said('旧句。', true, 1600, 2000), said('新话', false, 26_600)]);
  respond([said('旧句', true, 3000, 3400), said('新话', false, 26_600)]);
  assert.deepEqual(rows, [['0', '旧句。', true], ['1', '新话', false], ['1', '新话', false]]);
});

test('S42-03 Doubao: a definite starting over a second before its interims but with the open sentence\'s text closes that sentence in order', t => {
  // The same sentence (X10): one identity, not a second copy under 'at' + start.
  let { rows, respond } = doubaoRows(t);
  respond([said('那缓存怎么设计', false, 4400)]);
  respond([said('那缓存怎么设计。', true, 3300, 5300)], true);
  assert.deepEqual(rows, [['0', '那缓存怎么设计', false], ['0', '那缓存怎么设计。', true]]);
  // The open sentence had the next one appended (S10): the split-off first sentence stays first.
  ({ rows, respond } = doubaoRows(t));
  respond([said('那缓存怎么设计。还有数', false, 4800)]);
  respond([said('那缓存怎么设计。', true, 3300, 5300), said('还有数据库', false, 7300)]);
  respond([said('那缓存怎么设计。', true, 3300, 5300), said('还有数据库怎么分库分表。', true, 5800, 8800)], true);
  assert.deepEqual(rows, [['0', '那缓存怎么设计。还有数', false], ['0', '那缓存怎么设计。', true],
    ['1', '还有数据库', false], ['1', '还有数据库怎么分库分表。', true]]);
});

test('S42-03 Domestic seal of audio queued on a connection whose handshake fails stays with that seal on the retry', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  Socket.instances = [];
  const { DoubaoStreamingSTT } = load('DoubaoStreamingSTT');
  const stt = new DoubaoStreamingSTT('synthetic');
  t.after(() => stt.stop(false));
  const failures = [];
  stt.on('error', error => failures.push(error.code));
  stt.start();
  const first = Socket.instances.at(-1);
  stt.write(Buffer.alloc(320));
  const seal = stt.seal(0); // Stop while the connection is still opening
  assert.deepEqual([...seal.scopes], [domestic.scope('Doubao', first)]);
  first.terminate(); // the handshake fails
  assert.deepEqual(failures, ['connection']);
  t.mock.timers.tick(1001); // the first retry back-off
  const retry = Socket.instances.at(-1);
  assert.notEqual(retry, first);
  assert.equal(domestic.scope('Doubao', retry), seal.scopes[0], 'the retry carries the sealed request id');
  stt.write(Buffer.alloc(320)); // after Stop
  retry.open();
  assert.equal(domestic.audio('Doubao', retry), 1, 'only the audio queued at Stop');
  assert.equal(domestic.finishes('Doubao', retry), 1);
  respondTo(retry)([said('题是什么。', true, 0, 900)], true);
  assert.equal(await seal.done, 'complete');
  assert.notEqual(domestic.scope('Doubao', Socket.instances.at(-1)), seal.scopes[0], 'audio after Stop is on a new request');
});

test('S42-03 Domestic seals only the microphone: the interviewer request keeps revising the question being asked', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000_000 });
  const { MeetingSttSession } = load('MeetingSttSession');
  const { DoubaoStreamingSTT } = load('DoubaoStreamingSTT');
  Socket.instances = [];
  const user = new DoubaoStreamingSTT('synthetic');
  const interviewer = new DoubaoStreamingSTT('synthetic');
  t.after(() => { user.stop(false); interviewer.stop(false); });
  const session = new MeetingSttSession({ create: channel => channel === 'user' ? user : interviewer, onTranscript() {} });
  session.begin('meeting');
  session.ensure('user');
  session.ensure('interviewer');
  user.start();
  const mic = Socket.instances.at(-1);
  interviewer.start();
  const system = Socket.instances.at(-1);
  mic.open();
  system.open();
  user.write(Buffer.alloc(320));
  interviewer.write(Buffer.alloc(320));
  respondTo(system)([said('请你介绍一下你的', false, 0)]);
  const collector = session.collect({ cutoffAt: Date.now(), deadline: Date.now() + 10_000, signal: new AbortController().signal });
  assert.equal(domestic.finishes('Doubao', mic), 1, 'the microphone request is sealed');
  assert.equal(domestic.finishes('Doubao', system), 0, 'the interviewer request goes on');
  t.mock.timers.tick(800); // the question goes on after the action
  respondTo(system)([said('请你介绍一下你的项目经历', false, 0)]);
  respondTo(mic)([], true);
  for (let i = 0; i < 20; i++) await Promise.resolve();
  t.mock.timers.tick(4000); // the interviewer lane ends in its tail window, as before seals
  const frozen = await collector.frozen;
  assert.deepEqual(frozen.channels.interviewer.segments.map(segment => segment.text), ['请你介绍一下你的项目经历']);
});

for (const tail of ['answers', 'never answers']) test(`S42-03 Doubao: the meeting drain behind a seal that never ends stays within its 5 s budget; the tail ${tail}`, async t => {
  const { session, advance, stop, open, audio } = doubaoMeeting(t);
  const one = open();
  audio();
  one.respond([said('最后一个问题', false, 0)]);
  await advance(1000);
  stop(undefined);
  audio();
  const started = Date.now();
  let result;
  session.drain(5000, 0).then(value => { result = value; });
  await advance(1000);
  assert.equal(Socket.instances.length, 2, 'the seal is given up after a short wait');
  const two = Socket.instances.at(-1);
  await advance(1500); // a slow handshake
  two.open();
  assert.equal(domestic.audio('Doubao', two), 1);
  assert.equal(domestic.finishes('Doubao', two), 1);
  if (tail === 'answers') {
    await advance(1500);
    respondTo(two)([said('尾音', true, 0, 300)], true);
    await advance(0);
    assert.deepEqual(JSON.parse(JSON.stringify(result)), { timedOut: false, failedChannels: [] });
  } else {
    await advance(1999);
    assert.equal(result, undefined);
    await advance(1);
    assert.equal(Date.now() - started, 4500, 'the tail request gets what is left of the budget, not a fresh 4.5 s');
    assert.deepEqual(JSON.parse(JSON.stringify(result)), { timedOut: false, failedChannels: ['user'] }, 'only the microphone failed; the session did not time out');
  }
  assert.ok(Date.now() - started < 5000);
});

test('S42-03 Domestic seal: a finish frame that cannot be sent fails the seal at once; a close while sealing ends the request quietly', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  Socket.instances = [];
  const { DoubaoStreamingSTT } = load('DoubaoStreamingSTT');
  const stt = new DoubaoStreamingSTT('synthetic');
  t.after(() => stt.stop(false));
  const errors = [];
  stt.on('error', error => errors.push(error));
  stt.start();
  const first = Socket.instances.at(-1);
  first.open();
  stt.write(Buffer.alloc(320));
  first.bufferedAmount = 1024 * 1024; // the next send throws
  let outcome;
  const failedSeal = stt.seal(0);
  failedSeal.done.then(value => { outcome = value; });
  await Promise.resolve();
  assert.equal(outcome, 'failed', 'no wait for the seal timeout');
  assert.equal(first.readyState, 3, 'the request is given up');
  stt.write(Buffer.alloc(320));
  assert.equal(Socket.instances.length, 2, 'new audio starts a new request at once');
  const second = Socket.instances.at(-1);
  second.open();
  stt.write(Buffer.alloc(320));
  const closing = stt.seal(0);
  stt.write(Buffer.alloc(320)); // queued behind the seal
  second.emit('close', 1000);
  assert.equal(await closing.done, 'failed');
  assert.equal(Socket.instances.length, 3, 'the queued audio reconnects at once, without a back-off');
  const third = Socket.instances.at(-1);
  third.open();
  assert.equal(domestic.audio('Doubao', third), 1);
  assert.deepEqual(errors, [], 'neither is a user-facing connection error');
});
