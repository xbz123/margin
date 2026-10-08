// Margin meeting storage and summary test (PLAN.md AG-13, AG-14; phase 1 exit item 7).
//
// Runs the real app under the X2 isolation guard on a fresh, temporary SQLite
// database (the sandbox's userData) and drives a meeting through IPC:
//   start -> transcript (test-inject-transcript) -> end -> title and structured
//   summary from a loopback mock -> read back -> restart -> read again -> delete ->
//   restart -> still deleted. Also: a meeting saved with the Transcripts scope off sends
//   nothing; the meeting chat sends a past meeting only while profile_history is
//   allowed, and its summary only while post_call_summary is allowed too; startup
//   recovery of an unprocessed meeting sends it only while profile_history is allowed;
//   an edit that fails to save is rolled back and reported.
// The summary chain never calls OpenAI (Codex -> Groq -> Gemini), so the mock
// serves the Groq client through the SDK's own GROQ_BASE_URL.
//
// Prerequisites: `node scripts/build-electron.js` and `npx vite build`.
// Run:
//   node scripts/margin/isolation/run-node.mjs --allow-exec Electron \
//     --test --test-timeout=180000 tests/margin/meeting-storage.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { startMockOpenAI } from './mock-openai.mjs';
import { launchApp, windowWithQuery, readMainErrors } from './launch-app.mjs';
import { makeSandbox, readBlocked, REPO } from '../../scripts/margin/isolation/env.mjs';

const FAKE_GROQ_KEY = 'gsk-margin-regression-not-a-real-key';
const TITLE = 'Margin Storage Check';
const SECTIONS = ['Summary', 'Action items', 'Key points'];
const SUMMARY = {
  overview: 'The team agreed on the storage test plan.',
  sections: {
    Summary: ['Storage test plan agreed.'],
    'Action items': ['Alex will write the migration note by Friday.'],
    'Key points': ['Meetings must survive a restart.'],
  },
};

let mock;
let sandbox;
let app;
let env;
let mainErrorsLog;
let mainPid;
let userDataPath;

// Launches the app and keeps the recorder file and main pid for the after hook.
async function launch() {
  ({ app, mainErrorsLog, userDataPath } = await launchApp(sandbox, env));
  mainPid = app.process().pid;
}

const isSummaryRequest = (body) => JSON.stringify(body?.messages ?? '').includes('silent meeting note-taker');

async function launcherWindow() {
  const w = await windowWithQuery(app, 'window=launcher');
  await w.waitForLoadState('domcontentloaded');
  return w;
}

async function restart() {
  await app.close();
  await launch();
  return launcherWindow();
}

async function waitFor(fn, what, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 300));
  }
}

test.before(async () => {
  mock = await startMockOpenAI();
  mock.setScript({
    respond: (body) => (isSummaryRequest(body) ? JSON.stringify(SUMMARY) : TITLE),
  });
  sandbox = makeSandbox('meeting-storage');
  env = {
    NODE_ENV: 'test', // enables the test-inject-transcript IPC
    MARGIN_ISOLATION_MIC: 'granted', // permission double, no OS prompt (guard.cjs)
    GROQ_BASE_URL: mock.baseURL.replace(/\/v1$/, ''),
  };
  await launch();
});

test.after(async () => {
  try { await app?.close(); } catch { /* already gone */ }
  await mock?.close();
  const blocked = sandbox ? readBlocked(sandbox).filter((b) => !['permission', 'device', 'local-exec'].includes(b.kind)) : [];
  assert.deepEqual(blocked.map((b) => `${b.kind} ${b.detail}`), [], 'no outbound attempts during the storage run');
  // AG-14: nothing may probe, start or reach Ollama (port 11434 is a watched port, so a
  // connection would also show up above as kind "watched-port").
  const ollama = sandbox ? readBlocked(sandbox).filter((b) => /11434|ollama|lsof/i.test(`${b.kind} ${b.detail}`)) : [];
  assert.deepEqual(ollama.map((b) => `${b.kind} ${b.detail}`), [], 'no Ollama probe or port 11434 traffic during the storage run');
  // Every launch loaded record-main-errors.cjs (launchApp checks); none of them may
  // have had an uncaught exception or unhandled rejection in the main process.
  const mainErrors = mainErrorsLog ? readMainErrors(mainErrorsLog, mainPid) : [];
  assert.deepEqual(mainErrors.map((e) => `${e.kind}: ${e.detail.split('\n')[0]}`), [], 'no main-process exception during the storage run');
});

