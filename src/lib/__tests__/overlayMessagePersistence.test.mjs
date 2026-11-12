import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  finalizeStreamingByIntentMessages,
  prepareIntelligenceStreamPlaceholderMessages,
} from '../overlayMessagePersistence.mjs';

const priorMessages = [
  { id: 'u1', role: 'user', text: 'Hello' },
  { id: 'a1', role: 'system', text: 'Prior answer', intent: 'what_to_answer', isStreaming: false },
  { id: 'u2', role: 'user', text: 'Follow-up' },
];

test('clarify placeholder does not clear messages', () => {
  const next = prepareIntelligenceStreamPlaceholderMessages(priorMessages, 'clarify', 'ph-clarify');
  assert.equal(next.length, priorMessages.length + 1);
  assert.equal(next[0].text, 'Hello');
  assert.equal(next[1].text, 'Prior answer');
  assert.equal(next[next.length - 1].intent, 'clarify');
  assert.equal(next[next.length - 1].isStreaming, true);
});

test('clarify finalize does not clear messages', () => {
  const withPlaceholder = prepareIntelligenceStreamPlaceholderMessages(
    priorMessages,
    'clarify',
    'ph-clarify',
  );
  const next = finalizeStreamingByIntentMessages(
    withPlaceholder,
    'clarify',
    'Here is clarification.',
    () => 'final-id',
  );
  assert.equal(next.length, withPlaceholder.length);
  assert.equal(next.filter((m) => m.role === 'user').length, 2);
  assert.equal(next.find((m) => m.intent === 'clarify')?.text, 'Here is clarification.');
  assert.equal(next.find((m) => m.intent === 'clarify')?.isStreaming, false);
});

test('clarify finalize updates last matching intent row only', () => {
  const rows = [
    ...priorMessages,
    { id: 'c1', role: 'system', text: 'old', intent: 'clarify', isStreaming: false },
    { id: 'c2', role: 'system', text: '', intent: 'clarify', isStreaming: true },
  ];
  const next = finalizeStreamingByIntentMessages(rows, 'clarify', 'new text', () => 'x');
  assert.equal(next.length, rows.length);
  assert.equal(next.find((m) => m.id === 'c1')?.text, 'old');
  assert.equal(next.find((m) => m.id === 'c2')?.text, 'new text');
});

test('what_to_answer finalize updates last row only (findLastIndex — RC-D)', () => {
  const rows = [
    { id: 'w1', role: 'system', text: 'first click stale', intent: 'what_to_answer', isStreaming: false },
    { id: 'w2', role: 'system', text: '', intent: 'what_to_answer', isStreaming: true },
  ];
  const next = finalizeStreamingByIntentMessages(rows, 'what_to_answer', 'final answer', () => 'w3');
  assert.equal(next.length, 2);
  assert.equal(next.find((m) => m.id === 'w1')?.text, 'first click stale');
  assert.equal(next.find((m) => m.id === 'w2')?.text, 'final answer');
  assert.equal(next.find((m) => m.id === 'w3'), undefined);
});

test('what_to_answer finalize prefers explicit streamingMsgId over findLastIndex (Fix 3)', () => {
  const rows = [
    { id: 'w1', role: 'system', text: 'stale', intent: 'what_to_answer', isStreaming: false },
    { id: 'w2', role: 'system', text: '', intent: 'what_to_answer', isStreaming: true },
  ];
  const next = finalizeStreamingByIntentMessages(
    rows,
    'what_to_answer',
    'targeted answer',
    () => 'w3',
    'w2',
  );
  assert.equal(next.length, 2);
  assert.equal(next.find((m) => m.id === 'w1')?.text, 'stale');
  assert.equal(next.find((m) => m.id === 'w2')?.text, 'targeted answer');
  assert.equal(next.find((m) => m.id === 'w3'), undefined);
});

test('what_to_answer finalize appends when no prior system row (blank first click path)', () => {
  const next = finalizeStreamingByIntentMessages([], 'what_to_answer', 'only answer', () => 'wta-1');
  assert.equal(next.length, 1);
  assert.equal(next[0].intent, 'what_to_answer');
  assert.equal(next[0].text, 'only answer');
});

