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

const { IntelligenceManager } = require('../../../dist-electron/electron/IntelligenceManager.js');

// gemini-chat-stream (typed 'text' and spoken 'answer' entry points) registers the message the
// user sent; a failed first attempt logs it as a 'chat' row, and so must a successful Retry.
for (const entryPoint of ['text', 'answer']) {
  test(`a ${entryPoint} chat question: fails, Retry succeeds, history shows the original message and the retry answer`, async () => {
    const helper = new StubLLMHelper(['CHAT ', 'RETRY']);
    const manager = new IntelligenceManager(helper);
    const message = 'What is the difference between a mutex and a semaphore?';
    const first = helper.beginGenerationTask(); first.entryPoint = entryPoint;
    // As ipcHandlers does right after attachPresentation.
    manager.rememberQuestion(first, 'chat', message);
    // The handler's failure path logs the question with the (empty) partial answer.
    manager.logUsage('chat', message, '', helper.getTaskMetadata(first));

    const retry = retryTask(helper, first);
    const answer = await helper.runGeneration(() => manager.runPreparedRetry({ userContent: PROMPT + message }), 'written', undefined, retry);
    assert.equal(answer, 'CHAT RETRY');
    const row = endMeeting(manager.session).find(entry => entry.answer === 'CHAT RETRY');
    // The same type and question a first-try success records: logUsage('chat', message, answer).
    assert.equal(row.type, 'chat');
    assert.equal(row.question, message);
    assert.equal(row.retryOf, first.requestId);
    assert.doesNotMatch(row.question, /private reference material|meeting context/);
  });
}

test('the chat stream handler registers the user message for its retry label', async () => {
  const fs = await import('node:fs');
  const source = fs.readFileSync(new URL('../../ipcHandlers.ts', import.meta.url), 'utf8');
  const handler = source.slice(source.indexOf("'gemini-chat-stream',"), source.indexOf("safeOn('gemini-chat-stream-stop'"));
  // The message, plus the localized text the window showed for it (screenshot-only questions).
  assert.match(handler, /rememberQuestion\(chatTask, 'chat', message, displayQuestion\)/);
  // The success path logs the same type, message and display text.
  assert.match(handler, /logUsage\('chat', message, fullResponse, llmHelper\.getTaskMetadata\(chatTask\), displayQuestion\)/);
});

test('manual What to Answer without a question: the Retry row matches what a success records', async () => {
  const session = new SessionTracker();
  session.handleTranscript({ speaker: 'interviewer', text: 'How would you shard this table?', timestamp: Date.now() - 2000, final: true });
  const helper = new StubLLMHelper(['RETRY SHARD']);
  const engine = new IntelligenceEngine(helper, session);
  engine.whatToAnswerLLM = { async *generateStream() { yield 'FIRST SHARD'; } };

  // A manual press checks that an answer model is configured.
  const manualTask = () => {
    const task = new GenerationTask({ kind: 'api', client: {}, target: { provider: 'synthetic', model: 'stub' } });
    task.entryPoint = 'what-to-say';
    return task;
  };
  const success = manualTask();
  await helper.runGeneration(() => engine.runWhatShouldISay(undefined, 0.8, undefined, { manual: true, skipCooldown: true, errorDelivery: 'caller' }), 'interview', undefined, success);
  const succeeded = endMeeting(session).find(entry => entry.answer === 'FIRST SHARD');
  assert.ok(succeeded, 'the success path recorded a row');

  engine.whatToAnswerLLM = { async *generateStream() { throw Object.assign(new Error('provider down'), { status: 500 }); } };
  const first = manualTask();
  await assert.rejects(() => helper.runGeneration(
    () => engine.runWhatShouldISay(undefined, 0.8, undefined, { manual: true, skipCooldown: true, errorDelivery: 'caller' }), 'interview', undefined, first), /provider down/);
  const retry = retryTask(helper, first);
  await helper.runGeneration(() => engine.runPreparedRetry({ userContent: PROMPT }), 'interview', undefined, retry);
  const retried = endMeeting(session).find(entry => entry.answer === 'RETRY SHARD');
  assert.equal(retried.type, succeeded.type);
  assert.equal(retried.question, succeeded.question);
  assert.equal(retried.question, 'What to Answer');
});

