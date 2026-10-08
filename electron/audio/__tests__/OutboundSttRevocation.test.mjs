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
    exports: module.exports, module, console: quiet, Buffer, process: { env: { GOOGLE_APPLICATION_CREDENTIALS: '/synthetic/account.json' }, cwd: () => '/synthetic' },
    setTimeout: schedule, setInterval: schedule, clearTimeout() {}, clearInterval() {},
    require(id) {
      if (id === 'ws') return Socket;
      if (id === '@deepgram/sdk') return { createClient: () => ({ listen: { live: () => new Socket() } }), LiveTranscriptionEvents: { Open: 'open', Transcript: 'transcript', Error: 'error', Close: 'close' } };
      if (id === '@google-cloud/speech') return { SpeechClient: class { streamingRecognize() { return new Socket(); } } };
      if (id === '../config/languages') return { RECOGNITION_LANGUAGES: { 'english-us': { bcp47: 'en-US', iso639: 'en' } } };
      if (id === './dnsHelpers') return { streamingStttWsOptions: () => ({}) };
      if (id === '../services/outbound') return outbound;
      if (id === '../services/googleServiceAccount') return { loadGoogleServiceAccount: () => ({}), googleSpeechClientOptions: () => ({}) };
      if (id === './openaiTranscriptTurnCoalescer') return require('../../../dist-electron/electron/audio/openaiTranscriptTurnCoalescer.js');
      return require(id);
    },
  });
  return { Class: module.exports[name], sockets, timers };
}

const audio = Buffer.alloc(96_000, 1);
function ready(name, socket) {
  socket.readyState = 1; socket.emit('open');
  if (name === 'OpenAIStreamingSTT') socket.emit('message', Buffer.from('{"type":"session.created"}'));
  if (name === 'ElevenLabsStreamingSTT') socket.emit('message', Buffer.from('{"message_type":"session_started"}'));
}
const hasAudio = socket => socket.sent.some(data => Buffer.isBuffer(data) || /"(?:audio|audio_base_64)"/.test(String(data)));

for (const name of ['DeepgramStreamingSTT', 'SonioxStreamingSTT', 'ElevenLabsStreamingSTT', 'OpenAIStreamingSTT']) {
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
    if (lateMessage) lateMessage(Buffer.from(name === 'OpenAIStreamingSTT' ? '{"type":"session.created"}' : '{"message_type":"session_started"}'));
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

test('Google stopped stream cannot flush queued audio or restart', () => {
  const loaded = subject('GoogleSTT'), stt = new loaded.Class('synthetic');
  stt.start(); stt.write(audio);
  assert.equal(hasAudio(loaded.sockets[0]), true);
  stt.buffer.push(audio); stt.stop(false); stt.flushBuffer(); stt.startStream(); stt.write(audio);
  assert.equal(loaded.sockets.length, 1);
  assert.equal(loaded.sockets[0].sent.length, 1);
  assert.equal(loaded.sockets[0].cancelled, true);
});

test('AppState revokes both old senders before a capture-stop failure or pipeline wait', async () => {
  const source = read('electron/main.ts');
  const ast = ts.createSourceFile('main.ts', source, ts.ScriptTarget.Latest, true);
  const klass = ast.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'AppState');
  const methods = ['reconfigureSttProvider', 'discardSttProviders'].map(name => klass.members.find(node => node.name?.getText(ast) === name).getText(ast));
  const module = { exports: {} };
  vm.runInNewContext(compile(`class Subject { ${methods.join('\n')} } exports.Subject = Subject;`), {
    exports: module.exports, console: quiet,
    require: () => ({ CredentialsManager: { getInstance: () => ({ getSttProvider: () => 'none' }) } }),
  });
  for (const fail of [false, true]) {
    const state = new module.exports.Subject(), stopped = [];
    const old = () => ({ stop: graceful => stopped.push(graceful), removeAllListeners() {} });
    let release;
    Object.assign(state, { isMeetingActive: true, googleSTT: old(), googleSTT_User: old(), broadcast() {},
      systemAudioCapture: { stop: () => { assert.deepEqual(stopped, [false, false]); if (fail) throw Error('synthetic capture failure'); }, start() {} },
      setupSystemAudioPipeline: () => new Promise(resolve => { release = resolve; }),
    });
    const result = state.reconfigureSttProvider();
    assert.deepEqual(stopped, [false, false]); assert.equal(state.googleSTT, null);
    if (fail) await assert.rejects(result, /synthetic capture failure/);
    else { release(); await result; }
  }
});

test('AppState never guesses Google for unknown, none or missing selected keys', () => {
  const source = read('electron/main.ts');
  const ast = ts.createSourceFile('main.ts', source, ts.ScriptTarget.Latest, true);
  const klass = ast.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'AppState');
  const method = klass.members.find(node => node.name?.getText(ast) === 'createSTTProvider').getText(ast);
  for (const provider of ['none', 'unknown', 'deepgram', 'soniox', 'elevenlabs', 'openai', 'groq', 'azure', 'ibmwatson', 'google']) {
    const module = { exports: {} };
    const manager = new Proxy({ getSttProvider: () => provider }, { get: (target, key) => target[key] ?? (() => undefined) });
    vm.runInNewContext(compile(`class Subject { ${method} } exports.Subject = Subject;`), {
      exports: module.exports, console: quiet, process: { env: {} },
      require: () => ({ CredentialsManager: { getInstance: () => manager } }),
      GoogleSTT: class { constructor() { throw Error('unconfigured Google must not be constructed'); } },
    });
    assert.equal(new module.exports.Subject().createSTTProvider('user'), null, provider);
  }
});
