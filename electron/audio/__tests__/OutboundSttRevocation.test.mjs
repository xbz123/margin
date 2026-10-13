import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { REPO } from '../../../scripts/margin/isolation/env.mjs';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const outbound = require('../../../dist-electron/electron/services/outbound.js');
const quiet = { log() {}, warn() {}, error() {} };
const compile = source => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
const read = file => fs.readFileSync(`${REPO}/${file}`, 'utf8');

function subject(name) {
  const sockets = [], timers = [];
  class Socket extends EventEmitter {
    static OPEN = 1;
    static CLOSED = 3;
    readyState = 0;
    sent = [];
    writable = true;
    constructor() { super(); sockets.push(this); }
    send(data) { this.sent.push(data); }
    write(data) { this.sent.push(data); }
    close() { this.readyState = 3; }
    end() { this.ended = true; }
    destroy() { this.destroyed = true; }
    cancel() { this.cancelled = true; }
    ping() {}
    keepAlive() {}
    finalize() { this.sent.push('finalize'); }
    requestClose() { this.sent.push('close-stream'); }
    disconnect() { this.close(); }
  }
  const schedule = fn => { const timer = { fn, unref() {} }; timers.push(timer); return timer; };
  const module = { exports: {} };
  vm.runInNewContext(compile(read(`electron/audio/${name}.ts`)), {
    exports: module.exports, module, console: quiet, Buffer, Date, process: { env: {}, cwd: () => '/synthetic' },
    setTimeout: schedule, setInterval: schedule, clearTimeout() {}, clearInterval() {},
    require(id) {
      if (id === 'ws') return Socket;
      if (id === '../config/languages') return { RECOGNITION_LANGUAGES: { 'english-us': { bcp47: 'en-US', iso639: 'en' } } };
      if (id === './dnsHelpers') return { streamingStttWsOptions: () => ({}) };
      if (id === '../services/outbound') return outbound;
      if (id === './openaiTranscriptTurnCoalescer') return require('../../../dist-electron/electron/audio/openaiTranscriptTurnCoalescer.js');
      if (id === './restBatches') return require('../../../dist-electron/electron/audio/restBatches.js');
      return require(id);
    },
  });
  return { Class: module.exports[name], sockets, timers };
}

const audio = Buffer.alloc(96_000, 1);
function ready(name, socket) {
  socket.readyState = 1; socket.emit('open');
  if (name === 'OpenAIStreamingSTT') socket.emit('message', Buffer.from('{"type":"session.updated"}'));
}
const hasAudio = socket => socket.sent.some(data => Buffer.isBuffer(data) || /"(?:audio|audio_base_64)"/.test(String(data)));

for (const name of ['SonioxStreamingSTT', 'OpenAIStreamingSTT']) {
  test(`${name}: handshake/buffer/reconnect revocation, with an allowed audio control`, () => {
    const allowed = subject(name), live = new allowed.Class('synthetic-only');
    live.start(); ready(name, allowed.sockets[0]); live.write(audio);
    assert.equal(hasAudio(allowed.sockets[0]), true, 'the real write method sends synthetic audio while active');
    live.stop(false);

    const revoked = subject(name), old = new revoked.Class('synthetic-only');
    old.start(); old.write(audio);
    const socket = revoked.sockets[0];
    const lateOpen = socket.listeners('open')[0];
    const lateMessage = socket.listeners('message')[0];
    if (name === 'OpenAIStreamingSTT') old._scheduleWsReconnect(); else old.scheduleReconnect();
    old.stop(false);
    socket.readyState = 1;
    lateOpen?.();
    if (lateMessage) lateMessage(Buffer.from('{"type":"session.created"}'));
    old.write(audio);
    for (const timer of [...revoked.timers]) timer.fn();
    if (name === 'OpenAIStreamingSTT') {
      const timersBefore = revoked.timers.length;
      old._switchToRest(); old._flushRingBuffer();
      assert.equal(revoked.timers.length, timersBefore, 'delayed fallback cannot restart its safety timer');
    }
    assert.equal(revoked.sockets.length, 1, 'queued reconnects cannot create a fresh socket');
    assert.equal(socket.sent.length, 0, 'revocation does not flush audio, config or finalization frames');
  });
}