// A failed or cancelled Retry is listed under the same label a successful Retry records, with
// the localized text the user saw, never under the internal 'generation outcome' label.
const SHOWN = '直接解答截图中的题目';
const SCREENSHOT_MESSAGE = 'Solve the question in this screenshot directly';

async function failingRetry(outcome) {
  const helper = new StubLLMHelper([]);
  const manager = new IntelligenceManager(helper);
  const first = helper.beginGenerationTask(); first.entryPoint = 'text';
  manager.rememberQuestion(first, 'chat', SCREENSHOT_MESSAGE, SHOWN);
  first.terminalStatus = 'failed';
  manager.logUsage('chat', SCREENSHOT_MESSAGE, '', helper.getTaskMetadata(first), SHOWN);

  const retry = retryTask(helper, first);
  helper.replayPrepared = async function* () {
    if (outcome === 'cancelled') {
      retry.controller.abort(new DOMException('Generation cancelled', 'AbortError'));
      throw new DOMException('Generation cancelled', 'AbortError');
    }
    throw Object.assign(new Error('provider down'), { status: 500 });
  };
  await assert.rejects(() => helper.runGeneration(() => manager.runPreparedRetry({ userContent: PROMPT + SCREENSHOT_MESSAGE }), 'written', undefined, retry));
  const usage = endMeeting(manager.session);
  return { first, retry, usage, rows: usage.filter(entry => entry.requestId === retry.requestId) };
}

for (const outcome of ['failed', 'cancelled']) {
  test(`screenshot only in the Chinese UI: a ${outcome} Retry is listed under the question the user saw`, async () => {
    const { first, rows, usage } = await failingRetry(outcome);
    assert.equal(rows.length, 1, 'one row for the Retry, no duplicate');
    const [row] = rows;
    assert.equal(row.type, 'chat');
    assert.equal(row.question, SCREENSHOT_MESSAGE);
    assert.equal(row.displayQuestion, SHOWN);
    assert.equal(row.retryOf, first.requestId);
    assert.equal(row.questionId, first.questionId);
    assert.equal(row.status, outcome);
    assert.equal(row.answer, '');
    assert.equal(usage.some(entry => entry.question === 'generation outcome'), false);
  });
}

// LLMHelper.runGeneration waits for the renderer's visible receipt after the replay settles. If
// that wait times out, the task aborts as failed after runPreparedRetry recorded its success;
// the abort must not list the same answer a second time.
test('a successful Retry whose visible receipt times out is recorded once', async () => {
  const { GenerationTimeoutError, awaitGeneration } = require('../../../dist-electron/electron/llm/generateTask.js');
  const session = new SessionTracker();
  const helper = new StubLLMHelper(['RETRY ', 'ANSWER']);
  // Mirrors LLMHelper.runGeneration; the receipt deadline expires while it waits.
  helper.runGeneration = async function (factory, _kind, _signal, supplied) {
    const inherited = generationTasks.getStore();
    const task = supplied ?? inherited ?? this.beginGenerationTask();
    try {
      const result = await awaitGeneration(task, Promise.resolve().then(() => generationTasks.run(task, factory)));
      if (task !== inherited) {
        const waiting = task.waitForVisible();
        task.controller.abort(new GenerationTimeoutError('total', task.hasText));
        await waiting;
      }
      return result;
    } catch (error) {
      if (!task.signal.aborted && !['refused', 'incomplete', 'empty'].includes(task.terminalStatus ?? '')) task.terminalStatus = 'failed';
      throw error;
    } finally { if (task !== inherited) task.close(); }
  };
  const manager = new IntelligenceManager(helper);
  const first = helper.beginGenerationTask(); first.entryPoint = 'text';
  manager.rememberQuestion(first, 'chat', SCREENSHOT_MESSAGE, SHOWN);
  first.close();

  const retry = retryTask(helper, first);
  retry.requireVisibleReceipt = true;
  await assert.rejects(() => helper.runGeneration(() => manager.runPreparedRetry({ userContent: PROMPT + SCREENSHOT_MESSAGE }), 'written', undefined, retry),
    error => error?.name === 'GenerationTimeoutError');
  assert.equal(retry.terminalStatus, 'failed', 'the receipt timeout failed the task after the success row');

  const rows = endMeeting(manager.session).filter(entry => entry.requestId === retry.requestId);
  assert.equal(rows.length, 1, 'one usage row for the Retry');
  assert.equal(rows[0].answer, 'RETRY ANSWER');
  assert.equal(rows[0].question, SCREENSHOT_MESSAGE);
  const messages = manager.session.getFullTranscript().filter(segment => segment.speaker === 'assistant' && segment.generation?.requestId === retry.requestId);
  assert.equal(messages.length, 1, 'one assistant message for the Retry');
});