test('RC-E: explicit streamingMsgId finalizes correct row when user message is between WTA rows', () => {
  const rows = [
    { id: 'w1', role: 'system', text: 'first answer', intent: 'what_to_answer', isStreaming: false },
    { id: 'u1', role: 'user', text: 'manual question between clicks' },
    { id: 'w2', role: 'system', text: '', intent: 'what_to_answer', isStreaming: true },
  ];
  const next = finalizeStreamingByIntentMessages(
    rows,
    'what_to_answer',
    'second answer',
    () => 'w3',
    'w2',
  );
  assert.equal(next.length, 3);
  assert.equal(next.find((m) => m.id === 'w1')?.text, 'first answer');
  assert.equal(next.find((m) => m.id === 'w2')?.text, 'second answer');
  assert.equal(next.find((m) => m.id === 'w2')?.isStreaming, false);
  assert.equal(next.find((m) => m.id === 'u1')?.text, 'manual question between clicks');
});

// Regression: duplicate-answer bug. Finalize ran before the streaming row mounted
// (transition still pending). Caller passed the reserved streamingMsgId; finalize
// must append USING that id (not idFactory()) so the late-arriving mount finds
// and merges into this row instead of creating a parallel duplicate.
test('finalize appends with reserved streamingMsgId when row not yet mounted', () => {
  const reservedId = 'reserved-1';
  const next = finalizeStreamingByIntentMessages(
    [{ id: 'u1', role: 'user', text: 'q' }],
    'what_to_answer',
    'final text',
    () => 'fallback-should-not-be-used',
    reservedId,
  );
  assert.equal(next.length, 2);
  const wta = next.find((m) => m.role === 'system');
  assert.equal(wta?.id, reservedId, 'must use reserved id, not idFactory');
  assert.equal(wta?.text, 'final text');
  assert.equal(wta?.intent, 'what_to_answer');
  assert.equal(wta?.isStreaming, false);
});

// Regression: previous answer must not be clobbered when a new answer arrives
// without an open streaming row. The fallback findLastIndex must require
// isStreaming=true so a finalized prior answer is left intact.
test('finalize without streamingMsgId appends new row when no open stream exists', () => {
  const rows = [
    { id: 'u1', role: 'user', text: 'first question' },
    { id: 'w1', role: 'system', text: 'first answer', intent: 'what_to_answer', isStreaming: false },
    { id: 'u2', role: 'user', text: 'second question' },
  ];
  const next = finalizeStreamingByIntentMessages(
    rows,
    'what_to_answer',
    'second answer',
    () => 'w2',
  );
  assert.equal(next.length, 4, 'must append a new row, not clobber w1');
  assert.equal(next.find((m) => m.id === 'w1')?.text, 'first answer', 'prior answer preserved');
  const newRow = next[next.length - 1];
  assert.equal(newRow.id, 'w2');
  assert.equal(newRow.text, 'second answer');
  assert.equal(newRow.isStreaming, false);
});

// End-to-end race simulation: finalize fires before mount, then mount applies
// the buffered token. Only one row should exist with the final text.
test('finalize-before-mount race resolves to a single row (E2E)', async () => {
  const { applyFirstStreamingToken } = await import('../streamingTokenQueue.mjs');
  const reservedId = 'race-1';
  // Step 1: finalize lands first (token transition still pending).
  let rows = finalizeStreamingByIntentMessages(
    [{ id: 'u1', role: 'user', text: 'q' }],
    'what_to_answer',
    'final answer text',
    () => 'should-not-be-used',
    reservedId,
  );
  // Step 2: deferred token mount commits with the same reserved id.
  rows = applyFirstStreamingToken(rows, {
    id: reservedId,
    token: 'final answer text',
    intent: 'what_to_answer',
  });
  // Must end up with exactly one system row carrying the final text.
  const systemRows = rows.filter((m) => m.role === 'system');
  assert.equal(systemRows.length, 1, 'race must not produce duplicate rows');
  assert.equal(systemRows[0].id, reservedId);
});
