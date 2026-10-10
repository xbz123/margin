import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import os from 'node:os';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');

async function loadRouter() {
  const routerPath = path.resolve(__dirname, '../../../dist-electron/electron/llm/ProviderRouter.js');
  return import(pathToFileURL(routerPath).href);
}

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
    currentModelId: 'llama-3.3-70b-versatile', selectedTarget: { provider: 'groq', protocol: 'chat-completions', model: 'llama-3.3-70b-versatile' },
    codexCliConfig: { enabled: false },
    groqClient: { chat: { completions: { create: async (body) => { requests.push(body); return { choices: [{ message: { content: 'SUMMARY' }, finish_reason: 'stop' }] }; } } } },
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
    getProviderScopePolicy: () => policy, personaPrompt: '', aiResponseLanguage: 'auto',
  });
  try {
    if (entry === 'stream') {
      for await (const _ of self.streamChat('TRANSCRIPT_SENTINEL said hello')) { /* drain */ }
    } else {
      await self.chatWithGemini('TRANSCRIPT_SENTINEL said hello');
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
      const model = { groq: 'llama-3.3-70b-versatile', openai: 'gpt-5.4', claude: 'claude-sonnet-4-6', deepseek: 'deepseek-v4-flash' }[provider];
      self.setModel(`llm-target:${provider}:${provider === 'claude' ? 'messages' : 'chat-completions'}:${model}`);
      const calls = { [provider]: () => self.chatWithGemini('SCOPE_SENTINEL') };
      await assert.rejects(calls[provider]);
      assert.equal(requests, 1, 'no hidden SDK replay after the scope closes');
      assert.equal(client.maxRetries, 0);
    });
  }
}

test('vision denial is terminal without another send', async () => {
  const self = helperWith({ screenshots: false }, geminiClient(() => { throw Error('must not send'); }));
  await assert.rejects(() => drain(self.streamChat('QUESTION', NO_IMAGE, undefined, undefined, true, true, ['screenshots'])), { name: 'ProviderScopeError' });
});

test('Gemini explicit backup preserves refusal without a speculative sibling', async () => {
  const { ProviderScopeError } = await loadRouter();
  const denied = new ProviderScopeError('gemini', ['transcript']);
  const attempted = [];
  const self = helperWith({}, geminiClient(body => { attempted.push(body.model); throw denied; }));
  self.setGenerationPolicy({ ...self.getGenerationPolicy(), backupModel: 'llm-target:gemini:gemini:backup' });
  await assert.rejects(() => drain(self.streamChat('QUESTION')), error => error === denied);
  assert.equal(attempted.length, 1);
});

test('Gemini explicit backup recovers a transient failure, while cancellation terminates it', async () => {
  const attempted = [];
  const self = helperWith({}, geminiClient(body => {
    attempted.push(body.model); if (attempted.length === 1) throw Object.assign(Error('overloaded'), { status: 503 }); return complete('BACKUP_RESULT');
  }));
  self.setGenerationPolicy({ ...self.getGenerationPolicy(), backupModel: 'llm-target:gemini:gemini:backup' });
  assert.equal(await collect(self.streamChat('QUESTION')), 'BACKUP_RESULT');
  assert.deepEqual(attempted, ['gemini-test', 'backup']);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(() => collect(self.streamChat('QUESTION', undefined, undefined, undefined, false, false, [], controller.signal)), { name: 'AbortError' });
  assert.equal(attempted.length, 2);
});

test('an aborted Gemini collection cannot send after its cache wait', async () => {
  const controller = new AbortController(); let sends = 0;
  const self = helperWith({}, geminiClient(() => { sends++; return complete(); }));
  self.geminiPromptCache.getOrCreate = async () => { controller.abort(); return null; };
  await assert.rejects(() => collect(self.streamChat('QUESTION', undefined, undefined, 'SYSTEM', true, true, [], controller.signal)), { name: 'AbortError' });
  assert.equal(sends, 0);
});

const drain = async stream => { for await (const _ of stream) { /* drain */ } };
const collect = async stream => { let text = ''; for await (const chunk of stream) text += chunk; return text; };
const complete = (text = 'ANSWER') => ({ text, candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }] });

