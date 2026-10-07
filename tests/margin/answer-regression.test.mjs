// Margin answer regression harness (PLAN.md AG-09).
//
// Drives the real renderer -> preload -> IPC -> LLMHelper path against a loopback
// mock OpenAI server, inside the X2 isolation (temporary HOME, mock keychain, no
// network, no audio devices, no permission prompts). Uses the dev-only hooks from
// electron/margin/devOverrides.ts. Covers: streamed text answers, cancellation (events
// of the old stream ignored, also once a new stream has started), a superseding question, a screenshot question that sends
// the fixture image, recovery after a provider error, and a retry in the launcher's chat
// after a request that failed before streaming.
//
// Prerequisites: `node scripts/build-electron.js` and `npx vite build`.
// Run:
//   node scripts/margin/isolation/run-node.mjs --allow-exec Electron \
//     --test --test-timeout=180000 tests/margin/answer-regression.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { startMockOpenAI } from './mock-openai.mjs';
import { launchApp, windowWithQuery, readMainErrors } from './launch-app.mjs';
import { makeSandbox, readBlocked } from '../../scripts/margin/isolation/env.mjs';

const require = createRequire(import.meta.url);
const sharp = require('sharp');
const FAKE_KEY = 'sk-margin-regression-not-a-real-key';
const MODEL = 'gpt-5.4';

let mock;
let app;
let sandbox;
let overlay;
let mainErrorsLog;
let mainPid;

// Visible transcript text of the overlay's message list.
const overlayText = () => overlay.evaluate(() => document.body.innerText);

// Type a question and press Enter. The overlay clears the input only when it
// accepts the submit (it ignores submits while a previous answer is in flight), so
// retry until the input is empty.
async function ask(question, { timeoutMs = 15_000 } = {}) {
  const input = overlay.locator('input[type="text"]').last();
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await input.fill(question);
    await input.press('Enter');
    await new Promise((r) => setTimeout(r, 250));
    if ((await input.inputValue()) === '') return;
  }
  throw new Error(`overlay did not accept the question within ${timeoutMs} ms`);
}

// The real shortcut path: KeybindManager -> main sends 'global-shortcut'
// {action:'takeScreenshot'} to the window, the renderer takes the screenshot over IPC
// and attaches it. Only the OS-level key press is simulated here.
async function pressScreenshotShortcut() {
  await app.evaluate(({ BrowserWindow }) => {
    for (const w of BrowserWindow.getAllWindows()) {
      if (w.webContents.getURL().includes('window=overlay')) w.webContents.send('global-shortcut', { action: 'takeScreenshot' });
    }
  });
}

// Sends a chat stream event to the overlay over the real main -> preload -> renderer
// IPC path, as the main process would for a provider chunk. `args` follow the channel
// as main sends them: (token, streamId), (streamId) or (error, streamId).
async function sendOverlayStreamEvent(channel, ...args) {
  await app.evaluate(({ BrowserWindow }, [ch, a]) => {
    for (const w of BrowserWindow.getAllWindows()) {
      if (w.webContents.getURL().includes('window=overlay')) (w.webContents.__marginRealSend ?? w.webContents.send.bind(w.webContents))(ch, ...a);
    }
  }, [channel, args]);
}

// Main side: records the stream id of every chat token the app itself sends to the
// overlay, so the test can address an old or the current stream.
async function installStreamIdSpy() {
  await app.evaluate(({ BrowserWindow }) => {
    globalThis.__marginStreamIds = [];
    for (const w of BrowserWindow.getAllWindows()) {
      const wc = w.webContents;
      if (!wc.getURL().includes('window=overlay') || wc.__marginRealSend) continue;
      wc.__marginRealSend = wc.send.bind(wc);
      wc.send = (ch, ...args) => {
        if (ch === 'gemini-stream-token' && !globalThis.__marginStreamIds.includes(args[1])) globalThis.__marginStreamIds.push(args[1]);
        return wc.__marginRealSend(ch, ...args);
      };
    }
  });
}
const streamIds = () => app.evaluate(() => globalThis.__marginStreamIds);

// Renderer side: subscribes through the same preload API the overlay uses and records
// exactly which stream events the preload delivers.
async function installDeliveryRecorder() {
  await overlay.evaluate(() => {
    window.__marginDelivered = { tokens: [], done: 0, errors: [] };
    window.electronAPI.onGeminiStreamToken((t) => window.__marginDelivered.tokens.push(t));
    window.electronAPI.onGeminiStreamDone(() => { window.__marginDelivered.done += 1; });
    window.electronAPI.onGeminiStreamError((e) => window.__marginDelivered.errors.push(e));
  });
}
const delivered = () => overlay.evaluate(() => JSON.parse(JSON.stringify(window.__marginDelivered)));
const resetDelivered = () => overlay.evaluate(() => { window.__marginDelivered = { tokens: [], done: 0, errors: [] }; });

