// Margin meeting storage and summary test (PLAN.md AG-13, AG-14; phase 1 exit item 7).
//
// Runs the real app under the X2 isolation guard on a fresh, temporary SQLite
// database (the sandbox's userData) and drives a meeting through IPC:
//   start -> transcript (test-inject-transcript) -> end -> title and structured
//   summary from a loopback mock -> read back -> restart -> read again -> delete ->
//   restart -> still deleted.
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
import { launchApp, windowWithQuery } from './launch-app.mjs';
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

const isSummaryRequest = (body) => JSON.stringify(body?.messages ?? '').includes('silent meeting note-taker');

async function launcherWindow() {
  const w = await windowWithQuery(app, 'window=launcher');
  await w.waitForLoadState('domcontentloaded');
  return w;
}

async function restart() {
  await app.close();
  ({ app } = await launchApp(sandbox, env));
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
  ({ app } = await launchApp(sandbox, env));
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
