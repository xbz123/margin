// What to Answer sends the interviewer's latest words as the explicit question and reports them
// with the answer events; without interviewer speech it keeps inferring from the transcript.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { GenerationTask } = require('../../../dist-electron/electron/llm/generateTask.js');
const { IntelligenceEngine } = require('../../../dist-electron/electron/IntelligenceEngine.js');
const { SessionTracker } = require('../../../dist-electron/electron/SessionTracker.js');
const { PromptAssembler } = require('../../../dist-electron/electron/services/context/PromptAssembler.js');
const { insertWhatToSayQuestionMessages } = await import('../../../src/lib/overlayMessagePersistence.mjs');

class StubLLMHelper {
  getCurrentGenerationTask() { return undefined; }
  async runGeneration(factory, _kind, _signal, task) { try { return await factory(); } finally { task?.close(); } }
  beginGenerationTask() { return new GenerationTask({ provider: 'synthetic', model: 'stub' }); }
  getTaskMetadata(task) { return { requestId: task.requestId, provider: 'synthetic', model: 'stub', attempts: 0, partial: false }; }
  runGenerationStream(factory) { return factory(); }
  getSettingsManager() { return { get: () => null, set: () => {} }; }
}

const segment = (key, channel, text, firstSeenAt, final = true) => ({ key, channel, text, final, revision: 1, firstSeenAt });
const speech = (cutoffAt, user, interviewer) => ({ sessionId: 'meeting', cutoffAt, frozenAt: cutoffAt + 10,
  channels: { user: { segments: user, reason: 'complete' }, interviewer: { segments: interviewer, reason: 'deadline' } } });

/** Runs a manual What to Answer press over the frozen view and records what the model and renderer get. */
async function press(build) {
  const session = new SessionTracker();
  const cutoff = Date.now();
  const frozen = build(session, cutoff);
  const view = session.frozenView(frozen, session.captureBase(cutoff));
  const engine = new IntelligenceEngine(new StubLLMHelper(), session);
  const calls = [], tokens = [], finals = [];
  engine.whatToAnswerLLM = {
    async *generateStream(transcript, _temporal, _intent, _images, _screen, currentQuestion) {
      calls.push({ transcript, currentQuestion });
      yield 'ANSWER';
    },
  };
  engine.on('suggested_answer_token', (_token, question) => tokens.push(question));
  engine.on('suggested_answer', (_answer, question) => finals.push(question));
  const answer = await engine.runWhatShouldISayInner(undefined, 0.8, undefined, { manual: true, view });
  assert.equal(answer, 'ANSWER');
  assert.equal(calls.length, 1);
  return { ...calls[0], tokens, finals };
}

test('the interviewer\'s last four final turns, oldest first, are the question; the transcript keeps everything', async () => {
  const result = await press((session, cutoff) => {
    ['Q1 earlier topic', 'Q2 tell me about caching', 'Q3 which eviction policy', 'Q4 and why LRU'].forEach((text, i) =>
      session.handleTranscript({ speaker: 'interviewer', text, timestamp: cutoff - 9000 + i * 1000, final: true }));
    session.handleTranscript({ speaker: 'user', text: 'my own words', timestamp: cutoff - 4500, final: true });
    session.handleTranscript({ speaker: 'interviewer', text: 'Q5 under memory pressure?', timestamp: cutoff - 4000, final: true });
    return speech(cutoff, [], []);
  });
  const expected = 'Q2 tell me about caching\nQ3 which eviction policy\nQ4 and why LRU\nQ5 under memory pressure?';
  assert.equal(result.currentQuestion, expected);
  assert.match(result.transcript, /Q1 earlier topic/i, 'older turns stay as background');
  assert.deepEqual([...new Set(result.tokens)], [expected]);
  assert.deepEqual(result.finals, [expected]);

  const packet = new PromptAssembler().assemble({ transcript: 'BACKGROUND', currentQuestion: result.currentQuestion, tokenBudget: 4000, systemPrompt: '' });
  assert.match(packet.userMessage, /<current_question[^>]*>[\s\S]*Q5 under memory pressure\?[\s\S]*<\/current_question>[\s\S]*<transcript/);
  assert.match(packet.userMessage, /last line is the newest[\s\S]*Answer the newest complete question/);
  const withImage = new PromptAssembler().assemble({ transcript: 'BACKGROUND', currentQuestion: result.currentQuestion, hasImages: true, tokenBudget: 4000, systemPrompt: '' });
  assert.match(withImage.userMessage, /only to understand what is being asked; the attached screenshot is the primary request/);
  assert.doesNotMatch(withImage.userMessage, /Answer the newest complete question/);

  // The renderer shows the same words just above the answer row.
  const rows = insertWhatToSayQuestionMessages([{ id: 'answer', role: 'system', text: '' }], 'answer', result.finals[0], 'q');
  assert.deepEqual(rows.map(row => [row.role, row.text]), [['interviewer', expected], ['system', '']]);
});

test('an unfinished interviewer turn frozen at the press is the question', async () => {
  const result = await press((_session, cutoff) => speech(cutoff, [],
    [segment('interviewer:1:a', 'interviewer', 'How would you shard this', cutoff - 300, false)]));
  assert.equal(result.currentQuestion, 'How would you shard this');
  assert.deepEqual(result.finals, ['How would you shard this']);
});

test('without interviewer speech nothing is named and no bubble is shown, as before', async () => {
  const result = await press((_session, cutoff) => speech(cutoff, [segment('user:1:a', 'user', 'thinking aloud', cutoff - 300)], []));
  assert.equal(result.currentQuestion, undefined);
  assert.deepEqual([...new Set(result.tokens)], ['inferred']);
  assert.deepEqual(result.finals, ['What to Answer']);
  const rows = [{ id: 'answer', role: 'system', text: '' }];
  assert.equal(insertWhatToSayQuestionMessages(rows, 'answer', result.finals[0], 'q'), rows);
  const packet = new PromptAssembler().assemble({ transcript: 'BACKGROUND', tokenBudget: 4000, systemPrompt: '' });
  assert.doesNotMatch(packet.userMessage, /current_question/);
});