test.before(async () => {
  mock = await startMockOpenAI();
  sandbox = makeSandbox('regression');
  const fixture = path.join(sandbox.tmp, 'fixture-screen.png');
  await sharp({ create: { width: 64, height: 48, channels: 3, background: '#2050a0' } }).png().toFile(fixture);

  ({ app, mainErrorsLog } = await launchApp(sandbox, {
    NODE_ENV: 'production',
    MARGIN_DEV_OPENAI_BASE_URL: mock.baseURL,
    MARGIN_DEV_SCREENSHOT_FIXTURE: fixture,
  }));
  mainPid = app.process().pid;
  const launcher = await windowWithQuery(app, 'window=launcher');
  await launcher.waitForLoadState('domcontentloaded');
  const keyResult = await launcher.evaluate((k) => window.electronAPI.setOpenaiApiKey(k), FAKE_KEY);
  assert.equal(keyResult?.success, true, `setOpenaiApiKey failed: ${JSON.stringify(keyResult)}`);
  await launcher.evaluate((m) => window.electronAPI.setModel(m), MODEL); // see note in PLAN.md AG-09
  const config = await launcher.evaluate(() => window.electronAPI.getCurrentLlmConfig());
  assert.equal(config?.model, MODEL, `active model is ${JSON.stringify(config)}`);

  overlay = await windowWithQuery(app, 'window=overlay');
  await overlay.waitForLoadState('domcontentloaded');
});

test.after(async () => {
  try { await app?.close(); } catch { /* already gone */ }
  await mock?.close();
  const blocked = sandbox ? readBlocked(sandbox).filter((b) => !['permission', 'device', 'local-exec'].includes(b.kind)) : [];
  assert.deepEqual(blocked.map((b) => `${b.kind} ${b.detail}`), [], 'no outbound attempts during the regression run');
  // AG-14: nothing may probe, start or reach Ollama (port 11434 is a watched port, so a
  // connection would also show up above as kind "watched-port").
  const ollama = sandbox ? readBlocked(sandbox).filter((b) => /11434|ollama|lsof/i.test(`${b.kind} ${b.detail}`)) : [];
  assert.deepEqual(ollama.map((b) => `${b.kind} ${b.detail}`), [], 'no Ollama probe or port 11434 traffic during the regression run');
  // The launch loaded record-main-errors.cjs (launchApp checks); it may not have had an uncaught exception or unhandled rejection in the main process.
  const mainErrors = mainErrorsLog ? readMainErrors(mainErrorsLog, mainPid) : [];
  assert.deepEqual(mainErrors.map((e) => `${e.kind}: ${e.detail.split('\n')[0]}`), [], 'no main-process exception during the regression run');
});

test('a typed question streams the mock answer into the overlay', async () => {
  mock.setScript({ chunks: ['Margin ', 'regression ', 'answer ', 'one.'], delayMs: 150 });
  const before = mock.chatRequests().length;
  await ask('What is two plus two?');

  // Partial text must appear before the stream finishes (streaming, not one block).
  await overlay.waitForFunction(() => document.body.innerText.includes('Margin regression'), null, { timeout: 15_000 });
  const partial = await overlayText();
  assert.ok(!partial.includes('Margin regression answer one.'), 'first visible state should be partial');
  await overlay.waitForFunction(() => document.body.innerText.includes('Margin regression answer one.'), null, { timeout: 15_000 });

  const req = mock.chatRequests().at(-1);
  assert.equal(mock.chatRequests().length, before + 1, 'exactly one request per question');
  assert.equal(req.body.model, MODEL);
  assert.equal(req.body.stream, true);
  assert.ok(JSON.stringify(req.body.messages).includes('What is two plus two?'));
});

