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
const capabilityModule = { exports: {} };
vm.runInNewContext(compile(read('src/types/modelCapabilities.ts')), { module: capabilityModule, exports: capabilityModule.exports, URL });
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
  // S47: replacing the primary's model is a removal of a used candidate; it is refused rather than followed onto the backup.
  const replaced = manager.setProviderConfiguration({ ...targets.openai, model: 'backup' });
  assert.equal(replaced.ok, false); assert.match(replaced.message, /primary, backup or current answer model/);
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
        if (id === '../../src/types/modelCapabilities') return capabilityModule.exports;
        if (id === '../llm/answerReasoning') return require('../../../dist-electron/electron/llm/answerReasoning.js');
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
  answerOperations(manager, { configureProvider: apply, setSavedReasoning: apply, setGenerationPolicy: apply, getCurrentModelSelection: () => 'synthetic' }, appState);
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
  assert.equal(effects.length, 6);
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
    setGatewayConfiguration: 'gateways', setSavedReasoning: 'answerReasoning',
  };
  assert.equal(names.length, 20);
  assert.deepEqual(names.sort(), Object.keys(fields).sort());
  for (const name of names) {
    const before = plain(manager.getAllCredentials());
    disk.setFault('write');
    const args = name === 'setGenerationPolicy' ? [{ interviewFirstTokenSeconds: 12, interviewTotalSeconds: 75, writtenTotalSeconds: 190 }] : name === 'setProviderConfiguration' ? [{ ...targets.openai, protocol: 'responses', model: 'opaque', models: [{ model: 'gpt-5.4' }], apiKey: 'synthetic-old' }] : name === 'setGatewayConfiguration' ? [{ protocol: 'responses', baseUrl: 'https://synthetic.invalid/v1', model: 'opaque', apiKey: 'synthetic-gateway' }] : name === 'setDefaultModel' ? ['gpt-5.4'] : name === 'setSavedReasoning' ? [targetModule.exports.modelTargetId(manager.resolveSelection(manager.getDefaultModel())), 'high'] : name === 'setPreferredModel' ? ['gemini', 'synthetic-model'] : [name === 'setSttProvider' ? 'groq' : name === 'setOpenAiSttBaseUrl' ? 'https://synthetic.invalid/v1' : 'synthetic-value'];
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
      persistCredentials, discardRemovedSttKey, LLM_PRESETS: targets, modelTargetId: targetModule.exports.modelTargetId, providerCandidates: targetModule.exports.providerCandidates,
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
  answerOperations(manager, { configureProvider: (...args) => applied.push(args), setSavedReasoning() {}, setGenerationPolicy() {},
    getCurrentModelSelection: () => 'llm-target:openai:responses:opaque' }, appState);
  const invoke = handler('set-provider-configuration', { require: () => ({ CredentialsManager: { getInstance: () => manager } }), appState });
  // S47: dropping the default's model is refused with no storage, runtime or broadcast change.
  const refused = await invoke({}, value);
  assert.equal(refused.ok, false); assert.match(refused.message, /is used as the primary, backup or current answer model/);
  assert.deepEqual(applied, []); assert.deepEqual(broadcast, []);
  assert.deepEqual(disk.files.get(disk.filename), previous);
  value.models = [{ model: 'gpt-5.4' }];
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
  assert.deepEqual(plain(config), { provider: 'openai', protocol: 'responses', model: 'opaque', models: [{ model: 'gpt-5.4' }] });
  assert.equal(restarted.getProviderApiKey('openai'), 'synthetic-new');
  assert.equal(restarted.getDefaultModel(), 'llm-target:openai:responses:gpt-5.4', 'the kept default model moves with the protocol only');
  assert.equal(restarted.setProviderConfiguration({ ...targets.claude, model: 'other-slot' }).ok, true);
  assert.equal(restarted.getDefaultModel(), 'llm-target:openai:responses:gpt-5.4', 'another slot cannot change the selected default');
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
      validateGenerationTargets() {}, getCodexCliConfig: () => codexModule.exports.DEFAULT_CODEX_SOURCE_CONFIG, getGroqFastTextMode: () => false,
      setSavedReasoning() {}, reconcileSessionReasoning: () => undefined }) },
      sendModelChanged: value => events.push(value), modelSelectorWindowHelper: { hideWindow: () => events.push('hide') } },
  };
  assert.deepEqual(plain(await handler('get-default-model', context)({})), { model: 'llm-target:gemini:gemini:gemini-3.1-flash-lite' });
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
      setModel() {} setGenerationPolicy() {} setSavedReasoning() {} setSttLanguage() {} setAiResponseLanguage() {}
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
    setGenerationPolicy: () => calls.push(['setGenerationPolicy']), setSavedReasoning: saved => calls.push(['setSavedReasoning', saved]), getCurrentModelSelection: () => 'synthetic-selection' };
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
    [['applyStoredProvider', 'openai'], ['configureProvider', 'openai', 'synthetic-openai'], ['setSavedReasoning', { choice: 'default' }], ['setGenerationPolicy'], ...refresh]);
  const created = await run('set-gateway-configuration', GATEWAY_SAVE), id = created.result.gatewayId;
  assert.deepEqual(created.calls, [['applyStoredGateway', id], ['configureGateway', id, 'synthetic-gateway'], ['setGenerationPolicy'], ...refresh]);
  assert.deepEqual((await run('set-provider-preferred-model', 'openai', 'gpt-5.5')).calls,
    [['applyStoredProvider', 'openai'], ['configureProvider', 'openai', 'synthetic-openai'], ['setSavedReasoning', { choice: 'default' }], ['sendModelChanged', 'synthetic-selection']]);
  assert.deepEqual((await run('remove-provider-api-key', 'openai')).calls,
    [['applyStoredProvider', 'openai'], ['configureProvider', 'openai', ''], ['setSavedReasoning', { choice: 'default' }], ...refresh]);
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
  for (const [change, operate, expected, saved = true] of [
    ['another provider', context => handler('set-provider-configuration', context)({}, { ...targets.claude, apiKey: 'synthetic-claude-new' }), session],
    ['the current provider', context => handler('set-provider-configuration', context)({}, { ...targets.openai, protocol: 'responses', apiKey: 'synthetic-openai-new' }),
      'llm-target:openai:responses:gpt-5.4'],
    ['the current provider key removed', context => handler('remove-provider-api-key', context)({}, 'openai'), session],
    // S47: replacing the session's model is refused; the session stays on it.
    ['the preferred model', context => handler('set-provider-preferred-model', context)({}, 'openai', 'gpt-5.5'), session, false],
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
      const before = plain(manager.getAllCredentials());
      const result = plain(await operate(context));
      assert.equal(result.ok, saved, change); assert.equal('warning' in result, false, change);
      if (!saved) assert.deepEqual(plain(manager.getAllCredentials()), before, `${change}: nothing stored`);
      assert.equal(live.getCurrentModelSelection(), expected, change);
      assert.equal(selections.includes(defaultModel), false, `${change}: no setModel(default)`);
    } finally { runtime.cleanup(); }
  }
});

