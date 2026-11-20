// A successful Retry is listed in the usage history under the question the user saw when it
// was first asked, not under its internal question id, and never under the assembled prompt.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { GenerationTask, generationTasks } = require('../../../dist-electron/electron/llm/generateTask.js');
const { IntelligenceEngine } = require('../../../dist-electron/electron/IntelligenceEngine.js');
const { SessionTracker } = require('../../../dist-electron/electron/SessionTracker.js');

const PROMPT = 'SYSTEM: private reference material\n<transcript>meeting context</transcript>\nQ: ';

/** Runs factories inside their task, as LLMHelper.runGeneration does; replays a canned answer. */
class StubLLMHelper {
  constructor(replay) { this.replay = replay; this.replayed = []; }
  getCurrentGenerationTask() { return generationTasks.getStore(); }
  beginGenerationTask() { return new GenerationTask({ target: { provider: 'synthetic', model: 'stub' } }); }
  async runGeneration(factory, _kind, _signal, supplied) {
    const inherited = generationTasks.getStore();
    const task = supplied ?? inherited ?? this.beginGenerationTask();
    try { return await generationTasks.run(task, factory); }
    catch (error) { task.terminalStatus ??= 'failed'; throw error; }
    finally { if (task !== inherited) task.close(); }
  }
  getTaskMetadata(task) { return { requestId: task.requestId, questionId: task.questionId, retryOf: task.retryOf, provider: 'synthetic', model: 'stub', status: task.terminalStatus }; }
  deniedDataScopes() { return []; }
  async *replayPrepared(input) { this.replayed.push(input); yield* this.replay; }
}

/** The task a Retry click begins: same question id, new request id (LLMHelper.beginPreparedRetry). */
function retryTask(helper, prior) {
  const task = helper.beginGenerationTask();
  task.entryPoint = prior.entryPoint; task.questionId = prior.questionId; task.retryOf = prior.requestId;
  return task;
}

/** Ends the meeting as MeetingPersistence does: the saved usage is the session's full usage. */
const endMeeting = session => [...session.getFullUsage()];

test('What to Answer with a typed question: fails, Retry succeeds, history shows the question and the retry answer', async () => {
  const session = new SessionTracker();
  const helper = new StubLLMHelper(['RETRY ', 'ANSWER']);
  const engine = new IntelligenceEngine(helper, session);
  const question = '如何设计一个分布式限流器？';
  engine.whatToAnswerLLM = { async *generateStream() { throw Object.assign(new Error('provider down'), { status: 500 }); } };

  const first = helper.beginGenerationTask(); first.entryPoint = 'what-to-say';
  await assert.rejects(() => helper.runGeneration(
    () => engine.runWhatShouldISay(question, 0.8, undefined, { skipCooldown: true, errorDelivery: 'caller' }), 'interview', undefined, first), /provider down/);
  assert.equal(endMeeting(session).some(entry => entry.answer === 'RETRY ANSWER'), false);

  const retry = retryTask(helper, first);
  const answer = await helper.runGeneration(() => engine.runPreparedRetry({ userContent: PROMPT + question }), 'interview', undefined, retry);
  assert.equal(answer, 'RETRY ANSWER');
  assert.equal(helper.replayed.length, 1);

  const usage = endMeeting(session);
  const retried = usage.filter(entry => entry.answer === 'RETRY ANSWER');
  assert.equal(retried.length, 1);
  assert.equal(retried[0].question, question);
  assert.equal(retried[0].type, 'assist');
  // The id still links the answer to its question, internally.
  assert.equal(retried[0].questionId, first.questionId);
  assert.equal(retried[0].retryOf, first.requestId);
  for (const entry of usage) {
    assert.notEqual(entry.question, first.questionId, 'no history row is labelled with the question id');
    assert.doesNotMatch(String(entry.question), /private reference material|meeting context/, 'the assembled prompt is never a label');
  }
});

test('a quick action without its own question is listed under the action name after Retry', async () => {
  const session = new SessionTracker();
  session.handleTranscript({ speaker: 'interviewer', text: 'Tell me about your last project', timestamp: Date.now() - 2000, final: true });
  const helper = new StubLLMHelper(['A short recap']);
  const engine = new IntelligenceEngine(helper, session);
  engine.recapLLM = { async *generateStream() { throw new Error('recap failed'); } };

  const first = helper.beginGenerationTask(); first.entryPoint = 'recap';
  // Recap reports its failure through the error event and returns null.
  engine.on('error', () => {});
  assert.equal(await helper.runGeneration(() => engine.runRecap(), 'interview', undefined, first), null);

  const retry = retryTask(helper, first);
  assert.equal(await helper.runGeneration(() => engine.runPreparedRetry({ userContent: PROMPT }), 'interview', undefined, retry), 'A short recap');
  const row = endMeeting(session).find(entry => entry.answer === 'A short recap');
  assert.equal(row.question, 'Recap Meeting');
  assert.equal(row.type, 'chat');
});

test('a Retry whose question label is not held falls back to the entry point name, never the id', async () => {
  const session = new SessionTracker();
  const helper = new StubLLMHelper(['Hint text']);
  const engine = new IntelligenceEngine(helper, session);
  const retry = helper.beginGenerationTask();
  retry.entryPoint = 'code-hint'; retry.questionId = 'a7f1c2d4-0000-4000-8000-000000000000';
  await helper.runGeneration(() => engine.runPreparedRetry({ userContent: PROMPT }), 'interview', undefined, retry);
  const row = endMeeting(session).find(entry => entry.answer === 'Hint text');
  assert.equal(row.question, 'Code Hint');
  assert.notEqual(row.question, retry.questionId);
});