test('a meeting is saved with a mock summary, survives a restart, and stays deleted', async () => {
  let launcher = await launcherWindow();
  const dbPath = path.join(userDataPath, 'natively.db');
  assert.ok(dbPath.startsWith(sandbox.root), `database must live in the sandbox, got ${dbPath}`);

  const keyResult = await launcher.evaluate((k) => window.electronAPI.setGroqApiKey(k), FAKE_GROQ_KEY);
  assert.deepEqual(keyResult, { ok: true }, `setGroqApiKey failed: ${JSON.stringify(keyResult)}`);
  assert.deepEqual(await launcher.evaluate(() => window.electronAPI.getRecentMeetings()), [], 'fresh database has no meetings');

  // 1. Meeting with a transcript.
  const started = await launcher.evaluate(() => window.electronAPI.startMeeting());
  assert.equal(started?.success, true, `startMeeting: ${JSON.stringify(started)}`);
  const lines = [
    ['interviewer', 'Let us plan the storage test for meetings.'],
    ['user', 'Meetings must survive a restart of the app.'],
    ['interviewer', 'Alex will write the migration note by Friday.'],
    ['user', 'Then we agree on the storage test plan.'],
  ];
  for (const [speaker, text] of lines) {
    const r = await launcher.evaluate((seg) => window.electronAPI.testInjectTranscript(seg), { speaker, text, final: true });
    assert.equal(r?.success, true, `inject failed: ${JSON.stringify(r)}`);
  }
  const ended = await launcher.evaluate(() => window.electronAPI.endMeeting());
  assert.equal(ended?.success, true, `endMeeting: ${JSON.stringify(ended)}`);

  // 2. The background worker titles and summarizes it through the mock.
  const meeting = await waitFor(async () => {
    const list = await launcher.evaluate(() => window.electronAPI.getRecentMeetings());
    return list.find((m) => m.title === TITLE);
  }, 'the processed meeting');
  const details = await launcher.evaluate((id) => window.electronAPI.getMeetingDetails(id), meeting.id);
  assert.equal(details.title, TITLE);
  assert.equal(details.detailedSummary.overview, SUMMARY.overview);
  assert.deepEqual(details.detailedSummary.sections.map((s) => s.title), SECTIONS);
  assert.deepEqual(details.detailedSummary.sections.map((s) => s.bullets), SECTIONS.map((t) => SUMMARY.sections[t]));
  assert.equal(details.transcript.length, lines.length);
  assert.ok(details.transcript.some((t) => t.text.includes('survive a restart')));

  // The summary request used the fixed default sections and no mode context.
  const summaryReq = mock.chatRequests().find((r) => isSummaryRequest(r.body));
  assert.ok(summaryReq, 'no summary request reached the mock');
  assert.ok(summaryReq.url.startsWith('/openai/v1/chat/completions'), `summary went to ${summaryReq.url}`);
  const system = summaryReq.body.messages.find((m) => m.role === 'system').content;
  assert.ok(system.includes('transcript below.\n\nRULES:'), 'no mode context block between the intro and the rules');
  assert.ok(system.includes([
    'SECTIONS TO FILL (extract only what is present in the transcript):',
    '- "Summary": High-level summary of the conversation.',
    '- "Action items": Tasks and follow-ups identified.',
    '- "Key points": Important points discussed.',
  ].join('\n')), 'fixed default sections, in order');
  assert.doesNotMatch(system, /active_mode|reference_file|<user_context>/);

  // 3. Restart: the meeting is read back from the same database file.
  launcher = await restart();
  const reread = await launcher.evaluate((id) => window.electronAPI.getMeetingDetails(id), meeting.id);
  assert.deepEqual(
    { title: reread.title, summary: reread.detailedSummary, transcript: reread.transcript },
    { title: details.title, summary: details.detailedSummary, transcript: details.transcript },
  );

  // 4. Delete, then restart: it stays deleted.
  const deleted = await launcher.evaluate((id) => window.electronAPI.deleteMeeting(id), meeting.id);
  assert.ok(deleted === true || deleted?.success === true, `delete returned ${JSON.stringify(deleted)}`);
  assert.equal((await launcher.evaluate(() => window.electronAPI.getRecentMeetings())).some((m) => m.id === meeting.id), false);
  launcher = await restart();
  assert.equal((await launcher.evaluate(() => window.electronAPI.getRecentMeetings())).some((m) => m.id === meeting.id), false);
  assert.equal(await launcher.evaluate((id) => window.electronAPI.getMeetingDetails(id), meeting.id), null);

  // 5. Schema: fully migrated, no mode or RAG tables, and the vector extension was
  //    never loaded (AG-13, AG-14; phase 1 exit item 7).
  const schema = await app.evaluate((_electron, { file, repo }) => {
    // Playwright's main-process evaluate has no `require`; build one at the repo root.
    const req = process.getBuiltinModule('module').createRequire(`${repo}/package.json`);
    const Database = req('better-sqlite3');
    const db = new Database(file, { readonly: true });
    try {
      return {
        version: db.pragma('user_version', { simple: true }),
        tables: db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name),
        loadedVecModules: Object.keys(process.getBuiltinModule('module')._cache).filter((k) => /sqlite-vec/.test(k)),
      };
    } finally {
      db.close();
    }
  }, { file: dbPath, repo: REPO });
  assert.equal(schema.version, 17);
  assert.ok(schema.tables.includes('meetings'), `tables: ${schema.tables}`);
  for (const t of ['modes', 'mode_reference_files', 'mode_note_sections', 'mode_reference_index_state',
    'chunks', 'chunk_summaries', 'embedding_queue']) {
    assert.equal(schema.tables.includes(t), false, `${t} should not exist`);
  }
  assert.deepEqual(schema.tables.filter((t) => t.startsWith('vec_')), [], 'no vector tables');
  assert.deepEqual(schema.loadedVecModules, [], 'sqlite-vec must not be loaded in the main process');
});

