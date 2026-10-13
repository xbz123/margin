import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';

const source = fs.readFileSync(new URL('../CredentialsManager.ts', import.meta.url), 'utf8');
const tree = ts.createSourceFile('credentials.ts', source, ts.ScriptTarget.Latest, true);
const declaration = tree.statements.find(node => ts.isClassDeclaration(node));
const names = ['getSttProvider', 'setSttProvider', 'getDomesticStt', 'invalidDomesticStt', 'setDomesticStt', 'requireSttConfigured',
  'getGroqSttApiKey', 'getOpenAiSttApiKey', 'getSonioxApiKey'];
const methods = declaration.members.filter(node => node.name && names.includes(node.name.getText(tree))).map(node => node.getText(tree));
const compile = source => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const Manager = new Function(compile('return class Manager {' + methods.join('\n') + '}'))();
const manager = new Manager();
manager.credentials = {};
manager.saveCredentials = patch => { Object.assign(manager.credentials, patch); return { ok: true }; };

test('STT base URL rejects hidden authorities and query/fragment credentials', () => {
  const { validateSttBaseUrl } = createRequire(import.meta.url)('../../../dist-electron/electron/utils/validateSttBaseUrl.js');
  assert.equal(validateSttBaseUrl(' https://synthetic.invalid/v1/ '), 'https://synthetic.invalid/v1');
  assert.equal(validateSttBaseUrl(''), '');
  for (const value of [null, 'file:///credentials', 'https://user:secret@host.invalid', 'https://host.invalid/?key=secret',
    'https://host.invalid/#secret', 'https://host.invalid\\@other.invalid', 'https://host.invalid/a b']) {
    assert.throws(() => validateSttBaseUrl(value));
  }
});

test('exactly five cloud selections, missing keys fail closed, domestic credentials save and delete', () => {
  manager.setSttProvider('none');
  assert.throws(() => manager.requireSttConfigured(), /not configured/);
  for (const provider of ['openai', 'soniox', 'groq', 'aliyun', 'doubao']) {
    manager.setSttProvider(provider);
    assert.equal(manager.getSttProvider(), provider);
    assert.throws(() => manager.requireSttConfigured(), /not configured/);
  }
  assert.throws(() => manager.setSttProvider('unknown'), /Invalid/);
  for (const provider of ['aliyun', 'doubao']) {
    manager.setSttProvider(provider);
    assert.equal(manager.setDomesticStt(provider, { key: 'synthetic-secret', workspaceId: 'workspace', appId: '' }).ok, true);
    assert.doesNotThrow(() => manager.requireSttConfigured());
    assert.throws(() => manager.setDomesticStt(provider, { key: 'header\ninjection', workspaceId: '', appId: '' }), /Invalid/);
    assert.equal(manager.getDomesticStt(provider).key, 'synthetic-secret');
    manager.setDomesticStt(provider, { key: '', workspaceId: '', appId: '' });
    assert.throws(() => manager.requireSttConfigured(), /not configured/);
  }
});

test('STT IPC only exposes presence, applies deletion and closes mock connection tests', async () => {
  const handlers = new Map();
  const streams = [];
  class Stream extends EventEmitter {
    constructor() { super(); streams.push(this); }
    start() {}
    write() {}
    async finalize() { this.emit('completed'); }
    stop() { this.stopped = true; }
  }
  const module = {};
  const text = fs.readFileSync(new URL('../../ipc/sttHandlers.ts', import.meta.url), 'utf8');
  new Function('require', 'exports', compile(text))(id => {
    if (id.includes('CredentialsManager')) return { CredentialsManager: { getInstance: () => manager } };
    return { AliyunStreamingSTT: Stream, DoubaoStreamingSTT: Stream };
  }, module);
  let applied = 0;
  module.registerDomesticSttHandlers((name, callback) => handlers.set(name, callback), async () => { applied++; });
  for (const provider of ['aliyun', 'doubao']) {
    const call = (name, ...args) => handlers.get(name)(null, provider, ...args);
    const input = { key: 'synthetic-secret', workspaceId: 'workspace', appId: provider === 'doubao' ? '123' : '' };
    assert.equal((await call('save-domestic-stt', input)).ok, true);
    assert.equal(JSON.stringify(call('get-domestic-stt')).includes(input.key), false);
    assert.equal(call('get-domestic-stt').hasKey, true);
    assert.equal((await call('test-domestic-stt')).success, true);
    assert.equal(streams.at(-1).stopped, true);
    await call('save-domestic-stt', { ...input, key: '' });
    assert.equal(call('get-domestic-stt').hasKey, false);
    assert.equal((await call('test-domestic-stt')).success, false);
  }
  assert.equal(applied, 4);
});

