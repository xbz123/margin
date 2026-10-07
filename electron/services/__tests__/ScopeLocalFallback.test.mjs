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

// Third review (PLAN.md AG-17): the non-streaming Claude and Groq multimodal sends had
// no scope check of their own, and Gemini requests with inline images were not seen as
// screenshots. Each send below is replaced by a stub that records the request and
// throws, so an allowed call proves the check sits in front of the send.
const SEND_STUB = 'send-stub-reached';

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

// Static sweep: every call in LLMHelper.ts that sends to a cloud provider must have a
// scope check earlier in the same method. A new send without one fails here.
test('every cloud send in LLMHelper.ts is preceded by a scope check in its method', () => {
  const lines = read('electron/LLMHelper.ts').split('\n');
  const SEND = /\.chat\.completions\.create\(|\.models\.generateContent(?:Stream)?\(|\.messages\.(?:create|stream)\(|CodexCliService\.(?:run|stream)\(/;
  const METHOD = /^ {2}(?:public |private |protected )?(?:static )?(?:async )?(?:\* ?)?[A-Za-z_]\w*\s*\(/;
  const CHECK = /assertOutboundScopes\(|assertGeminiContents\(|getDeniedDataScopes\(\[/;
  const sends = [];
  lines.forEach((line, i) => {
    if (!SEND.test(line) || /^\s*(?:\/\/|\*)/.test(line)) return;
    let start = i;
    while (start > 0 && !METHOD.test(lines[start])) start--;
    const checked = lines.slice(start, i).some((l) => CHECK.test(l));
    sends.push({ line: i + 1, method: lines[start].trim().slice(0, 60), checked });
  });
  assert.ok(sends.length >= 20, `found only ${sends.length} sends; the pattern no longer matches the code`);
  assert.deepEqual(sends.filter((s) => !s.checked), [], 'sends without a scope check');
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
