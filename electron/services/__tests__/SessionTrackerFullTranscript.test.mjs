import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { SessionTracker } = require(path.resolve(__dirname, '../../../dist-electron/electron/SessionTracker.js'));

const line = (i, prefix = 'line') => ({
  speaker: i % 2 ? 'user' : 'interviewer',
  text: `${prefix} ${i}`,
  timestamp: 1_000_000 + i * 1000,
  final: true,
});

test('a long meeting keeps every transcript line, including the first ones', () => {
  const session = new SessionTracker();
  for (let i = 0; i < 2500; i++) session.addTranscript(line(i));
  for (let i = 0; i < 100; i++) session.addAssistantMessage(`answer ${i}`);

  const transcript = session.getFullTranscript();
  assert.equal(transcript.length, 2600);
  assert.equal(transcript[0].text, 'line 0');
  assert.equal(transcript[2499].text, 'line 2499');
  assert.equal(transcript.at(-1).text, 'answer 99');
});

test('no work started in one meeting changes the next meeting after reset()', async () => {
  const session = new SessionTracker();
  // A recap model that never settles until released stands in for a slow summary call (if one is made).
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  if (typeof session.setRecapLLM === 'function') {
    session.setRecapLLM({ generateCompression: () => pending });
  }

  for (let i = 0; i < 1900; i++) session.addTranscript(line(i, 'old'));
  session.reset();
  for (let i = 0; i < 20; i++) session.addTranscript(line(i, 'new'));

  release('- summary');
  for (let i = 0; i < 5; i++) await new Promise(resolve => setImmediate(resolve));

  const transcript = session.getFullTranscript();
  assert.deepEqual(transcript.map(item => item.text), Array.from({ length: 20 }, (_, i) => `new ${i}`));
});
