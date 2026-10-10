import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const { GenerationTask } = createRequire(import.meta.url)('../../../dist-electron/electron/llm/generateTask.js');

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function loadIntelligenceEngine() {
  const enginePath = path.resolve(__dirname, '../../../dist-electron/electron/IntelligenceEngine.js');
  return import(pathToFileURL(enginePath).href);
}

async function loadSessionTracker() {
  const sessionPath = path.resolve(__dirname, '../../../dist-electron/electron/SessionTracker.js');
  return import(pathToFileURL(sessionPath).href);
}

class StubLLMHelper {
  getCurrentGenerationTask() { return undefined; }
  async runGeneration(factory, _kind, _signal, task) { try { return await factory(); } finally { task?.close(); } }
  beginGenerationTask() { return new GenerationTask({ provider: 'synthetic', model: 'stub' }); }
  getTaskMetadata(task) { return { requestId: task.requestId, provider: task.actualTarget.provider, model: task.actualTarget.model, status: task.terminalStatus, attempts: task.sends, partial: task.hasText && task.terminalStatus !== 'completed' }; }
  runGenerationStream(factory) { return factory(); }
  getActiveModel() { return { provider: 'gemini', model: 'gemini-3-flash' }; }
  isStreamingSupported() { return true; }
  setNegotiationCoachingHandler(_fn) { }
  getGeminiClient() { return null; }
  getOpenAIClient() { return null; }
  getClaudeClient() { return null; }
  getGroqClient() { return null; }
  getSettingsManager() { return { get: () => null, set: () => {} }; }
}

async function makeEngine() {
  const { IntelligenceEngine } = await loadIntelligenceEngine();
  const { SessionTracker } = await loadSessionTracker();
  const session = new SessionTracker();
  const engine = new IntelligenceEngine(new StubLLMHelper(), session);
  return { engine, session };
}

test('runWhatShouldISay passes screenContext and preserves imagePaths', async () => {
  const { engine, session } = await makeEngine();
  const calls = [];
  const imagePaths = ['/tmp/natively-test-screen.png'];
  const screenContext = {
    ocrText: 'Visible prompt: explain the error on screen',
    imagePath: imagePaths[0],
    timestamp: Date.now(),
    hash: 'screen-hash-1',
  };

  session.addTranscript({
    speaker: 'interviewer',
    text: 'What should we do here?',
    timestamp: Date.now(),
    final: true,
  });

  engine.whatToAnswerLLM = {
    async *generateStream(cleanedTranscript, temporalContext, intentResult, receivedImagePaths, receivedScreenContext) {
      calls.push({ cleanedTranscript, temporalContext, intentResult, receivedImagePaths, receivedScreenContext });
      yield 'Use the visible error message to explain the fix.';
    }
  };

  const answer = await engine.runWhatShouldISay(undefined, 0.8, imagePaths, {
    skipCooldown: true,
    screenContext,
  });

  assert.equal(answer, 'Use the visible error message to explain the fix.');
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].receivedImagePaths, imagePaths);
  assert.equal(calls[0].receivedScreenContext, screenContext);
});

test('runWhatShouldISay works without screenContext', async () => {
  const { engine, session } = await makeEngine();
  let receivedScreenContext = 'unset';

  session.addTranscript({
    speaker: 'interviewer',
    text: 'What should I answer?',
    timestamp: Date.now(),
    final: true,
  });

  engine.whatToAnswerLLM = {
    async *generateStream(_cleanedTranscript, _temporalContext, _intentResult, _imagePaths, screenContext) {
      receivedScreenContext = screenContext;
      yield 'Answer from transcript only.';
    }
  };

  const answer = await engine.runWhatShouldISay(undefined, 0.8, undefined, { skipCooldown: true });

  assert.equal(answer, 'Answer from transcript only.');
  assert.equal(receivedScreenContext, undefined);
});