// S47: several saved candidates under one official key.
const OPENAI_IMAGE = model => JSON.stringify(['openai', 'chat-completions', 'https://api.openai.com/v1', model]);
// S48: candidates carry no reasoning or image setting of their own; both come from the answer model choice and the capability table.
const TWO_CANDIDATES = { provider: 'openai', protocol: 'chat-completions', model: 'model-a', models: [{ model: 'model-b' }] };
const sessionAppState = () => ({ getIntelligenceManager: () => ({ resetEngine() {}, initializeLLMs() {} }), sendModelChanged() {}, modelSelectorWindowHelper: { hideWindow() {} } });

test('S47 a legacy single-model configuration reads unchanged as one candidate; S48 its older settings never reach the resolved target', () => {
  const disk = storage();
  const legacy = { provider: 'openai', protocol: 'chat-completions', model: 'legacy-model', reasoning: { effort: 'medium' }, imageSupportConfirmedFor: OPENAI_IMAGE('legacy-model') };
  disk.files.set(disk.filename, Buffer.from('cipher:' + JSON.stringify({ openaiApiKey: 'synthetic-old', providerConfigurations: { openai: legacy }, defaultModel: 'llm-target:openai:chat-completions:legacy-model' })));
  const manager = disk.boot();
  assert.deepEqual(plain(manager.getProviderConfigurations().openai), legacy, 'no candidate list is invented');
  assert.deepEqual(plain(targetModule.exports.providerCandidates(manager.getProviderConfigurations().openai)),
    [{ model: 'legacy-model', reasoning: { effort: 'medium' }, imageSupportConfirmedFor: OPENAI_IMAGE('legacy-model') }]);
  // The older reasoning becomes the pending saved default for this one target (S48 C4); the older image confirmation no longer counts.
  assert.deepEqual(plain(manager.resolveSelection(manager.getDefaultModel())), { provider: 'openai', protocol: 'chat-completions', model: 'legacy-model' });
  assert.deepEqual(plain(manager.getSavedReasoning()), { legacy: { effort: 'medium' }, target: 'llm-target:openai:chat-completions:legacy-model' });
  assert.equal(manager.getProviderApiKey('openai'), 'synthetic-old');
});