// A failed, cancelled or empty first attempt is listed under the label a successful answer from
// the same entry point records, never under the internal 'generation outcome' placeholder.
test('What to Answer: a failed first attempt is listed under the typed question, as a success is', async () => {
  const session = new SessionTracker();
  const helper = new StubLLMHelper([]);
  const engine = new IntelligenceEngine(helper, session);
  const question = '如何设计一个分布式限流器？';
  engine.whatToAnswerLLM = { async *generateStream() { throw Object.assign(new Error('provider down'), { status: 500 }); } };
  const first = helper.beginGenerationTask(); first.entryPoint = 'what-to-say';
  await assert.rejects(() => helper.runGeneration(
    () => engine.runWhatShouldISay(question, 0.8, undefined, { skipCooldown: true, errorDelivery: 'caller' }), 'interview', undefined, first), /provider down/);
  const usage = endMeeting(session);
  const rows = usage.filter(entry => entry.requestId === first.requestId);
  assert.equal(rows.length, 1);
  // runWhatShouldISayInner's success records { type: 'assist', question: question || 'What to Answer' }.
  assert.equal(rows[0].type, 'assist');
  assert.equal(rows[0].question, question);
  assert.equal(rows[0].status, 'failed');
  assert.equal(rows[0].answer, '');
  assert.equal(rows[0].retryOf, undefined);
  assert.equal(usage.some(entry => entry.question === 'generation outcome'), false);
});

test('Recap: a cancelled first attempt is listed under Recap Meeting with its partial answer', async () => {
  const session = new SessionTracker();
  session.handleTranscript({ speaker: 'interviewer', text: 'Tell me about your last project', timestamp: Date.now() - 2000, final: true });
  const helper = new StubLLMHelper([]);
  const engine = new IntelligenceEngine(helper, session);
  engine.on('error', () => {});
  const first = helper.beginGenerationTask(); first.entryPoint = 'recap';
  engine.recapLLM = { async *generateStream() {
    yield 'Partial recap';
    first.controller.abort(new DOMException('Generation cancelled', 'AbortError'));
    throw new DOMException('Generation cancelled', 'AbortError');
  } };
  await helper.runGeneration(() => engine.runRecap(), 'interview', undefined, first).catch(() => {});
  const usage = endMeeting(session);
  const rows = usage.filter(entry => entry.requestId === first.requestId);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].type, 'chat');
  assert.equal(rows[0].question, 'Recap Meeting');
  assert.equal(rows[0].status, 'cancelled');
  assert.equal(rows[0].answer, 'Partial recap');
  assert.equal(usage.some(entry => entry.question === 'generation outcome'), false);
});

test('a first attempt with no label and no named entry point is never called a Retry', async () => {
  const session = new SessionTracker();
  const helper = new StubLLMHelper([]);
  const engine = new IntelligenceEngine(helper, session);
  for (const entryPoint of ['internal', 'text']) {
    const first = helper.beginGenerationTask(); first.entryPoint = entryPoint;
    assert.equal(await helper.runGeneration(() => engine.runGenerationRequest(async () => null), 'interview', undefined, first), null);
    const [row] = endMeeting(session).filter(entry => entry.requestId === first.requestId);
    assert.equal(row.status, 'empty');
    // The placeholder the renderer shows as "Question not recorded" (meetingUsageExport).
    assert.equal(row.question, 'generation outcome');
  }
});