test('S42-01 workspace and resource are checked before saving; refusals keep the previous configuration', () => {
  const store = new Manager();
  store.credentials = {};
  let writes = 0;
  store.saveCredentials = patch => { writes++; Object.assign(store.credentials, patch); return { ok: true }; };
  const plain = value => JSON.parse(JSON.stringify(value));
  const refused = (provider, input) => {
    const before = plain(store.credentials), count = writes;
    assert.throws(() => store.setDomesticStt(provider, input), /Invalid/, JSON.stringify(input));
    assert.deepEqual(plain(store.credentials), before);
    assert.equal(writes, count, 'nothing is persisted');
  };
  store.setSttProvider('aliyun');
  assert.equal(store.setDomesticStt('aliyun', { key: 'synthetic-secret', workspaceId: '', appId: '' }).ok, true);
  assert.deepEqual(plain(store.getDomesticStt('aliyun')), { key: 'synthetic-secret', workspaceId: '', appId: '' });
  assert.doesNotThrow(() => store.requireSttConfigured(), 'an empty workspace is a complete configuration');
  assert.equal(store.setDomesticStt('aliyun', { key: 'synthetic-secret', workspaceId: ' ws_01-a ', appId: '' }).ok, true);
  assert.equal(store.getDomesticStt('aliyun').workspaceId, 'ws_01-a');
  for (const workspaceId of ['evil.example', 'a/b', 'x@y', '-lead', 'a'.repeat(64), 'w#', 'w\r\nX-Injected: 1', null]) {
    refused('aliyun', { key: 'synthetic-other', workspaceId, appId: '' });
  }
  store.credentials.domesticStt.aliyun.workspaceId = 'evil.example';
  assert.throws(() => store.requireSttConfigured(), /not configured/, 'a stored invalid workspace never starts');

  store.setSttProvider('doubao');
  assert.equal(store.setDomesticStt('doubao', { key: 'synthetic-secret', workspaceId: '', appId: '' }).ok, true);
  assert.equal(store.getDomesticStt('doubao').resourceId, 'volc.seedasr.sauc.duration', 'missing choice means hourly');
  assert.equal(store.setDomesticStt('doubao', { key: 'synthetic-secret', workspaceId: '', appId: 'synthetic-app',
    resourceId: 'volc.seedasr.sauc.concurrent' }).ok, true);
  assert.deepEqual(plain(store.getDomesticStt('doubao')),
    { key: 'synthetic-secret', workspaceId: '', appId: 'synthetic-app', resourceId: 'volc.seedasr.sauc.concurrent' });
  for (const resourceId of ['', null, 'volc.bigasr.sauc.duration', 'volc.seedasr.sauc.Duration', 'volc.seedasr.sauc.concurrent ']) {
    refused('doubao', { key: 'synthetic-other', workspaceId: '', appId: '', resourceId });
  }
  assert.doesNotThrow(() => store.requireSttConfigured());
  store.credentials.domesticStt.doubao = { key: 'synthetic-legacy', workspaceId: '', appId: '' };
  assert.equal(store.getDomesticStt('doubao').resourceId, 'volc.seedasr.sauc.duration', 'older saved configuration');
  assert.doesNotThrow(() => store.requireSttConfigured());
  store.credentials.domesticStt.doubao.resourceId = 'volc.other';
  assert.throws(() => store.requireSttConfigured(), /not configured/);
  store.credentials.domesticStt.doubao.resourceId = null;
  assert.throws(() => store.requireSttConfigured(), /not configured/, 'null is an invalid stored choice, not a missing legacy field');
  assert.equal(store.setDomesticStt('doubao', { key: '', workspaceId: '', appId: '' }).ok, true);
  assert.equal(store.getDomesticStt('doubao'), undefined);
  assert.throws(() => store.requireSttConfigured(), /not configured/);
});