test('OpenAI normal Stop drains the accumulator; discard does not', () => {
  for (const graceful of [true, false]) {
    const loaded = subject('OpenAIStreamingSTT'), stt = new loaded.Class('synthetic-only');
    stt.start(); ready('OpenAIStreamingSTT', loaded.sockets[0]);
    const socket = loaded.sockets[0]; socket.sent = [];
    stt.pcmAccumulator = [new Int16Array([1, 2])]; stt.pcmAccumulatorLen = 2;
    stt.stop(graceful);
    assert.equal(hasAudio(socket), graceful);
    assert.equal(socket.sent.some(data => /input_audio_buffer.commit/.test(String(data))), graceful);
  }
});

for (const [name, args, flush, upload, chunks, bytes, pending] of [
  ['RestSTT', ['groq', 'synthetic-only'], 'flushAndUpload', 'uploadAudio', 'chunks', 'totalBufferedBytes', 'flushPending'],
  ['OpenAIStreamingSTT', ['synthetic-only', 'https://explicit.invalid/v1'], '_restFlushAndUpload', '_restUpload', 'restChunks', 'restTotalBytes', 'restFlushPending'],
]) {
  test(`${name}: queued REST upload does not run after discard`, async () => {
    const loaded = subject(name), stt = new loaded.Class(...args);
    stt.start(); stt.isSilent = stt._isSilent = () => false;
    let complete, sends = 0;
    stt[upload] = async () => { sends++; await new Promise(resolve => { complete = resolve; }); return ''; };
    stt[chunks] = [audio]; stt[bytes] = audio.length;
    const first = stt[flush]();
    stt[chunks] = [audio]; stt[bytes] = audio.length;
    await stt[flush](); assert.equal(stt[pending], true);
    stt.stop(false); complete(); await first;
    await stt[flush]();
    for (const timer of [...loaded.timers]) timer.fn();
    assert.equal(sends, 1, 'already submitted upload may complete; queued upload must not start');
  });
}

test('AppState revokes both old senders before a capture-stop failure or pipeline wait', async () => {
  const { mainFixture } = await import('./mainMeetingFixture.mjs');
  const { deferred } = await import('./meetingAudioFixture.mjs');
  for (const fail of [false, true]) {
    const f = mainFixture();
    await f.start();
    const stopped = [], entered = deferred(), release = deferred();
    for (const provider of f.providers) provider.stop = flush => stopped.push(flush);
    f.audio.pipeline.reconfigureSttProvider = async () => {
      assert.deepEqual(stopped, [false, false]);
      entered.resolve();
      if (fail) throw Error('synthetic capture failure');
      await release.promise;
    };
    const result = f.state.reconfigureSttProvider();
    assert.deepEqual(stopped, [false, false]);
    assert.equal(f.session.get('user'), null);
    assert.equal(f.session.get('interviewer'), null);
    await entered.promise;
    if (fail) await assert.rejects(result, /synthetic capture failure/);
    else { release.resolve(); await result; }
    await f.state.endMeeting();
  }
});

test('AppState returns null for unknown, none or unconfigured providers', () => {
  const source = read('electron/main.ts');
  const ast = ts.createSourceFile('main.ts', source, ts.ScriptTarget.Latest, true);
  const klass = ast.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'AppState');
  const method = klass.members.find(node => node.name?.getText(ast) === 'createSTTProvider').getText(ast);
  for (const provider of ['none', 'unknown', 'google', 'deepgram', 'elevenlabs', 'azure', 'ibmwatson', 'local-whisper', 'soniox', 'openai', 'groq']) {
    const module = { exports: {} };
    const manager = new Proxy({ getSttProvider: () => provider }, { get: (target, key) => target[key] ?? (() => undefined) });
    vm.runInNewContext(compile(`class Subject { ${method} } exports.Subject = Subject;`), {
      exports: module.exports, console: quiet, process: { env: {} },
      require: () => ({ CredentialsManager: { getInstance: () => manager } }),
    });
    assert.equal(new module.exports.Subject().createSTTProvider('user'), null, provider);
  }
});