test('after cancel, and after a new stream has started, events of the old stream are not shown', async () => {
  await installStreamIdSpy();
  await installDeliveryRecorder();

  // 800 ms between chunks leaves ~2.4 s between "Cancel test" showing and LATE-3 being
  // sent. At 400 ms (~1.2 s) a slow CI runner once cancelled after LATE-3 (PLAN.md AG-16).
  mock.setScript({ chunks: ['Cancel ', 'test ', 'LATE-1 ', 'LATE-2 ', 'LATE-3 ', 'LATE-4.'], delayMs: 800 });
  await ask('Please give a long answer.');
  await overlay.waitForFunction(() => document.body.innerText.includes('Cancel test'), null, { timeout: 15_000 });
  const oldReq = mock.chatRequests().at(-1);
  const [oldId] = await streamIds();
  assert.ok(oldId !== undefined && oldId !== null, `main sent no stream id with the tokens: ${JSON.stringify(await streamIds())}`);

  // Positive control: while the stream is live, an injected token with its id is shown,
  // so the injection path below really reaches the overlay.
  await sendOverlayStreamEvent('gemini-stream-token', 'LIVE-INJECTED ', oldId);
  await overlay.waitForFunction(() => document.body.innerText.includes('LIVE-INJECTED'), null, { timeout: 5_000 });

  await overlay.evaluate(() => window.electronAPI.cancelChatStream());
  await resetDelivered();

  // 1. In the gap after the cancel: a late token and done of the old stream.
  await sendOverlayStreamEvent('gemini-stream-token', 'GAP-INJECTED', oldId);
  await sendOverlayStreamEvent('gemini-stream-done', oldId);
  assert.deepEqual(await delivered(), { tokens: [], done: 0, errors: [] }, 'events after cancel were delivered');

  // 2. A new stream starts right away; events of the old stream (which main may have
  // sent before it saw the stop) and events without an id must still be dropped.
  mock.setScript({ chunks: ['Fresh ', 'answer ', 'arrives ', 'intact.'], delayMs: 600 });
  await overlay.evaluate(() => { window.electronAPI.streamGeminiChat('Fresh question'); });
  await overlay.waitForFunction(() => window.__marginDelivered.tokens.includes('Fresh '), null, { timeout: 15_000 });
  const newId = (await streamIds()).at(-1);
  assert.notEqual(newId, oldId, 'the new stream must have its own id');
  await sendOverlayStreamEvent('gemini-stream-token', 'STALE-INJECTED', oldId);
  await sendOverlayStreamEvent('gemini-stream-done', oldId);
  await sendOverlayStreamEvent('gemini-stream-error', 'STALE-ERROR-INJECTED', oldId);
  await sendOverlayStreamEvent('gemini-stream-token', 'NOID-INJECTED');
  await sendOverlayStreamEvent('gemini-stream-done');
  // Positive control for the new stream: its own id is delivered.
  await sendOverlayStreamEvent('gemini-stream-token', 'NEW-INJECTED ', newId);
  await overlay.waitForFunction(() => window.__marginDelivered.tokens.includes('NEW-INJECTED '), null, { timeout: 5_000 });
  const midStream = await delivered();
  assert.equal(midStream.done, 0, 'a done of the old stream ended the new one');
  assert.deepEqual(midStream.errors, [], 'an error of the old stream reached the new one');

  // The new stream finishes normally: one done, its full text, nothing stale.
  await overlay.waitForFunction(() => window.__marginDelivered.done === 1, null, { timeout: 15_000 });
  await overlay.waitForFunction(() => document.body.innerText.includes('intact.'), null, { timeout: 5_000 });
  await new Promise((r) => setTimeout(r, 4_500)); // longer than the old stream's remaining script
  const final = await delivered();
  assert.equal(final.done, 1);
  assert.deepEqual(final.errors, []);
  assert.deepEqual(final.tokens.filter((t) => /INJECTED|LATE-/.test(t)), ['NEW-INJECTED '], `stale tokens were delivered: ${JSON.stringify(final.tokens)}`);
  const text = await overlayText();
  for (const stale of ['GAP-INJECTED', 'STALE-INJECTED', 'STALE-ERROR-INJECTED', 'NOID-INJECTED', 'LATE-3', 'LATE-4']) {
    assert.ok(!text.includes(stale), `${stale} was shown:\n${text.slice(-400)}`);
  }
  assert.ok(oldReq.closedEarly || oldReq.chunksSent < 6, 'the client should abort the old HTTP stream');
});

test('while an answer streams, a typed question is held back and a new stream request supersedes it', async () => {
  mock.setScript({ chunks: ['First ', 'STALE-A ', 'STALE-B ', 'STALE-C ', 'STALE-D.'], delayMs: 500 });
  await ask('First question');
  await overlay.waitForFunction(() => document.body.innerText.includes('First'), null, { timeout: 15_000 });
  const firstReq = mock.chatRequests().at(-1);

  // UI contract: the overlay does not accept a second typed question mid-stream.
  const input = overlay.locator('input[type="text"]').last();
  await input.fill('Typed during stream');
  await input.press('Enter');
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(await input.inputValue(), 'Typed during stream', 'typed question should be held back while streaming');
  await input.fill('');

  // Main-process contract: a new gemini-chat-stream from the same window aborts the old one.
  mock.setScript({ chunks: ['Second ', 'answer ', 'done.'], delayMs: 50 });
  await overlay.evaluate(() => window.electronAPI.streamGeminiChat('Second question'));
  await overlay.waitForFunction(() => document.body.innerText.includes('Second answer done.'), null, { timeout: 15_000 });
  await new Promise((r) => setTimeout(r, 2_500));
  const text = await overlayText();
  assert.ok(!text.includes('STALE-D'), `superseded stream kept writing:\n${text.slice(-400)}`);
  assert.ok(firstReq.closedEarly || firstReq.chunksSent < 5, 'the first HTTP stream should be aborted');
});

