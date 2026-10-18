import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { generateKeyPairSync } from 'node:crypto';
import { REPO } from '../../../scripts/margin/isolation/env.mjs';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const read = file => fs.readFileSync(path.join(REPO, file), 'utf8');
const compile = source => ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true,
} }).outputText;
const targetModule = { exports: {} };
vm.runInNewContext(compile(read('src/types/llmTarget.ts')), { module: targetModule, exports: targetModule.exports });
const { LLM_PRESETS: targets } = targetModule.exports;
const generationPolicyModule = { exports: {} };
vm.runInNewContext(compile(read('src/types/generationPolicy.ts')), { module: generationPolicyModule, exports: generationPolicyModule.exports });
const codexModule = { exports: {} };
vm.runInNewContext(compile(read('src/types/codexSource.ts')), { module: codexModule, exports: codexModule.exports });
const quiet = { log() {}, warn() {}, error() {} };
const failure = { ok: false, code: 'write_failed', message: 'Synthetic save failure' };
const plain = value => JSON.parse(JSON.stringify(value));

test('generation policy persists independent deadlines and rejects invalid or identical targets without mutation', () => {
  const disk = storage(); const manager = disk.boot();
  assert.equal(manager.setProviderConfiguration({ ...targets.openai, model: 'primary' }).ok, true);
  const primary = 'llm-target:openai:chat-completions:primary';
  const backup = 'llm-target:openai:chat-completions:backup';
  assert.equal(manager.setDefaultModel(primary).ok, true);
  const policy = { backupModel: backup, interviewFirstTokenSeconds: 12, interviewTotalSeconds: 90, writtenTotalSeconds: 240 };
  assert.equal(manager.setGenerationPolicy(policy).ok, true);
  assert.deepEqual(plain(disk.boot().getGenerationPolicy()), policy);
  const before = disk.files.get(disk.filename).toString();
  for (const invalid of [{ ...policy, interviewFirstTokenSeconds: 0 }, { ...policy, interviewTotalSeconds: 5 },
    { ...policy, writtenTotalSeconds: Infinity }, { ...policy, backupModel: primary }]) {
    assert.throws(() => manager.setGenerationPolicy(invalid));
    assert.equal(disk.files.get(disk.filename).toString(), before);
    assert.deepEqual(plain(manager.getGenerationPolicy()), policy);
  }
  assert.throws(() => manager.setDefaultModel(backup), /must differ/);
  assert.throws(() => manager.setProviderConfiguration({ ...targets.openai, model: 'backup' }), /must differ/);
  assert.equal(manager.getDefaultModel(), primary);
  assert.equal(disk.files.get(disk.filename).toString(), before);
});

test('generation policy failed atomic save keeps old memory and disk deadlines', () => {
  const disk = storage(); const manager = disk.boot(); const previous = plain(manager.getGenerationPolicy());
  const before = disk.files.get(disk.filename).toString(); disk.setFault('rename');
  const result = manager.setGenerationPolicy({ ...previous, interviewTotalSeconds: 75 });
  assert.equal(result.ok, false); assert.equal(result.code, 'write_failed');
  assert.deepEqual(plain(manager.getGenerationPolicy()), previous);
  assert.equal(disk.files.get(disk.filename).toString(), before);
});
test('AG34 Codex alias and actual fast target equality are rejected before credential persistence', () => {
  const config = { ...codexModule.exports.DEFAULT_CODEX_SOURCE_CONFIG, model: 'configured', fastModel: 'fast' };
  const disk = storage(), manager = disk.boot(); manager.setDefaultModel('codex-cli', config);
  const before = disk.files.get(disk.filename).toString(), previous = plain(manager.getGenerationPolicy());
  for (const [backup, fast] of [['codex-cli:configured', false], ['codex-cli:fast', true]]) {
    assert.throws(() => manager.setGenerationPolicy({ ...previous, backupModel: backup }, config, fast), /must differ/);
    assert.equal(disk.files.get(disk.filename).toString(), before); assert.deepEqual(plain(manager.getGenerationPolicy()), previous);
  }
  assert.equal(manager.setGenerationPolicy({ ...previous, backupModel: 'codex-cli:configured' }, config, true).ok, true);
  const stored = disk.files.get(disk.filename).toString();
  assert.throws(() => manager.setDefaultModel('codex-cli', config, false), /must differ/);
  assert.equal(disk.files.get(disk.filename).toString(), stored);
  assert.equal(manager.getDefaultModel(), 'codex-cli');
});

function storage() {
  const filename = '/synthetic/credentials.enc';
  const files = new Map([[filename, Buffer.from('cipher:' + JSON.stringify({ openaiApiKey: 'synthetic-old' }))]]);
  let fault;
  const reads = [];
  const fakeFs = {
    existsSync: file => files.has(file),
    readFileSync(file) { reads.push(file); if (fault === 'read') throw Error('synthetic read'); return files.get(file); },
    writeFileSync(file, bytes, options) {
      if (fault === 'collision') {
        files.set(file, Buffer.from('synthetic-existing-temp'));
        const error = Error('synthetic collision'); error.code = 'EEXIST'; throw error;
      }
      if (options?.flag === 'wx' && files.has(file)) throw Error('synthetic EEXIST');
      files.set(file, Buffer.from(bytes));
      if (fault === 'write') throw Error('synthetic partial write');
    },
    renameSync(from, to) { if (fault === 'rename') throw Error('synthetic rename'); files.set(to, files.get(from)); files.delete(from); },
    unlinkSync: file => files.delete(file),
    linkSync(from, to) {
      if (fault === 'link') throw Error('synthetic link');
      if (files.has(to)) throw Error('synthetic EEXIST');
      files.set(to, files.get(from));
    },
  };
  const safeStorage = {
    isEncryptionAvailable: () => fault !== 'unavailable',
    encryptString(text) { if (fault === 'encrypt') throw Error('synthetic encrypt'); return Buffer.from('cipher:' + text); },
    decryptString(bytes) { if (fault === 'decrypt') throw Error('synthetic decrypt'); return fault === 'parse' ? 'not-json' : bytes.toString().slice(7); },
  };
  const boot = () => {
    const module = { exports: {} };
    vm.runInNewContext(compile(read('electron/services/CredentialsManager.ts')), {
      module, exports: module.exports, Buffer, URL, console: quiet,
      require(id) {
        if (id === 'electron') return { app: { getPath: () => '/synthetic' }, safeStorage };
        if (id === 'fs') return fakeFs;
        if (id === './outbound') return require('../../../dist-electron/electron/services/outbound.js');
        if (id === '../utils/validateSttBaseUrl') return require('../../../dist-electron/electron/utils/validateSttBaseUrl.js');
        if (id === '../../src/types/llmTarget') return targetModule.exports;
        if (id === '../../src/types/generationPolicy') return generationPolicyModule.exports;
        if (id === '../../src/types/codexSource') return codexModule.exports;
        if (id === '../llm/llmTarget') return require('../../../dist-electron/electron/llm/llmTarget.js');
        return require(id);
      },
    });
    const manager = module.exports.CredentialsManager.getInstance();
    manager.init();
    return manager;
  };
  return { files, filename, reads, boot, setFault(value) { fault = value; } };
}

const llmTargetApi = () => require('../../../dist-electron/electron/llm/llmTarget.js');
const newGateway = (manager, extra = {}) => manager.setGatewayConfiguration({ protocol: 'chat-completions', baseUrl: 'https://custom.invalid/v1', model: 'primary', apiKey: 'synthetic-gateway', ...extra });

test('S45 gateway origin change requires a reentered key and official providers never take a custom address', () => {
  const disk = storage(), manager = disk.boot();
  const created = newGateway(manager);
  assert.equal(created.ok, true); assert.match(created.gatewayId, /^gw-[0-9a-f-]{36}$/);
  const id = created.gatewayId;
  assert.equal(manager.setDefaultModel(`llm-gateway:${id}:chat-completions:primary`).ok, true);
  const before = plain(manager.getAllCredentials()), cipher = disk.files.get(disk.filename);
  for (const apiKey of [undefined, '', '   ']) {
    const result = manager.setGatewayConfiguration({ id, protocol: 'chat-completions', baseUrl: 'https://other.invalid/v1', model: 'primary', apiKey });
    assert.equal(result.ok, false); assert.match(result.message, /re-enter.*API key/i);
    assert.deepEqual(plain(manager.getAllCredentials()), before); assert.deepEqual(disk.files.get(disk.filename), cipher);
  }
  for (const baseUrl of ['http://custom.invalid/v1', 'https://custom.invalid:8443/v1']) assert.equal(manager.setGatewayConfiguration({ id, protocol: 'chat-completions', baseUrl, model: 'primary' }).ok, false);
  assert.equal(manager.setGatewayConfiguration({ id, protocol: 'chat-completions', baseUrl: 'https://CUSTOM.invalid:443/other/', model: 'primary' }).ok, true, 'same normalized origin keeps its key');
  assert.equal(manager.setGatewayConfiguration({ id, protocol: 'chat-completions', baseUrl: 'https://other.invalid/v1', model: 'primary', apiKey: 'synthetic-rebound' }).ok, true);
  const restarted = disk.boot();
  assert.equal(restarted.getGatewayApiKey(id), 'synthetic-rebound');
  assert.equal(restarted.getProviderApiKey('openai'), 'synthetic-old', 'the official key is separate and untouched');
  assert.equal(restarted.getDefaultModel(), `llm-gateway:${id}:chat-completions:primary`);
  const stored = disk.files.get(disk.filename);
  for (const baseUrl of ['https://custom.invalid/v1', 'http://127.0.0.1:9999/v1']) {
    assert.throws(() => manager.setProviderConfiguration({ ...targets.openai, baseUrl, apiKey: 'synthetic-any' }), /gateway/);
  }
  assert.equal(manager.setProviderConfiguration({ ...targets.openai, baseUrl: 'https://API.OPENAI.COM:443/v1/' }).ok, true, 'the official address itself is accepted');
  assert.equal(manager.getProviderConfigurations().openai.baseUrl, undefined);
  assert.notDeepEqual(disk.files.get(disk.filename), stored);
});

