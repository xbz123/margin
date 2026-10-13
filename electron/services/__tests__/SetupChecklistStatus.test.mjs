import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';

const root = path.resolve(import.meta.dirname, '../../..');
function load(relative, imports = {}) {
  const module = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root, relative), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { module, exports: module.exports, require(id) { if (id in imports) return imports[id]; throw Error(`Unexpected import: ${id}`); } });
  return module.exports;
}
const codex = load('src/types/codexSource.ts');
const { readSetupChecklist } = load('src/components/onboarding/setupChecklistStatus.ts', { '../../types/codexSource': codex });
const plain = value => JSON.parse(JSON.stringify(value));
function metadata() {
  return { providerConfigurations: { openai: { provider: 'openai', model: 'synthetic', protocol: 'chat-completions' } },
    hasOpenaiKey: false, hasClaudeKey: true, sttProvider: 'none', hasSttOpenaiKey: false, hasSttGroqKey: false, hasSonioxKey: false };
}
function api(creds = metadata()) {
  const calls = [];
  const local = { getCurrentLlmConfig: async () => ({ provider: 'openai', model: 'synthetic' }), getStoredCredentials: async () => creds,
    getDomesticStt: async () => ({ hasKey: true, workspaceId: '', appId: '', resourceId: 'volc.seedasr.sauc.duration' }),
    getCodexCliConfig: async () => ({ ...codex.DEFAULT_CODEX_SOURCE_CONFIG }),
    checkPermissions: async () => ({ platform: 'darwin', microphone: 'denied', screen: 'not-determined' }) };
  return { calls, local: new Proxy(local, { get(target, name) { if (!(name in target)) throw Error(`Forbidden API ${String(name)}`); return (...args) => { calls.push([name, ...args]); return target[name](...args); }; } }), mutable: local };
}

test('AG62 empty selected configuration stays actionable and does not borrow another provider key', async () => {
  const f = api();
  assert.deepEqual(plain(await readSetupChecklist(f.local)), { answer: 'missing', speech: 'missing', permissions: 'missing' });
  assert.deepEqual(f.calls.map(([name]) => name).sort(), ['checkPermissions', 'getCurrentLlmConfig', 'getStoredCredentials']);
});

for (const provider of ['openai', 'groq', 'soniox', 'aliyun', 'doubao']) test(`AG62 ${provider} speech configuration uses only its selected metadata`, async () => {
  const creds = { ...metadata(), sttProvider: provider, hasSttOpenaiKey: true, hasSttGroqKey: true, hasSonioxKey: true };
  const f = api(creds);
  assert.equal((await readSetupChecklist(f.local)).speech, 'configured');
  if (provider === 'aliyun' || provider === 'doubao') {
    assert.deepEqual(f.calls.filter(([name]) => name === 'getDomesticStt'), [['getDomesticStt', provider]]);
    f.mutable.getDomesticStt = async () => ({ hasKey: false, workspaceId: '', appId: '', resourceId: 'volc.seedasr.sauc.concurrent' });
  } else creds[provider === 'openai' ? 'hasSttOpenaiKey' : provider === 'groq' ? 'hasSttGroqKey' : 'hasSonioxKey'] = false;
  assert.equal((await readSetupChecklist(f.local)).speech, 'missing');
});

test('AG62 Doubao retains the selected resource and never assumes a purchased resource', async () => {
  const f = api({ ...metadata(), sttProvider: 'doubao' });
  for (const resourceId of ['volc.seedasr.sauc.duration', 'volc.seedasr.sauc.concurrent']) {
    f.mutable.getDomesticStt = async () => ({ hasKey: true, workspaceId: '', appId: '', resourceId });
    assert.equal((await readSetupChecklist(f.local)).speech, 'configured');
  }
  f.mutable.getDomesticStt = async () => ({ hasKey: true, resourceId: null });
  assert.notEqual((await readSetupChecklist(f.local)).speech, 'configured');
});

test('AG62 selected Codex requires enabled configuration and current risk confirmation, never a login probe', async () => {
  const f = api(); f.mutable.getCurrentLlmConfig = async () => ({ provider: 'codex-cli', model: 'codex-cli' });
  for (const config of [{ enabled: false, riskConfirmedVersion: 1 }, { enabled: true }, { enabled: true, riskConfirmedVersion: 0 }]) {
    f.mutable.getCodexCliConfig = async () => ({ ...codex.DEFAULT_CODEX_SOURCE_CONFIG, ...config });
    assert.equal((await readSetupChecklist(f.local)).answer, 'missing');
  }
  f.mutable.getCodexCliConfig = async () => ({ ...codex.DEFAULT_CODEX_SOURCE_CONFIG, enabled: true, riskConfirmedVersion: 1 });
  assert.equal((await readSetupChecklist(f.local)).answer, 'configured');
  assert.equal(f.calls.some(([name]) => name.startsWith('test') || name.startsWith('fetch')), false);
});

test('AG62 failed and malformed metadata never keeps a previous configured state', async () => {
  const creds = { ...metadata(), hasOpenaiKey: true, sttProvider: 'soniox', hasSonioxKey: true }, f = api(creds);
  f.mutable.checkPermissions = async () => ({ platform: 'darwin', microphone: 'granted', screen: 'granted' });
  assert.deepEqual(plain(await readSetupChecklist(f.local)), { answer: 'configured', speech: 'configured', permissions: 'reported-allowed' });
  f.mutable.getStoredCredentials = async () => { throw Error('unreadable'); };
  f.mutable.checkPermissions = async () => { throw Error('unreadable'); };
  assert.deepEqual(plain(await readSetupChecklist(f.local)), { answer: 'unknown', speech: 'unknown', permissions: 'unknown' });
  f.mutable.getStoredCredentials = async () => ({ hasOpenaiKey: false, sttProvider: 'none' });
  assert.deepEqual(plain(await readSetupChecklist(f.local)), { answer: 'unknown', speech: 'unknown', permissions: 'unknown' });
  assert.deepEqual(plain(await readSetupChecklist(undefined)), { answer: 'unknown', speech: 'unknown', permissions: 'unknown' });
});

test('AG62 non-Mac granted IPC metadata is not a real device permission verification', async () => {
  const f = api();
  for (const platform of ['win32', 'linux', '']) {
    f.mutable.checkPermissions = async () => ({ platform, microphone: 'granted', screen: 'granted' });
    assert.equal((await readSetupChecklist(f.local)).permissions, 'unknown');
  }
});

test('AG62 selected domestic/Codex read failure is unknown without falling back to other credentials', async () => {
  const f = api({ ...metadata(), sttProvider: 'aliyun', hasSttOpenaiKey: true });
  f.mutable.getDomesticStt = async () => { throw Error('unreadable'); };
  assert.equal((await readSetupChecklist(f.local)).speech, 'unknown');
  f.mutable.getCurrentLlmConfig = async () => ({ provider: 'codex-cli', model: 'codex-cli' });
  f.mutable.getCodexCliConfig = async () => { throw Error('unreadable'); };
  assert.equal((await readSetupChecklist(f.local)).answer, 'unknown');
});