for (const [name, args, flush, upload, chunks, bytes] of [
  ['RestSTT', ['groq', 'synthetic-only'], 'flushAndUpload', 'uploadAudio', 'chunks', 'totalBufferedBytes'],
  ['OpenAIStreamingSTT', ['synthetic-only', 'https://explicit.invalid/v1'], '_restFlushAndUpload', '_restUpload', 'restChunks', 'restTotalBytes'],
]) {
  const setup = () => {
    const loaded = subject(name), stt = new loaded.Class(...args);
    stt.start(); stt.isSilent = stt._isSilent = () => false;
    const uploads = [], rows = [], errors = [];
    stt[upload] = wav => new Promise((resolve, reject) => uploads.push({ wav, resolve, reject }));
    stt.on('transcript', row => rows.push(row)); stt.on('error', error => errors.push(error));
    return { stt, uploads, rows, errors };
  };
  const settle = () => new Promise(resolve => setImmediate(resolve));

  test(`S42-03 ${name}: a seal cuts pre-click audio into its own batch while an upload is in flight; later audio stays separate`, async () => {
    const { stt, uploads, rows } = setup();
    const block = Buffer.alloc(8000, 1);
    stt.write(block); void stt[flush]();
    assert.equal(uploads.length, 1, 'batch A is uploading');
    stt.write(Buffer.alloc(8000, 2));
    const seal = stt.seal(Date.now());
    stt.write(Buffer.alloc(8000, 3));
    assert.equal(seal.scopes.length, 2, 'the seal covers the in-flight batch and its own pre-click batch');
    assert.equal(uploads.length, 1, 'the sealed batch waits for the upload in flight');
    let outcome; seal.done.then(value => { outcome = value; });
    uploads[0].resolve('first words'); await settle();
    assert.equal(rows[0].scope, seal.scopes[0]); assert.equal(rows[0].segmentId, seal.scopes[0]);
    assert.equal(uploads.length, 2);
    assert.equal(uploads[1].wav.length, uploads[0].wav.length, 'post-click audio is not in the sealed batch');
    assert.equal(outcome, undefined, 'one finished batch does not complete the seal');
    uploads[1].resolve('pre click words'); await settle();
    assert.equal(rows[1].scope, seal.scopes[1]);
    assert.equal(outcome, 'complete');
    assert.equal(stt[bytes], 8000, 'post-click audio waits for its own upload');
    stt.stop(false);
  });

  test(`S42-03 ${name}: short is unknown, quiet is no-pending, errors fail visibly and stop prevents queued uploads`, async () => {
    let { stt, uploads, errors } = setup();
    assert.equal(await stt.seal(Date.now()).done, 'no-pending', 'nothing received: fast empty');
    stt.write(Buffer.alloc(100, 1));
    assert.equal(await stt.seal(Date.now()).done, 'unknown', 'a too-short batch is not empty');
    assert.equal(stt[bytes], 100, 'its audio is kept for the next upload');
    stt.isSilent = stt._isSilent = () => true;
    stt.write(Buffer.alloc(8000, 1));
    assert.equal(await stt.seal(Date.now()).done, 'no-pending', 'a discarded quiet batch leaves nothing to process');
    stt.isSilent = stt._isSilent = () => false;
    stt.write(Buffer.alloc(8000, 1));
    const failing = stt.seal(Date.now());
    uploads.at(-1).reject(Error('synthetic upload failure'));
    assert.equal(await failing.done, 'failed');
    assert.equal(errors.length, 1);
    stt.stop(false);

    ({ stt, uploads } = setup());
    stt.write(Buffer.alloc(8000, 1)); void stt[flush]();
    stt.write(Buffer.alloc(8000, 2));
    const queued = stt.seal(Date.now());
    stt.stop(false);
    assert.equal(await queued.done, 'unknown');
    uploads[0].resolve(''); await settle();
    assert.equal(uploads.length, 1, 'stop prevents the queued upload');
  });

  test(`S42-03 ${name}: a delayed begin seals only pre-cut ingress, not audio already buffered after the click`, async t => {
    t.mock.timers.enable({ apis: ['Date'], now: 1000 });
    const { stt, uploads } = setup(); t.after(() => stt.stop(false));
    stt.write(Buffer.alloc(8000, 1));
    const cut = Date.now();
    t.mock.timers.tick(10);
    stt.write(Buffer.alloc(8000, 2));
    const seal = stt.seal(cut);
    assert.equal(uploads.length, 1);
    assert.equal(uploads[0].wav.length, 8044);
    assert.equal(uploads[0].wav[44], 1);
    assert.equal(stt[bytes], 8000);
    uploads[0].resolve('pre-cut only');
    assert.equal(await seal.done, 'complete');
  });

  test(`S42-03 ${name}: a mixed in-flight batch is unknown rather than falsely attributed to the click`, async t => {
    t.mock.timers.enable({ apis: ['Date'], now: 1000 });
    const { stt, uploads } = setup(); t.after(() => stt.stop(false));
    stt.write(Buffer.alloc(8000, 1)); const cut = Date.now();
    t.mock.timers.tick(10); stt.write(Buffer.alloc(8000, 2)); void stt[flush]();
    const seal = stt.seal(cut);
    assert.equal(seal.scopes.length, 0);
    assert.equal(await seal.done, 'unknown');
    uploads[0].resolve('mixed result for normal history'); await settle();
  });

  test(`S42-03 ${name}: queue capacity refuses new sealing without modifying an older batch`, async t => {
    t.mock.timers.enable({ apis: ['Date'], now: 1000 });
    const { stt, uploads, errors } = setup(); t.after(() => stt.stop(false));
    stt.write(Buffer.alloc(8000, 1)); void stt[flush]();
    for (let index = 1; index <= 8; index++) {
      t.mock.timers.tick(1); stt.write(Buffer.alloc(8000, index)); stt.seal(Date.now());
    }
    t.mock.timers.tick(1); stt.write(Buffer.alloc(8000, 99));
    assert.throws(() => stt.seal(Date.now()), /queue capacity exceeded/);
    assert.equal(errors.length, 1);
    assert.equal(stt[bytes], 8000, 'refused audio stays outside every older sealed batch');
    for (let index = 0; index <= 8; index++) { uploads[index].resolve('words'); await settle(); }
    assert.equal(uploads.length, 9);
    assert.equal(uploads[8].wav.length, 8044);
    assert.equal(uploads[8].wav[44], 8);
  });

  test(`S42-03 ${name}: retained audio has a byte bound and overflow cannot become proven empty`, async t => {
    const { stt, uploads, errors } = setup(); t.after(() => stt.stop(false));
    stt.write(Buffer.alloc(8000, 1)); void stt[flush]();
    stt.write(Buffer.alloc(8 * 1024 * 1024, 1));
    assert.equal(errors.length, 1);
    assert.match(errors[0].message, /buffer capacity exceeded/);
    const seal = stt.seal(Date.now());
    uploads[0].resolve('retained audio');
    assert.equal(await seal.done, 'unknown');
    assert.equal(stt[bytes], 0);
  });

  test(`S42-03 ${name}: an old upload cannot emit or release the new upload after stop and restart`, async t => {
    const { stt, uploads, rows } = setup(); t.after(() => stt.stop(false));
    stt.write(Buffer.alloc(8000, 1)); void stt[flush]();
    stt.stop(false); stt.start();
    stt.write(Buffer.alloc(8000, 2)); void stt[flush]();
    assert.equal(uploads.length, 2);
    uploads[0].resolve('OLD SESSION'); await settle();
    assert.equal(rows.length, 0);
    stt.write(Buffer.alloc(8000, 3)); stt.seal(Date.now());
    assert.equal(uploads.length, 2, 'old finally did not clear the new upload lock');
    uploads[1].resolve('NEW SESSION'); await settle();
    assert.equal(rows[0].text, 'NEW SESSION');
    assert.equal(uploads.length, 3);
    uploads[2].resolve('new tail'); await settle();
  });
}