test('S45 environment addresses never redirect an official provider; only the development loopback hook applies', () => {
  const variable = 'OPENAI_BASE_URL', previous = process.env[variable];
  const electronId = require.resolve('electron'), cached = require.cache[electronId];
  const previousDev = process.env.MARGIN_DEV_OPENAI_BASE_URL;
  try {
    require.cache[electronId] = { id: electronId, filename: electronId, loaded: true, exports: { app: { isPackaged: false } } };
    for (const dev of [false, true]) {
      process.env[variable] = 'https://environment.invalid/root';
      if (dev) process.env.MARGIN_DEV_OPENAI_BASE_URL = 'http://127.0.0.1:19331/v1';
      else delete process.env.MARGIN_DEV_OPENAI_BASE_URL;
      const disk = storage(), manager = disk.boot();
      assert.equal(manager.setProviderConfiguration({ ...targets.openai, apiKey: 'synthetic-new' }).ok, true);
      const api = llmTargetApi();
      assert.equal(api.effectiveProviderConfiguration(manager.getProviderConfigurations().openai).baseUrl, dev ? 'http://127.0.0.1:19331/v1' : 'https://api.openai.com/v1');
      assert.equal(api.blockedEnvironmentOverride('openai'), dev ? undefined : variable);
    }
  } finally {
    if (previous === undefined) delete process.env[variable]; else process.env[variable] = previous;
    if (previousDev === undefined) delete process.env.MARGIN_DEV_OPENAI_BASE_URL; else process.env.MARGIN_DEV_OPENAI_BASE_URL = previousDev;
    if (cached) require.cache[electronId] = cached; else delete require.cache[electronId];
  }
});

test('S45 official and gateway targets with the same wire model keep separate identities and keys across restart', () => {
  const disk = storage(), manager = disk.boot();
  assert.equal(manager.setProviderConfiguration({ ...targets.openai, model: 'same-model', apiKey: 'synthetic-official' }).ok, true);
  const { gatewayId: id } = newGateway(manager, { model: 'same-model', apiKey: 'synthetic-gateway' });
  assert.equal(manager.setDefaultModel('llm-target:openai:chat-completions:same-model').ok, true);
  assert.equal(manager.setGenerationPolicy({ ...manager.getGenerationPolicy(), backupModel: `llm-gateway:${id}:chat-completions:same-model` }).ok, true, 'same model name, different targets');
  const restarted = disk.boot();
  assert.equal(restarted.getProviderApiKey('openai'), 'synthetic-official');
  assert.equal(restarted.getGatewayApiKey(id), 'synthetic-gateway');
  const official = restarted.resolveSelection(restarted.getDefaultModel()), gateway = restarted.resolveSelection(restarted.getGenerationPolicy().backupModel);
  assert.equal(official.provider, 'openai'); assert.equal(official.baseUrl, undefined);
  assert.deepEqual([gateway.provider, gateway.gatewayId, gateway.baseUrl], ['gateway', id, 'https://custom.invalid/v1']);
  assert.deepEqual(plain(restarted.getGatewaySummaries()).map(item => Object.keys(item).sort()), [['baseUrl', 'hasKey', 'id', 'model', 'protocol']], 'summaries carry no key');
  assert.doesNotMatch(JSON.stringify(restarted.getGatewaySummaries()), /synthetic-/);
});

test('S45 gateway removal keeps official credentials, refuses a selected gateway and leaves no fallback', () => {
  const disk = storage(), manager = disk.boot();
  const { gatewayId: id } = newGateway(manager);
  assert.equal(manager.setDefaultModel(`llm-gateway:${id}:chat-completions:primary`).ok, true);
  const cipher = disk.files.get(disk.filename);
  const refused = manager.removeGateway(id);
  assert.equal(refused.ok, false); assert.match(refused.message, /selected/); assert.deepEqual(disk.files.get(disk.filename), cipher);
  assert.equal(manager.setDefaultModel('gpt-5.4').ok, true);
  disk.setFault('rename');
  assert.equal(manager.removeGateway(id).ok, false, 'a failed write keeps the gateway');
  assert.equal(manager.getGatewayApiKey(id), 'synthetic-gateway');
  disk.setFault(undefined);
  assert.equal(manager.removeGateway(id).ok, true);
  const restarted = disk.boot();
  assert.deepEqual(plain(restarted.getGateways()), {}); assert.equal(restarted.getGatewayApiKey(id), undefined);
  assert.equal(restarted.getProviderApiKey('openai'), 'synthetic-old');
  assert.throws(() => restarted.resolveSelection(`llm-gateway:${id}:chat-completions:primary`), /no longer exists/);
  assert.throws(() => restarted.setDefaultModel(`llm-gateway:${id}:chat-completions:primary`), /no longer exists/);
});

test('S45 a new gateway needs its own key, and failed writes keep memory and disk unchanged', () => {
  for (const fault of ['encrypt', 'write', 'rename', 'unavailable']) {
    const disk = storage(), manager = disk.boot();
    const cipher = disk.files.get(disk.filename), before = plain(manager.getAllCredentials());
    assert.equal(newGateway(manager, { apiKey: '' }).ok, false);
    disk.setFault(fault);
    assert.equal(newGateway(manager).ok, false, fault);
    assert.deepEqual(plain(manager.getAllCredentials()), before, fault); assert.deepEqual(disk.files.get(disk.filename), cipher, fault);
    assert.deepEqual([...disk.files.keys()], [disk.filename], 'no temporary file remains');
  }
});

test('S45 Groq is refused as an answer target while its stored key is kept apart from speech', () => {
  const disk = storage(), manager = disk.boot();
  assert.equal(manager.setGroqApiKey('synthetic-groq-answer').ok, true);
  const cipher = disk.files.get(disk.filename);
  for (const selection of ['llm-target:groq:chat-completions:llama-3.3-70b-versatile', 'llama']) {
    assert.throws(() => manager.setDefaultModel(selection), /Groq is not available/);
    assert.throws(() => manager.setGenerationPolicy({ ...manager.getGenerationPolicy(), backupModel: selection }), /Groq is not available/);
  }
  assert.throws(() => manager.setProviderConfiguration({ ...targets.groq, apiKey: 'synthetic-any' }), /Groq is not available/);
  assert.deepEqual(disk.files.get(disk.filename), cipher);
  assert.equal(manager.getGroqApiKey(), 'synthetic-groq-answer');
  assert.equal(manager.getGroqSttApiKey(), undefined, 'the answer key is not a speech key');
});

test('R3-1 real save handler refuses origin changes and failed atomic saves before any runtime effect', async () => {
  const disk = storage(), manager = disk.boot(), effects = [];
  const before = plain(manager.getAllCredentials()), cipher = disk.files.get(disk.filename);
  const apply = () => effects.push('runtime');
  const appState = { getIntelligenceManager: () => ({ resetEngine: apply, initializeLLMs: apply }), sendModelChanged: apply };
  answerOperations(manager, { configureProvider: apply, setGenerationPolicy: apply, getCurrentModelSelection: () => 'synthetic' }, appState);
  const invoke = handler('set-provider-configuration', { require: () => ({ CredentialsManager: { getInstance: () => manager } }), appState });
  assert.equal((await invoke({}, { ...targets.openai, baseUrl: 'https://new.invalid/v1', apiKey: 'synthetic-new' })).ok, false, 'an official provider never takes a custom address');
  const config = { ...targets.openai, protocol: 'responses' };
  disk.setFault('rename');
  assert.equal((await invoke({}, { ...config, apiKey: 'synthetic-new' })).ok, false);
  assert.deepEqual(effects, []);
  assert.deepEqual(plain(manager.getAllCredentials()), before);
  assert.deepEqual(disk.files.get(disk.filename), cipher);
  disk.setFault(undefined);
  assert.equal((await invoke({}, { ...config, apiKey: 'synthetic-new' })).ok, true);
  assert.equal(effects.length, 5);
  assert.equal(disk.boot().getProviderApiKey('openai'), 'synthetic-new');
});

test('AG33 gateway primary and backup image confirmations survive restart independently and reset on address/model changes', () => {
  const disk = storage(), manager = disk.boot();
  const { gatewayId: id } = newGateway(manager, { baseUrl: 'https://custom.example/v1' });
  const binding = (model, base = 'https://custom.example/v1') => JSON.stringify(['gateway', id, 'chat-completions', base, model]);
  const config = { id, protocol: 'chat-completions', baseUrl: 'https://custom.example/v1', model: 'primary' };
  assert.equal(manager.setGatewayConfiguration({ ...config, imageSupportConfirmedFor: binding('primary') }).ok, true);
  assert.equal(manager.setDefaultModel(`llm-gateway:${id}:chat-completions:primary`).ok, true);
  assert.equal(manager.setGenerationPolicy({ ...manager.getGenerationPolicy(), backupModel: `llm-gateway:${id}:chat-completions:backup`, backupImageSupportConfirmedFor: binding('backup') }).ok, true);
  const restarted = disk.boot();
  assert.equal(restarted.getGateways()[id].imageSupportConfirmedFor, binding('primary'));
  assert.equal(restarted.getGenerationPolicy().backupImageSupportConfirmedFor, binding('backup'));
  // An official-looking binding for the same address is not a gateway confirmation.
  assert.equal(restarted.setGatewayConfiguration({ ...config, imageSupportConfirmedFor: JSON.stringify(['openai', 'chat-completions', config.baseUrl, 'primary']) }).ok, true);
  assert.equal(restarted.getGateways()[id].imageSupportConfirmedFor, undefined);
  assert.equal(restarted.setGatewayConfiguration({ ...config, imageSupportConfirmedFor: binding('primary') }).ok, true);
  assert.equal(restarted.setGatewayConfiguration({ ...config, baseUrl: 'https://changed.example/v1', apiKey: 'synthetic-new', imageSupportConfirmedFor: binding('primary') }).ok, true);
  assert.equal(restarted.getGateways()[id].imageSupportConfirmedFor, undefined);
  assert.equal(restarted.getGenerationPolicy().backupImageSupportConfirmedFor, undefined);
  assert.equal(disk.boot().getGenerationPolicy().backupImageSupportConfirmedFor, undefined);
  const changed = { ...config, baseUrl: 'https://changed.example/v1' };
  assert.equal(restarted.setGatewayConfiguration({ ...changed, model: 'different', imageSupportConfirmedFor: binding('primary', changed.baseUrl) }).ok, true);
  assert.equal(restarted.getGateways()[id].imageSupportConfirmedFor, undefined);
  assert.equal(restarted.getDefaultModel(), `llm-gateway:${id}:chat-completions:different`, 'an explicit save of the selected configured model keeps the selection on it');
});

for (const fault of ['unavailable', 'encrypt', 'write', 'rename', 'decrypt', 'parse', 'read', 'load-unavailable']) {
  test(`credential transaction rejects ${fault} without losing memory or the old ciphertext`, () => {
    const disk = storage();
    const loading = ['decrypt', 'parse', 'read', 'load-unavailable'].includes(fault);
    if (loading) disk.setFault(fault === 'load-unavailable' ? 'unavailable' : fault);
    const manager = disk.boot();
    const before = disk.files.get(disk.filename);
    disk.setFault(loading ? undefined : fault);
    const result = manager.setOpenaiApiKey('synthetic-new');
    assert.equal(result?.ok, false);
    assert.equal(result.code, ['unavailable', 'load-unavailable'].includes(fault) ? 'encryption_unavailable' : loading ? 'decrypt_failed' : 'write_failed');
    assert.equal(manager.getOpenaiApiKey(), loading ? undefined : 'synthetic-old');
    assert.deepEqual(disk.files.get(disk.filename), before);
    assert.deepEqual([...disk.files.keys()], [disk.filename], 'no partial temp file remains');
    disk.setFault(undefined);
    assert.equal(disk.boot().getOpenaiApiKey(), 'synthetic-old', 'restart restores old ciphertext');
    if (loading) {
      manager.init();
      assert.equal(manager.setOpenaiApiKey('synthetic-new').ok, true, 'successful reload releases the write lock');
    }
  });
}

