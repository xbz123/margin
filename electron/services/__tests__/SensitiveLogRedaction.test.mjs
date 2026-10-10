import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import os from 'node:os';
import { inspect } from 'node:util';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

test('SessionTracker logs transcript and assistant message metadata without text snippets', () => {
  const source = read('electron/SessionTracker.ts');

  assert.match(source, /Coding question stored`, \{ source, length: trimmed\.length \}/);
  assert.match(source, /addAssistantMessage called`, \{ length: text\.length \}/);
  assert.match(source, /RX User Segment`, \{ final: segment\.final, length: segment\.text\.length \}/);
  assert.match(source, /RX Interviewer Segment`, \{ final: segment\.final, length: segment\.text\.length \}/);
  assert.match(source, /Force-saving pending interim transcript', \{ length: this\.lastInterimInterviewer\.text\.length \}/);
  assert.doesNotMatch(source, /console\.log[\s\S]{0,120}substring\(/);
  assert.doesNotMatch(source, /Force-saving pending interim transcript:', this\.lastInterimInterviewer\.text/);
  assert.doesNotMatch(source, /transcriptEpochSummaries\.push\([^\n]*(substring|\.text)/);
  assert.doesNotMatch(source, /Earlier discussion[^`]*\$\{oldEntries\.slice/);
});

test('IntelligenceEngine logs interim transcript metadata without text snippets', () => {
  const source = read('electron/IntelligenceEngine.ts');

  assert.match(source, /Speculative inference fired on interim`, \{ length: text\.length, confidence \}/);
  assert.match(source, /Injecting interim transcript`, \{ length: lastInterim\.text\.length \}/);
  assert.doesNotMatch(source, /console\.log[\s\S]{0,120}substring\(/);
});

test('LLMHelper actual chat and stream paths never log prompt, context, system or response text', async () => {
  const source = read('electron/LLMHelper.ts');
  assert.doesNotMatch(source, /console\.log[\s\S]{0,120}message\.substring\(/);
  assert.doesNotMatch(source, /console\.log[\s\S]{0,120}JSON\.stringify\(data\)\.substring\(/);

  const require = createRequire(import.meta.url);
  const electronId = require.resolve('electron');
  const previous = require.cache[electronId];
  require.cache[electronId] = { id: electronId, filename: electronId, loaded: true, exports: { app: { getPath: () => os.tmpdir(), isPackaged: true, getVersion: () => '0.0.0' } } };
  let LLMHelper;
  try { ({ LLMHelper } = require(path.join(root, 'dist-electron/electron/LLMHelper.js'))); }
  finally { if (previous) require.cache[electronId] = previous; else delete require.cache[electronId]; }
  const sentinels = ['PRIVATE_PROMPT_SENTINEL', 'PRIVATE_CONTEXT_SENTINEL', 'PRIVATE_SYSTEM_SENTINEL', 'PRIVATE_RESPONSE_SENTINEL'];
  let sends = 0;
  const helper = Object.assign(Object.create(LLMHelper.prototype), {
    selectedTarget: { provider: 'openai', protocol: 'chat-completions', model: 'synthetic-model' },
    currentModelId: 'synthetic-model', personaPrompt: '', customNotes: '', aiResponseLanguage: 'English',
    codexCliConfig: { enabled: false }, getProviderScopePolicy: () => ({}),
    openaiClient: { chat: { completions: { create: async body => {
      sends++;
      return body.stream ? (async function* () {
        yield { choices: [{ delta: { content: sentinels[3] } }] };
        yield { choices: [{ delta: {}, finish_reason: 'stop' }] };
      })() : { choices: [{ message: { content: sentinels[3] }, finish_reason: 'stop' }] };
    } } } },
  });
  const entries = [];
  const originalConsole = Object.fromEntries(['log', 'warn', 'error'].map(level => [level, console[level]]));
  try {
    for (const level of Object.keys(originalConsole)) console[level] = (...args) => entries.push(args.map(arg => inspect(arg)).join(' '));
    assert.equal(await helper.chatWithGemini(sentinels[0], undefined, sentinels[1]), sentinels[3]);
    let streamed = '';
    for await (const chunk of helper.streamChat(sentinels[0], undefined, sentinels[1], sentinels[2], true, true)) streamed += chunk;
    assert.equal(streamed, sentinels[3]);
  } finally { Object.assign(console, originalConsole); }
  assert.equal(sends, 2, 'both actual public paths reached the synthetic transport');
  for (const sentinel of sentinels) assert.ok(!entries.join('\n').includes(sentinel), `${sentinel} must not appear in logs`);
});

test('STT providers log transcript metadata without transcript text', () => {
  const files = [
    'electron/audio/GoogleSTT.ts',
    'electron/audio/RestSTT.ts',
    'electron/audio/DeepgramStreamingSTT.ts',
    'electron/audio/OpenAIStreamingSTT.ts',
    'electron/audio/ElevenLabsStreamingSTT.ts',
  ];

  for (const file of files) {
    const source = read(file);
    assert.doesNotMatch(source, /console\.log[\s\S]{0,180}(transcript|msg\.text)[\s\S]{0,100}substring\(/, file);
    assert.doesNotMatch(source, /console\.log[\s\S]{0,180}text="\$\{transcript/, file);
    assert.doesNotMatch(source, /console\.log[\s\S]{0,180}JSON\.stringify\(msg\)\.(slice|substring)/, file);
    assert.doesNotMatch(source, /console\.log[\s\S]{0,180}apiKey\?\.slice/, file);
  }
});

test('IPC and meeting summary logs avoid answer and LLM response snippets', () => {
  const ipc = read('electron/ipcHandlers.ts');
  const persistence = read('electron/MeetingPersistence.ts');
  const intent = read('electron/llm/IntentClassifier.ts');

  assert.match(ipc, /gemini - chat response received`, \{ length: result\?\.length \?\? 0 \}/);
  assert.match(ipc, /Updated IntelligenceManager\.Last message`,[\s\S]{0,120}length: intelligenceManager\.getLastAssistantMessage\(\)\?\.length \?\? 0/);
  assert.doesNotMatch(ipc, /console\.log[\s\S]{0,140}result\.substring\(/);
  assert.doesNotMatch(ipc, /console\.log[\s\S]{0,140}getLastAssistantMessage\(\)\?\.substring\(/);

  assert.match(persistence, /LLM summary response received', \{ length: jsonStr\.length \}/);
  assert.match(persistence, /Failed to parse summary JSON', \{ responseLength: jsonStr\.length, error: e \}/);
  assert.doesNotMatch(persistence, /Raw LLM summary response/);
  assert.doesNotMatch(persistence, /Raw response:', jsonStr\.substring/);

  assert.doesNotMatch(intent, /text\.substring\(/);
});