test('S47 two candidates resolve to themselves through save, cold start and the wire; S48 they send no per-model reasoning', async () => {
  const http = await import('node:http');
  const os = await import('node:os');
  const electronId = require.resolve('electron'), cached = require.cache[electronId];
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 's47-candidates-'));
  const built = require.resolve('../../../dist-electron/electron/LLMHelper.js'), cachedHelper = require.cache[built];
  delete require.cache[built];
  // The development loopback hook reads app.isPackaged at request time, so the stub stays until the end.
  require.cache[electronId] = { id: electronId, filename: electronId, loaded: true, exports: { app: { getPath: () => userData, isPackaged: false } } };
  let LLMHelper;
  try { ({ LLMHelper } = require(built)); }
  finally { if (cachedHelper) require.cache[built] = cachedHelper; else delete require.cache[built]; }
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
  const previousBase = process.env.MARGIN_DEV_OPENAI_BASE_URL;
  const helpers = [];
  try {
    process.env.MARGIN_DEV_OPENAI_BASE_URL = `http://127.0.0.1:${server.address().port}/v1`;
    const disk = storage(), manager = disk.boot();
    const start = store => { const helper = new LLMHelper(); helpers.push(helper); helper.getProviderScopePolicy = () => ({});
      helper.initModelVersionManager = async () => {};
      const appState = sessionAppState(); answerOperations(store, helper, appState); appState.processingHelper.loadStoredCredentials(); return { helper, appState }; };
    const { helper, appState } = start(manager);
    const context = { require: () => ({ CredentialsManager: { getInstance: () => manager } }), appState };
    assert.equal(plain(await handler('set-provider-configuration', context)({}, { ...TWO_CANDIDATES, apiKey: 'synthetic-openai' })).ok, true);
    const a = 'llm-target:openai:chat-completions:model-a', b = 'llm-target:openai:chat-completions:model-b';
    const expected = {
      [a]: { provider: 'openai', protocol: 'chat-completions', model: 'model-a' },
      [b]: { provider: 'openai', protocol: 'chat-completions', model: 'model-b' },
    };
    const cold = disk.boot();
    assert.deepEqual(plain(cold.getProviderConfigurations().openai), TWO_CANDIDATES, 'stored exactly as saved');
    for (const [id, target] of Object.entries(expected)) {
      assert.deepEqual(plain(manager.resolveSelection(id)), target, `${id} immediately after save`);
      assert.deepEqual(plain(cold.resolveSelection(id)), target, `${id} after cold start`);
    }
    assert.deepEqual(plain(manager.resolveSelection('llm-target:openai:chat-completions:model-c')), { provider: 'openai', protocol: 'chat-completions', model: 'model-c' });
    const { helper: coldHelper } = start(cold);
    for (const runtime of [helper, coldHelper]) {
      for (const [id, target] of Object.entries(expected)) {
        runtime.setModel(id);
        assert.deepEqual(plain(runtime.selectedTarget), target);
        const before = bodies.length;
        assert.equal(await runtime.chat('QUESTION'), 'ANSWER');
        assert.equal(bodies.length, before + 1, 'one send');
        assert.equal(bodies.at(-1).model, target.model, 'wire model is the candidate itself');
        // Unlisted models (and the development endpoint) only offer the provider default: no reasoning field at all.
        assert.equal('reasoning_effort' in bodies.at(-1), false); assert.equal('thinking' in bodies.at(-1), false);
      }
      const before = bodies.length;
      assert.equal(await runtime.testProviderConnection('openai', 'model-b'), 'ANSWER');
      assert.equal(bodies.length, before + 1); assert.equal(bodies.at(-1).model, 'model-b'); assert.equal('reasoning_effort' in bodies.at(-1), false);
      await assert.rejects(() => runtime.testProviderConnection('openai', 'model-c'), /not a saved candidate/);
      assert.equal(bodies.length, before + 1, 'an unsaved model is never tested');
    }
  } finally {
    for (const helper of helpers) helper.scrubKeys();
    if (previousBase === undefined) delete process.env.MARGIN_DEV_OPENAI_BASE_URL; else process.env.MARGIN_DEV_OPENAI_BASE_URL = previousBase;
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    if (cached) require.cache[electronId] = cached; else delete require.cache[electronId];
    fs.rmSync(userData, { recursive: true, force: true });
  }
});

test('S47 malformed, unknown-typed or repeated candidates are refused at the manager and IPC with nothing stored', async () => {
  const disk = storage(), manager = disk.boot();
  assert.equal(manager.setProviderConfiguration({ ...TWO_CANDIDATES, apiKey: 'synthetic-openai' }).ok, true);
  const stored = disk.files.get(disk.filename), memory = plain(manager.getAllCredentials());
  let applied = 0;
  const appState = { processingHelper: { getLLMHelper: () => ({ getCurrentModelSelection: () => 'synthetic', setGenerationPolicy() {} }), applyStoredProvider: () => { applied++; }, refreshAnswerRuntime() {} } };
  const context = { require: () => ({ CredentialsManager: { getInstance: () => manager } }), appState };
  for (const models of ['model-b', {}, [null], [['model-b']], [{}], [{ model: '' }], [{ model: 'bad\nid' }], [{ model: 7 }], [{ model: 'model-a' }],
    [{ model: 'model-b' }, { model: 'model-b' }], [{ model: 'model-b', reasoning: { effort: 'turbo' } }], [{ model: 'model-b', reasoning: { budget: 1 } }],
    [{ model: 'model-b', imageSupportConfirmedFor: true }]]) {
    assert.throws(() => manager.setProviderConfiguration({ ...TWO_CANDIDATES, models }), undefined, JSON.stringify(models));
    const result = plain(await handler('set-provider-configuration', context)({}, { ...TWO_CANDIDATES, models }));
    assert.equal(result.ok, false, JSON.stringify(models));
    assert.deepEqual(disk.files.get(disk.filename), stored); assert.deepEqual(plain(manager.getAllCredentials()), memory);
  }
  assert.equal(applied, 0, 'nothing reached the runtime');
  // An image confirmation for another target is not kept for this candidate (same rule as the first model).
  assert.equal(manager.setProviderConfiguration({ ...TWO_CANDIDATES, models: [{ model: 'model-b', imageSupportConfirmedFor: OPENAI_IMAGE('model-a') }] }).ok, true);
  assert.deepEqual(plain(manager.getProviderConfigurations().openai.models), [{ model: 'model-b' }]);
});

