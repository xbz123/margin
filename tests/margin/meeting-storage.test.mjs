// Margin meeting storage test (PLAN.md AG-13, AG-14, AG-52; phase 1 exit item 7).
//
// Runs the real app under the X2 isolation guard on a fresh, temporary SQLite
// database (the sandbox's userData) and drives a meeting through IPC:
//   start -> transcript (test-inject-transcript) -> end -> saved at once with its
//   transcript, no request of any kind -> read back -> restart -> read again ->
//   delete -> restart -> still deleted.
// Since AG-52 (PLAN S33) a meeting is kept as its local transcript and usage only: no
// generated title or summary, no meeting chat and no startup recovery. An OpenAI key and
// default model are still set, so a regression that sends the meeting reaches the
// loopback mock and fails the test. The second test opens a meeting from the history
// list, checks its usage view, and rolls back a title edit that fails to save.
// AG-41b: first assert that unconfigured STT refuses meeting start. Then save a
// synthetic STT key in this sandbox through IPC, with OpenAI's custom REST base
// pointing at the same loopback mock (no Realtime socket). The native isolation
// guard supplies no audio. The mock still catches requests caused by saving a
// meeting, and any STT upload or generation POST makes the test fail.
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

const FAKE_ANSWER_KEY = 'sk-margin-regression-not-a-real-key';
const FAKE_STT_KEY = 'sk-margin-storage-stt-not-a-real-key';
const TITLE = 'Margin Storage Check';

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

// Saves one meeting with the given transcript lines through IPC and returns it.
async function saveMeeting(launcher, lines) {
  const known = new Set((await launcher.evaluate(() => window.electronAPI.getRecentMeetings())).map((m) => m.id));
  const started = await launcher.evaluate(() => window.electronAPI.startMeeting());
  assert.equal(started?.success, true, `startMeeting: ${JSON.stringify(started)}`);
  for (const [speaker, text] of lines) {
    const r = await launcher.evaluate((seg) => window.electronAPI.testInjectTranscript(seg), { speaker, text, final: true });
    assert.equal(r?.success, true, `inject failed: ${JSON.stringify(r)}`);
  }
  await new Promise((r) => setTimeout(r, 1_200)); // MeetingPersistence's one-second minimum
  const ended = await launcher.evaluate(() => window.electronAPI.endMeeting());
  assert.equal(ended?.success, true, `endMeeting: ${JSON.stringify(ended)}`);
  return waitFor(async () => (await launcher.evaluate(() => window.electronAPI.getRecentMeetings())).find((m) => !known.has(m.id)), 'the saved meeting', 20_000);
}

// Clicks like a user. When something covers the target (CI run 38090230126), the error
// names the element at the target's centre and the target's box, so the next run shows
// what intercepted the click instead of only "<div>…</div> intercepts pointer events".
async function clickOrExplain(page, locator, what) {
  try {
    await locator.click({ timeout: 15_000 });
  } catch (error) {
    const seen = await locator.evaluate((target) => {
      const box = target.getBoundingClientRect();
      const x = box.left + box.width / 2;
      const y = box.top + box.height / 2;
      const top = document.elementFromPoint(x, y);
      const chain = [];
      for (let e = top; e && chain.length < 6; e = e.parentElement) {
        const style = getComputedStyle(e);
        chain.push(`${e.tagName.toLowerCase()} class="${e.className}" position=${style.position} z=${style.zIndex} opacity=${style.opacity} pointer-events=${style.pointerEvents}`);
      }
      return {
        target: { x: box.left, y: box.top, width: box.width, height: box.height },
        viewport: { width: innerWidth, height: innerHeight },
        coveredBy: top && top !== target && !target.contains(top) ? top.outerHTML.slice(0, 3000) : null,
        coveringChain: chain,
      };
    }).catch((e) => ({ inspectFailed: String(e) }));
    await page.screenshot({ path: path.join(sandbox.root, `click-failed-${what.replace(/\W+/g, '-')}.png`) }).catch(() => {});
    throw new Error(`clicking ${what} failed: ${error.message.split('\n')[0]}\n${JSON.stringify(seen, null, 2)}`);
  }
}