test('unreadable credentials are offered for discard only after a decrypt or parse failure', () => {
  for (const fault of ['decrypt', 'parse']) {
    const disk = storage();
    disk.setFault(fault);
    const manager = disk.boot();
    const original = disk.files.get(disk.filename);
    assert.deepEqual(plain(manager.getLoadStatus()), { ok: false, code: 'decrypt_failed', message: manager.getLoadStatus().message, canDiscard: true });
    disk.setFault(undefined);
    const discarded = manager.discardUnreadableCredentials();
    assert.equal(discarded.ok, true);
    assert.match(discarded.backupName, /^credentials\.enc\.unreadable-[0-9T-]+Z$/);
    assert.equal(disk.files.has(disk.filename), false, 'the original name is free for a new store');
    assert.deepEqual(disk.files.get(`/synthetic/${discarded.backupName}`), original, 'the backup keeps the original bytes');
    assert.deepEqual(plain(manager.getLoadStatus()), { ok: true });
    assert.equal(manager.setOpenaiApiKey('synthetic-new').ok, true, 'saving works again after the discard');
    assert.equal(disk.boot().getOpenaiApiKey(), 'synthetic-new');
    assert.deepEqual(disk.files.get(`/synthetic/${discarded.backupName}`), original, 'a later save leaves the backup alone');
  }
  for (const fault of ['read', 'unavailable']) {
    const disk = storage();
    disk.setFault(fault);
    const manager = disk.boot();
    const before = new Map(disk.files);
    assert.equal(manager.getLoadStatus().canDiscard, false, `${fault} may succeed later, so it is not discardable`);
    assert.equal(manager.discardUnreadableCredentials().ok, false);
    assert.deepEqual(disk.files, before);
    assert.equal(manager.setOpenaiApiKey('synthetic-new').ok, false, 'saving stays blocked');
  }
  const healthy = storage().boot();
  assert.deepEqual(plain(healthy.getLoadStatus()), { ok: true });
  assert.equal(healthy.discardUnreadableCredentials().ok, false, 'a readable store is never discarded');
});

test('a failed backup during discard keeps the unreadable file and the save block', () => {
  const disk = storage();
  disk.setFault('decrypt');
  const manager = disk.boot();
  const before = new Map(disk.files);
  disk.setFault('link');
  assert.equal(manager.discardUnreadableCredentials().ok, false);
  assert.deepEqual(disk.files, before);
  assert.equal(manager.getLoadStatus().canDiscard, true);
  disk.setFault(undefined);
  assert.equal(manager.setOpenaiApiKey('synthetic-new').ok, false);
});

test('all credential setters commit only after persistence and can be read after restart', () => {
  const disk = storage();
  const manager = disk.boot();
  const ast = ts.createSourceFile('manager.ts', read('electron/services/CredentialsManager.ts'), ts.ScriptTarget.Latest, true);
  const klass = ast.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'CredentialsManager');
  const names = klass.members.filter(node => ts.isMethodDeclaration(node) && node.name.getText(ast).startsWith('set')).map(node => node.name.getText(ast));
  const fields = {
    setGeminiApiKey: 'geminiApiKey', setGroqApiKey: 'groqApiKey', setOpenaiApiKey: 'openaiApiKey',
    setClaudeApiKey: 'claudeApiKey', setDeepseekApiKey: 'deepseekApiKey',
    setSttProvider: 'sttProvider', setGroqSttApiKey: 'groqSttApiKey',
    setOpenAiSttApiKey: 'openAiSttApiKey', setOpenAiSttBaseUrl: 'openAiSttBaseUrl', setGroqSttModel: 'groqSttModel',
    setSonioxApiKey: 'sonioxApiKey',
    setDomesticStt: 'domesticStt',
    setSttLanguage: 'sttLanguage', setAiResponseLanguage: 'aiResponseLanguage', setDefaultModel: 'defaultModel', setPreferredModel: 'geminiPreferredModel', setProviderConfiguration: 'providerConfigurations', setGenerationPolicy: 'generationPolicy',
    setGatewayConfiguration: 'gateways',
  };
  assert.equal(names.length, 19);
  assert.deepEqual(names.sort(), Object.keys(fields).sort());
  for (const name of names) {
    const before = plain(manager.getAllCredentials());
    disk.setFault('write');
    const args = name === 'setGenerationPolicy' ? [{ interviewFirstTokenSeconds: 12, interviewTotalSeconds: 75, writtenTotalSeconds: 190 }] : name === 'setProviderConfiguration' ? [{ ...targets.openai, protocol: 'responses', model: 'opaque', apiKey: 'synthetic-old' }] : name === 'setGatewayConfiguration' ? [{ protocol: 'responses', baseUrl: 'https://synthetic.invalid/v1', model: 'opaque', apiKey: 'synthetic-gateway' }] : name === 'setDefaultModel' ? ['gpt-5.4'] : name === 'setPreferredModel' ? ['gemini', 'synthetic-model'] : [name === 'setSttProvider' ? 'groq' : name === 'setOpenAiSttBaseUrl' ? 'https://synthetic.invalid/v1' : 'synthetic-value'];
    if (name === 'setDomesticStt') args.splice(0, args.length, 'aliyun', { key: 'synthetic-key', workspaceId: 'workspace', appId: '' });
    assert.equal(manager[name](...args).ok, false, name);
    assert.deepEqual(plain(manager.getAllCredentials()), before, name);
    disk.setFault(undefined);
    assert.equal(manager[name](...args).ok, true, name);
    if (name === 'setProviderConfiguration') { const { apiKey, ...config } = args[0]; assert.deepEqual(plain(manager.getAllCredentials().providerConfigurations.openai), plain(config)); }
    else if (name === 'setGatewayConfiguration') { const { apiKey, ...config } = args[0]; assert.deepEqual(plain(Object.values(manager.getAllCredentials().gateways)).map(({ id, ...rest }) => rest), [plain(config)]); }
    else if (name === 'setGenerationPolicy') assert.deepEqual(plain(manager.getAllCredentials().generationPolicy), plain(args[0]));
    else if (name === 'setDomesticStt') assert.deepEqual(plain(manager.getDomesticStt('aliyun')), plain(args[1]));
    else assert.equal(manager.getAllCredentials()[fields[name]], args.at(-1), name + ': correct field');
    assert.deepEqual(plain(disk.boot().getAllCredentials()), plain(manager.getAllCredentials()), name);
  }
});

test('an exclusive-create collision never deletes the pre-existing temporary file', () => {
  const disk = storage();
  const manager = disk.boot();
  const before = disk.files.get(disk.filename);
  disk.setFault('collision');
  assert.equal(manager.setOpenaiApiKey('synthetic-new').ok, false);
  assert.deepEqual(disk.files.get(disk.filename), before);
  assert.equal(manager.getOpenaiApiKey(), 'synthetic-old');
  const collided = [...disk.files.entries()].filter(([name]) => name !== disk.filename);
  assert.equal(collided.length, 1);
  assert.equal(collided[0][1].toString(), 'synthetic-existing-temp');
});

test('legacy plaintext is removed without being read or used as credentials', () => {
  const disk = storage();
  disk.files.delete(disk.filename);
  disk.files.set(disk.filename + '.json', Buffer.from('{"openaiApiKey":"synthetic-plaintext"}'));
  const manager = disk.boot();
  assert.equal(manager.getOpenaiApiKey(), undefined);
  assert.equal(disk.files.has(disk.filename + '.json'), false);
  assert.equal(disk.reads.includes(disk.filename + '.json'), false, 'plaintext was never read');
  disk.setFault('unavailable');
  assert.equal(manager.setOpenaiApiKey('synthetic-new').ok, false);
  assert.equal(disk.files.size, 0);
});

test('a warm instance clears old memory and stays locked until a successful reload', () => {
  const disk = storage();
  const manager = disk.boot();
  const before = disk.files.get(disk.filename);
  for (const fault of ['decrypt', 'parse', 'read', 'unavailable']) {
    assert.equal(manager.getOpenaiApiKey(), 'synthetic-old');
    disk.setFault(fault);
    assert.equal(manager.init().ok, false);
    assert.equal(manager.getOpenaiApiKey(), undefined);
    disk.setFault(undefined);
    assert.equal(manager.setOpenaiApiKey('synthetic-new').ok, false, 'storage recovery alone does not unlock');
    assert.deepEqual(disk.files.get(disk.filename), before);
    assert.equal(manager.init().ok, true);
  }
  assert.equal(manager.setOpenaiApiKey('synthetic-new').ok, true);
});

const channels = [
  'set-ai-response-language', 'remove-provider-api-key', 'set-provider-preferred-model',
  'set-stt-provider', 'set-groq-stt-api-key', 'set-openai-stt-api-key', 'set-openai-stt-base-url',
  'set-groq-stt-model', 'set-soniox-api-key',
  'set-default-model', 'set-recognition-language', 'set-provider-configuration',
];

