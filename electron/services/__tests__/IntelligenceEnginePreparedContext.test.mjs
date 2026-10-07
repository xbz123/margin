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