test.before(async () => {
  mock = await startMockOpenAI();
  mock.setScript({ respond: () => 'UNEXPECTED_REQUEST' });
  sandbox = makeSandbox('meeting-storage');
  env = {
    NODE_ENV: 'test', // enables the test-inject-transcript IPC
    MARGIN_ISOLATION_MIC: 'granted', // permission double, no OS prompt (guard.cjs)
    MARGIN_DEV_OPENAI_BASE_URL: mock.baseURL,
  };
  await launch();
  const launcher = await launcherWindow();
  assert.equal(await launcher.evaluate(() => window.electronAPI.getSttProvider()), 'none');
  const refused = await launcher.evaluate(() => window.electronAPI.startMeeting());
  assert.equal(refused?.success, false, 'unconfigured STT must refuse meeting start');
  assert.match(refused.error, /STT is not configured/);
  assert.equal(await launcher.evaluate(() => window.electronAPI.getMeetingActive()), false, 'rejected start leaves the meeting inactive');
  assert.deepEqual(await launcher.evaluate(url => window.electronAPI.setOpenAiSttBaseUrl(url), mock.baseURL), { ok: true });
  assert.deepEqual(await launcher.evaluate(key => window.electronAPI.setOpenAiSttApiKey(key), FAKE_STT_KEY), { ok: true });
  assert.deepEqual(await launcher.evaluate(() => window.electronAPI.setSttProvider('openai')), { ok: true });
});

