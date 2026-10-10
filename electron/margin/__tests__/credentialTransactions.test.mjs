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
const quiet = { log() {}, warn() {}, error() {} };
const failure = { ok: false, code: 'write_failed', message: 'Synthetic save failure' };
const plain = value => JSON.parse(JSON.stringify(value));
const serviceAccountPath = '/synthetic/account.json';
const serviceAccount = { type: 'service_account', project_id: 'synthetic-project', client_email: 'synthetic@synthetic-project.iam.gserviceaccount.com',
  private_key: generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' }) };

function accountHelper(fakeFs) {
  const module = { exports: {} };
  vm.runInNewContext(compile(read('electron/services/googleServiceAccount.ts')), { module, exports: module.exports, URL, process: { env: {} },
    require(id) {
      if (id === 'fs') return fakeFs;
      if (id === './outbound') return require('../../../dist-electron/electron/services/outbound.js');
      return require(id);
    },
  });
  return module.exports;
}

test('generation policy persists independent deadlines and rejects invalid or identical targets without mutation', () => {
  const disk = storage(); const manager = disk.boot();
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

function storage() {
  const filename = '/synthetic/credentials.enc';
  const files = new Map([[filename, Buffer.from('cipher:' + JSON.stringify({ openaiApiKey: 'synthetic-old' }))]]);
  let fault;
  const reads = [];
  const fakeFs = {
    existsSync: file => files.has(file),
    readFileSync(file) { reads.push(file); if (fault === 'read') throw Error('synthetic read'); return files.get(file) ?? (file === serviceAccountPath ? JSON.stringify(serviceAccount) : undefined); },
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
      module, exports: module.exports, Buffer, console: quiet,
      require(id) {
        if (id === 'electron') return { app: { getPath: () => '/synthetic' }, safeStorage };
        if (id === 'fs') return fakeFs;
        if (id === './outbound') return require('../../../dist-electron/electron/services/outbound.js');
        if (id === './googleServiceAccount') return accountHelper(fakeFs);
        if (id === '../../src/types/llmTarget') return targetModule.exports;
        if (id === '../../src/types/generationPolicy') return generationPolicyModule.exports;
        if (id === '../llm/llmTarget') return require('../../../dist-electron/electron/llm/llmTarget.js');
        return require(id);
      },
    });
    const manager = module.exports.CredentialsManager.getInstance();
    manager.init();
    return manager;
  };
  return { files, filename, reads, boot, accountHelper: accountHelper(fakeFs), setFault(value) { fault = value; } };
}

test('AG33 primary and same-provider backup image confirmations survive restart independently and reset on endpoint/model changes', () => {
  const disk = storage(), manager = disk.boot();
  const config = { ...targets.openai, baseUrl: 'https://custom.example/v1', model: 'primary' };
  const binding = model => JSON.stringify(['openai', 'chat-completions', config.baseUrl, model]);
  assert.equal(manager.setProviderConfiguration({ ...config, imageSupportConfirmedFor: binding('primary') }).ok, true);
  assert.equal(manager.setDefaultModel('llm-target:openai:chat-completions:primary').ok, true);
  assert.equal(manager.setGenerationPolicy({ ...manager.getGenerationPolicy(), backupModel: 'llm-target:openai:chat-completions:backup', backupImageSupportConfirmedFor: binding('backup') }).ok, true);
  const restarted = disk.boot();
  assert.equal(restarted.getProviderConfigurations().openai.imageSupportConfirmedFor, binding('primary'));
  assert.equal(restarted.getGenerationPolicy().backupImageSupportConfirmedFor, binding('backup'));
  assert.equal(restarted.setProviderConfiguration({ ...config, baseUrl: 'https://changed.example/v1', imageSupportConfirmedFor: binding('primary') }).ok, true);
  assert.equal(restarted.getProviderConfigurations().openai.imageSupportConfirmedFor, undefined);
  assert.equal(restarted.getGenerationPolicy().backupImageSupportConfirmedFor, undefined);
  assert.equal(disk.boot().getGenerationPolicy().backupImageSupportConfirmedFor, undefined);
  assert.equal(restarted.setProviderConfiguration({ ...config, model: 'different', imageSupportConfirmedFor: binding('primary') }).ok, true);
  assert.equal(restarted.getProviderConfigurations().openai.imageSupportConfirmedFor, undefined);
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

test('all 24 setters commit only after persistence and can be read after restart', () => {
  const disk = storage();
  const manager = disk.boot();
  const ast = ts.createSourceFile('manager.ts', read('electron/services/CredentialsManager.ts'), ts.ScriptTarget.Latest, true);
  const klass = ast.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'CredentialsManager');
  const names = klass.members.filter(node => ts.isMethodDeclaration(node) && node.name.getText(ast).startsWith('set')).map(node => node.name.getText(ast));
  const fields = {
    setGeminiApiKey: 'geminiApiKey', setGroqApiKey: 'groqApiKey', setOpenaiApiKey: 'openaiApiKey',
    setClaudeApiKey: 'claudeApiKey', setDeepseekApiKey: 'deepseekApiKey', setGoogleServiceAccountPath: 'googleServiceAccountPath',
    setSttProvider: 'sttProvider', setDeepgramApiKey: 'deepgramApiKey', setGroqSttApiKey: 'groqSttApiKey',
    setOpenAiSttApiKey: 'openAiSttApiKey', setOpenAiSttBaseUrl: 'openAiSttBaseUrl', setGroqSttModel: 'groqSttModel',
    setElevenLabsApiKey: 'elevenLabsApiKey', setAzureApiKey: 'azureApiKey', setAzureRegion: 'azureRegion',
    setIbmWatsonApiKey: 'ibmWatsonApiKey', setIbmWatsonRegion: 'ibmWatsonRegion', setSonioxApiKey: 'sonioxApiKey',
    setSttLanguage: 'sttLanguage', setAiResponseLanguage: 'aiResponseLanguage', setDefaultModel: 'defaultModel', setPreferredModel: 'geminiPreferredModel', setProviderConfiguration: 'providerConfigurations', setGenerationPolicy: 'generationPolicy',
  };
  assert.equal(names.length, 24);
  assert.deepEqual(names.sort(), Object.keys(fields).sort());
  for (const name of names) {
    const before = plain(manager.getAllCredentials());
    disk.setFault('write');
    const args = name === 'setGenerationPolicy' ? [{ interviewFirstTokenSeconds: 12, interviewTotalSeconds: 75, writtenTotalSeconds: 190 }] : name === 'setProviderConfiguration' ? [{ ...targets.openai, protocol: 'responses', baseUrl: 'https://synthetic.invalid/v1', model: 'opaque' }] : name === 'setDefaultModel' ? ['gpt-5.4'] : name === 'setPreferredModel' ? ['gemini', 'synthetic-model'] : [name === 'setSttProvider' ? 'groq' : name === 'setOpenAiSttBaseUrl' ? 'https://synthetic.invalid/v1' : name === 'setGoogleServiceAccountPath' ? serviceAccountPath : 'synthetic-value'];
    assert.equal(manager[name](...args).ok, false, name);
    assert.deepEqual(plain(manager.getAllCredentials()), before, name);
    disk.setFault(undefined);
    assert.equal(manager[name](...args).ok, true, name);
    if (name === 'setProviderConfiguration') assert.deepEqual(plain(manager.getAllCredentials().providerConfigurations.openai), plain(args[0]));
    else if (name === 'setGenerationPolicy') assert.deepEqual(plain(manager.getAllCredentials().generationPolicy), plain(args[0]));
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
  'set-ai-response-language', 'switch-to-gemini', 'set-gemini-api-key', 'set-groq-api-key',
  'set-openai-api-key', 'set-claude-api-key', 'set-deepseek-api-key', 'set-provider-preferred-model',
  'set-stt-provider', 'set-groq-stt-api-key', 'set-openai-stt-api-key', 'set-openai-stt-base-url',
  'set-deepgram-api-key', 'set-groq-stt-model', 'set-elevenlabs-api-key', 'set-azure-api-key',
  'set-azure-region', 'set-ibmwatson-api-key', 'set-soniox-api-key', 'set-ibmwatson-region',
  'set-default-model', 'set-recognition-language', 'select-service-account', 'set-provider-configuration',
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
      resolveModelTarget: require('../../../dist-electron/electron/llm/llmTarget.js').resolveModelTarget,
      loadGoogleServiceAccount: () => serviceAccount, googleSpeechClientOptions: () => ({}), ...context });
}

test('AG31 complete configuration saves key, endpoint, protocol, model and matching default atomically across restart', async () => {
  const disk = storage(), manager = disk.boot();
  assert.equal(manager.setDefaultModel('gpt-5.4').ok, true);
  const value = { provider: 'openai', protocol: 'responses', baseUrl: 'http://127.0.0.1:9999/v1/', model: 'opaque', apiKey: 'synthetic-new' };
  const previous = disk.files.get(disk.filename);
  const applied = [];
  const broadcast = [];
  const invoke = handler('set-provider-configuration', {
    require: () => ({ CredentialsManager: { getInstance: () => manager } }),
    appState: { processingHelper: { getLLMHelper: () => ({ configureProvider: (...args) => applied.push(args),
      getCurrentModelSelection: () => 'llm-target:openai:responses:opaque' }) }, sendModelChanged: value => broadcast.push(value),
      getIntelligenceManager: () => ({ resetEngine() {}, initializeLLMs() {} }) },
  });
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
  assert.deepEqual(plain(config), { provider: 'openai', protocol: 'responses', baseUrl: 'http://127.0.0.1:9999/v1', model: 'opaque' });
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
    appState: { processingHelper: { getLLMHelper: () => ({ setModel: () => {}, getCurrentModelSelection: () => current }) },
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

test('AG31 env-only startup retains explicit keys, saved slots bind their own keys, and unreadable storage never falls back', () => {
  for (const scenario of ['env-only', 'saved-target', 'removed-key', 'unreadable']) {
    const disk = storage(), manager = disk.boot();
    // Start without the old synthetic stored key for the env-only control.
    if (scenario === 'env-only') manager.setOpenaiApiKey('');
    if (scenario === 'saved-target' || scenario === 'removed-key') manager.setProviderConfiguration({ ...targets.openai,
      protocol: 'responses', baseUrl: 'https://synthetic.invalid/v1', model: 'opaque', apiKey: scenario === 'removed-key' ? '' : 'synthetic-saved' });
    if (scenario === 'unreadable') { disk.setFault('decrypt'); manager.init(); }
    const configured = [];
    class Helper {
      constructor() {}
      configureProvider(config, key) { configured.push([config.provider, key, config]); }
      initModelVersionManager() { return Promise.resolve(); }
      setModel() {} setGenerationPolicy() {} setSttLanguage() {} setAiResponseLanguage() {}
    }
    const module = { exports: {} };
    vm.runInNewContext(compile(read('electron/ProcessingHelper.ts')), {
      module, exports: module.exports, console: quiet, process: { env: { OPENAI_API_KEY: 'synthetic-env' } },
      require(id) {
        if (id === './LLMHelper') return { LLMHelper: Helper };
        if (id === './services/CredentialsManager') return { CredentialsManager: { getInstance: () => manager } };
        if (id === '../src/types/llmTarget') return targetModule.exports;
        if (id === 'electron') return { app: { isPackaged: true } };
        return require(id);
      },
    });
    const processing = new module.exports.ProcessingHelper({ getIntelligenceManager: () => ({ initializeLLMs() {} }) });
    processing.loadStoredCredentials();
    const [, key, config] = configured.find(([provider]) => provider === 'openai');
    assert.equal(key, scenario === 'env-only' ? 'synthetic-env' : scenario === 'saved-target' ? 'synthetic-saved' : undefined);
    if (scenario === 'saved-target') { assert.equal(config.protocol, 'responses'); assert.equal(config.model, 'opaque'); }
  }
});

test('AG24: all active STT key removals discard only after a successful save', async () => {
  for (const provider of ['groq', 'openai', 'deepgram', 'elevenlabs', 'azure', 'ibmwatson', 'soniox']) {
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
  for (const [method, value] of [['setAzureRegion', 'other.invalid/path'], ['setIbmWatsonRegion', 'user@other.invalid/path'], ['setOpenAiSttBaseUrl', 'https://key@other.invalid']]) {
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
  for (const [channel, value] of [['set-azure-region', 'other.invalid/path'], ['set-ibmwatson-region', 'user@other.invalid/path'], ['set-openai-stt-base-url', 'https://key@other.invalid'], ['set-stt-provider', 'unknown-provider']]) {
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

test('Google selection rejects invalid JSON/type/read before persistence or runtime; safe snapshot crosses a successful save', async () => {
  const disk = storage(), manager = disk.boot();
  const before = disk.files.get(disk.filename), memory = plain(manager.getAllCredentials());
  let applies = 0;
  const invalidPath = '/synthetic/invalid.json';
  for (const contents of ['{', JSON.stringify({ ...serviceAccount, type: 'external_account' }), JSON.stringify({ ...serviceAccount, project_id: '' }), undefined]) {
    if (contents === undefined) disk.files.delete(invalidPath); else disk.files.set(invalidPath, contents);
    assert.throws(() => manager.setGoogleServiceAccountPath(invalidPath), /Invalid Google service account/);
    const result = await handler('select-service-account', {
      loadGoogleServiceAccount: disk.accountHelper.loadGoogleServiceAccount,
      require: () => ({ CredentialsManager: { getInstance: () => manager } }),
      dialog: { showOpenDialog: async () => ({ canceled: false, filePaths: [invalidPath] }) },
      appState: { updateGoogleCredentials() { applies++; } },
    })({});
    assert.equal(result.ok, false);
    assert.equal(applies, 0);
    assert.deepEqual(disk.files.get(disk.filename), before);
    assert.deepEqual(plain(manager.getAllCredentials()), memory);
  }
  const result = await handler('select-service-account', {
    loadGoogleServiceAccount: disk.accountHelper.loadGoogleServiceAccount,
    require: () => ({ CredentialsManager: { getInstance: () => ({ setGoogleServiceAccountPath(file, account) {
      const saved = manager.setGoogleServiceAccountPath(file, account);
      disk.files.set(file, JSON.stringify({ ...serviceAccount, type: 'external_account' }));
      return saved;
    } }) } }),
    dialog: { showOpenDialog: async () => ({ canceled: false, filePaths: [serviceAccountPath] }) },
    appState: { updateGoogleCredentials(file, account) { applies++; assert.equal(file, serviceAccountPath); assert.equal(account.type, 'service_account'); } },
  })({});
  assert.equal(result.ok, true);
  assert.equal(applies, 1);
  assert.deepEqual(Object.keys(result).sort(), ['ok', 'path'], 'private credential fields never return across IPC');
  assert.equal(manager.getGoogleServiceAccountPath(), serviceAccountPath);
  assert.throws(() => disk.accountHelper.loadGoogleServiceAccount(serviceAccountPath), /Invalid Google service account/, 'next load rejects changed file contents');
});

test('Google settings do not advertise an invalid saved path as usable', async () => {
  const disk = storage(), manager = disk.boot();
  assert.equal(manager.setGoogleServiceAccountPath(serviceAccountPath).ok, true);
  disk.files.set(serviceAccountPath, JSON.stringify({ ...serviceAccount, type: 'authorized_user' }));
  const credentials = await handler('get-stored-credentials', {
    require: () => ({ CredentialsManager: { getInstance: () => manager } }),
    ...disk.accountHelper,
  })({});
  assert.equal(credentials.googleServiceAccountPath, null);
  assert.equal(manager.getGoogleServiceAccountPath(), serviceAccountPath, 'bad legacy path is not deleted or replaced');
  assert.equal(credentials.hasOpenaiKey, true, 'independent settings remain usable');
});

test('AG24: real Azure/IBM connection-test handlers share the runtime region boundary', async () => {
  const outbound = require('../../../dist-electron/electron/services/outbound.js');
  for (const provider of ['azure', 'ibmwatson']) {
    for (const region of ['other.invalid/path', 'user@other.invalid/path', provider === 'azure' ? 'eastus' : 'us-south']) {
      const sends = [];
      const result = await handler('test-stt-connection', {
        Buffer, regionalSttEndpoint: outbound.regionalSttEndpoint,
        axios: { post: async endpoint => { sends.push(endpoint); return { data: {} }; } },
        require, sanitizeErrorMessage: message => message,
      })({}, provider, 'synthetic-only', region);
      const valid = !region.includes('/');
      assert.equal(result.success, valid);
      assert.equal(sends.length, valid ? 1 : 0);
      if (valid) assert.equal(sends[0], outbound.regionalSttEndpoint(provider, region));
    }
  }
});

test('AG24: a refused ElevenLabs redirect is not reported as a validated key', async () => {
  const result = await handler('test-stt-connection', {
    Buffer, require, sanitizeErrorMessage: message => message,
    axios: { get: async () => { throw { response: { status: 307 } }; } },
  })({}, 'elevenlabs', 'synthetic-only');
  assert.equal(result.success, false);
});

test('all saving IPC handlers return storage failure before runtime, events or window side effects', async () => {
  for (const channel of channels) {
    const effects = [];
    const effect = () => { effects.push('runtime'); };
    const manager = new Proxy({}, { get: () => () => failure });
    const llm = new Proxy({}, { get: () => effect });
    const appState = {
      processingHelper: { getLLMHelper: () => llm }, getIntelligenceManager: () => ({ resetEngine: effect, initializeLLMs: effect }),
      reconfigureSttProvider: effect, sendModelChanged: effect, updateGoogleCredentials: effect,
      modelSelectorWindowHelper: { hideWindow: effect },
      setRecognitionLanguage: () => failure,
    };
    const result = await handler(channel, {
      appState, BrowserWindow: { getAllWindows: () => [{ isDestroyed: () => false, webContents: { send: effect } }] },
      dialog: { showOpenDialog: async () => ({ canceled: false, filePaths: ['/synthetic/account.json'] }) },
      require: () => ({ CredentialsManager: { getInstance: () => manager } }),
    })({}, ...(channel === 'set-provider-preferred-model' ? ['gemini', 'synthetic-model'] : ['synthetic-value']));
    assert.deepEqual(plain(result), failure, channel);
    assert.deepEqual(effects, [], channel);
  }
});

test('ProviderCard stops model Fetch while complete configuration is unsaved', async () => {
  let fetched = false;
  const callback = expression('src/components/settings/ProviderCard.tsx', node => ts.isArrowFunction(node)
    && ts.isVariableDeclaration(node.parent) && node.parent.name.getText() === 'handleFetchModels', {
    unsaved: true, apiKey: 'synthetic-input', onSaveKey: async () => failure, providerId: 'openai',
    setIsFetching() {}, setFetchError() {}, window: { electronAPI: { fetchProviderModels: async () => { fetched = true; return { success: false }; } } },
  });
  await callback();
  assert.equal(fetched, false);
});

test('IPC warns safely after a committed save fails to apply, and cancellation is not a write failure', async () => {
  const applied = () => { throw Error('synthetic-key-must-not-leak'); };
  const context = {
    require: () => ({ CredentialsManager: { getInstance: () => new Proxy({}, { get: () => () => ({ ok: true }) }) } }),
    appState: { processingHelper: { getLLMHelper: () => new Proxy({}, { get: () => applied }) }, updateGoogleCredentials: applied },
    dialog: { showOpenDialog: async () => ({ canceled: false, filePaths: ['/synthetic/account.json'] }) },
  };
  for (const channel of ['set-openai-api-key', 'switch-to-gemini', 'select-service-account']) {
    const result = await handler(channel, context)({}, 'synthetic-key');
    assert.equal(result.ok, true, channel);
    assert.match(result.warning, /Saved/);
    assert.doesNotMatch(result.warning, /synthetic-key/);
  }
  const unsaved = await handler('switch-to-gemini', context)({}, undefined);
  assert.match(unsaved.warning, /No credentials were saved/);
  context.dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] });
  assert.deepEqual(plain(await handler('select-service-account', context)({})), { cancelled: true });
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
  setAiResponseLanguage: 'set-ai-response-language', switchToGemini: 'switch-to-gemini',
  setGeminiApiKey: 'set-gemini-api-key', setGroqApiKey: 'set-groq-api-key', setOpenaiApiKey: 'set-openai-api-key',
  setClaudeApiKey: 'set-claude-api-key', setDeepseekApiKey: 'set-deepseek-api-key',
  setProviderPreferredModel: 'set-provider-preferred-model', setSttProvider: 'set-stt-provider',
  setGroqSttApiKey: 'set-groq-stt-api-key', setOpenAiSttApiKey: 'set-openai-stt-api-key',
  setOpenAiSttBaseUrl: 'set-openai-stt-base-url', setDeepgramApiKey: 'set-deepgram-api-key',
  setGroqSttModel: 'set-groq-stt-model', setElevenLabsApiKey: 'set-elevenlabs-api-key',
  setAzureApiKey: 'set-azure-api-key', setAzureRegion: 'set-azure-region', setIbmWatsonApiKey: 'set-ibmwatson-api-key',
  setSonioxApiKey: 'set-soniox-api-key', setIbmWatsonRegion: 'set-ibmwatson-region',
  setDefaultModel: 'set-default-model', setRecognitionLanguage: 'set-recognition-language', selectServiceAccount: 'select-service-account',
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
    confirm: () => true, setTimeout: () => 1,
    providerConfigurations: targets, hasStoredKey: {}, unsaved: false,
    window: { electronAPI: new Proxy({}, { get: () => async () => result }) },
    availableLanguages: { 'english-us': { group: 'English' } }, sttAzureRegion: 'eastus', sttOpenaiBaseUrl: 'https://synthetic.invalid',
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
    [overlay, 'handleSelectServiceAccount', [], ['setGoogleServiceAccountPath']],
    [overlay, 'handleAzureRegionSave', [], []], [overlay, 'handleOpenAiSttBaseUrlSave', [], []],
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

test('all seven STT Save/Remove callbacks distinguish connection validation from stored keys', async () => {
  const file = 'src/components/SettingsOverlay.tsx';
  for (const provider of ['groq', 'openai', 'deepgram', 'elevenlabs', 'azure', 'ibmwatson', 'soniox']) {
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

test('renderer keeps Saved and displays a safe apply warning, while cancellation does not change the selected file', async () => {
  const warning = 'Saved; restart to apply the synthetic configuration.';
  const subject = ui('src/components/settings/AIProvidersSettings.tsx', 'handleSaveKey', { ok: true, warning });
  const result = await subject.fn('openai', 'synthetic-key', () => {});
  assert.equal(result.ok, true);
  assert.equal(subject.changes.get('setSavedStatus').openai, true);
  assert.equal(subject.changes.get('setCredentialNotice'), warning);
  const cancelled = ui('src/components/SettingsOverlay.tsx', 'handleSelectServiceAccount', { cancelled: true });
  await cancelled.fn();
  assert.equal(cancelled.changes.has('setGoogleServiceAccountPath'), false);
  assert.equal(cancelled.changes.get('setCredentialNotice'), '');
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

test('all five LLM Save/Remove branches use their matching endpoint and show failure without clearing input', async () => {
  for (const [provider, method] of Object.entries({ gemini: 'setGeminiApiKey', groq: 'setGroqApiKey', openai: 'setOpenaiApiKey', claude: 'setClaudeApiKey', deepseek: 'setDeepseekApiKey' })) {
    for (const name of ['handleSaveKey', 'handleRemoveKey']) {
      const calls = [];
      const subject = ui('src/components/settings/AIProvidersSettings.tsx', name, failure, {
        window: { electronAPI: new Proxy({}, { get: (_, key) => async value => { calls.push([key, value]); return failure; } }) },
      });
      const keep = () => assert.fail('failed input was cleared');
      await subject.fn(...(name === 'handleSaveKey' ? [provider, 'synthetic-key', keep] : [provider, keep]));
      assert.deepEqual(plain(calls), name === 'handleSaveKey'
        ? [['setProviderConfiguration', plain({ ...targets[provider], apiKey: 'synthetic-key' })]] : [[method, '']]);
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
    apiKey: '', providerId: 'openai', selectedModel: 'synthetic-old-model',
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
    const callback = handler('set-provider-configuration', {
      require: () => ({ CredentialsManager: { getInstance: () => manager } }),
      appState: { processingHelper: { getLLMHelper: () => ({ configureProvider() { effects++; } }) },
        getIntelligenceManager: () => ({ resetEngine() { effects++; }, initializeLLMs() { effects++; } }) },
    });
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