// gemini-chat-stream streams through LLMHelper, not IntelligenceEngine.runGenerationRequest, so
// a failed first chat attempt is logged once, by the handler.
test('a failed first chat attempt records exactly one row', async () => {
  const helper = new StubLLMHelper([]);
  const manager = new IntelligenceManager(helper);
  const message = 'What is the difference between a mutex and a semaphore?';
  const first = helper.beginGenerationTask(); first.entryPoint = 'text';
  manager.rememberQuestion(first, 'chat', message);
  // The stream is cancelled; the handler's catch path logs the question with the empty answer.
  first.controller.abort(new DOMException('Generation cancelled', 'AbortError'));
  manager.logUsage('chat', message, '', helper.getTaskMetadata(first));
  first.close();
  const rows = endMeeting(manager.session).filter(entry => entry.requestId === first.requestId);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].type, 'chat');
  assert.equal(rows[0].question, message);

  const fs = await import('node:fs');
  const source = fs.readFileSync(new URL('../../ipcHandlers.ts', import.meta.url), 'utf8');
  const handler = source.slice(source.indexOf("'gemini-chat-stream',"), source.indexOf("safeOn('gemini-chat-stream-stop'"));
  assert.match(handler, /llmHelper\.runGenerationStream\(/);
  assert.doesNotMatch(handler, /intelligenceManager\.run|getIntelligenceManager\(\)\.run/, 'no mode method, so no second row from recordPartial');
});

// A first attempt whose mode method recorded its success row, and whose visible receipt then
// times out (the task aborts as failed), is listed once: recordPartial skips a recorded success.
for (const [entryPoint, setup, run, expected] of [
  ['recap', engine => { engine.recapLLM = { async *generateStream() { yield 'Full recap'; } }; }, engine => engine.runRecap(), { type: 'chat', question: 'Recap Meeting', answer: 'Full recap' }],
  ['code-hint', engine => { engine.codeHintLLM = { async *generateStream() { yield 'Full hint'; } }; }, engine => engine.runCodeHint(), { type: 'assist', question: 'Code Hint', answer: 'Full hint' }],
]) {
  test(`a successful first-attempt ${entryPoint} whose visible receipt times out is recorded once`, async () => {
    const { GenerationTimeoutError, awaitGeneration } = require('../../../dist-electron/electron/llm/generateTask.js');
    const session = new SessionTracker();
    session.handleTranscript({ speaker: 'interviewer', text: 'Tell me about your last project', timestamp: Date.now() - 2000, final: true });
    const helper = new StubLLMHelper([]);
    // Mirrors LLMHelper.runGeneration; the receipt deadline expires while it waits.
    helper.runGeneration = async function (factory, _kind, _signal, supplied) {
      const inherited = generationTasks.getStore();
      const task = supplied ?? inherited ?? this.beginGenerationTask();
      try {
        const result = await awaitGeneration(task, Promise.resolve().then(() => generationTasks.run(task, factory)));
        if (task !== inherited) {
          task.terminalStatus ??= 'completed';
          const waiting = task.waitForVisible();
          task.controller.abort(new GenerationTimeoutError('total', task.hasText));
          await waiting;
        }
        return result;
      } catch (error) {
        if (!task.signal.aborted && !['refused', 'incomplete', 'empty'].includes(task.terminalStatus ?? '')) task.terminalStatus = 'failed';
        throw error;
      } finally { if (task !== inherited) task.close(); }
    };
    const engine = new IntelligenceEngine(helper, session);
    engine.on('error', () => {});
    setup(engine);
    const first = helper.beginGenerationTask(); first.entryPoint = entryPoint; first.requireVisibleReceipt = true;
    await assert.rejects(() => helper.runGeneration(() => run(engine), 'interview', undefined, first),
      error => error?.name === 'GenerationTimeoutError');
    assert.equal(first.terminalStatus, 'failed', 'the receipt timeout failed the task after the success row');

    const rows = endMeeting(session).filter(entry => entry.requestId === first.requestId);
    assert.equal(rows.length, 1, 'one usage row for the first attempt');
    assert.equal(rows[0].type, expected.type);
    assert.equal(rows[0].question, expected.question);
    assert.equal(rows[0].answer, expected.answer);
    const messages = session.getFullTranscript().filter(segment => segment.speaker === 'assistant' && segment.generation?.requestId === first.requestId);
    assert.equal(messages.length, 1, 'one assistant message for the first attempt');
  });
}