function expression(file, select, context) {
  const source = read(file);
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith('tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const matches = [];
  function visit(node) { if (select(node, ast)) matches.push(node); ts.forEachChild(node, visit); }
  visit(ast);
  assert.ok(matches.length, `no matching callback in ${file}`);
  const node = matches.sort((a, b) => a.getWidth(ast) - b.getWidth(ast))[0];
  return vm.runInNewContext(compile(`const callback = ${node.getText(ast)}; callback;`), { console: quiet, ...context });
}

function handler(channel, context) {
  const persistCredentials = expression('electron/ipcHandlers.ts', node => ts.isArrowFunction(node)
    && ts.isVariableDeclaration(node.parent) && node.parent.name.getText() === 'persistCredentials', {});
  const discardRemovedSttKey = expression('electron/ipcHandlers.ts', node => ts.isArrowFunction(node)
    && ts.isVariableDeclaration(node.parent) && node.parent.name.getText() === 'discardRemovedSttKey', context);
  return expression('electron/ipcHandlers.ts', node => ts.isArrowFunction(node) && ts.isCallExpression(node.parent)
    && node.parent.expression.getText() === 'safeHandle' && node.parent.arguments[0]?.text === channel, {
      persistCredentials, discardRemovedSttKey, LLM_PRESETS: targets, modelTargetId: targetModule.exports.modelTargetId,
      ANSWER_APPLY_WARNING: expression('electron/ipcHandlers.ts', node => ts.isStringLiteral(node) && ts.isVariableDeclaration(node.parent)
        && node.parent.name.getText() === 'ANSWER_APPLY_WARNING', {}),
      ANSWER_PROVIDERS: targetModule.exports.ANSWER_PROVIDERS, sanitizeErrorMessage: message => message,
      boundedProviderError: expression('electron/ipcHandlers.ts', node => ts.isArrowFunction(node) && ts.isVariableDeclaration(node.parent) && node.parent.name.getText() === 'boundedProviderError', { sanitizeErrorMessage: message => message }),
      ...require('../../../dist-electron/electron/llm/llmTarget.js'), ...context });
}

test('AG31 complete configuration saves key, endpoint, protocol, model and matching default atomically across restart', async () => {
  const disk = storage(), manager = disk.boot();
  assert.equal(manager.setDefaultModel('gpt-5.4').ok, true);
  const value = { provider: 'openai', protocol: 'responses', model: 'opaque', apiKey: 'synthetic-new' };
  const previous = disk.files.get(disk.filename);
  const applied = [];
  const broadcast = [];
  const appState = { sendModelChanged: value => broadcast.push(value), getIntelligenceManager: () => ({ resetEngine() {}, initializeLLMs() {} }) };
  answerOperations(manager, { configureProvider: (...args) => applied.push(args), setGenerationPolicy() {},
    getCurrentModelSelection: () => 'llm-target:openai:responses:opaque' }, appState);
  const invoke = handler('set-provider-configuration', { require: () => ({ CredentialsManager: { getInstance: () => manager } }), appState });
  disk.setFault('rename');
  assert.equal((await invoke({}, value)).ok, false);
  assert.deepEqual(applied, []);
  assert.deepEqual(broadcast, []);
  assert.deepEqual(disk.files.get(disk.filename), previous);
  disk.setFault(undefined);
  assert.equal((await invoke({}, value)).ok, true);
  assert.equal(applied.length, 1);
  assert.deepEqual(broadcast, ['llm-target:openai:responses:opaque']);
  const restarted = disk.boot();
  const config = restarted.getProviderConfigurations().openai;
  assert.deepEqual(plain(config), { provider: 'openai', protocol: 'responses', model: 'opaque' });
  assert.equal(restarted.getProviderApiKey('openai'), 'synthetic-new');
  assert.equal(restarted.getDefaultModel(), 'llm-target:openai:responses:opaque');
  assert.equal(restarted.setProviderConfiguration({ ...targets.claude, model: 'other-slot' }).ok, true);
  assert.equal(restarted.getDefaultModel(), 'llm-target:openai:responses:opaque', 'another slot cannot change the selected default');
  const configs = plain(restarted.getAllCredentials());
  configs.providerConfigurations.openai.provider = 'claude';
  disk.files.set(disk.filename, Buffer.from('cipher:' + JSON.stringify(configs)));
  assert.throws(() => disk.boot().getProviderConfigurations(), /protocol|credential slot/);
});

test('legacy default and raw switch input reach model UI as the canonical runtime selection', async () => {
  const disk = storage(), manager = disk.boot();
  let current = 'llm-target:openai:chat-completions:gpt-5.4';
  const events = [];
  const context = {
    require: () => ({ CredentialsManager: { getInstance: () => manager } }),
    appState: { processingHelper: { getLLMHelper: () => ({ setModel: () => {}, getCurrentModelSelection: () => current,
      validateGenerationTargets() {}, getCodexCliConfig: () => codexModule.exports.DEFAULT_CODEX_SOURCE_CONFIG, getGroqFastTextMode: () => false }) },
      sendModelChanged: value => events.push(value), modelSelectorWindowHelper: { hideWindow: () => events.push('hide') } },
  };
  assert.deepEqual(plain(await handler('get-default-model', context)({})), { model: 'llm-target:gemini:gemini:gemini-3.1-flash-lite-preview' });
  assert.equal((await handler('set-model', context)({}, 'gpt-5.4')).success, true);
  assert.deepEqual(events.splice(0), [current, 'hide']);
  assert.equal((await handler('set-default-model', context)({}, 'gpt-5.4')).ok, true);
  assert.deepEqual(events.splice(0), [current, 'hide']);
  assert.deepEqual(plain(await handler('get-default-model', context)({})), { model: current });
  current = 'codex-cli:synthetic-model';
  manager.setDefaultModel(current);
  assert.deepEqual(plain(await handler('get-default-model', context)({})), { model: current });
});

const ENV_KEYS = { GEMINI_API_KEY: 'synthetic-env-gemini', GROQ_API_KEY: 'synthetic-env-groq', OPENAI_API_KEY: 'synthetic-env-openai',
  CLAUDE_API_KEY: 'synthetic-env-claude', DEEPSEEK_API_KEY: 'synthetic-env-deepseek' };
const PROVIDERS = ['gemini', 'groq', 'openai', 'claude', 'deepseek'];
// Compiles the production ProcessingHelper against the given credentials, LLMHelper class and process.
function processingHelperClass(manager, LLMHelper, processValue) {
  const module = { exports: {} };
  vm.runInNewContext(compile(read('electron/ProcessingHelper.ts')), {
    module, exports: module.exports, console: quiet, process: processValue,
    require(id) {
      if (id === './LLMHelper') return { LLMHelper };
      if (id === './services/CredentialsManager') return { CredentialsManager: { getInstance: () => manager } };
      if (id === '../src/types/llmTarget') return targetModule.exports;
      if (id === 'electron') return { app: { isPackaged: true } };
      return require(id);
    },
  });
  return module.exports.ProcessingHelper;
}

test('AG31 startup ignores environment keys: never-saved, saved, removed and unreadable credentials use only saved keys', () => {
  for (const scenario of ['never-saved', 'saved-differs', 'removed-key', 'unreadable']) {
    const disk = storage();
    // The never-saved control starts from a credentials file with no key at all.
    if (scenario === 'never-saved') disk.files.set(disk.filename, Buffer.from('cipher:{}'));
    const manager = disk.boot();
    if (scenario === 'never-saved') for (const provider of PROVIDERS) assert.equal(manager.getProviderApiKey(provider), undefined);
    if (scenario === 'saved-differs' || scenario === 'removed-key') assert.equal(manager.setProviderConfiguration({ ...targets.openai,
      protocol: 'responses', model: 'opaque', apiKey: 'synthetic-saved' }).ok, true);
    if (scenario === 'saved-differs') assert.equal(newGateway(manager).ok, true);
    if (scenario === 'removed-key') assert.equal(manager.setProviderConfiguration({ ...manager.getProviderConfigurations().openai, apiKey: '' }).ok, true);
    if (scenario === 'unreadable') { disk.setFault('decrypt'); manager.init(); }
    const configured = [], constructed = [];
    class Helper {
      constructor(...args) { constructed.push(args); }
      configureProvider(config, key) { configured.push([config.provider, key, config]); }
      configureGateway(config, key) { configured.push(['gateway', key, config]); }
      initModelVersionManager() { return Promise.resolve(); }
      setModel() {} setGenerationPolicy() {} setSttLanguage() {} setAiResponseLanguage() {}
    }
    const ProcessingHelper = processingHelperClass(manager, Helper, { env: { ...ENV_KEYS } });
    new ProcessingHelper({ getIntelligenceManager: () => ({ initializeLLMs() {} }) }).loadStoredCredentials();
    assert.deepEqual(constructed, [[]], 'LLMHelper is constructed without keys');
    const official = configured.filter(([provider]) => provider !== 'gateway');
    assert.deepEqual(official.map(([provider]) => provider).sort(), [...PROVIDERS].sort(), scenario);
    for (const [provider, key] of official) {
      assert.equal(key || undefined, scenario === 'saved-differs' && provider === 'openai' ? 'synthetic-saved' : undefined, `${scenario} ${provider}`);
    }
    const [, , config] = official.find(([provider]) => provider === 'openai');
    if (scenario === 'saved-differs') { assert.equal(config.protocol, 'responses'); assert.equal(config.model, 'opaque'); }
    const gateways = configured.filter(([provider]) => provider === 'gateway');
    assert.deepEqual(gateways.map(([, key, gateway]) => [key, gateway.baseUrl]), scenario === 'saved-differs' ? [['synthetic-gateway', 'https://custom.invalid/v1']] : []);
  }
});

const CLIENT_FIELDS = { gemini: ['client', 'apiKey'], groq: ['groqClient', 'groqApiKey'], openai: ['openaiClient', 'openaiApiKey'],
  claude: ['claudeClient', 'claudeApiKey'], deepseek: ['deepseekClient', 'deepseekApiKey'] };
const ADDRESS_VARIABLES = ['OPENAI_BASE_URL', 'GROQ_BASE_URL', 'ANTHROPIC_BASE_URL', 'GOOGLE_GEMINI_BASE_URL'];
const ANSWER_APPLY_WARNING = 'Saved, but the running service could not fully apply the change. Try restarting the application; if the problem persists, check the configuration.';

// A freshly loaded built LLMHelper (userData in a temporary directory) with official address variables cleared.
// cleanup() scrubs every instance, restores the variables and removes the directory.
function realAnswerRuntime() {
  const os = require('node:os');
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'answer-runtime-'));
  const electronId = require.resolve('electron'), cachedElectron = require.cache[electronId];
  const built = require.resolve('../../../dist-electron/electron/LLMHelper.js'), cachedHelper = require.cache[built];
  delete require.cache[built];
  require.cache[electronId] = { id: electronId, filename: electronId, loaded: true, exports: { app: { getPath: () => userData, isPackaged: true } } };
  let Base;
  try { ({ LLMHelper: Base } = require(built)); }
  finally {
    if (cachedElectron) require.cache[electronId] = cachedElectron; else delete require.cache[electronId];
    if (cachedHelper) require.cache[built] = cachedHelper; else delete require.cache[built];
  }
  const instances = [];
  class LLMHelper extends Base { constructor() { super(); instances.push(this); } }
  const previous = Object.fromEntries(ADDRESS_VARIABLES.map(name => [name, process.env[name]]));
  for (const name of ADDRESS_VARIABLES) delete process.env[name];
  return { LLMHelper, cleanup() {
    for (const helper of instances) helper.scrubKeys();
    for (const [name, value] of Object.entries(previous)) if (value === undefined) delete process.env[name]; else process.env[name] = value;
    fs.rmSync(userData, { recursive: true, force: true });
  } };
}

// Real ProcessingHelper over the manager and LLMHelper class; the model-list manager is replaced by an async recorder.
function startAnswerRuntime(manager, LLMHelper, appState, calls = []) {
  const processing = new (processingHelperClass(manager, LLMHelper, process))(appState);
  appState.processingHelper = processing;
  processing.getLLMHelper().initModelVersionManager = async () => { calls.push('initModelVersionManager'); };
  processing.loadStoredCredentials();
  return processing.getLLMHelper();
}