test('a screenshot question sends the fixture image to the model', async () => {
  mock.setScript({ chunks: ['Screenshot ', 'seen.'], delayMs: 50 });
  await pressScreenshotShortcut();
  // The attached screenshot shows as a preview image in the input area.
  await overlay.waitForFunction(() => [...document.images].some((i) => i.src.startsWith('data:image')), null, { timeout: 15_000 });
  const before = mock.chatRequests().length;
  await ask('What is on the screen?');
  await overlay.waitForFunction(() => document.body.innerText.includes('Screenshot seen.'), null, { timeout: 20_000 });
  const req = mock.chatRequests().slice(before).find((r) => JSON.stringify(r.body).includes('What is on the screen?'));
  assert.ok(req, 'no request carried the screenshot question');
  const serialized = JSON.stringify(req.body.messages);
  assert.ok(/data:image\/(png|jpeg|webp);base64,/.test(serialized), 'request did not include an image');
});

test('a provider error is shown and the next question still works', async () => {
  mock.setScript({ errorStatus: 400 });
  const before = mock.chatRequests().length;
  await ask('This one fails.');
  await overlay.waitForFunction(() => document.body.innerText.includes('mock: injected error'), null, { timeout: 15_000 });
  await new Promise((r) => setTimeout(r, 1_000)); // a retry storm would show up here
  assert.equal(mock.chatRequests().length - before, 1, 'a 400 should not be retried');

  mock.setScript({ errorStatus: 0, chunks: ['Recovered ', 'answer.'], delayMs: 50 });
  await ask('And this one?');
  await overlay.waitForFunction(() => document.body.innerText.includes('Recovered answer.'), null, { timeout: 20_000 });
});

// Makes the next gemini-chat-stream request fail in its setup, before any stream event,
// as an exception there does: the renderer's invoke rejects. Later requests go to the
// real handler again. Electron keeps invoke handlers in ipcMain._invokeHandlers.
async function failNextChatStreamSetup() {
  await app.evaluate(({ ipcMain }) => {
    const handlers = ipcMain._invokeHandlers;
    const real = handlers?.get('gemini-chat-stream');
    if (!real) throw new Error('gemini-chat-stream handler not found');
    handlers.set('gemini-chat-stream', async () => {
      handlers.set('gemini-chat-stream', real);
      throw new Error('margin: injected setup failure');
    });
  });
}

// Third review (PLAN.md AG-17): the launcher's chat registered its stream listeners and
// kept them when the request failed before streaming, so the next answer was received
// twice into one buffer, and the old done handler cleared it.
test('after a chat request fails before streaming, the next answer is shown once and kept', async () => {
  const launcher = await windowWithQuery(app, 'window=launcher');
  // A fresh profile shows the first-run startup sequence instead of the launcher.
  await launcher.evaluate(() => localStorage.setItem('natively_seen_startup_v1', 'true'));
  await launcher.reload();
  await launcher.waitForLoadState('domcontentloaded');
  await failNextChatStreamSetup();
  const before = mock.chatRequests().length;
  const search = launcher.locator('input[placeholder="Search or ask anything..."]');
  await search.click();
  await search.fill('Launcher question that fails');
  await search.press('ArrowDown');
  await search.press('Enter');
  await launcher.waitForFunction(() => document.body.innerText.includes('Something went wrong'), null, { timeout: 15_000 });
  assert.equal(mock.chatRequests().length, before, 'the failed request reached no provider');

  mock.setScript({ errorStatus: 0, chunks: ['Retry ', 'answer ', 'kept.'], delayMs: 100 });
  const chat = launcher.locator('input[placeholder="Ask me anything..."]');
  await chat.fill('Launcher retry question');
  await chat.press('Enter');
  await launcher.waitForFunction(() => document.body.innerText.includes('Retry answer kept.'), null, { timeout: 20_000 });
  await new Promise((r) => setTimeout(r, 1_000)); // past the stream's done event
  const text = await launcher.evaluate(() => document.body.innerText);
  assert.equal(text.split('Retry answer kept.').length - 1, 1, 'the answer is shown exactly once and survives done');
  assert.equal(mock.chatRequests().length, before + 1);
});
