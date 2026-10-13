// buildPreparedTranscriptContext — interim + final transcript assembly for WTA.

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function loadPreparedContext() {
  const modPath = path.resolve(
    __dirname,
    '../../../dist-electron/electron/utils/preparedTranscriptContext.js',
  );
  return import(pathToFileURL(modPath).href);
}

async function loadSessionTracker() {
  const sessionPath = path.resolve(__dirname, '../../../dist-electron/electron/SessionTracker.js');
  return import(pathToFileURL(sessionPath).href);
}

describe('buildPreparedTranscriptContext', () => {
  let buildPreparedTranscriptContext;
  let SessionTracker;

  beforeEach(async () => {
    ({ buildPreparedTranscriptContext } = await loadPreparedContext());
    ({ SessionTracker } = await loadSessionTracker());
  });

  test('includes interim interviewer text alongside final turns', () => {
    const session = new SessionTracker();
    const now = Date.now();

    session.handleTranscript({
      speaker: 'interviewer',
      text: 'Tell me about your leadership experience.',
      timestamp: now - 5000,
      final: true,
    });

    session.handleTranscript({
      speaker: 'interviewer',
      text: 'Especially cross-functional teams.',
      timestamp: now,
      final: false,
    });

    const context = buildPreparedTranscriptContext(session, 180);
    assert.match(context, /leadership experience/);
    assert.match(context, /cross-functional teams/);
  });

  // PLAN.md AG-17 (fourth review): the separate block of recent assistant responses is
  // declared profile_history data and is left out when the caller says so. Assistant
  // turns inside the conversation itself stay: they are part of the transcript.
  test('includes the recent assistant responses block only when asked to', () => {
    const session = new SessionTracker();
    const now = Date.now();
    session.handleTranscript({ speaker: 'interviewer', text: 'What would you change first?', timestamp: now - 4000, final: true });
    session.addAssistantMessage('PRIOR_ANSWER_SENTINEL: start with the cache.');
    session.handleTranscript({ speaker: 'interviewer', text: 'And after that?', timestamp: now, final: true });

    const withBlock = buildPreparedTranscriptContext(session, 180);
    assert.match(withBlock, /\[RECENT ASSISTANT RESPONSES\]\n- PRIOR_ANSWER_SENTINEL/);
    const without = buildPreparedTranscriptContext(session, 180, false);
    assert.doesNotMatch(without, /RECENT ASSISTANT RESPONSES/);
    assert.match(without, /and after that/i, 'the conversation itself stays');
  });

  test('returns empty string for empty session (negative)', () => {
    const session = new SessionTracker();
    assert.equal(buildPreparedTranscriptContext(session, 180), '');
  });
});

describe('S42-03 frozen transcript view', () => {
  let SessionTracker;
  beforeEach(async () => { ({ SessionTracker } = await loadSessionTracker()); });
  const speech = (cutoffAt, user, interviewer, extra = {}) => ({ sessionId: 'meeting', cutoffAt, frozenAt: cutoffAt + 10,
    channels: { user: { segments: user, reason: 'complete' }, interviewer: { segments: interviewer, reason: 'deadline' } }, ...extra });
  const segment = (key, channel, text, firstSeenAt, final = true) => ({ key, channel, text, final, revision: 1, firstSeenAt });

  test('a same-ID revision updates the stored turn instead of adding one', () => {
    const session = new SessionTracker();
    const now = Date.now();
    session.handleTranscript({ speaker: 'interviewer', text: 'first version', timestamp: now, final: true, segmentId: 'interviewer:1:a' });
    session.handleTranscript({ speaker: 'interviewer', text: 'corrected version', timestamp: now, final: true, segmentId: 'interviewer:1:a' });
    assert.deepEqual(session.getContext(60).map(item => item.text), ['corrected version']);
    assert.equal(session.getFullTranscript().length, 1);
  });

  test('the view holds the base copied at begin plus frozen revisions, ignoring later turns, revisions, replies and coding questions', async () => {
    const session = new SessionTracker();
    session.handleTranscript({ speaker: 'interviewer', text: 'stored partial question', timestamp: Date.now() - 2000, final: true, segmentId: 'interviewer:1:q' });
    session.handleTranscript({ speaker: 'interviewer', text: 'old final turn', timestamp: Date.now() - 3000, final: true, segmentId: 'interviewer:1:old' });
    session.addAssistantMessage('earlier reply');
    const cutoff = Date.now();
    const base = session.captureBase(cutoff);
    await new Promise(resolve => setTimeout(resolve, 2));
    // While collecting: an old segment the collector did not take is revised, and coding state changes.
    session.handleTranscript({ speaker: 'interviewer', text: 'old final turn LEAKED revision', timestamp: Date.now() - 3000, final: true, segmentId: 'interviewer:1:old' });
    session.setCodingQuestion('Implement a function that returns all permutations efficiently using recursion', 'screenshot');
    const frozen = speech(cutoff, [segment('user:1:d', 'user', 'my dictated words', cutoff - 500)],
      [segment('interviewer:1:q', 'interviewer', 'stored partial question completed', cutoff - 2000, false)]);
    const view = session.frozenView(frozen, base);
    session.handleTranscript({ speaker: 'interviewer', text: 'later live question', timestamp: cutoff + 100, final: true });
    session.addAssistantMessage('later reply');
    assert.deepEqual(view.getContext(180).map(item => [item.role, item.text]), [
      ['interviewer', 'old final turn'], ['interviewer', 'stored partial question completed'], ['user', 'my dictated words'], ['assistant', 'earlier reply']]);
    assert.equal(view.getLastInterviewerTurn(), 'stored partial question completed');
    assert.equal(view.getLastInterimInterviewer(), null);
    assert.deepEqual(view.getAssistantResponseHistory().map(item => item.text), ['earlier reply']);
    assert.equal(view.getDetectedCodingQuestion().question, null);
    assert.doesNotMatch(view.getFormattedContext(180), /later|LEAKED|permutations/);
    assert.ok(Object.isFrozen(base.items) && Object.isFrozen(base.items[0]), 'the base copy is read-only');
    const withoutQuestion = session.frozenView(frozen, base, new Set(['user:1:d']));
    assert.doesNotMatch(withoutQuestion.getFormattedContext(180), /dictated/);
  });
});