// The production answer operations of ProcessingHelper over a real manager and an LLMHelper stand-in, each call recorded in order.
function answerOperations(manager, llm, appState, calls = []) {
  class Helper { constructor() { return llm; } }
  const processing = new (processingHelperClass(manager, Helper, { env: {} }))(appState);
  for (const name of ['applyStoredProvider', 'applyStoredGateway', 'refreshAnswerRuntime']) {
    const operation = processing[name].bind(processing);
    processing[name] = (...args) => { calls.push([name, ...args]); return operation(...args); };
  }
  appState.processingHelper = processing;
  return calls;
}

const usable = helper => PROVIDERS.filter(provider => helper[CLIENT_FIELDS[provider][0]] || helper[CLIENT_FIELDS[provider][1]]);

test('real ProcessingHelper construction and startup create no official client from environment keys', () => {
  const runtime = realAnswerRuntime(), { LLMHelper } = runtime;
  const previous = Object.fromEntries(Object.keys(ENV_KEYS).map(name => [name, process.env[name]]));
  try {
    Object.assign(process.env, ENV_KEYS);
    for (const scenario of ['never-saved', 'saved']) {
      const disk = storage();
      if (scenario === 'never-saved') disk.files.set(disk.filename, Buffer.from('cipher:{}'));
      const manager = disk.boot();
      if (scenario === 'saved') assert.equal(manager.setProviderConfiguration({ ...targets.openai, apiKey: 'synthetic-saved' }).ok, true);
      const calls = [];
      const ProcessingHelper = processingHelperClass(manager, LLMHelper, process);
      const processing = new ProcessingHelper({ getIntelligenceManager: () => ({ initializeLLMs() { calls.push('initializeLLMs'); } }) });
      const helper = processing.getLLMHelper();
      assert.deepEqual(usable(helper), [], `${scenario}: construction creates no official client`);
      assert.equal(helper.gatewayClients?.size ?? 0, 0);
      // The real manager would fetch model lists with the key and start a background timer.
      helper.initModelVersionManager = async () => { calls.push('initModelVersionManager'); };
      processing.loadStoredCredentials();
      assert.deepEqual(calls, ['initializeLLMs', 'initModelVersionManager']);
      assert.deepEqual(usable(helper), scenario === 'saved' ? ['openai'] : [], `${scenario}: startup uses only saved keys`);
      if (scenario === 'saved') { assert.equal(helper.openaiApiKey, 'synthetic-saved'); assert.equal(helper.openaiClient.apiKey, 'synthetic-saved'); }
    }
  } finally {
    for (const [name, value] of Object.entries(previous)) if (value === undefined) delete process.env[name]; else process.env[name] = value;
    runtime.cleanup();
  }
});

// Comparable running state: configurations, exact keys, addresses, client availability and gateway clients.
const clientState = client => client ? { apiKey: client.apiKey ?? null, baseURL: client.baseURL ?? null } : null;
const runtimeState = helper => ({
  configurations: plain(helper.providerConfigurations), gateways: plain(helper.gateways ?? {}), blocked: plain(helper.blockedProviders ?? {}),
  keys: Object.fromEntries(PROVIDERS.map(provider => [provider, helper[CLIENT_FIELDS[provider][1]] ?? null])),
  clients: Object.fromEntries(PROVIDERS.map(provider => [provider, clientState(helper[CLIENT_FIELDS[provider][0]])])),
  gatewayClients: Object.fromEntries([...(helper.gatewayClients ?? new Map())].map(([id, client]) => [id, clientState(client)])),
});
const GATEWAY_SAVE = { protocol: 'chat-completions', baseUrl: 'https://custom.invalid/v1', model: 'opaque', apiKey: 'synthetic-gateway' };

test('B answer save entries apply through the shared ProcessingHelper operations in their own order without warnings', async () => {
  const disk = storage(), manager = disk.boot(), calls = [];
  const llm = { configureProvider: (config, key) => calls.push(['configureProvider', config.provider, key]),
    configureGateway: (config, key) => calls.push(['configureGateway', config.id, key]), removeGateway: id => calls.push(['removeGateway', id]),
    setGenerationPolicy: () => calls.push(['setGenerationPolicy']), getCurrentModelSelection: () => 'synthetic-selection' };
  const appState = { getIntelligenceManager: () => ({ resetEngine: () => calls.push(['resetEngine']), initializeLLMs: () => calls.push(['initializeLLMs']) }),
    sendModelChanged: value => calls.push(['sendModelChanged', value]) };
  answerOperations(manager, llm, appState, calls);
  const context = { require: () => ({ CredentialsManager: { getInstance: () => manager } }), appState };
  const refresh = [['refreshAnswerRuntime'], ['resetEngine'], ['initializeLLMs'], ['sendModelChanged', 'synthetic-selection']];
  const run = async (channel, ...args) => {
    calls.length = 0;
    const result = plain(await handler(channel, context)({}, ...args));
    assert.equal(result.ok, true, channel); assert.equal('warning' in result, false, channel);
    return { result, calls: plain(calls) };
  };
  assert.deepEqual((await run('set-provider-configuration', { ...targets.openai, apiKey: 'synthetic-openai' })).calls,
    [['applyStoredProvider', 'openai'], ['configureProvider', 'openai', 'synthetic-openai'], ['setGenerationPolicy'], ...refresh]);
  const created = await run('set-gateway-configuration', GATEWAY_SAVE), id = created.result.gatewayId;
  assert.deepEqual(created.calls, [['applyStoredGateway', id], ['configureGateway', id, 'synthetic-gateway'], ['setGenerationPolicy'], ...refresh]);
  assert.deepEqual((await run('set-provider-preferred-model', 'openai', 'gpt-5.5')).calls,
    [['applyStoredProvider', 'openai'], ['configureProvider', 'openai', 'synthetic-openai'], ['sendModelChanged', 'synthetic-selection']]);
  assert.deepEqual((await run('remove-provider-api-key', 'openai')).calls,
    [['applyStoredProvider', 'openai'], ['configureProvider', 'openai', ''], ...refresh]);
  assert.deepEqual((await run('remove-gateway', id)).calls, [['removeGateway', id], ...refresh]);
  const restarted = disk.boot();
  assert.equal(restarted.getProviderApiKey('openai') || undefined, undefined);
  assert.deepEqual(plain(restarted.getGateways()), {});
});

test('remove-provider-api-key refuses anything but the four answer providers with no storage or runtime change', async () => {
  const disk = storage(), manager = disk.boot(), calls = [];
  assert.equal(manager.setGroqApiKey('synthetic-groq').ok, true);
  const before = plain(manager.getAllCredentials()), cipher = disk.files.get(disk.filename);
  const llm = { configureProvider: () => calls.push('configureProvider'), getCurrentModelSelection: () => 'synthetic' };
  const appState = { getIntelligenceManager: () => ({ resetEngine: () => calls.push('resetEngine'), initializeLLMs: () => calls.push('initializeLLMs') }),
    sendModelChanged: () => calls.push('sendModelChanged') };
  answerOperations(manager, llm, appState, calls);
  const remove = handler('remove-provider-api-key', { require: () => ({ CredentialsManager: { getInstance: () => manager } }), appState });
  for (const provider of ['groq', 'unknown', 'OPENAI', 'constructor', null, { provider: 'openai' }, ['openai'], 1]) {
    assert.deepEqual(plain(await remove({}, provider)), { ok: false, code: 'write_failed', message: 'Credentials could not be saved. The previous credentials were kept.' }, JSON.stringify(provider));
  }
  assert.deepEqual(calls, []);
  assert.deepEqual(plain(manager.getAllCredentials()), before);
  assert.deepEqual(disk.files.get(disk.filename), cipher);
  assert.equal(disk.boot().getGroqApiKey(), 'synthetic-groq');
});

test('remove-provider-api-key with a failed storage write keeps the running key and client', async () => {
  const runtime = realAnswerRuntime();
  try {
    const disk = storage(), manager = disk.boot(), changed = [];
    assert.equal(manager.setProviderConfiguration({ ...targets.openai, apiKey: 'synthetic-openai' }).ok, true);
    const appState = { getIntelligenceManager: () => ({ resetEngine() {}, initializeLLMs() {} }), sendModelChanged: value => changed.push(value) };
    const live = startAnswerRuntime(manager, runtime.LLMHelper, appState);
    const client = live.openaiClient, cipher = disk.files.get(disk.filename);
    assert.equal(client.apiKey, 'synthetic-openai');
    disk.setFault('rename');
    const result = await handler('remove-provider-api-key', { require: () => ({ CredentialsManager: { getInstance: () => manager } }), appState })({}, 'openai');
    assert.equal(result.ok, false); assert.equal(result.code, 'write_failed');
    assert.equal(live.openaiApiKey, 'synthetic-openai'); assert.equal(live.openaiClient, client);
    assert.deepEqual(changed, []);
    assert.deepEqual(disk.files.get(disk.filename), cipher);
    assert.equal(manager.getProviderApiKey('openai'), 'synthetic-openai');
  } finally { runtime.cleanup(); }
});

test('after every answer save or removal the running service equals a cold start from the same saved file', async () => {
  const runtime = realAnswerRuntime();
  try {
    const disk = storage();
    disk.files.set(disk.filename, Buffer.from('cipher:{}'));
    const manager = disk.boot(), changed = [];
    const appState = { getIntelligenceManager: () => ({ resetEngine() {}, initializeLLMs() {} }), sendModelChanged: value => changed.push(value) };
    const live = startAnswerRuntime(manager, runtime.LLMHelper, appState);
    const context = { require: () => ({ CredentialsManager: { getInstance: () => manager } }), appState };
    let gatewayId;
    const steps = [
      ['save openai', () => handler('set-provider-configuration', context)({}, { ...targets.openai, apiKey: 'synthetic-openai' }), () => {
        assert.deepEqual(clientState(live.openaiClient), { apiKey: 'synthetic-openai', baseURL: 'https://api.openai.com/v1' });
      }],
      ['save claude', () => handler('set-provider-configuration', context)({}, { ...targets.claude, apiKey: 'synthetic-claude' }), () => {
        assert.deepEqual(clientState(live.claudeClient), { apiKey: 'synthetic-claude', baseURL: 'https://api.anthropic.com' });
      }],
      ['save gateway', async () => { const result = await handler('set-gateway-configuration', context)({}, GATEWAY_SAVE); gatewayId = result.gatewayId; return result; }, () => {
        assert.deepEqual(clientState(live.gatewayClients.get(gatewayId)), { apiKey: 'synthetic-gateway', baseURL: 'https://custom.invalid/v1' });
      }],
      ['remove openai key', () => handler('remove-provider-api-key', context)({}, 'openai'), () => {
        assert.equal(live.openaiClient, null); assert.equal(live.openaiApiKey, null);
        assert.equal(live.claudeClient.apiKey, 'synthetic-claude'); assert.equal(live.gatewayClients.get(gatewayId).apiKey, 'synthetic-gateway');
      }],
      ['remove gateway', () => handler('remove-gateway', context)({}, gatewayId), () => {
        assert.equal(live.gatewayClients.has(gatewayId), false); assert.deepEqual(plain(live.gateways), {});
        assert.equal(live.claudeClient.apiKey, 'synthetic-claude');
      }],
    ];
    for (const [step, operate, expect] of steps) {
      const before = changed.length;
      const result = plain(await operate());
      assert.equal(result.ok, true, step); assert.equal('warning' in result, false, step);
      assert.equal(changed.length, before + 1, `${step}: windows are told the current selection`);
      expect();
      const cold = startAnswerRuntime(disk.boot(), runtime.LLMHelper, { getIntelligenceManager: () => ({ initializeLLMs() {} }) });
      assert.deepEqual(runtimeState(cold), runtimeState(live), `${step}: running state equals a cold start`);
    }
  } finally { runtime.cleanup(); }
});

