import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const read = rel => fs.readFileSync(path.join(repoRoot, rel), 'utf8');

async function loadRouter() {
  const routerPath = path.resolve(__dirname, '../../../dist-electron/electron/llm/ProviderRouter.js');
  return import(pathToFileURL(routerPath).href);
}

test('transcript scope denial omits transcript from cloud calls', () => {
  const src = read('electron/LLMHelper.ts');

  assert.match(src, /shouldOmitContext = deniedOutboundScopes\.some\(scope => scope === 'transcript' \|\| scope === 'profile_history' \|\| scope === 'post_call_summary'\)/);
  assert.match(src, /cloudContext = shouldOmitContext \? undefined : context/);
  assert.match(src, /const cloudCombinedMessages = \{/);
  assert.match(src, /return await this\.generateWithCodexCli\(cloudUserContent/);
  assert.match(src, /return await this\.generateWithGroq\(cloudUserContent/);
});

test('LLMHelper infers auxiliary context scopes before cloud routing', () => {
  const src = read('electron/LLMHelper.ts');

  assert.match(src, /inferContextScopes\(context\?: string\): ProviderDataScope\[\]/);
  assert.match(src, /<meeting_history\|USER-PROVIDED PERSONA CONTEXT\|<user_context/);
  assert.match(src, /<post_call_summary\|meeting summary\|silent meeting summarizer\|silent meeting note-taker/);
});

test('routeLLMProviders marks cloud providers unavailable when a scope is denied', async () => {
  const { routeLLMProviders, routeWithScopeFallback } = await loadRouter();

  const options = {
    capability: 'chat',
    availability: { hasOpenAI: true, hasGroq: true, hasGemini: true },
    dataScopes: ['transcript'],
    scopePolicy: { transcript: false },
  };
  const attempts = routeLLMProviders(options);

  assert.equal(attempts.find(a => a.provider === 'openai')?.status, 'unavailable');
  assert.equal(attempts.find(a => a.provider === 'openai')?.unavailableReason, 'disabled');
  assert.equal(attempts.some(a => a.status === 'available'), false);
  assert.deepEqual(routeWithScopeFallback(options), attempts);
});

// Behavior check (rewritten in PLAN.md AG-17 after the Astra review): runs the built
// generateMeetingSummary against a stub Groq client and inspects the request body.
// The meeting context is the transcript, so denying either `transcript` or
// `post_call_summary` must keep it from being sent at all.
function loadBuiltLLMHelper() {
  const require = createRequire(import.meta.url);
  const built = path.resolve(__dirname, '../../../dist-electron/electron/LLMHelper.js');
  const electronId = require.resolve('electron', { paths: [path.dirname(built)] });
  const previous = require.cache[electronId];
  require.cache[electronId] = {
    id: electronId, filename: electronId, loaded: true,
    exports: { app: { getPath: () => os.tmpdir(), isPackaged: false, getVersion: () => '0.0.0' } },
  };
  try {
    return require(built).LLMHelper;
  } finally {
    if (previous) require.cache[electronId] = previous; else delete require.cache[electronId];
  }
}

async function summarizeWith(policy) {
  const LLMHelper = loadBuiltLLMHelper();
  const requests = [];
  const self = {
    codexCliConfig: { enabled: false },
    groqClient: { chat: { completions: { create: async (body) => { requests.push(body); return { choices: [{ message: { content: 'SUMMARY' } }] }; } } } },
    getProviderScopePolicy: () => policy,
    logScopeFallback: () => {},
    withTimeout: (promise) => promise,
    processResponse: (text) => text,
  };
  const result = await LLMHelper.prototype.generateMeetingSummary.call(self, 'SYSTEM', 'TRANSCRIPT_SENTINEL said hello', 'GROQ_SYSTEM');
  return { result, requests };
}

test('meeting summaries send the transcript only when both transcript and post_call_summary are allowed', async () => {
  const allowed = await summarizeWith({});
  assert.equal(allowed.result, 'SUMMARY');
  assert.equal(allowed.requests.length, 1);
  assert.match(JSON.stringify(allowed.requests[0].messages), /TRANSCRIPT_SENTINEL/);

  for (const policy of [{ transcript: false }, { post_call_summary: false }, { transcript: false, post_call_summary: false }]) {
    const denied = await summarizeWith(policy);
    assert.equal(denied.result, '', `no summary when ${JSON.stringify(policy)}`);
    assert.equal(denied.requests.length, 0, `no request at all when ${JSON.stringify(policy)}`);
  }
});

// Codex CLI is a cloud provider too (PLAN.md AG-17 review): both Codex entry points,
// through which every Codex call goes, must refuse a denied scope before starting the
// CLI. `spawn` is replaced for the duration of each call, so nothing is started: an
// allowed call reaches the stub (proving the check sits in front of the send step).
const SPAWN_STUB = 'spawn-stub-reached';

async function codexWith(entry, policy) {
  const LLMHelper = loadBuiltLLMHelper();
  const childProcess = createRequire(import.meta.url)('node:child_process');
  const realSpawn = childProcess.spawn;
  const spawned = [];
  childProcess.spawn = (cmd, args) => { spawned.push(cmd); throw new Error(SPAWN_STUB); };
  const self = Object.assign(Object.create(LLMHelper.prototype), {
    codexCliConfig: { enabled: true, path: '/margin-test/codex-not-installed', model: 'gpt-5.4', fastModel: 'gpt-5.3-codex', timeoutMs: 1_000, sandboxMode: 'read-only', serviceTier: 'default' },
    currentModelId: 'codex-cli:gpt-5.4',
    getProviderScopePolicy: () => policy,
  });
  try {
    if (entry === 'stream') {
      for await (const _ of self.streamWithCodexCli('TRANSCRIPT_SENTINEL said hello', 'SYSTEM')) { /* drain */ }
    } else {
      await self.generateWithCodexCli('TRANSCRIPT_SENTINEL said hello', 'SYSTEM');
    }
    return { error: null, spawned };
  } catch (error) {
    return { error, spawned };
  } finally {
    childProcess.spawn = realSpawn;
  }
}

for (const entry of ['generate', 'stream']) {
  test(`Codex CLI (${entry}) does not start when the transcript scope is denied`, async () => {
    const allowed = await codexWith(entry, {});
    assert.match(String(allowed.error?.message), new RegExp(SPAWN_STUB), 'with every scope allowed the call reaches the CLI');
    assert.deepEqual(allowed.spawned, ['/margin-test/codex-not-installed']);

    const denied = await codexWith(entry, { transcript: false });
    assert.equal(denied.error?.name, 'ProviderScopeError', `expected a scope error, got ${denied.error}`);
    assert.deepEqual(denied.spawned, [], 'the CLI must not be started');
  });
}
