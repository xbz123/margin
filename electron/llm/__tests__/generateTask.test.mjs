import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { GenerationTask, generateTask, withGenerationTask, generationTasks, classifyGenerationFailure } = require('../../../dist-electron/electron/llm/generateTask.js');
const drain = async source => { const events = []; for await (const event of source) events.push(event); return events; };
const policy = { interviewFirstTokenSeconds: 10, interviewTotalSeconds: 60, writtenTotalSeconds: 180 };
const unavailable = { status: 404, error: { code: 'model_not_found' } };
const cacheError = { status: 404, error: { details: [{ '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason: 'CACHED_CONTENT_EXPIRED' }] } };

for (const [name, failure, backup, expected] of [
  ['backup before same-model retry', { status: 503 }, 'B', ['A', 'B']],
  ['transient without backup', { code: 'ECONNRESET' }, undefined, ['A', 'A']],
  ['unavailable without backup', unavailable, undefined, ['A']],
  ['auth takes precedence over model code', { ...unavailable, status: 403 }, 'B', ['A']],
  ['ordinary 404 is terminal', { status: 404, message: 'cache not found' }, 'B', ['A']],
  ['Retry-After exceeds budget', { status: 429, headers: { 'retry-after': '1000' } }, 'B', ['A']],
]) test(name, async () => {
  const task = new GenerationTask('A', backup); const sent = [];
  try {
    await assert.rejects(() => drain(generateTask(task, async function* (target) { task.claimSend(); sent.push(target); throw failure; })), error => error === failure);
    assert.deepEqual(sent, expected); assert.equal(task.sends, expected.length);
  } finally { task.close(); }
});

for (const status of ['empty', 'refused', 'incomplete']) test(`${status} never retries`, async () => {
  const task = new GenerationTask('A', 'B'); let sends = 0;
  try {
    const events = await drain(generateTask(task, async function* () { task.claimSend(); sends++; yield { type: 'finish', status }; }));
    assert.equal(events.at(-1).status, status); assert.equal(sends, 1);
  } finally { task.close(); }
});

test('any emitted content prevents retry; EOF is incomplete', async () => {
  for (const content of ['', ' ', 'partial']) {
    const task = new GenerationTask('A', 'B'); let sends = 0;
    try {
      await assert.rejects(() => drain(generateTask(task, async function* () { task.claimSend(); sends++; yield { type: 'delta', text: content }; throw { status: 503 }; })));
      assert.equal(sends, content ? 1 : 2);
    } finally { task.close(); }
  }
  const task = new GenerationTask('A', 'B');
  try { await assert.rejects(() => drain(generateTask(task, async function* () { task.claimSend(); })), { name: 'GenerationResultError', status: 'incomplete' }); }
  finally { task.close(); }
});

test('explicit invalid cache recovers once on same target; second invalid reference ends task', async () => {
  const task = new GenerationTask('A', 'B'); const sends = []; let invalidations = 0;
  try {
    await assert.rejects(() => drain(generateTask(task, async function* (target, signal, recovery) {
      task.claimSend(); sends.push([target, recovery]); throw cacheError;
    }, { cacheReference: 'cached/explicit', invalidateCache: () => invalidations++ })), error => error === cacheError);
    assert.deepEqual(sends, [['A', false], ['A', true]]); assert.equal(invalidations, 1);
  } finally { task.close(); }
  assert.equal(classifyGenerationFailure({ ...cacheError, status: 403 }), 'terminal');
});

test('task scope survives every lazy next and cancellation fences uncooperative preparation', async () => {
  const controller = new AbortController(); const task = new GenerationTask('A', undefined, policy, 'interview', controller.signal);
  const contexts = [];
  const source = withGenerationTask(task, (async function* () {
    contexts.push(generationTasks.getStore()); yield 'first';
    contexts.push(generationTasks.getStore()); await new Promise(() => {}); yield 'late';
  })());
  assert.equal((await source.next()).value, 'first');
  const pending = source.next(); controller.abort(new DOMException('cancel', 'AbortError'));
  await assert.rejects(pending, { name: 'AbortError' }); assert.deepEqual(contexts, [task, task]);
});

test('TTFT starts at construction, not first next; total continues after visible text; background has no TTFT', t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 100_000 });
  const first = new GenerationTask('A', undefined, policy, 'interview', undefined, Date.now() - 11_000);
  try { assert.throws(() => first.check(), { name: 'GenerationTimeoutError', deadline: 'first-token' }); } finally { first.close(); }
  const total = new GenerationTask('A', undefined, policy, 'interview'); total.acceptText('visible'); total.markVisible('visible');
  try {
    assert.equal(total.signal.aborted, false);
    t.mock.timers.tick(11_000);
    total.check(); assert.equal(total.signal.aborted, false, 'visible text removes only TTFT');
    t.mock.timers.tick(49_000);
    assert.equal(total.signal.aborted, true);
    assert.throws(() => total.check(), { name: 'GenerationTimeoutError', deadline: 'total', partial: true });
  } finally { total.close(); }
  const background = new GenerationTask('A', undefined, policy, 'background', undefined, Date.now() - 20_000);
  try { background.check(); assert.equal(background.firstTokenDeadline, undefined); assert.equal(background.totalDeadline - background.startedAt, 180_000); }
  finally { background.close(); }
});

test('user positive finite budgets are not arbitrarily capped at a day', () => {
  const task = new GenerationTask('A', undefined, { ...policy, writtenTotalSeconds: 100_000 }, 'written');
  try { assert.equal(task.totalDeadline - task.startedAt, 100_000_000); } finally { task.close(); }
});

test('Retry-After above the Node timer limit is not shortened to one millisecond', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 100_000 });
  const longPolicy = { ...policy, interviewFirstTokenSeconds: 3_000_000, interviewTotalSeconds: 4_000_000 };
  const task = new GenerationTask('A', 'B', longPolicy); let sends = 0;
  const pending = drain(generateTask(task, async function* () {
    task.claimSend(); sends++;
    if (sends === 1) throw { status: 429, headers: { 'retry-after': '2500000' } };
    yield { type: 'delta', text: 'ok' }; yield { type: 'finish', status: 'completed' };
  }));
  try {
    await new Promise(resolve => setImmediate(resolve));
    t.mock.timers.tick(2_147_483_647); await new Promise(resolve => setImmediate(resolve));
    assert.equal(sends, 1);
    t.mock.timers.tick(352_516_353);
    assert.equal((await pending).at(-1).status, 'completed'); assert.equal(sends, 2);
  } finally { task.close(); }
});