test('a committed answer save that cannot be applied returns the new warning without the key', async () => {
  const disk = storage(), manager = disk.boot();
  const id = newGateway(manager).gatewayId;
  const fail = () => { throw Error('synthetic-secret-key rejected'); };
  const appState = { processingHelper: { getLLMHelper: () => ({ setGenerationPolicy() {}, removeGateway: fail, getCurrentModelSelection: () => 'synthetic' }),
    applyStoredProvider: fail, applyStoredGateway: fail, refreshAnswerRuntime() {} }, sendModelChanged() {} };
  const context = { require: () => ({ CredentialsManager: { getInstance: () => manager } }), appState };
  for (const [channel, ...args] of [['remove-provider-api-key', 'openai'], ['set-provider-configuration', { ...targets.openai, apiKey: 'synthetic-secret-key' }],
    ['set-gateway-configuration', { ...GATEWAY_SAVE, apiKey: 'synthetic-secret-key' }], ['set-provider-preferred-model', 'openai', 'gpt-5.5'], ['remove-gateway', id]]) {
    const result = plain(await handler(channel, context)({}, ...args));
    assert.equal(result.ok, true, channel);
    assert.equal(result.warning, ANSWER_APPLY_WARNING, channel);
    assert.doesNotMatch(JSON.stringify(result), /synthetic-secret-key/, channel);
  }
  assert.equal(disk.boot().getProviderApiKey('openai'), 'synthetic-secret-key', 'the save itself was committed');
});

test('a session model follows each answer save by the selection rules and is never reset to the default', async () => {
  const defaultModel = 'llm-target:claude:messages:claude-sonnet-4-6', session = 'llm-target:openai:chat-completions:gpt-5.4';
  for (const [change, operate, expected] of [
    ['another provider', context => handler('set-provider-configuration', context)({}, { ...targets.claude, apiKey: 'synthetic-claude-new' }), session],
    ['the current provider', context => handler('set-provider-configuration', context)({}, { ...targets.openai, protocol: 'responses', apiKey: 'synthetic-openai-new' }),
      'llm-target:openai:responses:gpt-5.4'],
    ['the current provider key removed', context => handler('remove-provider-api-key', context)({}, 'openai'), session],
    ['the preferred model', context => handler('set-provider-preferred-model', context)({}, 'openai', 'gpt-5.5'), 'llm-target:openai:chat-completions:gpt-5.5'],
  ]) {
    const runtime = realAnswerRuntime();
    try {
      const disk = storage(), manager = disk.boot();
      assert.equal(manager.setProviderConfiguration({ ...targets.openai, apiKey: 'synthetic-openai' }).ok, true);
      assert.equal(manager.setProviderConfiguration({ ...targets.claude, apiKey: 'synthetic-claude' }).ok, true);
      assert.equal(manager.setDefaultModel(defaultModel).ok, true);
      const appState = { getIntelligenceManager: () => ({ resetEngine() {}, initializeLLMs() {} }), sendModelChanged() {}, modelSelectorWindowHelper: { hideWindow() {} } };
      const live = startAnswerRuntime(manager, runtime.LLMHelper, appState);
      assert.equal(live.getCurrentModelSelection(), defaultModel);
      const context = { require: () => ({ CredentialsManager: { getInstance: () => manager } }), appState };
      assert.equal((await handler('set-model', context)({}, session)).success, true);
      assert.equal(live.getCurrentModelSelection(), session);
      const selections = [], setModel = live.setModel.bind(live);
      live.setModel = value => { selections.push(value); return setModel(value); };
      const result = plain(await operate(context));
      assert.equal(result.ok, true, change); assert.equal('warning' in result, false, change);
      assert.equal(live.getCurrentModelSelection(), expected, change);
      assert.equal(selections.includes(defaultModel), false, `${change}: no setModel(default)`);
    } finally { runtime.cleanup(); }
  }
});

test('AG24: all active STT key removals discard only after a successful save', async () => {
  for (const provider of ['groq', 'openai', 'soniox']) {
    const channel = ['groq', 'openai'].includes(provider) ? `set-${provider}-stt-api-key` : `set-${provider}-api-key`;
    for (const save of [failure, { ok: true }]) {
      for (const active of [provider, 'none']) {
        let discards = 0;
        const manager = new Proxy({ getSttProvider: () => active }, { get: (target, key) => target[key] ?? (() => save) });
        const result = await handler(channel, {
          require: () => ({ CredentialsManager: { getInstance: () => manager } }),
          appState: { discardSttProviders: () => { discards++; } }, BrowserWindow: { getAllWindows: () => [] },
        })({}, '');
        assert.equal(result.ok, save.ok);
        assert.equal(discards, save.ok && active === provider ? 1 : 0, channel);
      }
    }
  }
});

test('AG24: invalid region or STT endpoint never changes credentials', () => {
  const disk = storage();
  const manager = disk.boot();
  const before = disk.files.get(disk.filename);
  for (const [method, value] of [['setOpenAiSttBaseUrl', 'https://key@other.invalid']]) {
    assert.throws(() => manager[method](value));
    assert.deepEqual(disk.files.get(disk.filename), before);
  }
});

test('AG24: invalid configuration crosses real manager and IPC with no save or runtime change', async () => {
  const disk = storage();
  const manager = disk.boot();
  const before = disk.files.get(disk.filename);
  const memory = plain(manager.getAllCredentials());
  let applies = 0;
  for (const [channel, value] of [['set-openai-stt-base-url', 'https://key@other.invalid'], ['set-stt-provider', 'unknown-provider']]) {
    const result = await handler(channel, {
      require: () => ({ CredentialsManager: { getInstance: () => manager } }),
      appState: { reconfigureSttProvider: () => { applies++; } }, BrowserWindow: { getAllWindows: () => [] },
    })({}, value);
    assert.equal(result.ok, false, channel);
    assert.equal(applies, 0);
    assert.deepEqual(disk.files.get(disk.filename), before);
    assert.deepEqual(plain(manager.getAllCredentials()), memory);
  }
});

test('all saving IPC handlers return storage failure before runtime, events or window side effects', async () => {
  for (const channel of channels) {
    const effects = [];
    const effect = () => { effects.push('runtime'); };
    const manager = new Proxy({}, { get: () => () => failure });
    const llm = new Proxy({}, { get: (_, key) => ['validateGenerationTargets', 'getCodexCliConfig', 'getGroqFastTextMode', 'getCurrentModelSelection'].includes(key)
      ? () => key === 'getCodexCliConfig' ? codexModule.exports.DEFAULT_CODEX_SOURCE_CONFIG : key === 'getCurrentModelSelection' ? 'gpt-5.4' : undefined : effect });
    const appState = {
      processingHelper: { getLLMHelper: () => llm, applyStoredProvider: effect, applyStoredGateway: effect, refreshAnswerRuntime: effect },
      getIntelligenceManager: () => ({ resetEngine: effect, initializeLLMs: effect }),
      reconfigureSttProvider: effect, sendModelChanged: effect,
      modelSelectorWindowHelper: { hideWindow: effect },
      setRecognitionLanguage: () => failure,
    };
    const result = await handler(channel, {
      appState, BrowserWindow: { getAllWindows: () => [{ isDestroyed: () => false, webContents: { send: effect } }] },
      require: () => ({ CredentialsManager: { getInstance: () => manager } }),
    })({}, ...(channel === 'set-provider-preferred-model' ? ['gemini', 'synthetic-model'] : channel === 'remove-provider-api-key' ? ['openai'] : ['synthetic-value']));
    assert.deepEqual(plain(result), failure, channel);
    assert.deepEqual(effects, [], channel);
  }
});

test('ProviderCard stops model Fetch while complete configuration is unsaved', async () => {
  let fetched = false;
  const callback = expression('src/components/settings/ProviderCard.tsx', node => ts.isArrowFunction(node)
    && ts.isVariableDeclaration(node.parent) && node.parent.name.getText() === 'handleFetchModels', {
    dirty: true, hasStoredKey: true, providerId: 'openai', fetchRevision: { current: 0 },
    setBusy() {}, setFetchError() {}, window: { electronAPI: { fetchProviderModels: async () => { fetched = true; return { success: false }; } } },
  });
  await callback();
  assert.equal(fetched, false);
});

test('recognition language applies only after its real manager setter succeeds', () => {
  const source = read('electron/main.ts');
  const ast = ts.createSourceFile('main.ts', source, ts.ScriptTarget.Latest, true);
  const klass = ast.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'AppState');
  const method = klass.members.find(node => node.name?.getText(ast) === 'setRecognitionLanguage').getText(ast);
  for (const save of [failure, { ok: true }]) {
    let effects = 0;
    const module = { exports: {} };
    vm.runInNewContext(compile(`class Subject { ${method} } exports.Subject = Subject;`), {
      exports: module.exports, console: quiet,
      require: () => ({ CredentialsManager: { getInstance: () => ({ setSttLanguage: () => save }) } }),
    });
    const state = new module.exports.Subject();
    Object.assign(state, { googleSTT: { setRecognitionLanguage() { effects++; } },
      processingHelper: { getLLMHelper: () => ({ setSttLanguage() { effects++; } }) } });
    assert.equal(state.setRecognitionLanguage('english-us').ok, save.ok);
    assert.equal(effects, save.ok ? 2 : 0);
  }
});

const apiChannels = {
  setProviderConfiguration: 'set-provider-configuration',
  setAiResponseLanguage: 'set-ai-response-language', removeProviderApiKey: 'remove-provider-api-key',
  setProviderPreferredModel: 'set-provider-preferred-model', setSttProvider: 'set-stt-provider',
  setGroqSttApiKey: 'set-groq-stt-api-key', setOpenAiSttApiKey: 'set-openai-stt-api-key',
  setOpenAiSttBaseUrl: 'set-openai-stt-base-url',
  setGroqSttModel: 'set-groq-stt-model',
  setSonioxApiKey: 'set-soniox-api-key',
  setDefaultModel: 'set-default-model', setRecognitionLanguage: 'set-recognition-language',
};