test('S42-03 OpenAI WS mode has no scoped flush, so a manual action leaves it unknown', () => {
  const loaded = subject('OpenAIStreamingSTT'), stt = new loaded.Class('synthetic-only');
  stt.start(); ready('OpenAIStreamingSTT', loaded.sockets[0]);
  assert.equal(stt.seal(Date.now()), undefined);
  stt.stop(false);
});

test('S42-03 Soniox: utterances keep their identity per connection epoch; finalize proves processing only, never scopes results', async () => {
  const loaded = subject('SonioxStreamingSTT'), stt = new loaded.Class('synthetic-only');
  const rows = []; stt.on('transcript', row => rows.push(row));
  assert.equal(stt.seal(Date.now()), undefined, 'no open connection: nothing can be scoped');
  stt.start(); ready('SonioxStreamingSTT', loaded.sockets[0]);
  const socket = loaded.sockets[0];
  const tokens = list => socket.emit('message', Buffer.from(JSON.stringify({ tokens: list })));
  tokens([{ text: 'Hel', is_final: true, start_ms: 100, end_ms: 200 }, { text: 'lo', is_final: false, start_ms: 200, end_ms: 300 }]);
  const seal = stt.seal(Date.now());
  assert.match(String(socket.sent.at(-1)), /"finalize"/);
  assert.deepEqual(JSON.parse(JSON.stringify(seal.scopes)), [], 'a fin cannot authorize result text by itself');
  assert.equal(stt.seal(Date.now()), undefined, 'one outstanding manual finalize at a time');
  let outcome; seal.done.then(value => { outcome = value; });
  tokens([{ text: 'lo', is_final: true, start_ms: 200, end_ms: 300 }, { text: '<fin>', is_final: true }]);
  await Promise.resolve();
  assert.equal(outcome, 'complete');
  tokens([{ text: 'Next', is_final: false, start_ms: 900, end_ms: 1000 }]);
  tokens([{ text: 'Next', is_final: true, start_ms: 900, end_ms: 1000 }, { text: '<end>', is_final: true }]);
  assert.deepEqual(JSON.parse(JSON.stringify(rows.map(row => [row.segmentId, row.epoch, row.text, row.isFinal, row.scope ?? null]))),
    [['u0', '1', 'Hello', false, null], ['u0', '1', 'Hello', true, null], ['u1', '1', 'Next', false, null], ['u1', '1', 'Next', true, null]]);
  assert.deepEqual(JSON.parse(JSON.stringify(rows[1].media)), { basis: 'soniox-stream-audio', startMs: 100, endMs: 300 });
  // A connection that ends before its <fin> leaves the seal unproven; the next epoch restarts IDs without colliding.
  const pending = stt.seal(Date.now());
  socket.emit('close', 1006, Buffer.from(''));
  assert.equal(await pending.done, 'unknown');
  for (const timer of [...loaded.timers]) timer.fn();
  ready('SonioxStreamingSTT', loaded.sockets.at(-1));
  loaded.sockets.at(-1).emit('message', Buffer.from(JSON.stringify({ tokens: [{ text: 'Again', is_final: false }] })));
  assert.deepEqual([rows.at(-1).segmentId, rows.at(-1).epoch], ['u0', '2']);
  stt.stop(false);
});