test('S47 adding candidates never changes the primary, backup or session model; a used candidate is not removed until switched', async () => {
  const runtime = realAnswerRuntime();
  try {
    const disk = storage(), manager = disk.boot();
    const id = model => `llm-target:openai:chat-completions:${model}`;
    const three = { ...TWO_CANDIDATES, models: [...TWO_CANDIDATES.models, { model: 'model-c' }] };
    assert.equal(manager.setProviderConfiguration({ ...three, apiKey: 'synthetic-openai' }).ok, true);
    assert.equal(manager.setDefaultModel(id('model-a')).ok, true);
    assert.equal(manager.setGenerationPolicy({ ...manager.getGenerationPolicy(), backupModel: id('model-b') }).ok, true);
    const appState = sessionAppState();
    const live = startAnswerRuntime(manager, runtime.LLMHelper, appState);
    const context = { require: () => ({ CredentialsManager: { getInstance: () => manager } }), appState };
    const save = handler('set-provider-configuration', context);
    assert.equal((await handler('set-model', context)({}, id('model-c'))).success, true);
    const selections = [], setModel = live.setModel.bind(live);
    live.setModel = value => { selections.push(value); return setModel(value); };
    const state = () => ({ primary: manager.getDefaultModel(), backup: manager.getGenerationPolicy().backupModel, session: live.getCurrentModelSelection(),
      runtimeBackup: live.getGenerationPolicy().backupModel });
    const unchanged = { primary: id('model-a'), backup: id('model-b'), session: id('model-c'), runtimeBackup: id('model-b') };
    assert.deepEqual(state(), unchanged);

    const four = { ...three, models: [...three.models, { model: 'model-d' }] };
    assert.equal(plain(await save({}, four)).ok, true);
    assert.deepEqual(state(), unchanged, 'adding a candidate changes no selection');
    assert.deepEqual(selections, [], 'no setModel at all');
    assert.equal(manager.getProviderConfigurations().openai.models.length, 3);

    for (const [used, list] of [['model-a', [{ model: 'model-b' }, { model: 'model-c' }, { model: 'model-d' }]],
      ['model-b', [{ model: 'model-a' }, { model: 'model-c' }, { model: 'model-d' }]], ['model-c', [{ model: 'model-a' }, { model: 'model-b' }, { model: 'model-d' }]]]) {
      const stored = disk.files.get(disk.filename), running = runtimeState(live);
      const result = plain(await save({}, targetModule.exports.withCandidates(four, list)));
      assert.equal(result.ok, false, used); assert.match(result.message, /removed from this provider is used as the primary, backup or current answer model/);
      assert.deepEqual(disk.files.get(disk.filename), stored, `${used}: storage unchanged`);
      assert.deepEqual(runtimeState(live), running, `${used}: runtime unchanged`);
      assert.deepEqual(state(), unchanged);
    }
    // The old single-model replacement entry is guarded the same way.
    assert.equal(plain(await handler('set-provider-preferred-model', context)({}, 'openai', 'model-z')).ok, false);
    assert.deepEqual(state(), unchanged);

    // After switching the session elsewhere the candidate can be removed; nothing else moves.
    assert.equal((await handler('set-model', context)({}, id('model-d'))).success, true);
    assert.equal(plain(await save({}, targetModule.exports.withCandidates(four, providerCandidatesOf(four).filter(item => item.model !== 'model-c')))).ok, true);
    assert.deepEqual(state(), { ...unchanged, session: id('model-d') });
    assert.deepEqual(plain(disk.boot().getProviderConfigurations().openai.models.map(item => item.model)), ['model-b', 'model-d']);

    // A failed write changes neither storage nor runtime.
    const stored = disk.files.get(disk.filename), running = runtimeState(live);
    disk.setFault('rename');
    assert.equal(plain(await save({}, { ...four, models: [...four.models.filter(item => item.model !== 'model-c'), { model: 'model-e' }] })).ok, false);
    disk.setFault(undefined);
    assert.deepEqual(disk.files.get(disk.filename), stored); assert.deepEqual(runtimeState(live), running);

    // Removing the key keeps every candidate configuration and touches no other provider.
    assert.equal(plain(await handler('remove-provider-api-key', context)({}, 'openai')).ok, true);
    assert.deepEqual(plain(disk.boot().getProviderConfigurations().openai.models.map(item => item.model)), ['model-b', 'model-d']);
    assert.equal(live.openaiClient, null);
    assert.equal(selections.includes(manager.getDefaultModel()), false, 'never reset to the default');
  } finally { runtime.cleanup(); }
});