test('all credential preload callbacks preserve failure, warning and cancellation results', async () => {
  for (const [name, channel] of Object.entries(apiChannels)) {
    for (const result of [failure, { ok: true, warning: 'Synthetic safe warning' }, { cancelled: true }]) {
      const fn = expression('electron/preload.ts', node => ts.isArrowFunction(node) && ts.isPropertyAssignment(node.parent)
        && node.parent.name.getText() === name, { ipcRenderer: { invoke: async (actual) => { assert.equal(actual, channel); return result; } } });
      assert.deepEqual(await fn('synthetic-input'), result, name);
    }
  }
});

function ui(file, name, result, extra = {}) {
  const changes = new Map();
  const context = {
    confirm: () => true, setTimeout: () => 1, t: (text, values = {}) => text.replace(/\{(\w+)\}/g, (match, key) => key in values ? String(values[key]) : match), t: (text, values = {}) => text.replace(/\{(\w+)\}/g, (match, key) => key in values ? String(values[key]) : match),
    providerConfigurations: targets, hasStoredKey: {}, unsaved: false,
    PROVIDER_NAMES: { gemini: 'Gemini', groq: 'Groq', openai: 'OpenAI', claude: 'Claude', deepseek: 'DeepSeek' },
    window: { electronAPI: new Proxy({}, { get: () => async () => result }) },
    availableLanguages: { 'english-us': { group: 'English' } }, sttOpenaiBaseUrl: 'https://synthetic.invalid',
    ...extra,
  };
  // Only dependency setters are faked; the actual production callbacks are compiled and executed.
  const ast = ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  function visit(node) {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text.startsWith('set')) {
      const key = node.expression.text;
      if (!(key in context)) context[key] = value => {
        const previous = changes.has(key) ? changes.get(key) : {};
        changes.set(key, typeof value === 'function' ? value(previous) : value);
      };
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  return { changes, fn: expression(file, node => ts.isArrowFunction(node) && ts.isVariableDeclaration(node.parent)
    && node.parent.name.getText() === name, context) };
}

test('renderer save, remove and selection callbacks retain the previous UI on failure', async () => {
  const overlay = 'src/components/SettingsOverlay.tsx';
  const ai = 'src/components/settings/AIProvidersSettings.tsx';
  const card = 'src/components/settings/ProviderCard.tsx';
  for (const [file, name, args, forbidden] of [
    [ai, 'handleSaveKey', ['openai', 'synthetic-key', () => assert.fail('input was cleared')], ['setHasStoredKey']],
    [ai, 'handleRemoveKey', ['openai', () => assert.fail('input was cleared')], ['setHasStoredKey']],
    [ai, 'handleDefaultModelChange', ['synthetic-model'], ['setDefaultModel']],
    [overlay, 'handleLanguageChange', ['english-us'], ['setRecognitionLanguage', 'setSelectedSttGroup', 'setAutoDetectedLanguage']],
    [overlay, 'handleAiLanguageChange', ['english'], ['setAiResponseLanguage']],
    [overlay, 'handleSttProviderChange', ['groq'], ['setSttProvider']],
    [overlay, 'handleGroqSttModelChange', ['synthetic-model'], ['setGroqSttModel']],
    [overlay, 'handleOpenAiSttBaseUrlSave', [], []],
  ]) {
    const subject = ui(file, name, failure, { providerId: 'openai', onPreferredModelChange: () => assert.fail('selection committed') });
    await subject.fn(...args);
    for (const key of forbidden) assert.equal(subject.changes.has(key), false, name + ': ' + key);
    assert.notEqual(subject.changes.get('setSttSaved'), true, name);
    const saved = subject.changes.get('setSavedStatus');
    assert.ok(!saved || !Object.values(saved).some(Boolean), name);
    assert.ok(subject.changes.get('setCredentialNotice') || subject.changes.get('setFetchError'), name + ': visible failure');
  }
});

test('all three STT Save/Remove callbacks distinguish connection validation from stored keys', async () => {
  const file = 'src/components/SettingsOverlay.tsx';
  for (const provider of ['groq', 'openai', 'soniox']) {
    for (const name of ['handleSttKeySubmit', 'handleRemoveSttKey']) {
      const subject = ui(file, name, failure, { window: { electronAPI: new Proxy({ testSttConnection: async () => ({ success: true }) }, {
        get: (target, key) => target[key] || (async () => failure),
      }) } });
      await subject.fn(provider, 'synthetic-key');
      assert.notEqual(subject.changes.get('setSttSaved'), true, provider);
      assert.ok(![...subject.changes.keys()].some(key => key.startsWith('setHasStored')), provider);
      assert.equal(subject.changes.get('setCredentialNotice'), failure.message, provider);
    }
    let saves = 0;
    const invalid = ui(file, 'handleSttKeySubmit', failure, { window: { electronAPI: new Proxy({ testSttConnection: async () => ({ success: false }) }, {
      get: (target, key) => target[key] || (async () => { saves++; return failure; }),
    }) } });
    await invalid.fn(provider, 'synthetic-key');
    assert.equal(saves, 0, provider + ': invalid key must not be persisted first');
  }
});

test('renderer keeps Saved and displays a safe apply warning', async () => {
  const warning = 'Saved; restart to apply the synthetic configuration.';
  const subject = ui('src/components/settings/AIProvidersSettings.tsx', 'handleSaveKey', { ok: true, warning });
  const result = await subject.fn('openai', 'synthetic-key', () => {});
  assert.equal(result.ok, true);
  assert.equal(subject.changes.get('setSavedStatus').openai, true);
  assert.equal(subject.changes.get('setCredentialNotice'), warning);
});

test('renderer cannot report rollback when default-model refresh fails after a committed configuration save', async () => {
  let cleared = false;
  const subject = ui('src/components/settings/AIProvidersSettings.tsx', 'handleSaveKey', { ok: true }, {
    window: { electronAPI: { setProviderConfiguration: async () => ({ ok: true }),
      getDefaultModel: async () => { throw Error('synthetic refresh failure'); } } },
  });
  assert.equal((await subject.fn('openai', 'synthetic-key', () => { cleared = true; })).ok, true);
  assert.equal(cleared, true);
  assert.equal(subject.changes.get('setSavedStatus').openai, true);
  assert.equal(subject.changes.get('setHasStoredKey').openai, true);
  assert.match(subject.changes.get('setCredentialNotice'), /^Saved;/);
});

test('all four answer-provider Save/Remove branches use their matching endpoint and show failure without clearing input', async () => {
  for (const provider of ['gemini', 'openai', 'claude', 'deepseek']) {
    for (const name of ['handleSaveKey', 'handleRemoveKey']) {
      const calls = [];
      const subject = ui('src/components/settings/AIProvidersSettings.tsx', name, failure, {
        window: { electronAPI: new Proxy({}, { get: (_, key) => async value => { calls.push([key, value]); return failure; } }) },
      });
      const keep = () => assert.fail('failed input was cleared');
      await subject.fn(...(name === 'handleSaveKey' ? [provider, 'synthetic-key', keep] : [provider, keep]));
      assert.deepEqual(plain(calls), name === 'handleSaveKey'
        ? [['setProviderConfiguration', plain({ ...targets[provider], apiKey: 'synthetic-key' })]] : [['removeProviderApiKey', provider]]);
      assert.equal(subject.changes.has('setHasStoredKey'), false);
      assert.equal(subject.changes.get('setCredentialNotice'), failure.message);
    }
  }
});

test('detected-language save failure does not submit an unsaved language selection', async () => {
  const subject = ui('src/components/SettingsOverlay.tsx', 'loadLanguages', failure, {
    navigator: { language: 'en-US' },
    window: { electronAPI: {
      getRecognitionLanguages: async () => ({ 'english-us': { bcp47: 'en-US', iso639: 'en', group: 'English' } }),
      getSttLanguage: async () => '', setRecognitionLanguage: async () => failure,
      getAiResponseLanguages: async () => [], getAiResponseLanguage: async () => 'auto',
    } },
  });
  await subject.fn();
  assert.equal(subject.changes.get('setRecognitionLanguage'), '');
  assert.equal(subject.changes.get('setCredentialNotice'), failure.message);
});

test('Fetch lists models without implicitly selecting or saving the first model', async () => {
  const subject = ui('src/components/settings/ProviderCard.tsx', 'handleFetchModels', failure, {
    providerId: 'openai', hasStoredKey: true, dirty: false,
    fetchRevision: { current: 0 },
    onPreferredModelChange: () => assert.fail('failed model was selected'),
    window: { electronAPI: {
      fetchProviderModels: async () => ({ success: true, models: [{ id: 'synthetic-new-model' }] }),
      setProviderPreferredModel: async () => failure,
    } },
  });
  await subject.fn();
  assert.equal(subject.changes.has('setSelectedModel'), false);
  assert.equal(subject.changes.get('setFetchError'), null);
});

test('storage failures cross the real manager, IPC, preload and renderer without committing live state', async () => {
  for (const fault of ['unavailable', 'encrypt', 'write', 'rename', 'decrypt', 'parse', 'read', 'load-unavailable']) {
    const disk = storage();
    const loading = ['decrypt', 'parse', 'read', 'load-unavailable'].includes(fault);
    if (loading) disk.setFault(fault === 'load-unavailable' ? 'unavailable' : fault);
    const manager = disk.boot();
    disk.setFault(loading ? undefined : fault);
    const before = disk.files.get(disk.filename);
    let effects = 0;
    const appState = { getIntelligenceManager: () => ({ resetEngine() { effects++; }, initializeLLMs() { effects++; } }), sendModelChanged() { effects++; } };
    const operations = answerOperations(manager, { configureProvider() { effects++; }, setGenerationPolicy() { effects++; }, getCurrentModelSelection: () => 'synthetic' }, appState);
    const callback = handler('set-provider-configuration', { require: () => ({ CredentialsManager: { getInstance: () => manager } }), appState });
    const bridge = expression('electron/preload.ts', node => ts.isArrowFunction(node) && ts.isPropertyAssignment(node.parent)
      && node.parent.name.getText() === 'setProviderConfiguration', { ipcRenderer: { invoke: (channel, ...args) => {
        assert.equal(channel, 'set-provider-configuration'); return callback({}, ...args);
      } } });
    const subject = ui('src/components/settings/AIProvidersSettings.tsx', 'handleSaveKey', failure, {
      window: { electronAPI: { setProviderConfiguration: bridge } },
    });
    const result = await subject.fn('openai', 'synthetic-new', () => assert.fail('failed input was cleared'));
    assert.equal(result.ok, false, fault);
    assert.equal(effects, 0, fault);
    assert.deepEqual(operations, [], fault);
    assert.deepEqual(disk.files.get(disk.filename), before, fault);
    assert.equal(subject.changes.has('setHasStoredKey'), false, fault);
    assert.equal(subject.changes.get('setSavedStatus').openai, false, fault);
    assert.equal(subject.changes.get('setCredentialNotice'), result.message, fault);
  }
});

test('a decrypt failure reaches settings, and only a confirmed discard crosses IPC and preload', async () => {
  const disk = storage();
  disk.setFault('decrypt');
  const manager = disk.boot();
  disk.setFault(undefined);
  const original = disk.files.get(disk.filename);
  const context = { require: () => ({ CredentialsManager: { getInstance: () => manager } }) };
  const handlers = { 'credentials-load-status': handler('credentials-load-status', context), 'credentials-discard-unreadable': handler('credentials-discard-unreadable', context) };
  const bridge = name => expression('electron/preload.ts', node => ts.isArrowFunction(node) && ts.isPropertyAssignment(node.parent)
    && node.parent.name.getText() === name, { ipcRenderer: { invoke: (channel, ...args) => handlers[channel]({}, ...args) } });
  const electronAPI = { getCredentialLoadStatus: bridge('getCredentialLoadStatus'), discardUnreadableCredentials: bridge('discardUnreadableCredentials') };
  const status = await electronAPI.getCredentialLoadStatus();
  assert.equal(status.code, 'decrypt_failed');
  assert.equal(status.canDiscard, true);

  const declined = ui('src/components/settings/CredentialLoadBanner.tsx', 'discard', undefined, { confirm: () => false, window: { electronAPI } });
  await declined.fn();
  assert.deepEqual(disk.files.get(disk.filename), original, 'declining the confirmation changes nothing');
  assert.equal(declined.changes.size, 0);

  const confirmed = ui('src/components/settings/CredentialLoadBanner.tsx', 'discard', undefined, { window: { electronAPI } });
  await confirmed.fn();
  assert.equal(disk.files.has(disk.filename), false);
  assert.deepEqual(plain(confirmed.changes.get('setStatus')), { ok: true });
  assert.match(confirmed.changes.get('setResult'), /backed up as credentials\.enc\.unreadable-/);
  assert.deepEqual(plain(await electronAPI.getCredentialLoadStatus()), { ok: true });

  const again = ui('src/components/settings/CredentialLoadBanner.tsx', 'discard', undefined, { window: { electronAPI } });
  await again.fn();
  assert.equal(again.changes.get('setResult'), 'There are no unreadable credentials to discard.');
  assert.equal(again.changes.has('setStatus'), false);
});

test('AG-41a: CredentialsManager.getSttProvider() returns none for all retired providers', () => {
  const disk = storage();
  const manager = disk.boot();
  for (const retired of ['google', 'deepgram', 'elevenlabs', 'azure', 'ibmwatson', 'local-whisper']) {
    // Simulate pre-existing / migrated stored value on disk
    manager.credentials.sttProvider = retired;
    assert.equal(manager.getSttProvider(), 'none', `stored provider '${retired}' should resolve to 'none'`);
  }
});

test('S44 per-target reasoning saves through the real handler, survives restart, reaches the wire and is never silently stripped', async () => {
  const http = await import('node:http');
  const os = await import('node:os');
  const electronId = require.resolve('electron'), cached = require.cache[electronId];
  require.cache[electronId] = { id: electronId, filename: electronId, loaded: true, exports: { app: { getPath: () => fs.mkdtempSync(path.join(os.tmpdir(), 's44-reasoning-')), isPackaged: false } } };
  let LLMHelper;
  try { ({ LLMHelper } = require('../../../dist-electron/electron/LLMHelper.js')); }
  finally { if (cached) require.cache[electronId] = cached; else delete require.cache[electronId]; }
  const bodies = [];
  const server = http.createServer(async (req, res) => {
    let body = ''; for await (const part of req) body += part;
    const payload = JSON.parse(body); bodies.push(payload);
    if (payload.stream) {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      for (const event of [{ choices: [{ delta: { content: 'ANSWER' } }] }, { choices: [{ delta: {}, finish_reason: 'stop' }] }]) res.write(`data: ${JSON.stringify(event)}\n\n`);
      res.end(); return;
    }
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ choices: [{ message: { content: 'ANSWER' }, finish_reason: 'stop' }] }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}/v1`;
    const disk = storage(), manager = disk.boot(), helper = new LLMHelper();
    helper.getProviderScopePolicy = () => ({});
    const appState = { sendModelChanged() {}, getIntelligenceManager: () => ({ resetEngine() {}, initializeLLMs() {} }) };
    answerOperations(manager, helper, appState);
    const context = { require: () => ({ CredentialsManager: { getInstance: () => manager } }), appState };
    const save = handler('set-gateway-configuration', context);
    const created = await save({}, { protocol: 'chat-completions', baseUrl: base, model: 'opaque', contextWindowTokens: 4096, apiKey: 'synthetic-only' });
    assert.equal(created.ok, true);
    const id = created.gatewayId, gateway = { id, protocol: 'chat-completions', baseUrl: base, model: 'opaque', contextWindowTokens: 4096 };
    const invoke = (_event, value) => save({}, value);
    // Saved without a reasoning field: the request keeps its default shape.
    helper.setModel(`llm-gateway:${id}:chat-completions:opaque`);
    assert.equal(await helper.chat('LEGACY'), 'ANSWER');
    for (const field of ['reasoning_effort', 'thinking', 'reasoning']) assert.equal(Object.hasOwn(bodies.at(-1), field), false);

    assert.equal((await invoke({}, { ...gateway, reasoning: { effort: 'high' } })).ok, true);
    assert.deepEqual(plain(disk.boot().getGateways()[id]), { ...gateway, reasoning: { effort: 'high' } });
    assert.equal(await helper.chat('SAVED'), 'ANSWER');
    assert.equal(bodies.at(-1).reasoning_effort, 'high');
    assert.equal(await helper.testProviderConnection({ gatewayId: id }), 'ANSWER');
    assert.equal(bodies.at(-1).reasoning_effort, 'high', 'the connection test sends the saved target as configured');

    const stored = disk.files.get(disk.filename);
    for (const reasoning of [{ thinking: 'enabled' }, { effort: 'turbo' }, { effort: 'high', budget: 1024 }]) {
      assert.equal((await invoke({}, { ...gateway, reasoning })).ok, false);
      assert.deepEqual(disk.files.get(disk.filename), stored);
    }
    // Known official target: only the documented values for this exact model.
    assert.throws(() => manager.setProviderConfiguration({ provider: 'openai', protocol: 'responses', model: 'gpt-5.4', reasoning: { effort: 'minimal' }, apiKey: 'synthetic-only' }), /not available/);
    assert.throws(() => manager.setProviderConfiguration({ provider: 'openai', protocol: 'responses', model: 'gpt-5.4', contextWindowTokens: 1, apiKey: 'synthetic-only' }), /gateway/);
    assert.deepEqual(disk.files.get(disk.filename), stored);
    assert.equal(await helper.chat('AFTER REFUSAL'), 'ANSWER');
    assert.equal(bodies.at(-1).reasoning_effort, 'high');

    // A different model of the same provider does not inherit the configured model's setting.
    helper.setModel(`llm-gateway:${id}:chat-completions:other-model`);
    assert.equal(await helper.chat('OTHER'), 'ANSWER');
    assert.equal(bodies.at(-1).model, 'other-model');
    assert.equal(Object.hasOwn(bodies.at(-1), 'reasoning_effort'), false);
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});

test('S45 Save and test checks the exact saved target before any send, and gateway errors never reflect the key', async () => {
  const disk = storage(), manager = disk.boot();
  const { gatewayId: id } = newGateway(manager, { apiKey: 'synthetic-secret-key' });
  const calls = [];
  const context = { require: () => ({ CredentialsManager: { getInstance: () => manager } }),
    appState: { processingHelper: { getLLMHelper: () => ({ testProviderConnection: async target => { calls.push(target); if (calls.length === 2) throw Error('bad key synthetic-secret-key rejected'); return 'ANSWER'; } }) } } };
  const testGateway = handler('test-gateway-connection', context), testOfficial = handler('test-llm-connection', context);
  const saved = { id, protocol: 'chat-completions', baseUrl: 'https://custom.invalid/v1', model: 'primary' };
  const stale = await testGateway({}, id, { ...saved, model: 'older' });
  assert.equal(stale.success, false); assert.match(stale.error, /changed/); assert.equal(calls.length, 0, 'a stale target is never sent');
  assert.deepEqual(plain(await testGateway({}, id, { ...saved, baseUrl: 'https://custom.invalid/v1/' })), { success: true });
  const failed = await testGateway({}, id, saved);
  assert.equal(failed.success, false); assert.doesNotMatch(failed.error, /synthetic-secret-key/);
  assert.deepEqual(plain(calls), [{ gatewayId: id }, { gatewayId: id }]);
  assert.match((await testGateway({}, 'gw-missing', saved)).error, /no longer exists/);
  assert.equal((await testOfficial({}, 'openai', undefined, { ...targets.openai, model: 'other' })).success, false);
  assert.match((await testOfficial({}, 'groq')).error, /Groq is not available/);
  assert.equal(calls.length, 2);
});

test('S45 gateway save and removal handlers apply only after a committed write and leave official runtime alone', async () => {
  const disk = storage(), manager = disk.boot(), effects = [];
  const helper = { configureGateway: (config, key) => effects.push(['gateway', config.id, key]), removeGateway: id => effects.push(['remove', id]),
    configureProvider: () => effects.push(['official']), setGenerationPolicy() {}, getCurrentModelSelection: () => 'synthetic' };
  const appState = { sendModelChanged() {}, getIntelligenceManager: () => ({ resetEngine() {}, initializeLLMs() {} }) };
  answerOperations(manager, helper, appState);
  const context = { require: () => ({ CredentialsManager: { getInstance: () => manager } }), appState };
  const save = handler('set-gateway-configuration', context), remove = handler('remove-gateway', context);
  const value = { protocol: 'messages', baseUrl: 'https://custom.invalid', model: 'opaque', apiKey: 'synthetic-gateway' };
  disk.setFault('rename');
  assert.equal((await save({}, value)).ok, false); assert.deepEqual(effects, []);
  disk.setFault(undefined);
  const created = await save({}, value);
  assert.equal(created.ok, true);
  assert.deepEqual(effects, [['gateway', created.gatewayId, 'synthetic-gateway']]);
  assert.equal((await remove({}, created.gatewayId)).ok, true);
  assert.deepEqual(effects.at(-1), ['remove', created.gatewayId]);
  assert.equal(effects.some(([kind]) => kind === 'official'), false);
  assert.equal(disk.boot().getProviderApiKey('openai'), 'synthetic-old');
});