// PLAN.md AG-17 (Astra review): with the Transcripts data scope off, a meeting is
// still saved locally, but no title or summary request carrying its transcript may
// leave the app.
test('with the Transcripts data scope off, the meeting is saved and nothing is sent for its title or summary', async () => {
  const launcher = await launcherWindow();
  const scoped = await launcher.evaluate(() => window.electronAPI.setProviderDataScopes({ transcript: false }));
  assert.ok(scoped === undefined || scoped === true || scoped?.success !== false, `setProviderDataScopes: ${JSON.stringify(scoped)}`);
  const requestsBefore = mock.chatRequests().length;
  const known = new Set((await launcher.evaluate(() => window.electronAPI.getRecentMeetings())).map((m) => m.id));

  assert.equal((await launcher.evaluate(() => window.electronAPI.startMeeting()))?.success, true);
  for (const [speaker, text] of [
    ['interviewer', 'SCOPE_SENTINEL one: we discuss the private roadmap.'],
    ['user', 'SCOPE_SENTINEL two: the roadmap stays internal.'],
    ['interviewer', 'SCOPE_SENTINEL three: agreed, nothing leaves the room.'],
    ['user', 'SCOPE_SENTINEL four: then we are done.'],
  ]) {
    const r = await launcher.evaluate((seg) => window.electronAPI.testInjectTranscript(seg), { speaker, text, final: true });
    assert.equal(r?.success, true, `inject failed: ${JSON.stringify(r)}`);
  }
  assert.equal((await launcher.evaluate(() => window.electronAPI.endMeeting()))?.success, true);

  const meeting = await waitFor(async () => {
    const list = await launcher.evaluate(() => window.electronAPI.getRecentMeetings());
    return list.find((m) => !known.has(m.id) && m.title !== 'Processing...');
  }, 'the meeting with transcripts kept local');
  const details = await launcher.evaluate((id) => window.electronAPI.getMeetingDetails(id), meeting.id);
  assert.equal(details.transcript.length, 4, 'the transcript is still stored locally');
  assert.equal(details.title, 'Untitled Session', 'no generated title');

  const sent = mock.chatRequests().slice(requestsBefore);
  assert.deepEqual(sent.map((r) => r.url), [], 'no chat request may leave the app for this meeting');
  assert.ok(!sent.some((r) => JSON.stringify(r.body).includes('SCOPE_SENTINEL')));

  await launcher.evaluate(() => window.electronAPI.setProviderDataScopes({}));
  mock.setScript({ respond: (body) => (isSummaryRequest(body) ? JSON.stringify(SUMMARY) : TITLE) });
});