// A manual What to Answer freezes the transcript and checks the model before runWhatShouldISayInner
// runs; a cancel there is listed under the typed question, as a success would be.
test('manual What to Answer cancelled while the transcript is frozen is listed under the typed question', async () => {
  const session = new SessionTracker();
  const helper = new StubLLMHelper([]);
  const engine = new IntelligenceEngine(helper, session);
  const question = '如何设计一个分布式限流器？';
  const first = new GenerationTask({ kind: 'api', client: {}, target: { provider: 'synthetic', model: 'stub' } });
  first.entryPoint = 'what-to-say';
  await assert.rejects(() => helper.runGeneration(() => engine.runWhatShouldISay(question, 0.8, undefined, {
    manual: true, errorDelivery: 'caller',
    beforeGenerate: async () => { first.controller.abort(new DOMException('Generation cancelled', 'AbortError')); },
  }), 'interview', undefined, first));
  const rows = endMeeting(session).filter(entry => entry.requestId === first.requestId);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].type, 'assist');
  assert.equal(rows[0].question, question);
  assert.equal(rows[0].status, 'cancelled');
});

// recordUnrunTask lists a speech action whose mode method never ran (ipcHandlers
// registerGenerationHandler); a task the engine ran, or one already listed, adds nothing.
test('a task that ended before its mode method ran is listed once; a task the engine ran is never listed again', async () => {
  const session = new SessionTracker();
  session.handleTranscript({ speaker: 'interviewer', text: 'Tell me about your last project', timestamp: Date.now() - 2000, final: true });
  const helper = new StubLLMHelper([]);
  const engine = new IntelligenceEngine(helper, session);
  engine.on('error', () => {});

  const unrun = helper.beginGenerationTask(); unrun.entryPoint = 'clarify';
  unrun.controller.abort(new DOMException('Generation cancelled', 'AbortError'));
  engine.recordUnrunTask(unrun);
  engine.recordUnrunTask(unrun);
  // A mode method reached after the abort lists nothing more.
  await helper.runGeneration(() => engine.runClarify(), 'interview', undefined, unrun).catch(() => {});
  let rows = endMeeting(session).filter(entry => entry.requestId === unrun.requestId);
  assert.equal(rows.length, 1);
  assert.deepEqual([rows[0].type, rows[0].question, rows[0].status, rows[0].answer], ['chat', 'Clarify Question', 'cancelled', '']);
  assert.equal(rows[0].questionId, unrun.questionId);

  // The engine ran and failed this one: its own row only.
  engine.recapLLM = { async *generateStream() { throw new Error('recap failed'); } };
  const ran = helper.beginGenerationTask(); ran.entryPoint = 'recap';
  await helper.runGeneration(() => engine.runRecap(), 'interview', undefined, ran).catch(() => {});
  ran.terminalStatus ??= 'failed';
  engine.recordUnrunTask(ran);
  rows = endMeeting(session).filter(entry => entry.requestId === ran.requestId);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].question, 'Recap Meeting');

  // A completed or still running task is not listed.
  const done = helper.beginGenerationTask(); done.entryPoint = 'recap'; done.terminalStatus = 'completed';
  engine.recordUnrunTask(done);
  const running = helper.beginGenerationTask(); running.entryPoint = 'recap';
  engine.recordUnrunTask(running);
  assert.equal(endMeeting(session).filter(entry => [done.requestId, running.requestId].includes(entry.requestId)).length, 0);
});

test('a follow-up with no answer to refine is listed under its intent label, not the entry point fallback', async () => {
  const session = new SessionTracker();
  const helper = new StubLLMHelper([]);
  const engine = new IntelligenceEngine(helper, session);
  for (const [intent, request, label] of [['simplify', undefined, 'Simplify Answer'], ['shorten', 'two lines please', 'two lines please'], ['shorten', undefined, 'Refining: shorten']]) {
    const first = helper.beginGenerationTask(); first.entryPoint = 'follow-up';
    assert.equal(await helper.runGeneration(() => engine.runFollowUp(intent, request), 'interview', undefined, first), null);
    const rows = endMeeting(session).filter(entry => entry.requestId === first.requestId);
    assert.equal(rows.length, 1);
    assert.deepEqual([rows[0].type, rows[0].question, rows[0].status], ['followup', label, 'empty']);
  }
  assert.equal(IntelligenceEngine.followUpQuestion('expand'), 'Expand Answer');
});