test.after(async () => {
  try { await app?.close(); } catch { /* already gone */ }
  await mock?.close();
  assert.deepEqual(mock?.requests.filter(r => r.method === 'POST').map(r => r.url) ?? [], [], 'no STT upload or generation request during the storage run');
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

test('a meeting is saved without any request, survives a restart, and stays deleted', async () => {
  let launcher = await launcherWindow();
  const dbPath = path.join(userDataPath, 'natively.db');
  assert.ok(dbPath.startsWith(sandbox.root), `database must live in the sandbox, got ${dbPath}`);

  const keyResult = await launcher.evaluate((apiKey) => window.electronAPI.setProviderConfiguration({ provider: 'openai', protocol: 'chat-completions', model: 'gpt-5.4', apiKey }), FAKE_ANSWER_KEY);
  assert.deepEqual(keyResult, { ok: true }, `setProviderConfiguration failed: ${JSON.stringify(keyResult)}`);
  const modelResult = await launcher.evaluate(() => window.electronAPI.setDefaultModel('llm-target:openai:chat-completions:gpt-5.4'));
  assert.deepEqual(modelResult, { ok: true }, `setDefaultModel failed: ${JSON.stringify(modelResult)}`);
  assert.deepEqual(await launcher.evaluate(() => window.electronAPI.getRecentMeetings()), [], 'fresh database has no meetings');

  // 1. Meeting with a transcript: saved at once, and nothing is sent.
  const requestsBefore = mock.requests.length;
  const lines = [
    ['interviewer', 'Let us plan the storage test for meetings.'],
    ['user', 'Meetings must survive a restart of the app.'],
    ['interviewer', 'Alex will write the migration note by Friday.'],
    ['user', 'Then we agree on the storage test plan.'],
  ];
  const meeting = await saveMeeting(launcher, lines);
  const details = await launcher.evaluate((id) => window.electronAPI.getMeetingDetails(id), meeting.id);
  assert.equal(details.title, 'Untitled Session', 'no generated title');
  assert.equal(details.summary, '');
  assert.deepEqual(details.detailedSummary, { actionItems: [], keyPoints: [] });
  assert.equal(details.transcript.length, lines.length);
  assert.ok(details.transcript.some((t) => t.text.includes('survive a restart')));
  await new Promise((r) => setTimeout(r, 1_000));
  assert.deepEqual(mock.requests.slice(requestsBefore).map((r) => r.url), [], 'saving a meeting sends nothing');

  // 3. Restart: the meeting is read back from the same database file.
  launcher = await restart();
  const reread = await launcher.evaluate((id) => window.electronAPI.getMeetingDetails(id), meeting.id);
  assert.deepEqual(
    { title: reread.title, transcript: reread.transcript, usage: reread.usage },
    { title: details.title, transcript: details.transcript, usage: details.usage },
  );

  // 4. Delete, then restart: it stays deleted.
  const deleted = await launcher.evaluate((id) => window.electronAPI.deleteMeeting(id), meeting.id);
  assert.ok(deleted === true || deleted?.success === true, `delete returned ${JSON.stringify(deleted)}`);
  assert.equal((await launcher.evaluate(() => window.electronAPI.getRecentMeetings())).some((m) => m.id === meeting.id), false);
  launcher = await restart();
  assert.equal((await launcher.evaluate(() => window.electronAPI.getRecentMeetings())).some((m) => m.id === meeting.id), false);
  assert.equal(await launcher.evaluate((id) => window.electronAPI.getMeetingDetails(id), meeting.id), null);

  // 5. Schema: fully migrated, no mode or RAG tables, no calendar columns, and the vector
  //    extension was never loaded (AG-13, AG-14; phase 1 exit item 7).
  const schema = await app.evaluate((_electron, { file, repo }) => {
    // Playwright's main-process evaluate has no `require`; build one at the repo root.
    const req = process.getBuiltinModule('module').createRequire(`${repo}/package.json`);
    const Database = req('better-sqlite3');
    const db = new Database(file, { readonly: true });
    try {
      return {
        version: db.pragma('user_version', { simple: true }),
        tables: db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name),
        meetingColumns: db.prepare('PRAGMA table_info(meetings)').all().map((r) => r.name),
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
  // The retired calendar fields are not created on a fresh database (calendar was retired
  // in AG-10/AG-16; the columns were removed later as residue).
  assert.ok(schema.meetingColumns.includes('is_processed'), `meetings columns: ${schema.meetingColumns}`);
  for (const c of ['calendar_event_id', 'source']) {
    assert.equal(schema.meetingColumns.includes(c), false, `meetings.${c} should not exist`);
  }
  assert.deepEqual(schema.loadedVecModules, [], 'sqlite-vec must not be loaded in the main process');
});

// The history list opens a saved meeting, its usage view tells a partial, timed-out
// answer apart from a completed one (AG-33), and a title edit that fails to save is
// rolled back and reported (AG-17 review 7).
test('a meeting opened from the history list shows its usage and rolls back a failed title edit', async () => {
  const launcher = await launcherWindow();
  const requestsBefore = mock.requests.length;
  const meeting = await saveMeeting(launcher, [
    ['interviewer', 'HISTORY one: we plan the offsite.'],
    ['user', 'HISTORY two: the offsite is in May.'],
  ]);
  await app.evaluate(({}, { filename, id }) => {
    const { DatabaseManager } = process.mainModule.require(filename);
    const db = DatabaseManager.getInstance();
    const saved = db.getMeetingDetails(id);
    saved.usage.push({ type: 'chat', timestamp: 1, question: 'synthetic history question', answer: 'retained partial answer',
      requestId: 'HISTORY', provider: 'openai', model: 'HISTORY-model', status: 'failed', attempts: 2, partial: true, timeout: 'total' });
    db.saveMeeting(saved, Date.parse(saved.date), 1500);
  }, { filename: path.join(REPO, 'dist-electron/electron/db/DatabaseManager.js'), id: meeting.id });
  assert.equal(await launcher.evaluate(({ id, t }) => window.electronAPI.updateMeetingTitle(id, t), { id: meeting.id, t: TITLE }), true);

  // A returning user has passed the startup sequence and dismissed the permissions card.
  // The card opens 1.4 s after load until dismissed and covers the whole window; CI
  // clicked after it opened (runs 38090230126 and 38120147426), local runs before.
  await launcher.evaluate((flags) => {
    for (const [key, value] of Object.entries(flags)) localStorage.setItem(key, value);
  }, { natively_seen_startup_v1: 'true', natively_perms_shown_v1: '1' });
  await launcher.reload();
  await launcher.waitForLoadState('domcontentloaded');
  await new Promise((r) => setTimeout(r, 2_000)); // past the card's delay, as on CI
  assert.equal(await launcher.getByText(/Permissions$/).count(), 0, 'the dismissed permissions card stays closed');
  await clickOrExplain(launcher, launcher.getByText(TITLE, { exact: true }).first(), 'the meeting in the history list');
  await clickOrExplain(launcher, launcher.getByRole('button', { name: 'Usage', exact: true }), 'the Usage tab');
  const failed = launcher.locator('[data-generation-status="failed"]').filter({ hasText: 'HISTORY-model' });
  await failed.waitFor({ state: 'visible' });
  assert.ok((await failed.innerText()).includes('Incomplete · timeout:total'));
  assert.equal(await launcher.getByRole('button', { name: 'Summary', exact: true }).count(), 0, 'no summary tab (AG-52)');

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
  // The click is dispatched to the element so focus does not depend on layout.
  const rename = async (text) => {
    await title.dispatchEvent('click');
    await waitFor(() => title.evaluate((e) => document.activeElement === e), 'focus on the title', 5_000);
    await launcher.keyboard.press('Meta+A');
    await launcher.keyboard.type(text);
    await launcher.keyboard.press('Enter');
  };
  const NOT_SAVED = 'This change could not be saved.';

  // 1. The title save fails: notice, stored title shown again.
  await patchOnce('update-meeting-title', { result: false });
  await rename('RENAMED_NOT_SAVED');
  await waitFor(async () => (await alertText()) === NOT_SAVED, 'the notice', 10_000);
  await waitFor(async () => (await titleText()) === TITLE, 'the stored title shown again', 10_000);
  assert.equal((await stored()).title, TITLE);

  // 2. The title saves: its notice goes away.
  await rename('RENAMED_SAVED');
  await waitFor(async () => (await stored()).title === 'RENAMED_SAVED', 'the saved title', 10_000);
  await waitFor(async () => (await alert.count()) === 0, 'the notice cleared', 10_000);

  // 3. The save fails and the meeting cannot be read: the title goes back to its value
  // before the edit.
  await patchOnce('update-meeting-title', { result: false });
  await patchOnce('get-meeting-details', { throws: true });
  await rename('RENAMED_RELOAD_FAILED');
  await waitFor(async () => (await titleText()) === 'RENAMED_SAVED', 'the title before the edit', 10_000);
  assert.equal(await alertText(), NOT_SAVED);

  // 4. The save fails and the meeting no longer exists: the notice says so.
  await patchOnce('update-meeting-title', { result: false });
  await patchOnce('get-meeting-details', { result: null });
  await rename('RENAMED_MEETING_GONE');
  await waitFor(async () => /no longer exists/.test(await alertText()), 'the missing-meeting notice', 10_000);
  assert.equal(await titleText(), 'RENAMED_SAVED', 'a deleted meeting does not leave an unsaved title on screen');

  // 5. Only the latest edit's response acts: a slow failure of an earlier edit, answered
  // after a later edit was saved, changes nothing.
  await patchOnce('update-meeting-title', { result: false, delayMs: 1_500 });
  await rename('RENAMED_SLOW_FAIL');
  await rename('RENAMED_LATEST');
  await waitFor(async () => (await stored()).title === 'RENAMED_LATEST', 'the latest title saved', 10_000);
  await new Promise((r) => setTimeout(r, 2_000)); // the slow response has arrived by now
  assert.equal(await titleText(), 'RENAMED_LATEST');
  assert.equal(await alert.count(), 0, 'no notice from the outdated response');

  assert.equal(await launcher.evaluate(({ id, t }) => window.electronAPI.updateMeetingTitle(id, t), { id: meeting.id, t: TITLE }), true);
  assert.deepEqual(mock.requests.slice(requestsBefore).map((r) => r.url), [], 'opening and editing a meeting sends nothing');
});

// Failed meeting save (PLAN §8). The fault is injected from the test, without a
// production hook: a second SQLite connection in the main process holds the write lock
// on the app's database file, so the app's own save fails after its busy timeout
// (write error). Each esbuild entry bundles its own DatabaseManager, so the app's
// instance cannot be reached to clear its handle; the database-unavailable path is
// covered by DatabaseUnavailable.test.mjs on the actual class and by the mounted banner
// test. The meeting stays in memory, the launcher banner shows it, Start is refused
// without touching permission, audio or the overlay, a retry once the lock is released
// saves it under the same id, and a discard needs confirmation.
test('a failed save is kept, blocks start without side effects, and is saved on retry or discarded on confirmation', async () => {
  const launcher = await launcherWindow();
  const requestsBefore = mock.requests.length;
  const fault = (kind) => app.evaluate(({}, { file, repo, kind }) => {
    if (kind === 'lock') {
      const req = process.getBuiltinModule('module').createRequire(`${repo}/package.json`);
      const Database = req('better-sqlite3');
      const lock = new Database(file);
      lock.exec('BEGIN EXCLUSIVE');
      globalThis.__marginTestLock = lock;
    } else {
      const lock = globalThis.__marginTestLock;
      delete globalThis.__marginTestLock;
      lock?.exec('ROLLBACK');
      lock?.close();
    }
  }, { file: path.join(userDataPath, 'natively.db'), repo: REPO, kind });
  const visibleOverlay = () => app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().some((w) => !w.isDestroyed() && w.isVisible() && w.webContents.getURL().includes('window=overlay')));
  const sideEffects = () => readBlocked(sandbox).filter((b) => ['permission', 'device'].includes(b.kind)).length;
  const banner = launcher.getByTestId('unsaved-meeting-banner');
  const unsaved = () => launcher.evaluate(() => window.electronAPI.getUnsavedMeeting());
  const stopWithFailure = async (lines) => {
    const started = await launcher.evaluate(() => window.electronAPI.startMeeting());
    assert.equal(started?.success, true, `startMeeting: ${JSON.stringify(started)}`);
    for (const [speaker, text] of lines) {
      assert.equal((await launcher.evaluate((seg) => window.electronAPI.testInjectTranscript(seg), { speaker, text, final: true }))?.success, true);
    }
    await new Promise((r) => setTimeout(r, 1_200));
    const ended = await launcher.evaluate(() => window.electronAPI.endMeeting());
    assert.equal(ended?.success, true, 'stopping stays successful when only the save fails');
    await banner.waitFor({ state: 'visible', timeout: 20_000 });
    return unsaved();
  };

  await launcher.evaluate((flags) => {
    for (const [key, value] of Object.entries(flags)) localStorage.setItem(key, value);
  }, { natively_seen_startup_v1: 'true', natively_perms_shown_v1: '1' });
  await launcher.reload();
  await launcher.waitForLoadState('domcontentloaded');
  await new Promise((r) => setTimeout(r, 2_000)); // past the permissions card's delay

  // 1. The write fails: the meeting is kept and only its metadata is exposed.
  await fault('lock');
  const lines = [['interviewer', 'UNSAVED one: keep this in memory.'], ['user', 'UNSAVED two: retry should store it.']];
  const pending = await stopWithFailure(lines);
  assert.deepEqual(Object.keys(pending).sort(), ['durationMs', 'id', 'reason', 'startedAt', 'transcriptCount']);
  assert.equal(pending.reason, 'write-error');
  assert.equal(pending.transcriptCount, 2);
  assert.match(await banner.innerText(), /Writing to the meeting database failed\./);
  assert.match(await banner.innerText(), /kept only in memory and will be lost if the app quits or crashes/);
  assert.equal((await launcher.evaluate(() => window.electronAPI.getRecentMeetings())).some((m) => m.id === pending.id), false);
  // A reloaded launcher restores the banner from the query.
  await launcher.reload();
  await launcher.waitForLoadState('domcontentloaded');
  await banner.waitFor({ state: 'visible', timeout: 10_000 });
  // The banner is shared by the list and a meeting's details: opening a saved meeting
  // (the previous test's TITLE) and going back keeps it visible and usable.
  await clickOrExplain(launcher, launcher.getByText(TITLE, { exact: true }).first(), 'the saved meeting in the history list');
  await launcher.locator('h1[contenteditable]').first().waitFor();
  await banner.waitFor({ state: 'visible', timeout: 10_000 });
  assert.equal((await unsaved())?.id, pending.id, 'the same meeting is pending on the details page');
  assert.equal(await banner.getByRole('button', { name: 'Retry save', exact: true }).isEnabled(), true);
  assert.equal(await banner.getByRole('button', { name: 'Discard', exact: true }).isEnabled(), true);
  await clickOrExplain(launcher, launcher.getByRole('button', { name: 'Back', exact: true }).first(), 'Back');
  await launcher.getByRole('button', { name: /Start \S+$/ }).waitFor();
  await banner.waitFor({ state: 'visible', timeout: 10_000 });
  assert.equal((await unsaved())?.id, pending.id, 'the same meeting is pending after going back');

  // 2. Start is refused (through the real button and IPC) before permission, audio or
  //    overlay steps.
  const effectsBefore = sideEffects();
  await clickOrExplain(launcher, launcher.getByRole('button', { name: /Start \S+$/ }), 'the Start button');
  await waitFor(async () => (await banner.getAttribute('data-highlighted')) === 'true', 'the highlighted banner', 10_000);
  const refused = await launcher.evaluate(() => window.electronAPI.startMeeting());
  assert.equal(refused?.success, false);
  assert.equal(refused?.code, 'pending-unsaved-meeting');
  await new Promise((r) => setTimeout(r, 500));
  assert.equal(await launcher.evaluate(() => window.electronAPI.getMeetingActive()), false);
  assert.equal(await visibleOverlay(), false, 'a refused start does not show the overlay');
  assert.equal(sideEffects(), effectsBefore, 'a refused start asks for no permission and opens no device');

  // 3. A retry while the write still fails keeps the meeting.
  await clickOrExplain(launcher, banner.getByRole('button', { name: 'Retry save', exact: true }), 'Retry save');
  await banner.getByRole('alert').filter({ hasText: 'could not be saved' }).waitFor({ timeout: 20_000 });
  assert.equal((await unsaved())?.id, pending.id);

  // 4. Lock released: retry saves the same meeting once, the banner goes, start works.
  await fault('release');
  await clickOrExplain(launcher, banner.getByRole('button', { name: 'Retry save', exact: true }), 'Retry save');
  await banner.waitFor({ state: 'detached', timeout: 10_000 });
  assert.equal(await unsaved(), null);
  const saved = await launcher.evaluate((id) => window.electronAPI.getMeetingDetails(id), pending.id);
  assert.deepEqual(saved.transcript.map((t) => t.text), lines.map(([, text]) => text));
  assert.equal((await launcher.evaluate(() => window.electronAPI.getRecentMeetings())).filter((m) => m.id === pending.id).length, 1);
  const after = await saveMeeting(launcher, [['interviewer', 'AFTER RETRY: a new meeting starts and saves.']]);
  assert.notEqual(after.id, pending.id);
  assert.ok(sideEffects() > effectsBefore, 'an accepted start is seen by the same permission/device count');

  // 5. Another failed write, then discard: cancelling keeps it, confirming drops it
  //    without a row.
  await fault('lock');
  const second = await stopWithFailure([['interviewer', 'DISCARD one: this meeting will be dropped.']]);
  assert.equal(second.reason, 'write-error');
  assert.match(await banner.innerText(), /Writing to the meeting database failed\./);
  await clickOrExplain(launcher, banner.getByRole('button', { name: 'Discard', exact: true }), 'Discard');
  const dialog = banner.getByRole('alertdialog');
  await clickOrExplain(launcher, dialog.getByRole('button', { name: 'Cancel', exact: true }), 'Cancel');
  await dialog.waitFor({ state: 'detached' });
  assert.equal((await unsaved())?.id, second.id, 'cancel keeps the meeting');
  await clickOrExplain(launcher, banner.getByRole('button', { name: 'Discard', exact: true }), 'Discard');
  await clickOrExplain(launcher, dialog.getByRole('button', { name: 'Discard permanently', exact: true }), 'Discard permanently');
  await banner.waitFor({ state: 'detached', timeout: 10_000 });
  assert.equal(await unsaved(), null);
  await fault('release');
  assert.equal(await launcher.evaluate((id) => window.electronAPI.getMeetingDetails(id), second.id), null, 'a discarded meeting has no row');
  assert.equal((await launcher.evaluate(() => window.electronAPI.startMeeting()))?.success, true, 'start works after the discard');
  assert.equal((await launcher.evaluate(() => window.electronAPI.endMeeting()))?.success, true);

  assert.deepEqual(mock.requests.slice(requestsBefore).map((r) => r.url), [], 'the failed-save run sends nothing');
});