test('S42-03 Soniox: an untimed non-final utterance still ends at its marker, and text after a marker starts a new utterance', () => {
  const loaded = subject('SonioxStreamingSTT'), stt = new loaded.Class('synthetic-only');
  const rows = []; stt.on('transcript', row => rows.push(row));
  stt.start(); ready('SonioxStreamingSTT', loaded.sockets[0]);
  const tokens = list => loaded.sockets[0].emit('message', Buffer.from(JSON.stringify({ tokens: list })));
  tokens([{ text: 'abandoned', is_final: false }]);
  tokens([{ text: '<end>', is_final: true }]);
  tokens([{ text: 'fresh', is_final: false }]);
  tokens([{ text: 'old tail', is_final: false }, { text: '<end>', is_final: true }, { text: 'new head', is_final: false }]);
  assert.deepEqual(rows.map(row => [row.segmentId, row.text, row.isFinal]),
    [['u0', 'abandoned', false], ['u1', 'fresh', false], ['u2', 'new head', false]],
    'IDs are never reused and non-final text does not leak across a marker');
  stt.stop(false);
});

test('S42-03 Soniox through the session: a new utterance after the click is excluded even though finalize completed', async () => {
  const { MeetingSttSession } = require('../../../dist-electron/electron/audio/MeetingSttSession.js');
  const loaded = subject('SonioxStreamingSTT'), stt = new loaded.Class('synthetic-only');
  const session = new MeetingSttSession({ create: () => stt, onTranscript() {} });
  session.begin('meeting'); session.ensure('user');
  stt.start(); ready('SonioxStreamingSTT', loaded.sockets[0]);
  const tokens = list => loaded.sockets[0].emit('message', Buffer.from(JSON.stringify({ tokens: list })));
  tokens([{ text: 'before click', is_final: false, start_ms: 0, end_ms: 400 }]);
  await new Promise(resolve => setTimeout(resolve, 2));
  const collector = session.collect({ cutoffAt: Date.now(), deadline: Date.now() + 200, signal: new AbortController().signal });
  collector.setStage1End(Date.now());
  await new Promise(resolve => setTimeout(resolve, 2));
  tokens([{ text: 'before click', is_final: true, start_ms: 0, end_ms: 400 }, { text: '<end>', is_final: true },
    { text: 'AFTER CLICK utterance', is_final: true, start_ms: 900, end_ms: 1200 }, { text: '<fin>', is_final: true }]);
  const frozen = await collector.frozen;
  assert.deepEqual(frozen.channels.user.segments.map(segment => [segment.text, segment.final]), [['before click', true]]);
  stt.stop(false);
});