// PLAN.md AG-17 (fourth and fifth reviews): the meeting chat sends only the meeting id;
// the main process builds the context from the saved meeting. Its summary, key points
// and action items are post_call_summary data and are left out with that scope off; the
// whole meeting is profile_history data, so with that scope off nothing is sent.
test('the meeting chat follows the post_call_summary and profile_history scopes', async () => {
  let launcher = await launcherWindow();
  const keyResult = await launcher.evaluate((k) => window.electronAPI.setGroqApiKey(k), FAKE_GROQ_KEY);
  assert.deepEqual(keyResult, { ok: true }, `setGroqApiKey failed: ${JSON.stringify(keyResult)}`);
  assert.equal((await launcher.evaluate(() => window.electronAPI.startMeeting()))?.success, true);
  for (const [speaker, text] of [
    ['interviewer', 'CHAT_TRANSCRIPT one: we review the release checklist.'],
    ['user', 'CHAT_TRANSCRIPT two: the checklist has five steps.'],
    ['interviewer', 'CHAT_TRANSCRIPT three: step four needs an owner.'],
    ['user', 'CHAT_TRANSCRIPT four: I will take step four.'],
  ]) {
    const r = await launcher.evaluate((seg) => window.electronAPI.testInjectTranscript(seg), { speaker, text, final: true });
    assert.equal(r?.success, true, `inject failed: ${JSON.stringify(r)}`);
  }
  // MeetingPersistence drops meetings shorter than one second.
  await new Promise((r) => setTimeout(r, 1_500));
  assert.equal((await launcher.evaluate(() => window.electronAPI.endMeeting()))?.success, true);
  let seen = [];
  const meeting = await waitFor(async () => {
    const list = await launcher.evaluate(() => window.electronAPI.getRecentMeetings());
    seen = list.map((m) => m.title);
    return list.find((m) => m.title === TITLE);
  }, 'the processed meeting for the chat').catch((e) => { throw new Error(`${e.message}; meetings: ${JSON.stringify(seen)}; requests: ${mock.chatRequests().length}`); });
  const details = await launcher.evaluate((id) => window.electronAPI.getMeetingDetails(id), meeting.id);
  assert.equal(details.detailedSummary.overview, SUMMARY.overview);

  // A fresh profile shows the first-run startup sequence instead of the launcher.
  await launcher.evaluate(() => localStorage.setItem('natively_seen_startup_v1', 'true'));
  await launcher.reload();
  await launcher.waitForLoadState('domcontentloaded');
  // The chat uses the selected model; only the (mock) Groq key is set here. Selected
  // after the reload, which can restore the default model.
  await new Promise((r) => setTimeout(r, 1_000));
  await launcher.evaluate(() => window.electronAPI.setModel('llama-3.3-70b-versatile'));
  const config = await launcher.evaluate(() => window.electronAPI.getCurrentLlmConfig());
  assert.equal(config?.model, 'llama-3.3-70b-versatile', `active model is ${JSON.stringify(config)}`);
  await launcher.getByText(TITLE).first().click();
  const input = launcher.locator('input[placeholder="Ask about this meeting..."]');
  await launcher.evaluate(() => { window.__marginStreamErrors = []; window.electronAPI.onGeminiStreamError((e) => window.__marginStreamErrors.push(e)); });

  // Chat questions get their own answer, so the test can wait until it is shown.
  mock.setScript({
    respond: (body) => (isSummaryRequest(body) ? JSON.stringify(SUMMARY)
      : JSON.stringify(body?.messages ?? '').includes('CHAT_QUESTION') ? 'CHAT_ANSWER shown.' : TITLE),
  });
  const answersShown = () => launcher.evaluate(() => document.body.innerText.split('CHAT_ANSWER shown.').length - 1);
  const ask = async (question) => {
    const before = mock.chatRequests().length;
    const shown = await answersShown();
    await input.fill(question);
    await input.press('Enter');
    const req = await waitFor(() => mock.chatRequests().slice(before).find((r) => JSON.stringify(r.body).includes(question)), `the chat request for "${question}"`, 20_000)
      .catch(async (e) => {
        const page = await launcher.evaluate(() => {
          const t = document.body.innerText;
          return JSON.stringify({ streamErrors: window.__marginStreamErrors, question: t.includes('CHAT_QUESTION'), wrong: /went wrong|Couldn't get/.test(t), details: t.includes('Ask about this meeting'), around: t.slice(Math.max(0, t.indexOf('CHAT_QUESTION') - 200), t.indexOf('CHAT_QUESTION') + 300) });
        });
        throw new Error(`${e.message}; requests since: ${JSON.stringify(mock.chatRequests().slice(before).map((r) => r.url))}; page: ${page}`);
      });
    await waitFor(async () => (await answersShown()) > shown, `the answer to "${question}"`, 20_000);
    return JSON.stringify(req.body);
  };

  const allowed = await ask('CHAT_QUESTION one: what did we agree?');
  assert.match(allowed, /CHAT_TRANSCRIPT/, 'the transcript goes with the question');
  assert.ok(allowed.includes(SUMMARY.overview), 'with every scope allowed the summary goes too');

  await launcher.evaluate(() => window.electronAPI.setProviderDataScopes({ post_call_summary: false }));
  const denied = await ask('CHAT_QUESTION two: what else was said?');
  assert.match(denied, /CHAT_TRANSCRIPT/, 'the transcript still goes with the question');
  assert.ok(!denied.includes(SUMMARY.overview), 'the summary must be left out');
  for (const bullets of Object.values(SUMMARY.sections)) {
    for (const b of bullets) assert.ok(!denied.includes(b), `summary section text must be left out: ${b}`);
  }

  // A saved meeting is profile_history data (fifth review): with that scope off,
  // asking about the meeting sends nothing at all, and the chat shows an error.
  await launcher.evaluate(() => window.electronAPI.setProviderDataScopes({ profile_history: false }));
  let before = mock.chatRequests().length;
  await input.fill('CHAT_QUESTION three: who owns step four?');
  await input.press('Enter');
  await waitFor(async () => (await launcher.evaluate(() => (window.__marginStreamErrors ?? []).some((e) => /profile_history/.test(e)))), 'the profile_history refusal', 20_000);
  await new Promise((r) => setTimeout(r, 500));
  assert.deepEqual(mock.chatRequests().slice(before).map((r) => r.url), [], 'no request for a past meeting with profile_history off');

  // The window cannot get meeting data past the scopes by building the context itself:
  // the main process recognizes the meeting headings and leaves that context out.
  await launcher.evaluate(() => window.electronAPI.setProviderDataScopes({ post_call_summary: false }));
  before = mock.chatRequests().length;
  await launcher.evaluate((overview) => window.electronAPI.streamGeminiChat('CHAT_QUESTION four', undefined,
    `MEETING: x\n\nSUMMARY:\n${overview}`, { skipSystemPrompt: true }), SUMMARY.overview);
  const selfBuilt = await waitFor(() => mock.chatRequests().slice(before).find((r) => JSON.stringify(r.body).includes('CHAT_QUESTION four')), 'the request with a window-built context', 20_000);
  assert.ok(!JSON.stringify(selfBuilt.body).includes(SUMMARY.overview), 'a summary in a window-built context must be left out');

  // An unknown meeting id is rejected before anything is sent.
  before = mock.chatRequests().length;
  const rejected = await launcher.evaluate(() => window.electronAPI.streamGeminiChat('CHAT_QUESTION five', undefined, undefined, { meetingId: 'no-such-meeting' }).then(() => 'resolved', (e) => String(e)));
  assert.match(rejected, /Meeting not found/);
  assert.equal(mock.chatRequests().length, before);

  await launcher.evaluate(() => window.electronAPI.setProviderDataScopes({}));
  mock.setScript({ respond: (body) => (isSummaryRequest(body) ? JSON.stringify(SUMMARY) : TITLE) });
});

// PLAN.md AG-17 (sixth and seventh reviews): an edit whose save fails must not stay on
// screen as if it were stored. Handlers in the main process are replaced for one call
// (Electron keeps invoke handlers in ipcMain._invokeHandlers) to make a save fail, be
// slow, or make the reload fail. Checked: the failed field is restored (from the
// database, or to its value before the edit when the meeting cannot be read), other
// fields and list rows are left alone, only the latest edit's response acts, and the
// notice is cleared only by a later successful save of the same field.
test('a meeting edit that fails to save is rolled back and reported', async () => {
  const launcher = await launcherWindow();
  const meeting = (await launcher.evaluate(() => window.electronAPI.getRecentMeetings())).find((m) => m.title === TITLE);
  assert.ok(meeting, 'the meeting from the chat test is listed');
  assert.equal(await launcher.evaluate((id) => window.electronAPI.updateMeetingSummary(id, { keyPoints: ['KP_ONE', 'KP_TWO'] }), meeting.id), true);
  await launcher.reload();
  await launcher.waitForLoadState('domcontentloaded');
  await launcher.getByText(TITLE).first().click();
  const title = launcher.locator('h1[contenteditable]').first();
  await title.waitFor();
  const stored = () => launcher.evaluate((id) => window.electronAPI.getMeetingDetails(id), meeting.id);
  const titleText = async () => (await title.innerText()).trim();
  const alert = launcher.getByRole('alert');
  const alertText = async () => ((await alert.count()) ? (await alert.innerText()).trim() : '');

  // Makes the next call on `channel` return `result` (after `delayMs`) or throw.
  const patchOnce = (channel, behavior) => app.evaluate(({ ipcMain }, { channel, behavior }) => {
    const handlers = ipcMain._invokeHandlers;
    const real = handlers?.get(channel);
    if (!real) throw new Error(`${channel} handler not found`);
    handlers.set(channel, async () => {
      handlers.set(channel, real);
      if (behavior.delayMs) await new Promise((r) => setTimeout(r, behavior.delayMs));
      if (behavior.throws) throw new Error('margin: injected failure');
      return behavior.result;
    });
  }, { channel, behavior });
  // Clicks are dispatched to the element: after scrolling to the key points, other
  // parts of the page can cover the title.
  const rename = async (text) => {
    await title.dispatchEvent('click');
    await waitFor(() => title.evaluate((e) => document.activeElement === e), 'focus on the title', 5_000);
    await launcher.keyboard.press('Meta+A');
    await launcher.keyboard.type(text);
    await launcher.keyboard.press('Enter');
  };
  const keyPoint = (text) => launcher.locator('p').filter({ hasText: text }).first();
  const editKeyPoint = async (from, to) => {
    const el = keyPoint(from);
    await el.dispatchEvent('click');
    await waitFor(() => el.evaluate((e) => document.activeElement === e), `focus on ${from}`, 5_000);
    await launcher.keyboard.press('Meta+A');
    await launcher.keyboard.type(to);
    await el.evaluate((e) => e.blur());
  };
  const NOT_SAVED = 'This change could not be saved.';

  // 1. The title save fails: notice, stored title shown again.
  await patchOnce('update-meeting-title', { result: false });
  await rename('RENAMED_NOT_SAVED');
  await waitFor(async () => (await alertText()) === NOT_SAVED, 'the notice', 10_000);
  await waitFor(async () => (await titleText()) === TITLE, 'the stored title shown again', 10_000);
  assert.equal((await stored()).title, TITLE);

  // 2. A successful save of another field leaves the title's notice in place.
  await editKeyPoint('KP_ONE', 'KP_ONE_EDITED');
  await waitFor(async () => (await stored()).detailedSummary.keyPoints[0] === 'KP_ONE_EDITED', 'the saved key point', 10_000);
  assert.equal(await alertText(), NOT_SAVED, 'the notice of the title stays');

  // 3. The title saves: its notice goes away.
  await rename('RENAMED_SAVED');
  await waitFor(async () => (await stored()).title === 'RENAMED_SAVED', 'the saved title', 10_000);
  await waitFor(async () => (await alert.count()) === 0, 'the notice cleared', 10_000);

  // 4. A key point save fails: the list is restored from the database, the title and
  // the other row (same DOM node, so its draft and key survive) are left alone.
  await keyPoint('KP_TWO').evaluate((e) => { e.__marginMarker = 'kept'; });
  await patchOnce('update-meeting-summary', { result: false });
  await editKeyPoint('KP_ONE_EDITED', 'KP_NOT_SAVED');
  await waitFor(async () => (await alertText()) === NOT_SAVED, 'the key point notice', 10_000);
  await keyPoint('KP_ONE_EDITED').waitFor({ timeout: 10_000 });
  assert.equal(await keyPoint('KP_TWO').evaluate((e) => e.__marginMarker), 'kept', 'the other row was not remounted');
  assert.equal(await titleText(), 'RENAMED_SAVED');
  assert.deepEqual((await stored()).detailedSummary.keyPoints, ['KP_ONE_EDITED', 'KP_TWO']);

  // 5. The save fails and the meeting cannot be read: the title goes back to its value
  // before the edit.
  await patchOnce('update-meeting-title', { result: false });
  await patchOnce('get-meeting-details', { throws: true });
  await rename('RENAMED_RELOAD_FAILED');
  await waitFor(async () => (await titleText()) === 'RENAMED_SAVED', 'the title before the edit', 10_000);
  assert.equal(await alertText(), NOT_SAVED);

  // 6. The save fails and the meeting no longer exists: the notice says so.
  await patchOnce('update-meeting-title', { result: false });
  await patchOnce('get-meeting-details', { result: null });
  await rename('RENAMED_MEETING_GONE');
  await waitFor(async () => /no longer exists/.test(await alertText()), 'the missing-meeting notice', 10_000);
  assert.equal(await titleText(), 'RENAMED_SAVED', 'a deleted meeting does not leave an unsaved title on screen');

  // 7. Only the latest edit's response acts: a slow failure of an earlier edit, answered
  // after a later edit was saved, changes nothing.
  await patchOnce('update-meeting-title', { result: false, delayMs: 1_500 });
  await rename('RENAMED_SLOW_FAIL');
  await rename('RENAMED_LATEST');
  await waitFor(async () => (await stored()).title === 'RENAMED_LATEST', 'the latest title saved', 10_000);
  await new Promise((r) => setTimeout(r, 2_000)); // the slow response has arrived by now
  assert.equal(await titleText(), 'RENAMED_LATEST');
  assert.equal(await alert.count(), 0, 'no notice from the outdated response');

  assert.equal(await launcher.evaluate(({ id, t }) => window.electronAPI.updateMeetingTitle(id, t), { id: meeting.id, t: TITLE }), true);
});

// PLAN.md AG-17 (sixth review): a meeting the app could not finish processing is
// recovered on the next start. It is saved history by then, so recovery declares
// profile_history: with that scope off nothing of it is sent and it is saved without a
// generated title; with the scope on, recovery sends it as before.
test('startup recovery of an unprocessed meeting follows the profile_history scope', async () => {
  let launcher = await launcherWindow();
  const keyResult = await launcher.evaluate((k) => window.electronAPI.setGroqApiKey(k), FAKE_GROQ_KEY);
  assert.deepEqual(keyResult, { ok: true }, `setGroqApiKey failed: ${JSON.stringify(keyResult)}`);

  // Leaves one meeting unprocessed: the mock holds its title request, and the app is
  // closed while it waits.
  const leaveUnprocessed = async (marker) => {
    const known = new Set((await launcher.evaluate(() => window.electronAPI.getRecentMeetings())).map((m) => m.id));
    mock.setScript({ hold: true });
    const before = mock.chatRequests().length;
    assert.equal((await launcher.evaluate(() => window.electronAPI.startMeeting()))?.success, true);
    for (const [speaker, text] of [
      ['interviewer', `${marker} one: we plan the offsite.`],
      ['user', `${marker} two: the offsite is in May.`],
      ['interviewer', `${marker} three: the budget is fixed.`],
      ['user', `${marker} four: I will book the venue.`],
    ]) {
      const r = await launcher.evaluate((seg) => window.electronAPI.testInjectTranscript(seg), { speaker, text, final: true });
      assert.equal(r?.success, true, `inject failed: ${JSON.stringify(r)}`);
    }
    await new Promise((r) => setTimeout(r, 1_500)); // MeetingPersistence's one-second minimum
    assert.equal((await launcher.evaluate(() => window.electronAPI.endMeeting()))?.success, true);
    await waitFor(() => mock.chatRequests().slice(before).some((r) => JSON.stringify(r.body).includes(marker)), `the held title request for ${marker}`, 20_000);
    const list = await launcher.evaluate(() => window.electronAPI.getRecentMeetings());
    const placeholder = list.find((m) => !known.has(m.id));
    assert.equal(placeholder?.title, 'Processing...', `the meeting is still unprocessed: ${JSON.stringify(placeholder)}`);
    return placeholder.id;
  };
  const respondNormally = () => mock.setScript({ hold: false, respond: (body) => (isSummaryRequest(body) ? JSON.stringify(SUMMARY) : TITLE) });
  const recovered = async (id) => waitFor(async () => {
    const d = await launcher.evaluate((mid) => window.electronAPI.getMeetingDetails(mid), id);
    return d && d.title !== 'Processing...' ? d : null;
  }, `the recovered meeting ${id}`);

  // 1. profile_history off: recovery sends nothing.
  const deniedId = await leaveUnprocessed('RECOVER_DENIED');
  await launcher.evaluate(() => window.electronAPI.setProviderDataScopes({ profile_history: false }));
  respondNormally();
  await app.close();
  let before = mock.chatRequests().length;
  await launch();
  launcher = await launcherWindow();
  const deniedMeeting = await recovered(deniedId);
  await new Promise((r) => setTimeout(r, 1_000));
  assert.deepEqual(mock.chatRequests().slice(before).map((r) => r.url), [], 'no request for a recovered meeting with profile_history off');
  assert.equal(deniedMeeting.title, 'Untitled Session', 'no generated title');
  const storedTexts = deniedMeeting.transcript.map((t) => t.text);
  for (const n of ['one', 'two', 'three', 'four']) {
    assert.ok(storedTexts.some((t) => t.startsWith(`RECOVER_DENIED ${n}:`)), `the transcript is still stored locally: ${JSON.stringify(storedTexts)}`);
  }
  // The meeting chat of the previous test asked about a saved meeting; those questions
  // and answers are not part of this meeting (sixth review). (`CHAT_QUESTION four` went
  // through the launcher chat without a meeting id, which belongs to the session.)
  assert.ok(!storedTexts.some((t) => /CHAT_QUESTION (one|two|three)/.test(t)), `meeting chat turns must not enter the next meeting: ${JSON.stringify(storedTexts)}`);
  assert.equal(storedTexts.filter((t) => t === 'CHAT_ANSWER shown.').length, 1, `only the launcher chat answer is in the session: ${JSON.stringify(storedTexts)}`);

  // 2. profile_history on: recovery sends the recovered meeting (the check above is
  // not passing only because recovery sends nothing at all).
  await launcher.evaluate(() => window.electronAPI.setProviderDataScopes({}));
  const allowedId = await leaveUnprocessed('RECOVER_ALLOWED');
  respondNormally();
  await app.close();
  before = mock.chatRequests().length;
  await launch();
  launcher = await launcherWindow();
  const allowedMeeting = await recovered(allowedId);
  const sent = mock.chatRequests().slice(before).map((r) => JSON.stringify(r.body));
  assert.ok(sent.some((b) => b.includes('RECOVER_ALLOWED')), 'recovery sends the meeting with profile_history on');
  assert.ok(!sent.some((b) => b.includes('RECOVER_DENIED')), 'the meeting recovered earlier is not sent again');
  assert.equal(allowedMeeting.title, TITLE);
});
