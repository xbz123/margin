// Margin meeting storage and summary test (PLAN.md AG-13, AG-14; phase 1 exit item 7).
//
// Runs the real app under the X2 isolation guard on a fresh, temporary SQLite
// database (the sandbox's userData) and drives a meeting through IPC:
//   start -> transcript (test-inject-transcript) -> end -> title and structured
//   summary from a loopback mock -> read back -> restart -> read again -> delete ->
//   restart -> still deleted. Also: a meeting saved with the Transcripts scope off sends
//   nothing; the meeting chat sends a past meeting only while profile_history is
//   allowed, and its summary only while post_call_summary is allowed too.
// The summary chain never calls OpenAI (Codex -> Groq -> Gemini), so the mock
// serves the Groq client through the SDK's own GROQ_BASE_URL.
//
// Prerequisites: `node scripts/build-electron.js` and `npx vite build`.
// Run:
//   node scripts/margin/isolation/run-node.mjs --allow-exec Electron \
//     --test --test-timeout=180000 tests/margin/meeting-storage.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
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

// Launches the app and keeps the recorder file and main pid for the after hook.
async function launch() {
  ({ app, mainErrorsLog } = await launchApp(sandbox, env));
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
  const dbPath = await app.evaluate(({ app: electronApp }) => process.getBuiltinModule('path').join(electronApp.getPath('userData'), 'natively.db'));
  assert.ok(dbPath.startsWith(sandbox.root), `database must live in the sandbox, got ${dbPath}`);

  const keyResult = await launcher.evaluate((k) => window.electronAPI.setGroqApiKey(k), FAKE_GROQ_KEY);
  assert.equal(keyResult?.success, true, `setGroqApiKey failed: ${JSON.stringify(keyResult)}`);
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
  assert.equal(keyResult?.success, true, `setGroqApiKey failed: ${JSON.stringify(keyResult)}`);
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
