import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const enginePath = path.resolve(__dirname, '../../../dist-electron/electron/IntelligenceEngine.js');
const sessionPath = path.resolve(__dirname, '../../../dist-electron/electron/SessionTracker.js');
const require = createRequire(import.meta.url);
const electronId = require.resolve('electron');
const previousElectron = require.cache[electronId];
require.cache[electronId] = { id: electronId, filename: electronId, loaded: true, exports: { app: { getPath: () => '/tmp', isPackaged: false } } };
let LLMHelper;
try { ({ LLMHelper } = require('../../../dist-electron/electron/LLMHelper.js')); }
finally { if (previousElectron) require.cache[electronId] = previousElectron; else delete require.cache[electronId]; }

function makeHelper() {
  return Object.assign(Object.create(LLMHelper.prototype), {
    selectedTarget: { provider: 'gemini', protocol: 'gemini', model: 'synthetic-test' },
    setNegotiationCoachingHandler() {},
  });
}

async function makeEngine() {
  const { IntelligenceEngine } = await import(pathToFileURL(enginePath).href);
  const { SessionTracker } = require(sessionPath);
  const session = new SessionTracker();
  const engine = new IntelligenceEngine(makeHelper(), session);
  return { engine, session };
}

test('runCodeHint returns stream on cancellation, preserves its partial record and does not emit stale final result', async () => {
  const { engine, session } = await makeEngine();
  let returned = false;

  engine.codeHintLLM = {
    generateStream() {
      return {
        async *[Symbol.asyncIterator]() {
          const task = engine.llmHelper.getCurrentGenerationTask();
          task.claimSend(); task.acceptText('partial hint');
          yield 'partial hint';
          engine.reset();
          yield 'stale hint';
        },
        async return() {
          returned = true;
          return { done: true };
        },
      };
    },
  };

  const tokens = [];
  const finals = [];
  engine.on('suggested_answer_token', token => tokens.push(token));
  engine.on('suggested_answer', answer => finals.push(answer));

  await assert.rejects(() => engine.runCodeHint(['screenshot.png'], 'fix this code'), { name: 'AbortError' });
  assert.equal(returned, true);
  assert.deepEqual(tokens, ['partial hint']);
  assert.deepEqual(finals, []);
  assert.equal(session.getFullUsage().length, 1);
  assert.equal(session.getFullUsage()[0].answer, 'partial hint');
  assert.equal(session.getFullUsage()[0].status, 'cancelled');
  assert.equal(session.getFullUsage()[0].partial, true);
  assert.equal(session.getFullUsage()[0].attempts, 1);
  assert.equal(session.getFullTranscript().some(segment => segment.text === 'partial hint'), true);
  assert.equal(session.getFullTranscript().some(segment => segment.text.includes('stale hint')), false);
});
