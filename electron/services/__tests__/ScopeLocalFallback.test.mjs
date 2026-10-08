import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import { createRequire } from 'node:module';
import ts from 'typescript';

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

async function summarizeWith(policy, extraDataScopes) {
  const LLMHelper = loadBuiltLLMHelper();
  const requests = [];
  const self = Object.assign(Object.create(LLMHelper.prototype), {
    codexCliConfig: { enabled: false },
    groqClient: { chat: { completions: { create: async (body) => { requests.push(body); return { choices: [{ message: { content: 'SUMMARY' } }] }; } } } },
    getProviderScopePolicy: () => policy,
    logScopeFallback: () => {},
    withTimeout: (promise) => promise,
    processResponse: (text) => text,
  });
  const result = await LLMHelper.prototype.generateMeetingSummary.call(self, 'SYSTEM', 'TRANSCRIPT_SENTINEL said hello', 'GROQ_SYSTEM', extraDataScopes);
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

// Startup recovery (PLAN.md AG-17 sixth review): a meeting left over from an earlier
// run is saved history, so recovery declares profile_history as well. With it denied
// nothing is sent; the current meeting (no extra scope) is unaffected by it.
test('meeting summaries with a declared profile_history scope are not sent while it is denied', async () => {
  const recovered = await summarizeWith({ profile_history: false }, ['profile_history']);
  assert.equal(recovered.result, '');
  assert.equal(recovered.requests.length, 0);

  const allowed = await summarizeWith({}, ['profile_history']);
  assert.equal(allowed.requests.length, 1);
  assert.match(JSON.stringify(allowed.requests[0].messages), /TRANSCRIPT_SENTINEL/);

  const current = await summarizeWith({ profile_history: false });
  assert.equal(current.requests.length, 1, 'the current meeting does not carry profile_history');
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

// Third review (PLAN.md AG-17): the non-streaming Claude and Groq multimodal sends had
// no scope check of their own, and Gemini requests with inline images were not seen as
// screenshots. Each send below is replaced by a stub that records the request and
// throws, so an allowed call proves the check sits in front of the send.
const SEND_STUB = 'send-stub-reached';

// Keep the real SDK request/retry machinery; replace only its HTTP transport.
// A retryable response closes the scope before the SDK's retry timer can fire.
for (const construction of ['constructor', 'key update']) {
  for (const provider of ['groq', 'openai', 'claude', 'deepseek']) {
    test(`${provider} ${construction}: SDK cannot resend after scope revocation`, async () => {
      const LLMHelper = loadBuiltLLMHelper();
      const self = construction === 'constructor'
        ? new LLMHelper(undefined, 'test-only', 'test-only', 'test-only', 'test-only')
        : new LLMHelper();
      if (construction === 'key update') {
        const setters = { groq: 'setGroqApiKey', openai: 'setOpenaiApiKey', claude: 'setClaudeApiKey', deepseek: 'setDeepseekApiKey' };
        self[setters[provider]]('test-only');
      }
      const policy = {};
      self.getProviderScopePolicy = () => policy;
      self.withTimeout = promise => promise;
      self.rateLimiters[provider] = { acquire: async () => {} };
      const client = self[`${provider}Client`];
      let requests = 0;
      client.fetch = async () => {
        requests++;
        policy.transcript = false;
        return new Response(JSON.stringify({ error: { message: 'retryable test failure', type: 'server_error' } }), {
          status: 500, headers: { 'content-type': 'application/json', 'retry-after-ms': '1' },
        });
      };
      const calls = {
        groq: () => self.generateWithGroq('SCOPE_SENTINEL'),
        openai: () => self.generateWithOpenai('SCOPE_SENTINEL'),
        claude: () => self.generateWithClaude('SCOPE_SENTINEL'),
        deepseek: () => self.generateWithDeepseek('SCOPE_SENTINEL'),
      };
      await assert.rejects(calls[provider]);
      assert.equal(requests, 1, 'no hidden SDK replay after the scope closes');
      assert.equal(client.maxRetries, 0);
    });
  }
}

test('vision denial is terminal without retries, health penalty or fallback', async () => {
  const { ProviderScopeError } = await loadRouter();
  const { runStreamingVisionFallback, DEFAULT_VISION_FALLBACK_CONFIG } = await import(pathToFileURL(path.join(repoRoot, 'dist-electron/electron/llm/visionStreamFallback.js')).href);
  const denied = new ProviderScopeError('test', ['screenshots']);
  const health = new Map();
  const attempts = [];
  const providers = ['first', 'backup'].map(id => ({ id, name: id, isLocal: false, priority: 0,
    open: async function* () { attempts.push(id); throw denied; },
  }));
  const hooks = { sleep: async () => { attempts.push('backoff'); }, warn: () => { attempts.push('provider warning'); } };
  await assert.rejects(async () => {
    for await (const _ of runStreamingVisionFallback(providers, { ...DEFAULT_VISION_FALLBACK_CONFIG, cleanupTimeoutMs: 1 }, health, hooks)) { /* drain */ }
  }, error => error === denied);
  assert.deepEqual(attempts, ['first']);
  assert.equal(health.size, 0);
});

test('Gemini fallback preserves refusal without starting a speculative sibling', async () => {
  const { ProviderScopeError } = await loadRouter();
  const denied = new ProviderScopeError('gemini', ['transcript']);
  const attempted = [];
  const self = helperWith({}, { client: {}, collectStreamResponse: async (_, model) => {
    attempted.push(model);
    if (attempted.length === 1) throw denied;
    return 'must not become an answer';
  } });
  await assert.rejects(async () => {
    for await (const _ of self.streamWithGeminiFallback('QUESTION')) { /* drain */ }
  }, error => error === denied);
  assert.equal(attempted.length, 1);
});

test('Gemini sequential fallback retains ordinary failure and cancellation behavior', async () => {
  const attempted = [];
  const self = helperWith({}, { client: {}, collectStreamResponse: async (_, model) => {
    attempted.push(model);
    if (attempted.length === 1) throw new Error('provider unavailable');
    return 'BACKUP_RESULT';
  } });
  let answer = '';
  for await (const chunk of self.streamWithGeminiFallback('QUESTION')) answer += chunk;
  assert.equal(answer, 'BACKUP_RESULT');
  assert.equal(attempted.length, 2);
  const cancelled = new AbortController();
  self.collectStreamResponse = async () => { cancelled.abort(); throw new Error('cancelled'); };
  await drain(self.streamWithGeminiFallback('QUESTION', undefined, undefined, cancelled.signal));
});

test('an aborted Gemini collection cannot send after its cache wait', async () => {
  const controller = new AbortController();
  let sends = 0;
  const self = helperWith({}, {
    client: { models: { generateContent: async () => { sends++; return { text: 'ANSWER' }; } } },
    geminiPromptCache: { getOrCreate: async () => { controller.abort(); return null; } },
  });
  await assert.rejects(() => self.collectStreamResponse('QUESTION', 'test', undefined, controller.signal, 'SYSTEM'));
  assert.equal(sends, 0);
});

const drain = async (stream) => { for await (const _ of stream) { /* drain */ } };

test('prompt wrappers propagate a refusal instead of inventing an answer', async () => {
  loadBuiltLLMHelper();
  const { ProviderScopeError, rethrowProviderScopeError } = await loadRouter();
  const denied = new ProviderScopeError('test', ['transcript']);
  assert.throws(() => rethrowProviderScopeError(new AggregateError([new Error('ordinary'), new AggregateError([denied])])), error => error === denied);
  const helper = {
    getCapabilities: () => ({ outputBudgetTokens: 2000, supportsImages: true }),
    fitContextForCurrentModel: text => text,
    getPromptTier: () => 'standard',
    deniedDataScopes: () => [],
    chat: async () => { throw denied; },
    streamChat: async function* () { throw denied; },
  };
  const require = createRequire(import.meta.url);
  for (const name of ['WhatToAnswer', 'CodeHint', 'Brainstorm', 'Answer', 'Recap', 'FollowUp', 'Clarify', 'Assist', 'FollowUpQuestions']) {
    const className = `${name}LLM`;
    const Class = require(path.join(repoRoot, `dist-electron/electron/llm/${className}.js`))[className];
    const wrapper = new Class(helper);
    for (const method of ['generate', 'generateStream']) {
      if (typeof wrapper[method] !== 'function') continue;
      const args = name === 'CodeHint' ? [undefined, 'QUESTION', 'transcript', 'CONTEXT'] : ['QUESTION'];
      await assert.rejects(async () => {
        const result = wrapper[method](...args);
        if (method === 'generateStream') await drain(result); else await result;
      }, error => error === denied, `${className}.${method}`);
    }
  }
});

test('WhatToSay emits the refusal and rejects without a fabricated answer', async () => {
  loadBuiltLLMHelper();
  const { ProviderScopeError } = await loadRouter();
  const { IntelligenceEngine } = createRequire(import.meta.url)(path.join(repoRoot, 'dist-electron/electron/IntelligenceEngine.js'));
  const denied = new ProviderScopeError('test', ['transcript']);
  const events = [];
  const engine = Object.assign(Object.create(IntelligenceEngine.prototype), {
    session: { getFormattedContext: () => 'CONTEXT' },
    answerLLM: { generate: async () => { throw denied; } },
    emit: (...args) => events.push(args),
    setMode: mode => events.push(['mode', mode]),
  });
  await assert.rejects(() => engine.runWhatShouldISay('QUESTION'), error => error === denied);
  assert.deepEqual(events, [['mode', 'what_to_say'], ['error', denied, 'what_to_say'], ['mode', 'idle']]);
});

test('default chat routing refuses transcript denial but can send without denied context', async () => {
  const LLMHelper = loadBuiltLLMHelper();
  const policy = { transcript: false };
  const messages = [];
  const self = Object.assign(new LLMHelper(), {
    currentModelId: 'gemini-test', groqClient: {},
    getProviderScopePolicy: () => policy,
    generateWithGroq: async message => { messages.push(message); return 'ANSWER'; },
  });
  await assert.rejects(() => self.chatWithGemini('QUESTION'), { name: 'ProviderScopeError' });
  assert.equal(messages.length, 0);
  policy.transcript = true;
  policy.profile_history = false;
  assert.equal(await self.chatWithGemini('QUESTION', undefined, 'MEETING: SECRET_HISTORY'), 'ANSWER');
  assert.deepEqual(messages, ['QUESTION']);
});
const denialRoutes = [
  ['non-streaming chat', self => self.chatWithGemini('QUESTION')],
  ['fast Codex chat', self => { self.groqFastTextMode = true; self.codexCliConfig.enabled = true; return self.chatWithGemini('QUESTION'); }],
  ['fast Groq chat', self => { self.groqFastTextMode = true; self.currentModelId = 'llama-3.3-70b-versatile'; return self.chatWithGemini('QUESTION'); }],
  ['structured fallback', self => self.generateContentStructured('QUESTION')],
  ['non-streaming vision', self => self.generateWithVisionFallback('SYSTEM', 'QUESTION', NO_IMAGE)],
  ['Codex vision', self => { self.codexCliConfig.enabled = true; return self.generateWithVisionFallback('SYSTEM', 'QUESTION', NO_IMAGE); }],
  ['streaming text fallback', self => drain(self.streamChatWithGemini('QUESTION'))],
  ['streaming vision outer boundary', self => drain(self.streamChat('QUESTION', NO_IMAGE))],
  ['mode-specific fallback', self => drain(self.streamWithGroqOrGemini('QUESTION', 'QUESTION'))],
];
for (const [name, run] of denialRoutes) {
  test(`${name}: a scope refusal stops at the first provider`, async () => {
    const LLMHelper = loadBuiltLLMHelper();
    const { ProviderScopeError } = await loadRouter();
    const denied = new ProviderScopeError('test', ['transcript']);
    const calls = [];
    const self = Object.assign(new LLMHelper(), {
      currentModelId: 'gpt-5.4', codexCliConfig: { enabled: false, model: 'test' },
      openaiClient: {}, claudeClient: {}, client: {},
      groqClient: { chat: { completions: { create: async () => { calls.push('groq send'); throw denied; } } } },
      getProviderScopePolicy: () => ({}),
      delay: async () => { calls.push('backoff'); },
    });
    for (const method of ['generateWithCodexCli', 'generateWithGroq', 'generateWithOpenai', 'generateWithClaude', 'generateWithDeepseek', 'generateWithGroqMultimodal']) {
      self[method] = async () => { calls.push(method); throw denied; };
    }
    for (const method of ['streamWithCodexCli', 'streamWithGroq', 'streamWithOpenai', 'streamWithClaude', 'streamVisionWithFallback']) {
      self[method] = async function* () { calls.push(method); throw denied; };
    }
    await assert.rejects(() => run(self), error => error === denied);
    assert.equal(calls.length, 1, JSON.stringify(calls));
  });
}

for (const refuseAt of [1, 2]) {
  test(`robust Gemini fallback keeps refusal type at rate-limit wait ${refuseAt}`, async () => {
    const policy = {};
    let waits = 0;
    let sends = 0;
    const self = helperWith(policy, {
      rateLimiters: { gemini: { acquire: async () => { if (++waits === refuseAt) policy.transcript = false; } } },
    });
    const client = { models: { generateContent: async () => { sends++; throw new Error('server failed'); } } };
    await assert.rejects(() => self.generateWithFallback(client, { model: 'test', contents: [{ text: 'QUESTION' }] }), { name: 'ProviderScopeError' });
    assert.equal(sends, refuseAt - 1);
    assert.equal(waits, refuseAt, 'no subsequent retry cycle after a refusal');
  });
}

function helperWith(policy, fields) {
  const LLMHelper = loadBuiltLLMHelper();
  const noLimit = { acquire: async () => {} };
  return Object.assign(Object.create(LLMHelper.prototype), {
    codexCliConfig: { enabled: false },
    groqFastTextMode: false,
    rateLimiters: { claude: noLimit, groq: noLimit, gemini: noLimit, openai: noLimit, deepseek: noLimit },
    withRetry: (fn) => fn(),
    withTimeout: (promise) => promise,
    getProviderScopePolicy: () => policy,
    logScopeFallback: () => {},
  }, fields);
}

async function sendWith(policy, makeClient, call) {
  const requests = [];
  const self = helperWith(policy, makeClient((body) => { requests.push(body); throw new Error(SEND_STUB); }));
  try {
    return { result: await call(self), error: null, requests };
  } catch (error) {
    return { result: null, error, requests };
  }
}

const claudeClient = (send) => ({ claudeClient: { messages: { stream: send } }, currentModelId: 'claude-sonnet-4-6' });
const groqClient = (send) => ({ groqClient: { chat: { completions: { create: send } } } });
const geminiClient = (send) => ({ client: { models: { generateContent: send } }, geminiModel: 'gemini-test' });
// A path that does not exist: the image is skipped when reading, but the call still
// counts as one carrying screenshots, as in the app.
const NO_IMAGE = ['/margin-test/screenshot-not-present.png'];

const directSends = [
  ['Claude', claudeClient, (self, images) => self.generateWithClaude('TRANSCRIPT_SENTINEL said hello', 'SYSTEM', images)],
  ['Groq multimodal', groqClient, (self, images) => self.generateWithGroqMultimodal('TRANSCRIPT_SENTINEL said hello', images ?? [], 'SYSTEM')],
  ['Gemini contents', geminiClient, (self, images) => self.generateContent([{ text: 'TRANSCRIPT_SENTINEL said hello' }, ...(images ? [{ inlineData: { mimeType: 'image/png', data: 'AAAA' } }] : [])])],
];

for (const [name, makeClient, call] of directSends) {
  test(`${name} sends nothing when the transcript or screenshot scope is denied`, async () => {
    const allowed = await sendWith({}, makeClient, (self) => call(self, NO_IMAGE));
    assert.match(String(allowed.error?.message), new RegExp(SEND_STUB), 'with every scope allowed the call reaches the send');
    assert.equal(allowed.requests.length, 1);
    assert.match(JSON.stringify(allowed.requests[0]), /TRANSCRIPT_SENTINEL/);

    for (const [policy, images] of [[{ transcript: false }, undefined], [{ screenshots: false }, NO_IMAGE]]) {
      const denied = await sendWith(policy, makeClient, (self) => call(self, images));
      assert.equal(denied.error?.name, 'ProviderScopeError', `${JSON.stringify(policy)}: expected a scope error, got ${denied.error}`);
      assert.equal(denied.requests.length, 0, `${JSON.stringify(policy)}: nothing may be sent`);
    }
  });
}

// The path the review named: Claude selected, the transcript in the message itself
// (as generateSuggestion builds it), the Transcripts scope denied.
test('chatWithGemini with Claude selected does not send a transcript-bearing message when transcripts are denied', async () => {
  const ask = (self) => self.chatWithGemini('Question from the transcript: TRANSCRIPT_SENTINEL said hello', undefined, 'TRANSCRIPT_SENTINEL context');
  const allowed = await sendWith({}, claudeClient, ask);
  assert.equal(allowed.requests.length, 1, 'with every scope allowed Claude is asked');

  const denied = await sendWith({ transcript: false }, claudeClient, ask);
  assert.equal(denied.requests.length, 0, 'Claude must not be asked');
  assert.doesNotMatch(String(denied.result), /TRANSCRIPT_SENTINEL/);
});

// Syntax guard for the enumerated SDK methods, not a proof about arbitrary callees,
// aliases, SDK internals or data provenance. Runtime tests cover SDK retries separately.
function scanSends(source) {
  const tree = ts.createSourceFile('send.ts', source, ts.ScriptTarget.Latest, true);
  const sends = [];
  const walk = (node, visit) => { visit(node); ts.forEachChild(node, child => walk(child, visit)); };
  walk(tree, call => {
    if (!ts.isCallExpression(call) || !/(?:\.chat\.completions\.create|\.models\.generateContent(?:Stream)?|\.messages\.(?:create|stream)|CodexCliService\.(?:run|stream))$/.test(call.expression.getText(tree))) return;
    let statement = call;
    while (statement.parent && !ts.isBlock(statement.parent) && !ts.isSourceFile(statement.parent)) statement = statement.parent;
    const siblings = statement.parent?.statements ?? [];
    const previous = siblings[siblings.indexOf(statement) - 1];
    const checked = previous && ts.isExpressionStatement(previous) && ts.isCallExpression(previous.expression)
      && /^this\.(?:assertOutboundScopes|assertGeminiContents)$/.test(previous.expression.expression.getText(tree));
    let waits = false;
    walk(statement, node => {
      // Awaiting the send's result (or its withTimeout wrapper) is fine. Waiting
      // before invocation, including inside an argument, is not.
      const containsSend = node.pos <= call.pos && node.end >= call.end;
      if ((ts.isAwaitExpression(node) || ts.isYieldExpression(node)) && !containsSend && node.pos < call.end) waits = true;
      if (ts.isFunctionLike(node)) waits = true;
    });
    sends.push({ line: tree.getLineAndCharacterOfPosition(call.getStart(tree)).line + 1, checked: !!checked, waits });
  });
  return sends;
}

test('every enumerated SDK send immediately follows a scope check without a syntactic wait', () => {
  const sends = scanSends(read('electron/LLMHelper.ts'));
  assert.ok(sends.length >= 20);
  assert.deepEqual(sends.filter(send => !send.checked || send.waits), []);
});

test('send syntax guard rejects deferred closures and awaited arguments', () => {
  const check = 'this.assertOutboundScopes("test", "text");';
  const send = 'this.openaiClient.chat.completions.create({});';
  for (const unsafe of [
    `${check} const later = function () { return ${send} };`,
    `${check} const later = () => ${send}`,
    `${check} await wait(); ${send}`,
    `${check} this.openaiClient.chat.completions.create(await body());`,
    `${check} this.openaiClient.chat.completions.create({\n content: await body()\n });`,
    `if (allowed) { ${check} } ${send}`,
  ]) {
    assert.ok(scanSends(unsafe).some(send => !send.checked || send.waits), unsafe);
  }
  assert.deepEqual(scanSends(`${check} await this.withTimeout(${send.slice(0, -1)}, 1000);`).map(({ checked, waits }) => ({ checked, waits })), [{ checked: true, waits: false }]);
});

// Fourth review (PLAN.md AG-17): the static sweep only shows that a check comes
// before each send in the same method, not that every branch is guarded. These cases
// call each remaining send branch with the transcript scope denied and count requests,
// so deleting the check of any one branch fails here.
const geminiOnly = (send) => ({ client: { models: { generateContent: send } }, geminiModel: 'gemini-test', delay: async () => {} });
const groqThenNothing = (send) => ({ groqClient: { chat: { completions: { create: send } } } });
const branchSends = [
  // Two Gemini branches, each tried in every rotation: 2 x 3 requests when allowed.
  ['generateContentStructured (Gemini Pro and Flash branches)', geminiOnly, (self) => self.generateContentStructured('TRANSCRIPT_SENTINEL said hello'), 6],
  ['generateWithPro', geminiOnly, (self) => self.generateWithPro([{ text: 'TRANSCRIPT_SENTINEL said hello' }]), 1],
  ['generateWithFlash', geminiOnly, (self) => self.generateWithFlash([{ text: 'TRANSCRIPT_SENTINEL said hello' }]), 1],
  ['generateWithFallback (robust Gemini client)', geminiOnly, (self) => self.generateWithFallback(self.client, { model: 'gemini-test', contents: [{ text: 'TRANSCRIPT_SENTINEL said hello' }] }), null],
  ['streamWithGroqOrGemini (Groq branch)', groqThenNothing, async (self) => { for await (const _ of self.streamWithGroqOrGemini('TRANSCRIPT_SENTINEL said hello', 'TRANSCRIPT_SENTINEL said hello')) { /* drain */ } }, 1],
];

for (const [name, makeClient, call, allowedRequests] of branchSends) {
  test(`${name} sends nothing when the transcript scope is denied`, async () => {
    const allowed = await sendWith({}, makeClient, call);
    if (allowedRequests === null) assert.ok(allowed.requests.length >= 1, 'with every scope allowed the call reaches the send');
    else assert.equal(allowed.requests.length, allowedRequests, 'with every scope allowed every branch reaches the send');

    const denied = await sendWith({ transcript: false }, makeClient, call);
    assert.equal(denied.requests.length, 0, 'nothing may be sent');
    assert.match(`${denied.error?.name} ${denied.error?.message}`, /ProviderScopeError|blocked by data scope policy: transcript/, `unexpected error: ${denied.error}`);
  });
}

// Fourth review, finding 1: scopes the caller declares for a request describe data
// that may sit in the message itself. streamChat must refuse the request when one of
// them is denied, even with the transcript allowed.
const openaiClient = (send) => ({ openaiClient: { chat: { completions: { create: send } } }, currentModelId: 'gpt-5.4', personaPrompt: '' });

test('streamChat refuses a request whose declared scope is denied, before anything is sent', async () => {
  const run = (self) => (async () => {
    for await (const _ of self.streamChat('PRIOR_ANSWER_SENTINEL in the message', undefined, undefined, undefined, true, true, ['profile_history'])) { /* drain */ }
  })();
  const allowed = await sendWith({}, openaiClient, run);
  assert.equal(allowed.requests.length, 1, 'with every scope allowed the request is sent');

  for (const policy of [{ profile_history: false }, { transcript: false }]) {
    const denied = await sendWith(policy, openaiClient, run);
    assert.equal(denied.error?.name, 'ProviderScopeError', `${JSON.stringify(policy)}: expected a scope error, got ${denied.error}`);
    assert.equal(denied.requests.length, 0, `${JSON.stringify(policy)}: nothing may be sent`);
  }
});

// WhatToAnswer leaves earlier answers out of the request when profile_history is
// denied, so the answer still works without them.
async function whatToAnswerWith(deniedScopes) {
  const { WhatToAnswerLLM } = createRequire(import.meta.url)(path.resolve(__dirname, '../../../dist-electron/electron/llm/WhatToAnswerLLM.js'));
  const calls = [];
  const helper = {
    getCapabilities: () => ({ outputBudgetTokens: 2000 }),
    fitContextForCurrentModel: (text) => text,
    getPromptTier: () => 'standard',
    deniedDataScopes: (scopes) => scopes.filter((s) => deniedScopes.includes(s)),
    streamChat: async function* (...args) { calls.push(args); yield 'ok'; },
  };
  const temporal = { hasRecentResponses: true, previousResponses: ['PRIOR_ANSWER_SENTINEL from before'], recentTranscript: '', roleContext: '' };
  for await (const _ of new WhatToAnswerLLM(helper).generateStream('Interviewer: TRANSCRIPT_SENTINEL what next?', temporal)) { /* drain */ }
  assert.equal(calls.length, 1);
  return { message: calls[0][0], scopes: calls[0][6] };
}

test('WhatToAnswer sends earlier answers only while profile_history is allowed', async () => {
  const allowed = await whatToAnswerWith([]);
  assert.match(allowed.message, /PRIOR_ANSWER_SENTINEL/);
  assert.deepEqual(allowed.scopes, ['profile_history']);

  const denied = await whatToAnswerWith(['profile_history']);
  assert.doesNotMatch(denied.message, /PRIOR_ANSWER_SENTINEL/);
  assert.match(denied.message, /TRANSCRIPT_SENTINEL/, 'the transcript still goes');
  assert.deepEqual(denied.scopes, []);
});

// Fifth review (PLAN.md AG-17): the meeting chat's context is built in the main process
// from the saved meeting. A saved meeting is profile_history data; its summary parts
// are post_call_summary data too and are left out on request.
test('the meeting chat context carries the scopes of what it contains', () => {
  const { buildMeetingChatContext } = createRequire(import.meta.url)(path.resolve(__dirname, '../../../dist-electron/electron/services/meetingChatContext.js'));
  const meeting = {
    title: 'TITLE_SENTINEL',
    detailedSummary: { overview: 'OVERVIEW_SENTINEL', keyPoints: ['KEYPOINT_SENTINEL'], actionItems: ['ACTION_SENTINEL'] },
    transcript: [{ speaker: 'user', text: 'TRANSCRIPT_SENTINEL one' }, { speaker: 'interviewer', text: 'TRANSCRIPT_SENTINEL two' }],
  };
  const full = buildMeetingChatContext(meeting, true);
  for (const s of ['TITLE_SENTINEL', 'OVERVIEW_SENTINEL', 'KEYPOINT_SENTINEL', 'ACTION_SENTINEL', 'TRANSCRIPT_SENTINEL']) assert.match(full.context, new RegExp(s));
  assert.deepEqual(full.scopes, ['profile_history', 'post_call_summary']);

  const noSummary = buildMeetingChatContext(meeting, false);
  assert.doesNotMatch(noSummary.context, /OVERVIEW_SENTINEL|KEYPOINT_SENTINEL|ACTION_SENTINEL/);
  assert.match(noSummary.context, /TRANSCRIPT_SENTINEL/);
  assert.deepEqual(noSummary.scopes, ['profile_history']);
});

test('the keyword fallback recognizes the meeting chat headings in a window-built context', () => {
  const self = helperWith({}, () => ({}));
  assert.deepEqual(self.inferContextScopes('MEETING: x\n\nSUMMARY:\ny'), ['profile_history', 'post_call_summary']);
  assert.deepEqual(self.inferContextScopes('notes\nKEY POINTS:\n- a'), ['post_call_summary']);
  assert.deepEqual(self.inferContextScopes('plain conversation about a summary of nothing'), []);
});

// Seventh review (PLAN.md AG-17): a scope turned off while a request waits (a provider
// failing, the rate limiter) must stop the sends that follow. Each stub turns the scope
// off at that moment; the later sends must not happen. Data already sent before the
// change cannot be recalled and is not part of this check.
test('meeting summaries stop the fallback chain when a scope is turned off during it', async () => {
  const LLMHelper = loadBuiltLLMHelper();
  for (const [scope, extra] of [['profile_history', ['profile_history']], ['post_call_summary', []], ['transcript', []]]) {
    // Codex fails after the scope is turned off; Groq must not be asked.
    const policy = {};
    const groqRequests = [];
    const self = helperWith(policy, {
      codexCliConfig: { enabled: true, timeoutMs: 1000 },
      generateWithCodexCli: async () => { policy[scope] = false; throw new Error('codex failed'); },
      groqClient: { chat: { completions: { create: async (body) => { groqRequests.push(body); return { choices: [{ message: { content: 'SUMMARY' } }] }; } } } },
      processResponse: (text) => text,
    });
    const result = await LLMHelper.prototype.generateMeetingSummary.call(self, 'SYSTEM', 'TRANSCRIPT_SENTINEL said hello', 'GROQ_SYSTEM', extra);
    assert.equal(result, '', `${scope}: no summary`);
    assert.equal(groqRequests.length, 0, `${scope}: Groq is not asked after the scope was turned off`);
  }

  // Gemini: the first Flash attempt returns nothing after the scope is turned off; no
  // further Flash or Pro attempt is sent, and the refusal ends the chain at once
  // instead of going through the retries and their back-off waits (1 s and more).
  const policy = {};
  const geminiRequests = [];
  const self = helperWith(policy, {
    client: { models: { generateContent: async (body) => { geminiRequests.push(body); policy.profile_history = false; return { text: '' }; } } },
    processResponse: (text) => text,
  });
  const started = Date.now();
  const result = await LLMHelper.prototype.generateMeetingSummary.call(self, 'SYSTEM', 'TRANSCRIPT_SENTINEL said hello', 'GROQ_SYSTEM', ['profile_history']);
  const tookMs = Date.now() - started;
  assert.equal(result, '');
  assert.equal(geminiRequests.length, 1, 'only the attempt sent before the change');
  assert.ok(tookMs < 900, `the refusal ends the chain without retrying (took ${tookMs} ms)`);
});

test('streamChat re-checks its scopes before each send, also after waiting', async () => {
  const run = (self, scopes) => (async () => {
    for await (const _ of self.streamChat('QUESTION', undefined, 'MEETING: Weekly sync\nRECENT TRANSCRIPT:\nCHAT_SENTINEL', undefined, true, true, scopes)) { /* drain */ }
  })();
  const groqStream = (requests) => async (body) => { requests.push(body); return (async function* () { yield { choices: [{ delta: { content: 'ok' } }] }; })(); };

  // 1. Declared scope, turned off while the rate limiter waits: the Groq send is refused.
  for (const scopes of [['profile_history'], []]) {
    const policy = {};
    const requests = [];
    const self = helperWith(policy, {
      currentModelId: 'llama-3.3-70b-versatile',
      personaPrompt: '',
      groqClient: { chat: { completions: { create: groqStream(requests) } } },
      rateLimiters: { groq: { acquire: async () => { policy.profile_history = false; } } },
    });
    let error = null;
    try { await run(self, scopes); } catch (e) { error = e; }
    // With nothing declared, the `MEETING:` context heading carries profile_history.
    assert.equal(error?.name, 'ProviderScopeError', `${JSON.stringify(scopes)}: expected a scope error, got ${error}`);
    assert.equal(requests.length, 0, `${JSON.stringify(scopes)}: nothing may be sent after the scope was turned off`);
  }

  // 2. Fast mode: Codex fails after the scope is turned off; Groq is not asked.
  const policy = {};
  const requests = [];
  const self = helperWith(policy, {
    currentModelId: 'llama-3.3-70b-versatile',
    personaPrompt: '',
    groqFastTextMode: true,
    codexCliConfig: { enabled: true },
    streamWithCodexCli: async function* () { policy.profile_history = false; throw new Error('codex failed'); },
    groqClient: { chat: { completions: { create: groqStream(requests) } } },
  });
  let error = null;
  try { await run(self, ['profile_history']); } catch (e) { error = e; }
  assert.equal(error?.name, 'ProviderScopeError', `fast mode: expected a scope error, got ${error}`);
  assert.equal(requests.length, 0, 'fast mode: Groq is not asked');

  // Control: with nothing turned off the request is sent.
  const open = {};
  const sent = [];
  await run(helperWith(open, { currentModelId: 'llama-3.3-70b-versatile', personaPrompt: '', groqClient: { chat: { completions: { create: groqStream(sent) } } } }), ['profile_history']);
  assert.equal(sent.length, 1, 'with nothing turned off the request is sent');
  assert.match(JSON.stringify(sent[0]), /CHAT_SENTINEL/);
});

test('chatWithGemini keeps the scopes of its context for every send', async () => {
  const policy = {};
  const requests = [];
  const self = helperWith(policy, {
    ...claudeClient((body) => { requests.push(body); throw new Error(SEND_STUB); }),
    rateLimiters: { claude: { acquire: async () => { policy.post_call_summary = false; } }, groq: { acquire: async () => {} }, gemini: { acquire: async () => {} }, openai: { acquire: async () => {} }, deepseek: { acquire: async () => {} } },
  });
  await assert.rejects(() => self.chatWithGemini('QUESTION', undefined, 'MEETING: Weekly sync\n\nSUMMARY:\nSUMMARY_SENTINEL'), { name: 'ProviderScopeError', message: /Data scope denied/ });
  assert.equal(requests.length, 0, 'the context was allowed at the start, but not when Claude was about to be asked');
});