const providerCandidatesOf = config => targetModule.exports.providerCandidates(config);

test('S47 answer model options list every saved candidate once, keep provider identity and hide a provider without a usable key', () => {
  const module = { exports: {} };
  vm.runInNewContext(compile(read('src/utils/answerModelOptions.ts')), { module, exports: module.exports, URL, require: id => id === '../types/llmTarget' ? targetModule.exports : require(id) });
  const { answerModelOptions } = module.exports;
  const configurations = { ...targets, openai: { ...TWO_CANDIDATES, models: [...TWO_CANDIDATES.models, { model: 'shared' }, { model: 'shared' }] },
    deepseek: { provider: 'deepseek', protocol: 'chat-completions', model: 'shared' } };
  const ids = sources => plain(answerModelOptions({ providerConfigurations: configurations, gateways: [], ...sources }).map(option => option.id));
  assert.deepEqual(ids({ hasOpenaiKey: true, hasDeepseekKey: true }), ['llm-target:openai:chat-completions:model-a', 'llm-target:openai:chat-completions:model-b',
    'llm-target:openai:chat-completions:shared', 'llm-target:deepseek:chat-completions:shared']);
  assert.deepEqual(ids({ hasOpenaiKey: false, hasDeepseekKey: true }), ['llm-target:deepseek:chat-completions:shared'], 'no key hides every candidate');
  assert.deepEqual(ids({ hasOpenaiKey: true, providerAddressOverrides: { openai: 'OPENAI_BASE_URL' } }), [], 'a paused provider offers none');
  assert.deepEqual(ids({ hasGroqKey: true }), [], 'Groq is never an answer option');
});