test('S42-01 connection test and meeting capture open the same saved endpoint and resource; deletion sends nothing', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  class Socket extends EventEmitter {
    static OPEN = 1;
    static instances = [];
    readyState = 0;
    bufferedAmount = 0;
    constructor(url, options) { super(); this.url = url; this.options = options; Socket.instances.push(this); }
    send() {}
    terminate() { this.readyState = 3; }
    close() { this.terminate(); }
  }
  const audio = new Map();
  const loadAudio = name => {
    if (audio.has(name)) return audio.get(name);
    const exports = {};
    audio.set(name, exports);
    const source = fs.readFileSync(new URL('../../audio/' + name + '.ts', import.meta.url), 'utf8');
    new Function('require', 'exports', ts.transpileModule(source, { compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText)(
      id => id === 'ws' ? Socket : id.startsWith('./') ? loadAudio(id.substring(2)) : createRequire(import.meta.url)(id), exports);
    return exports;
  };
  const store = new Manager();
  store.credentials = {};
  store.saveCredentials = patch => { Object.assign(store.credentials, patch); return { ok: true }; };
  const handlerModule = {};
  new Function('require', 'exports', compile(fs.readFileSync(new URL('../../ipc/sttHandlers.ts', import.meta.url), 'utf8')))(id => {
    if (id.includes('CredentialsManager')) return { CredentialsManager: { getInstance: () => store } };
    return loadAudio(id.split('/').at(-1));
  }, handlerModule);
  const handlers = new Map();
  handlerModule.registerDomesticSttHandlers((name, callback) => handlers.set(name, callback), async () => {});
  const mainSource = fs.readFileSync(new URL('../../main.ts', import.meta.url), 'utf8');
  const ast = ts.createSourceFile('main.ts', mainSource, ts.ScriptTarget.Latest, true);
  const appState = ast.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'AppState');
  const method = appState.members.find(node => node.name?.getText(ast) === 'createSTTProvider').getText(ast);
  const Subject = new Function('require', 'console', compile(`return class Subject { sendSttStatus() {} ${method} }`))(
    id => id === './ipc/sttHandlers' ? handlerModule : { CredentialsManager: { getInstance: () => store } }, { log() {}, warn() {}, error() {} });
  store.getSttLanguage = () => 'auto';
  const connectionTest = async provider => {
    const pending = handlers.get('test-domestic-stt')(null, provider);
    const socket = Socket.instances.at(-1);
    socket.emit('unexpected-response', {}, { statusCode: 401, resume() {} });
    const result = await pending;
    assert.equal(result.success, false);
    assert.match(result.error, /authentication/);
    return socket;
  };
  const capture = provider => {
    store.setSttProvider(provider);
    const stt = new Subject().createSTTProvider('user');
    t.after(() => stt.stop(false));
    stt.start();
    return Socket.instances.at(-1);
  };
  const cases = [
    ['aliyun', { key: 'synthetic-secret', workspaceId: '', appId: '' }, socket => {
      assert.equal(socket.url, 'wss://dashscope.aliyuncs.com/api-ws/v1/inference');
      assert.equal(socket.options.headers.Authorization, 'Bearer synthetic-secret');
    }],
    ['aliyun', { key: 'synthetic-secret', workspaceId: 'ws_01', appId: '' }, socket => {
      assert.equal(socket.url, 'wss://ws_01.cn-beijing.maas.aliyuncs.com/api-ws/v1/inference');
    }],
    ['doubao', { key: 'synthetic-secret', workspaceId: '', appId: '' }, socket => {
      assert.equal(socket.options.headers['X-Api-Resource-Id'], 'volc.seedasr.sauc.duration');
      assert.equal(socket.options.headers['X-Api-Key'], 'synthetic-secret');
    }],
    ['doubao', { key: 'synthetic-secret', workspaceId: '', appId: 'synthetic-app', resourceId: 'volc.seedasr.sauc.concurrent' }, socket => {
      assert.equal(socket.options.headers['X-Api-Resource-Id'], 'volc.seedasr.sauc.concurrent');
      assert.equal(socket.options.headers['X-Api-App-Key'], 'synthetic-app');
      assert.equal(socket.options.headers['X-Api-Access-Key'], 'synthetic-secret');
    }],
  ];
  for (const [provider, input, check] of cases) {
    assert.equal((await handlers.get('save-domestic-stt')(null, provider, input)).ok, true);
    const visible = handlers.get('get-domestic-stt')(null, provider);
    assert.equal(visible.hasKey, true);
    assert.doesNotMatch(JSON.stringify(visible), /synthetic-secret/);
    if (provider === 'doubao') assert.equal(visible.resourceId, input.resourceId ?? 'volc.seedasr.sauc.duration');
    check(await connectionTest(provider));
    check(capture(provider));
  }
  const refused = await handlers.get('save-domestic-stt')(null, 'doubao',
    { key: 'synthetic-other', workspaceId: '', appId: '', resourceId: 'volc.seedasr.sauc.unknown' });
  assert.equal(refused.ok, false);
  assert.equal(handlers.get('get-domestic-stt')(null, 'doubao').resourceId, 'volc.seedasr.sauc.concurrent');
  const kept = await connectionTest('doubao');
  assert.equal(kept.options.headers['X-Api-Resource-Id'], 'volc.seedasr.sauc.concurrent', 'refusal kept the previous choice');
  assert.equal(kept.options.headers['X-Api-Access-Key'], 'synthetic-secret');
  for (const provider of ['aliyun', 'doubao']) {
    assert.equal((await handlers.get('save-domestic-stt')(null, provider, { key: '', workspaceId: '', appId: '' })).ok, true);
    const before = Socket.instances.length;
    assert.deepEqual(await handlers.get('test-domestic-stt')(null, provider), { success: false, error: 'Save STT credentials first.' });
    store.setSttProvider(provider);
    assert.equal(new Subject().createSTTProvider('user'), null);
    assert.equal(Socket.instances.length, before, 'deleted credentials open no connection');
  }
});