test('prompt wrappers propagate a refusal instead of inventing an answer', async () => {
  loadBuiltLLMHelper();
  const { ProviderScopeError, rethrowProviderScopeError } = await loadRouter();
  const denied = new ProviderScopeError('test', ['transcript']);
  assert.throws(() => rethrowProviderScopeError(new AggregateError([new Error('ordinary'), new AggregateError([denied])])), error => error === denied);
  const helper = {
    runGeneration: factory => factory(), runGenerationStream: factory => factory(),
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
  const LLMHelper = loadBuiltLLMHelper();
  const { ProviderScopeError } = await loadRouter();
  const { IntelligenceEngine } = createRequire(import.meta.url)(path.join(repoRoot, 'dist-electron/electron/IntelligenceEngine.js'));
  const denied = new ProviderScopeError('test', ['transcript']);
  const events = [];
  const engine = Object.assign(Object.create(IntelligenceEngine.prototype), {
    llmHelper: Object.assign(Object.create(LLMHelper.prototype), { selectedTarget: { provider: 'gemini', protocol: 'gemini', model: 'gemini-test' } }),
    session: { getFormattedContext: () => 'CONTEXT', pushUsage() {} },
    answerLLM: { generate: async () => { throw denied; } },
    emit: (...args) => events.push(args),
    setMode: mode => events.push(['mode', mode]),
  });
  await assert.rejects(() => engine.runWhatShouldISay('QUESTION'), error => error === denied);
  assert.deepEqual(events, [['mode', 'what_to_say'], ['error', denied, 'what_to_say'], ['mode', 'idle']]);
  events.length = 0;
  await assert.rejects(() => engine.runWhatShouldISay('QUESTION', 0.8, undefined, { skipCooldown: true, errorDelivery: 'caller' }), error => error === denied);
  assert.deepEqual(events, [['mode', 'what_to_say'], ['mode', 'idle']], 'IPC caller displays the rejection without an unaddressed duplicate event');
});

test('default chat routing refuses transcript denial but can omit denied history', async () => {
  const policy = { transcript: false }; const messages = [];
  const self = helperWith(policy, geminiClient(body => { messages.push(body); return complete('ANSWER'); }));
  await assert.rejects(() => self.chatWithGemini('QUESTION'), { name: 'ProviderScopeError' });
  assert.equal(messages.length, 0);
  policy.transcript = true; policy.profile_history = false;
  assert.equal(await self.chatWithGemini('QUESTION', undefined, 'MEETING: SECRET_HISTORY'), 'ANSWER');
  assert.doesNotMatch(JSON.stringify(messages), /SECRET_HISTORY/);
});

const denialRoutes = [
  ['non-streaming chat', self => self.chatWithGemini('QUESTION')],
  ['structured generation', self => self.generateContentStructured('QUESTION')],
  ['streaming text', self => drain(self.streamChatWithGemini('QUESTION'))],
  ['streaming images', self => drain(self.streamChat('QUESTION', NO_IMAGE))],
  ['fixed Pro', self => self.generateWithPro([{ text: 'QUESTION' }])],
  ['fixed Flash', self => self.generateWithFlash([{ text: 'QUESTION' }])],
];
for (const [name, run] of denialRoutes) test(`${name}: scope refusal stays terminal with an explicit backup`, async () => {
  const { ProviderScopeError } = await loadRouter(); const denied = new ProviderScopeError('test', ['transcript']);
  const calls = []; const self = helperWith({}, geminiClient(body => { calls.push(body.model); throw denied; }));
  self.setGenerationPolicy({ ...self.getGenerationPolicy(), backupModel: 'llm-target:gemini:gemini:backup' });
  await assert.rejects(() => run(self), error => error === denied);
  assert.equal(calls.length, 1);
});

for (const refuseAt of [1, 2]) test(`selected Gemini preserves scope refusal at limiter wait ${refuseAt}`, async () => {
  const policy = {}; let waits = 0; let sends = 0;
  const self = helperWith(policy, geminiClient(() => { sends++; throw Object.assign(Error('overloaded'), { status: 503 }); }));
  self.rateLimiters.gemini.acquire = async () => { if (++waits === refuseAt) policy.transcript = false; };
  await assert.rejects(() => self.chatWithGemini('QUESTION'), { name: 'ProviderScopeError' });
  assert.equal(sends, refuseAt - 1); assert.equal(waits, refuseAt);
});

function helperWith(policy, fields) {
  const LLMHelper = loadBuiltLLMHelper();
  const noLimit = { acquire: async () => {} };
  return Object.assign(Object.create(LLMHelper.prototype), {
    codexCliConfig: { enabled: false }, personaPrompt: '', customNotes: '', aiResponseLanguage: 'auto',
    currentModelId: 'gemini-test', selectedTarget: { provider: 'gemini', protocol: 'gemini', model: 'gemini-test' },
    processImage: async () => ({ mimeType: 'image/png', data: 'AAAA' }),
    geminiPromptCache: { getOrCreate: async () => null, invalidate() {} },
    processResponse: text => text,
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

const chosen = (provider, protocol, model) => ({ currentModelId: model, selectedTarget: { provider, protocol, model,
  ...(provider === 'gemini' ? { imageSupportConfirmedFor: JSON.stringify([provider, protocol, 'https://generativelanguage.googleapis.com', model]) } : {}),
} });
const claudeClient = send => ({ ...chosen('claude', 'messages', 'claude-sonnet-4-6'), claudeClient: { messages: { create: send } } });
const groqClient = send => ({ ...chosen('groq', 'chat-completions', 'synthetic-image-model'), selectedTarget: { provider: 'groq', protocol: 'chat-completions', model: 'synthetic-image-model', imageSupportConfirmedFor: JSON.stringify(['groq', 'chat-completions', 'https://api.groq.com/openai/v1', 'synthetic-image-model']) }, groqClient: { chat: { completions: { create: send } } } });
const geminiClient = send => ({ ...chosen('gemini', 'gemini', 'gemini-test'), client: { models: { generateContent: send, generateContentStream: async body => [await send(body)] } } });
const NO_IMAGE = ['/margin-test/screenshot-synthetic.png'];
const directSends = [['Claude', claudeClient], ['Groq images', groqClient], ['Gemini images', geminiClient]];
for (const [name, makeClient] of directSends) test(`${name} sends nothing when a declared transcript or screenshot scope is denied`, async () => {
  const call = self => drain(self.streamChat('TRANSCRIPT_SENTINEL said hello', NO_IMAGE, undefined, undefined, true, true, ['screenshots']));
  const allowed = await sendWith({}, makeClient, call);
  assert.match(String(allowed.error?.message), new RegExp(SEND_STUB)); assert.equal(allowed.requests.length, 1);
  assert.match(JSON.stringify(allowed.requests), /TRANSCRIPT_SENTINEL/);
  for (const policy of [{ transcript: false }, { screenshots: false }]) {
    const denied = await sendWith(policy, makeClient, call);
    assert.equal(denied.error?.name, 'ProviderScopeError'); assert.equal(denied.requests.length, 0);
  }
});

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

// Retired multi-provider rotations are covered through the selected structured/fixed entries.
const geminiOnly = geminiClient;
const branchSends = [
  ['generateContentStructured', self => self.generateContentStructured('TRANSCRIPT_SENTINEL')],
  ['generateWithPro', self => self.generateWithPro([{ text: 'TRANSCRIPT_SENTINEL' }])],
  ['generateWithFlash', self => self.generateWithFlash([{ text: 'TRANSCRIPT_SENTINEL' }])],
  ['streamChat selected model', self => drain(self.streamChat('TRANSCRIPT_SENTINEL'))],
];
for (const [name, call] of branchSends) test(`${name} refuses transcript denial at the actual send boundary`, async () => {
  const allowed = await sendWith({}, geminiOnly, call); assert.equal(allowed.requests.length, 1);
  const denied = await sendWith({ transcript: false }, geminiOnly, call);
  assert.equal(denied.error?.name, 'ProviderScopeError'); assert.equal(denied.requests.length, 0);
});

// Fourth review, finding 1: scopes the caller declares for a request describe data
// that may sit in the message itself. streamChat must refuse the request when one of
// them is denied, even with the transcript allowed.
const openaiClient = (send) => ({ ...chosen('openai', 'chat-completions', 'gpt-5.4'), openaiClient: { chat: { completions: { create: send } } }, currentModelId: 'gpt-5.4', personaPrompt: '' });

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
    runGeneration: factory => factory(), runGenerationStream: factory => factory(),
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

test('meeting summaries stop the explicit backup when a scope is turned off after the first send', async () => {
  for (const [scope, extra] of [['profile_history', ['profile_history']], ['post_call_summary', []], ['transcript', []]]) {
    const policy = {}; const requests = [];
    const self = helperWith(policy, geminiClient(body => { requests.push(body); policy[scope] = false; throw Object.assign(Error('overloaded'), { status: 503 }); }));
    self.setGenerationPolicy({ ...self.getGenerationPolicy(), backupModel: 'llm-target:gemini:gemini:backup' });
    assert.equal(await self.generateMeetingSummary('SYSTEM', 'TRANSCRIPT_SENTINEL', undefined, extra), '');
    assert.equal(requests.length, 1, `${scope}: no backup after revocation`);
  }
});

test('streamChat keeps declared and inferred context scopes through the limiter and explicit backup', async () => {
  for (const declared of [['profile_history'], []]) {
    const policy = {}; const requests = [];
    const self = helperWith(policy, geminiClient(body => { requests.push(body); return complete(); }));
    self.rateLimiters.gemini.acquire = async () => { policy.profile_history = false; };
    await assert.rejects(() => drain(self.streamChat('QUESTION', undefined, 'MEETING: Weekly sync\nCHAT_SENTINEL', undefined, true, true, declared)), { name: 'ProviderScopeError' });
    assert.equal(requests.length, 0);
  }
  for (const revoke of [true, false]) {
    const policy = {}; const requests = [];
    const self = helperWith(policy, geminiClient(body => {
      requests.push(body);
      if (requests.length === 1) { if (revoke) policy.profile_history = false; throw Object.assign(Error('overloaded'), { status: 503 }); }
      return complete();
    }));
    self.setGenerationPolicy({ ...self.getGenerationPolicy(), backupModel: 'llm-target:gemini:gemini:backup' });
    const run = () => drain(self.streamChat('QUESTION', undefined, 'MEETING: Weekly sync\nCHAT_SENTINEL'));
    if (revoke) await assert.rejects(run, { name: 'ProviderScopeError' }); else await run();
    assert.equal(requests.length, revoke ? 1 : 2); assert.match(JSON.stringify(requests[0]), /CHAT_SENTINEL/);
  }
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
