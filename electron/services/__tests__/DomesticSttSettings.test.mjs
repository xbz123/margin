import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';

const source = fs.readFileSync(new URL('../CredentialsManager.ts', import.meta.url), 'utf8');
const tree = ts.createSourceFile('credentials.ts', source, ts.ScriptTarget.Latest, true);
const declaration = tree.statements.find(node => ts.isClassDeclaration(node));
const names = ['getSttProvider', 'setSttProvider', 'getDomesticStt', 'setDomesticStt', 'requireSttConfigured',
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