test('connection test separates construction, configuration, authentication, timeout and network failures without echoing secrets', async () => {
  const handlers = new Map();
  let mode = 'construct', stopped = 0;
  class Stream extends EventEmitter {
    constructor() { super(); if (mode === 'construct') throw Error('synthetic-secret'); }
    start() { if (mode === 'configuration') this.emit('error', Object.assign(Error('synthetic-secret'), { code: mode })); }
    write() {}
    async finalize() {
      if (mode === 'success') { this.emit('completed'); return; }
      if (mode === 'authentication' || mode === 'empty-audio') this.emit('error', Object.assign(Error('synthetic-secret'), { code: mode }));
      throw Object.assign(Error('synthetic-secret'), { code: mode === 'timeout' ? 'timeout' : 'untrusted-code' });
    }
    stop() { stopped++; }
  }
  const module = {};
  const text = fs.readFileSync(new URL('../../ipc/sttHandlers.ts', import.meta.url), 'utf8');
  new Function('require', 'exports', compile(text))(id => id.includes('CredentialsManager')
    ? { CredentialsManager: { getInstance: () => ({ getDomesticStt: () => ({ key: 'synthetic-secret' }) }) } }
    : { AliyunStreamingSTT: Stream, DoubaoStreamingSTT: Stream }, module);
  module.registerDomesticSttHandlers((name, callback) => handlers.set(name, callback), async () => {});
  const expected = {
    construct: 'Invalid STT configuration.', configuration: 'Invalid STT configuration.',
    authentication: 'STT authentication failed. Check credentials and resource access.',
    timeout: 'STT connection test timed out.',
    'empty-audio': 'STT connection test received empty audio.',
    network: 'STT connection test failed. Check credentials and network.',
  };
  for (mode of Object.keys(expected)) {
    const result = await handlers.get('test-domestic-stt')(null, 'doubao');
    assert.equal(result.success, false);
    assert.equal(result.error, expected[mode]);
    assert.doesNotMatch(JSON.stringify(result), /synthetic-secret|untrusted-code/);
  }
  mode = 'success';
  assert.equal((await handlers.get('test-domestic-stt')(null, 'doubao')).success, true);
  assert.equal(stopped, 6);
});

test('main reports a permanent configuration error as failed, not as authentication or reconnecting', () => {
  const source = fs.readFileSync(new URL('../../main.ts', import.meta.url), 'utf8');
  const ast = ts.createSourceFile('main.ts', source, ts.ScriptTarget.Latest, true);
  let listener;
  function visit(node) {
    if (ts.isCallExpression(node) && node.expression.getText(ast) === 'stt.on' && node.arguments[0]?.text === 'error') {
      listener = node.arguments[1].getText(ast);
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.ok(listener);
  const statuses = [], provider = {};
  const state = { isMeetingActive: true, meetingStt: { get: () => provider }, sendSttStatus: row => statuses.push(row) };
  const onError = new Function('stt', 'speaker', 'sttProvider', 'console',
    compile("let _consecutiveErrors = 0; let _lastState = 'awaiting-audio'; return " + listener))
    .call(state, provider, 'user', 'doubao', { warn() {}, error() {} });
  onError(Object.assign(Error('STT configuration or protocol parameters are invalid'), { code: 'configuration' }));
  assert.equal(statuses[0].state, 'failed');
  assert.doesNotMatch(statuses[0].error, /auth|credential/i);
  onError(Object.assign(Error('STT connection or protocol failed'), { code: 'connection' }));
  assert.equal(statuses[1].state, 'reconnecting');
});
