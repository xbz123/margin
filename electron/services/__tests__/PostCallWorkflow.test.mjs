import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const workflowPath = path.resolve(__dirname, '../../../dist-electron/electron/services/post-call/PostCallWorkflow.js');
const {
  buildPostCallEnhancements,
  extractStructuredActionItems,
} = await import(pathToFileURL(workflowPath).href);

// Ids switched from `action_<N>` (length-derived; collided across reruns /
// multi-meeting aggregation) to `action_<uuid>` per issue #253 sweep.
const ACTION_ID_RE = /^action_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

test('extractStructuredActionItems captures owner, deadline, and unique ids', () => {
  const items = extractStructuredActionItems([
    { speaker: 'user', text: 'I will send the pricing proposal by Friday.', timestamp: 1200 },
    { speaker: 'interviewer', text: 'ACTION: schedule procurement review before next Tuesday.', timestamp: 2400 },
  ]);

  assert.equal(items.length, 2);
  assert.match(items[0].id, ACTION_ID_RE);
  assert.equal(items[0].owner, 'Me');
  assert.equal(items[0].text, 'send the pricing proposal');
  assert.equal(items[0].deadline, 'Friday');
  assert.equal(items[0].sourceTimestamp, 1200);
  assert.match(items[1].id, ACTION_ID_RE);
  assert.notEqual(items[0].id, items[1].id);
  assert.match(items[1].text, /schedule procurement review/i);
});

test('extractStructuredActionItems merges summary action items without duplicates', () => {
  const items = extractStructuredActionItems(
    [{ speaker: 'user', text: 'I will send the recap.', timestamp: 10 }],
    ['send the recap', 'share the deck']
  );

  assert.deepEqual(items.map(item => item.text), ['send the recap', 'share the deck']);
});

test('buildPostCallEnhancements returns schema v2 payload', () => {
  const result = buildPostCallEnhancements({
    transcript: [{ speaker: 'interviewer', text: 'Read chapter 4 before Friday.', timestamp: 10 }],
    summaryData: { overview: 'Lecture covered graph traversal.', actionItems: [] },
  });

  assert.equal(result.schemaVersion, 2);
  assert.ok(Array.isArray(result.actionItemsStructured));
});

test('post-call schema remains JSON-safe and excludes raw transcript fields', () => {
  const result = buildPostCallEnhancements({
    transcript: [
      { speaker: 'prospect', text: 'The pricing is too expensive for ACME secret budget.', timestamp: 10 },
      { speaker: 'user', text: 'I will send the proposal by Friday.', timestamp: 20 },
    ],
    summaryData: { overview: 'Discussed a pilot.', actionItems: [] },
  });

  assert.deepEqual(Object.keys(result).sort(), [
    'actionItemsStructured',
    'schemaVersion',
  ]);
  assert.equal(result.schemaVersion, 2);
  assert.doesNotThrow(() => JSON.stringify(result));
  assert.equal('transcript' in result, false);
  assert.equal('rawTranscript' in result, false);
});

test('structured action items cap at eight and mint unique ids after dedupe', () => {
  const transcript = Array.from({ length: 12 }, (_, index) => ({
    speaker: 'user',
    text: `I will prepare follow up item ${index + 1} by Friday.`,
    timestamp: index + 1,
  }));

  const items = extractStructuredActionItems(transcript, ['prepare follow up item 1']);

  assert.equal(items.length, 8);
  for (const item of items) assert.match(item.id, ACTION_ID_RE);
  assert.equal(new Set(items.map(item => item.id)).size, 8, 'every action id must be unique');
  assert.equal(items.filter(item => item.text === 'prepare follow up item 1').length, 1);
});