test('S47 Save and test sends one request to exactly the chosen saved candidate, never another or an unsaved one', async () => {
  const disk = storage(), manager = disk.boot();
  assert.equal(manager.setProviderConfiguration({ ...TWO_CANDIDATES, apiKey: 'synthetic-openai' }).ok, true);
  const calls = [];
  const context = { require: () => ({ CredentialsManager: { getInstance: () => manager } }),
    appState: { processingHelper: { getLLMHelper: () => ({ testProviderConnection: async (provider, model) => { calls.push([provider, model]); return 'ANSWER'; } }) } } };
  const test = handler('test-llm-connection', context);
  assert.deepEqual(plain(await test({}, 'openai', undefined, TWO_CANDIDATES, 'model-b')), { success: true });
  assert.deepEqual(plain(await test({}, 'openai', undefined, TWO_CANDIDATES)), { success: true });
  for (const [expected, model, error] of [[TWO_CANDIDATES, 'model-c', /candidate/], [TWO_CANDIDATES, 7, /candidate/],
    [{ ...TWO_CANDIDATES, models: [{ model: 'model-b' }, { model: 'model-z' }] }, 'model-b', /changed/]]) {
    const result = plain(await test({}, 'openai', undefined, expected, model));
    assert.equal(result.success, false); assert.match(result.error, error);
  }
  assert.deepEqual(calls, [['openai', 'model-b'], ['openai', undefined]], 'exactly one test each, only for saved candidates');
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

test('S44 gateway reasoning saves through the real handler, survives restart, reaches the wire and is never silently stripped; S48 official targets take none per model', async () => {
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
    // Official targets: reasoning is chosen with the answer model (S48), never saved with the provider configuration.
    for (const reasoning of [{ effort: 'minimal' }, { effort: 'high' }]) {
      assert.throws(() => manager.setProviderConfiguration({ provider: 'openai', protocol: 'responses', model: 'gpt-5.4', reasoning, apiKey: 'synthetic-only' }), /chosen with the answer model/);
    }
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

// S48: one saved default reasoning beside the primary model, one session override in the running helper.
const SONNET = 'llm-target:claude:messages:claude-sonnet-4-6', OPUS = 'llm-target:claude:messages:claude-opus-5-5', GPT = 'llm-target:openai:responses:gpt-5.4';
const NOT_AVAILABLE = 'The selected reasoning level is not available for this model, so the provider default is used.';
const reasoningContext = (manager, appState) => {
  appState.broadcasts = 0; appState.broadcastAnswerReasoning = () => { appState.broadcasts++; };
  appState.endSessionReasoning = () => { appState.processingHelper.getLLMHelper().clearSessionReasoning(); appState.broadcastAnswerReasoning(); };
  return { require: () => ({ CredentialsManager: { getInstance: () => manager } }), appState };
};
const primaryReasoning = helper => { const task = helper.beginGenerationTask('interview'); try { return plain(task.primary.target.reasoning ?? null); } finally { task.close(); } };
const claudeAndOpenai = manager => {
  assert.equal(manager.setProviderConfiguration({ provider: 'claude', protocol: 'messages', model: 'claude-sonnet-4-6', models: [{ model: 'claude-opus-5-5' }], apiKey: 'synthetic-claude' }).ok, true);
  assert.equal(manager.setProviderConfiguration({ provider: 'openai', protocol: 'responses', model: 'gpt-5.4', apiKey: 'synthetic-openai' }).ok, true);
};

test('S48 default reasoning saves through the real handler, reaches the running helper and a cold start; stale, illegal and failed writes change nothing', async () => {
  const runtime = realAnswerRuntime();
  try {
    const disk = storage(), manager = disk.boot();
    claudeAndOpenai(manager); assert.equal(manager.setDefaultModel(SONNET).ok, true);
    const appState = sessionAppState(), live = startAnswerRuntime(manager, runtime.LLMHelper, appState), context = reasoningContext(manager, appState);
    const save = handler('set-default-reasoning', context), session = handler('set-session-reasoning', context);
    assert.equal(primaryReasoning(live), null, 'no saved choice: provider default');
    // A session override set first is not overwritten by saving the default.
    assert.deepEqual(plain(await session({}, SONNET, 'max')), { ok: true });
    const storedBeforeSession = disk.files.get(disk.filename);
    assert.deepEqual(plain(await save({}, SONNET, 'high')), { ok: true });
    assert.notDeepEqual(disk.files.get(disk.filename), storedBeforeSession);
    assert.deepEqual(plain(manager.getSavedReasoning()), { choice: 'high' });
    assert.equal(live.getCurrentModelSelection(), SONNET, 'saving the level does not switch the model');
    assert.deepEqual(primaryReasoning(live), { thinking: 'adaptive', effort: 'max' }, 'the session override still wins');
    assert.equal(live.getSessionReasoningState().overridden, true);
    live.clearSessionReasoning();
    assert.deepEqual(primaryReasoning(live), { thinking: 'adaptive', effort: 'high' });
    const cold = startAnswerRuntime(disk.boot(), runtime.LLMHelper, sessionAppState());
    assert.deepEqual(primaryReasoning(cold), { thinking: 'adaptive', effort: 'high' }, 'cold start equals the running service');
    assert.equal(cold.getSessionReasoningState().overridden, false, 'a restart starts without the session override');

    const stored = disk.files.get(disk.filename), before = appState.broadcasts;
    for (const [expected, value, message] of [[GPT, 'low', /primary model changed/], [SONNET, 'xhigh', /could not be saved/], [SONNET, 'turbo', /could not be saved/], [7, 'low', /could not be saved/]]) {
      const result = plain(await save({}, expected, value));
      assert.equal(result.ok, false, `${expected} ${value}`); assert.match(result.message, message);
      assert.deepEqual(disk.files.get(disk.filename), stored); assert.deepEqual(primaryReasoning(live), { thinking: 'adaptive', effort: 'high' });
    }
    disk.setFault('rename');
    assert.equal(plain(await save({}, SONNET, 'low')).ok, false);
    disk.setFault(undefined);
    assert.deepEqual(disk.files.get(disk.filename), stored); assert.deepEqual(plain(manager.getSavedReasoning()), { choice: 'high' });
    assert.deepEqual(primaryReasoning(live), { thinking: 'adaptive', effort: 'high' }, 'a failed write leaves the runtime alone');
    assert.equal(appState.broadcasts, before, 'nothing is broadcast for a refused write');
    // Saved but not applied: the saved value and a warning, never a rollback claim.
    const apply = live.setSavedReasoning; live.setSavedReasoning = () => { throw Error('synthetic apply failure'); };
    assert.deepEqual(plain(await save({}, SONNET, 'off')), { ok: true, warning: ANSWER_APPLY_WARNING });
    live.setSavedReasoning = apply;
    assert.deepEqual(plain(disk.boot().getSavedReasoning()), { choice: 'off' });
  } finally { runtime.cleanup(); }
});

test('S48 the session reasoning IPC validates the running target and never writes storage', async () => {
  const runtime = realAnswerRuntime();
  try {
    const disk = storage(), manager = disk.boot();
    claudeAndOpenai(manager); assert.equal(manager.setDefaultModel(SONNET).ok, true);
    const appState = sessionAppState(), live = startAnswerRuntime(manager, runtime.LLMHelper, appState), context = reasoningContext(manager, appState);
    const session = handler('set-session-reasoning', context), stored = disk.files.get(disk.filename);
    for (const [expected, value, message] of [[OPUS, 'low', /changed/], [SONNET, 'xhigh', /not available/], [SONNET, 'turbo', /Invalid/], [undefined, 'low', /Invalid/]]) {
      const result = plain(await session({}, expected, value));
      assert.equal(result.ok, false); assert.match(result.message, message);
    }
    assert.equal(appState.broadcasts, 0); assert.equal(live.getSessionReasoningState().overridden, false);
    assert.deepEqual(plain(await session({}, SONNET, 'default')), { ok: true });
    assert.equal(appState.broadcasts, 1);
    assert.deepEqual(plain(live.getSessionReasoningState()).value, 'default'); assert.equal(live.getSessionReasoningState().overridden, true);
    assert.deepEqual(disk.files.get(disk.filename), stored, 'the session override is never stored');
  } finally { runtime.cleanup(); }
});

test('S48 changing the primary keeps a level the new model takes, otherwise saves the provider default with a notice in the same write', async () => {
  const runtime = realAnswerRuntime();
  try {
    const disk = storage(), manager = disk.boot();
    claudeAndOpenai(manager); assert.equal(manager.setDefaultModel(SONNET).ok, true);
    const appState = sessionAppState(), live = startAnswerRuntime(manager, runtime.LLMHelper, appState), context = reasoningContext(manager, appState);
    const save = handler('set-default-reasoning', context), primary = handler('set-default-model', context);
    assert.equal(plain(await save({}, SONNET, 'high')).ok, true);
    assert.deepEqual(plain(await primary({}, GPT)), { ok: true }, 'gpt-5.4 takes high');
    assert.deepEqual(plain(disk.boot().getSavedReasoning()), { choice: 'high' }); assert.deepEqual(primaryReasoning(live), { effort: 'high' });
    assert.equal(plain(await save({}, GPT, 'xhigh')).ok, true);
    const result = plain(await primary({}, SONNET));
    assert.deepEqual(result, { ok: true, warning: NOT_AVAILABLE }, 'Sonnet 4.6 has no xhigh');
    const cold = disk.boot();
    assert.equal(cold.getDefaultModel(), SONNET); assert.deepEqual(plain(cold.getSavedReasoning()), { choice: 'default' });
    assert.equal(primaryReasoning(live), null, 'nothing is silently mapped to a nearby level');
    // A failed write keeps both the primary and its level.
    const stored = disk.files.get(disk.filename);
    disk.setFault('rename');
    assert.equal(plain(await primary({}, OPUS)).ok, false);
    disk.setFault(undefined);
    assert.deepEqual(disk.files.get(disk.filename), stored); assert.equal(live.getCurrentModelSelection(), SONNET);
    // A gateway or Codex primary sets reasoning in its own configuration.
    const gateway = newGateway(manager); assert.equal(gateway.ok, true);
    assert.equal(manager.setDefaultModel(`llm-gateway:${gateway.gatewayId}:chat-completions:primary`).ok, true);
    assert.match(plain(await save({}, `llm-gateway:${gateway.gatewayId}:chat-completions:primary`, 'high')).message, /own configuration/);
  } finally { runtime.cleanup(); }
});

test('S48 an older configuration: the saved primary model\'s own setting is the initial value, a lossy one stays pending, and a saved choice replaces it', async () => {
  const runtime = realAnswerRuntime();
  try {
    const disk = storage();
    // Older S47 shape: per-candidate reasoning, no shared choice yet. The first candidate and the session model are not the source.
    const claude = { provider: 'claude', protocol: 'messages', model: 'claude-sonnet-4-6', reasoning: { thinking: 'adaptive', effort: 'low' }, models: [{ model: 'claude-opus-5-5', reasoning: { effort: 'max' } }] };
    disk.files.set(disk.filename, Buffer.from('cipher:' + JSON.stringify({ claudeApiKey: 'synthetic-claude', providerConfigurations: { claude }, defaultModel: OPUS })));
    let manager = disk.boot();
    assert.deepEqual(plain(manager.getSavedReasoning()), { choice: 'max' });
    const appState = sessionAppState(), live = startAnswerRuntime(manager, runtime.LLMHelper, appState), context = reasoningContext(manager, appState);
    assert.deepEqual(primaryReasoning(live), { effort: 'max' });
    assert.equal((await handler('set-model', context)({}, SONNET)).success, true);
    assert.deepEqual(primaryReasoning(live), { thinking: 'adaptive', effort: 'max' }, 'the shared choice, never this candidate\'s hidden low');
    assert.deepEqual(plain(manager.getSavedReasoning()), { choice: 'max' }, 'switching the session model changes nothing saved');
    // Saving the configuration unchanged (the older fields echoed back) is allowed; a new per-model value is not.
    assert.equal(manager.setProviderConfiguration({ ...claude }).ok, true);
    assert.throws(() => manager.setProviderConfiguration({ ...claude, reasoning: { thinking: 'adaptive', effort: 'high' } }), /chosen with the answer model/);
    assert.equal(plain(await handler('set-default-reasoning', context)({}, OPUS, 'high')).ok, true);
    manager = disk.boot();
    assert.deepEqual(plain(manager.getSavedReasoning()), { choice: 'high' });
    assert.deepEqual(plain(manager.getProviderConfigurations().claude), claude, 'older fields are kept, not migrated or cleared');

    // Lossy: effort without adaptive thinking on Sonnet 4.6 is no choice; it stays pending for that target only.
    const lossy = storage();
    lossy.files.set(lossy.filename, Buffer.from('cipher:' + JSON.stringify({ claudeApiKey: 'synthetic-claude',
      providerConfigurations: { claude: { ...claude, reasoning: { effort: 'high' } } }, defaultModel: SONNET })));
    const pending = lossy.boot();
    assert.deepEqual(plain(pending.getSavedReasoning()), { legacy: { effort: 'high' }, target: SONNET });
    const pendingLive = startAnswerRuntime(pending, runtime.LLMHelper, sessionAppState());
    assert.deepEqual(primaryReasoning(pendingLive), { effort: 'high' }, 'original behaviour until the user chooses');
    assert.deepEqual(plain(pending.setDefaultModel(OPUS)), { ok: true, warning: NOT_AVAILABLE });
    assert.deepEqual(plain(lossy.boot().getSavedReasoning()), { choice: 'default' });
  } finally { runtime.cleanup(); }
});

test('S48 the session override ends only when the unsaved meeting is saved or discarded', async () => {
  for (const channel of ['retry-unsaved-meeting', 'discard-unsaved-meeting']) for (const ok of [true, false]) {
    let ends = 0;
    const result = ok ? { ok: true } : { ok: false, code: 'write_failed', message: 'synthetic' };
    const run = handler(channel, { appState: { endSessionReasoning: () => { ends++; },
      getIntelligenceManager: () => ({ retryUnsavedMeeting: () => result, discardUnsavedMeeting: () => result }) } });
    assert.deepEqual(plain(await run({}, 'meeting-1')), result);
    assert.equal(ends, ok ? 1 : 0, `${channel} ${ok}`);
  }
});

// S48 P2 (independent review): a pending older setting is re-derived from storage after every official save, as a cold start does.
test('S48 P2 a pending legacy setting follows a provider protocol save exactly as a cold start; session override, in-flight task and failed saves are kept', async () => {
  const runtime = realAnswerRuntime();
  try {
    const CHAT = 'llm-target:openai:chat-completions:legacy-unlisted', RESPONSES = 'llm-target:openai:responses:legacy-unlisted';
    const config = { provider: 'openai', protocol: 'chat-completions', model: 'legacy-unlisted', reasoning: { effort: 'high' } };
    const seeded = () => { const disk = storage(); disk.files.set(disk.filename, Buffer.from('cipher:' + JSON.stringify({ openaiApiKey: 'synthetic-only',
      providerConfigurations: { openai: config }, defaultModel: CHAT }))); return disk; };
    const control = helper => { const { target, value, pendingLegacy, overridden } = plain(helper.getSessionReasoningState()); return { target, value, pendingLegacy, overridden }; };

    // Save → immediate runtime equals a cold start from the same file.
    let disk = seeded(), manager = disk.boot(), appState = sessionAppState();
    let live = startAnswerRuntime(manager, runtime.LLMHelper, appState), context = reasoningContext(manager, appState);
    assert.deepEqual(primaryReasoning(live), { effort: 'high' });
    const inFlight = live.beginGenerationTask('interview');
    assert.deepEqual(plain(await handler('set-provider-configuration', context)({}, { ...config, protocol: 'responses' })), { ok: true });
    assert.deepEqual(plain(manager.getSavedReasoning()), { legacy: { effort: 'high' }, target: RESPONSES });
    const cold = startAnswerRuntime(disk.boot(), runtime.LLMHelper, sessionAppState());
    assert.equal(live.getCurrentModelSelection(), RESPONSES);
    assert.deepEqual(primaryReasoning(live), primaryReasoning(cold), 'saved runtime and cold start send the same reasoning');
    assert.deepEqual(primaryReasoning(live), { effort: 'high' });
    assert.deepEqual(control(live), control(cold));
    assert.deepEqual(control(live), { target: RESPONSES, value: 'legacy', pendingLegacy: 'effort high', overridden: false });
    try { assert.deepEqual(plain(inFlight.primary.target.reasoning), { effort: 'high' }); assert.equal(inFlight.primary.target.protocol, 'chat-completions', 'the in-flight task keeps its snapshot'); }
    finally { inFlight.close(); }

    // An explicit session override survives the save.
    disk = seeded(); manager = disk.boot(); appState = sessionAppState();
    live = startAnswerRuntime(manager, runtime.LLMHelper, appState); context = reasoningContext(manager, appState);
    live.setSessionReasoning(CHAT, 'default');
    assert.equal(plain(await handler('set-provider-configuration', context)({}, { ...config, protocol: 'responses' })).ok, true);
    assert.equal(primaryReasoning(live), null); assert.equal(control(live).overridden, true, 'the session choice is not replaced by the saved setting');

    // A failed save changes neither storage nor the running reasoning.
    disk = seeded(); manager = disk.boot(); appState = sessionAppState();
    live = startAnswerRuntime(manager, runtime.LLMHelper, appState); context = reasoningContext(manager, appState);
    const stored = disk.files.get(disk.filename), before = control(live);
    let applied = 0; const apply = live.setSavedReasoning.bind(live); live.setSavedReasoning = saved => { applied++; return apply(saved); };
    disk.setFault('rename');
    assert.equal(plain(await handler('set-provider-configuration', context)({}, { ...config, protocol: 'responses' })).ok, false);
    disk.setFault(undefined);
    assert.deepEqual(disk.files.get(disk.filename), stored); assert.equal(applied, 0);
    assert.equal(live.getCurrentModelSelection(), CHAT); assert.deepEqual(control(live), before); assert.deepEqual(primaryReasoning(live), { effort: 'high' });
  } finally { runtime.cleanup(); }
});
