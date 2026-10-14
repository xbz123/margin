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
let answerGateway;

// Visible transcript text of the overlay's message list.
const overlayText = () => overlay.evaluate(() => document.body.innerText);

// Acceptance is a physical mock request, not input removal: failed generations
// now retain the submitted input and attachments for an explicit retry.
async function ask(question, { timeoutMs = 15_000 } = {}) {
  const input = overlay.locator('input[type="text"]').last();
  const deadline = Date.now() + timeoutMs;
  const before = mock.chatRequests().length;
  while (Date.now() < deadline) {
    await input.fill(question);
    await input.press('Enter');
    await new Promise((r) => setTimeout(r, 250));
    if (mock.chatRequests().length > before) return;
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
  assert.deepEqual(keyResult, { ok: true }, `setOpenaiApiKey failed: ${JSON.stringify(keyResult)}`);
  const created = await launcher.evaluate(config => window.electronAPI.setGatewayConfiguration(config),
    { protocol: 'chat-completions', baseUrl: mock.baseURL, model: MODEL, apiKey: FAKE_KEY });
  assert.equal(created.ok, true);
  answerGateway = created.gatewayId;
  const imageTarget = { id: answerGateway, protocol: 'chat-completions', baseUrl: mock.baseURL, model: MODEL,
    imageSupportConfirmedFor: JSON.stringify(['gateway', answerGateway, 'chat-completions', mock.baseURL.replace(/\/+$/, ''), MODEL]) };
  assert.equal((await launcher.evaluate(config => window.electronAPI.setGatewayConfiguration(config), imageTarget)).ok, true);
  await launcher.evaluate((m) => window.electronAPI.setModel(m), `llm-gateway:${answerGateway}:chat-completions:${encodeURIComponent(MODEL)}`);
  const config = await launcher.evaluate(() => window.electronAPI.getCurrentLlmConfig());
  assert.equal(config?.model, `llm-gateway:${answerGateway}:chat-completions:${encodeURIComponent(MODEL)}`, `active model is ${JSON.stringify(config)}`);

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
  let releaseTail;
  const tailGate = new Promise((resolve) => { releaseTail = resolve; });
  let reachedPause;
  const paused = new Promise((resolve) => { reachedPause = resolve; });
  mock.setScript({
    chunks: ['Margin ', 'regression ', 'answer ', 'one.'], delayMs: 150,
    afterChunk(entry) {
      if (entry.chunksSent !== 2) return;
      reachedPause(entry);
      return tailGate;
    },
  });
  const before = mock.chatRequests().length;
  let pauseTimeout;
  try {
    await ask('What is two plus two?');
    const req = await Promise.race([
      paused,
      new Promise((_, reject) => { pauseTimeout = setTimeout(() => reject(new Error('mock stream did not pause after two chunks')), 15_000); }),
    ]);
    // Hold the server's tail while observing the real renderer: slow browser
    // round trips cannot turn a partial-state assertion into a completed sample.
    await overlay.waitForFunction(() => document.body.innerText.includes('Margin regression'), null, { timeout: 15_000 });
    const partial = await overlayText();
    assert.equal(req.chunksSent, 2, 'only the first two chunks were sent while observing the partial');
    assert.ok(partial.includes('Margin regression'), 'the renderer must display the paused partial');
    assert.ok(!partial.includes('Margin regression answer one.'), 'first visible state should be partial');
    releaseTail();
    await overlay.waitForFunction(() => document.body.innerText.includes('Margin regression answer one.'), null, { timeout: 15_000 });
  } finally {
    clearTimeout(pauseTimeout);
    releaseTail();
  }

  const req = mock.chatRequests().at(-1);
  assert.equal(mock.chatRequests().length, before + 1, 'exactly one request per question');
  assert.equal(req.body.model, MODEL);
  assert.equal(req.body.stream, true);
  assert.ok(JSON.stringify(req.body.messages).includes('What is two plus two?'));
});

test('S42-04 actual hidden DOM cannot acknowledge quick EOF until the answer becomes visible', async () => {
  mock.setScript({ chunks: ['S42 actual visible body.'], delayMs: 1 });
  await app.evaluate(({ ipcMain }) => {
    globalThis.__s42Visible = [];
    ipcMain.on('generation:first-visible', (_event, requestId) => globalThis.__s42Visible.push(requestId));
  });
  await overlay.evaluate(() => {
    const style = document.createElement('style'); style.id = 's42-hidden-answer';
    style.textContent = 'body { visibility: hidden !important; }'; document.head.append(style);
    window.__s42Done = [];
    window.electronAPI.onGeminiStreamDone(metadata => window.__s42Done.push(metadata));
    void window.electronAPI.streamGeminiChat('S42 original hidden DOM question', undefined, undefined, { generationKind: 'interview' });
  });
  try {
    await overlay.waitForFunction(() => document.body.textContent.includes('S42 actual visible body.'), null, { timeout: 10_000 });
    assert.deepEqual(await app.evaluate(() => globalThis.__s42Visible), []);
    assert.deepEqual(await overlay.evaluate(() => window.__s42Done), []);
    await overlay.evaluate(() => document.getElementById('s42-hidden-answer').remove());
    await overlay.waitForFunction(() => window.__s42Done.length === 1, null, { timeout: 10_000 });
    const metadata = await overlay.evaluate(() => window.__s42Done[0]);
    assert.equal((await app.evaluate(() => globalThis.__s42Visible)).filter(id => id === metadata.requestId).length, 1);
    assert.ok(metadata.timing.firstVisibleMs >= metadata.timing.modelToVisibleMs);
  } finally { await overlay.evaluate(() => document.getElementById('s42-hidden-answer')?.remove()); }
});

test('S42-04 actual Retry preserves the partial row and original wire input while creating a separately linked answer', async () => {
  mock.setScript({ chunks: ['S42 retained partial.'], delayMs: 50, disconnectAfterChunks: 1 });
  await ask('S42 original retry question');
  await overlay.getByRole('button', { name: 'Retry', exact: true }).waitFor({ state: 'visible' });
  const original = structuredClone(mock.chatRequests().at(-1).body);
  const originalQuestionId = await overlay.locator('[data-question-id]').last().getAttribute('data-question-id');
  mock.setScript({ chunks: ['S42 independent retry body.'], delayMs: 1 });
  await overlay.getByRole('button', { name: 'Retry', exact: true }).click();
  await overlay.waitForFunction(() => document.body.innerText.includes('S42 independent retry body.'));
  assert.deepEqual(mock.chatRequests().at(-1).body.messages, original.messages);
  const text = await overlayText(); assert.match(text, /S42 retained partial\./);
  const rows = await overlay.locator(`[data-question-id="${originalQuestionId}"]`).allTextContents();
  assert.ok(rows.some(row => row.includes('S42 retained partial.') && !row.includes('S42 independent retry body.')));
  assert.ok(rows.some(row => row.includes('S42 independent retry body.') && !row.includes('S42 retained partial.')));
});

test('F1 actual Retry then Answer then Remove all cannot resend the withdrawn screenshot', async () => {
  await pressScreenshotShortcut();
  await overlay.getByAltText('Screenshot 1', { exact: true }).waitFor();
  mock.setScript({ errorStatus: 400 });
  try {
    await ask('F1 original screenshot question');
    await overlay.getByRole('button', { name: 'Retry', exact: true }).waitFor({ state: 'visible' });
    const before = mock.chatRequests().length;
    mock.setScript({ errorStatus: 503, retryAfterSeconds: 4 });
    await overlay.getByRole('button', { name: 'Retry', exact: true }).click();
    for (let n = 0; n < 100 && mock.chatRequests().length === before; n++) await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(mock.chatRequests().length, before + 1);
    await overlay.getByRole('button', { name: 'Answer', exact: true }).click();
    await overlay.getByRole('button', { name: 'Stop', exact: true }).waitFor();
    await overlay.getByRole('button', { name: 'Remove all', exact: true }).click();
    await overlay.getByAltText('Screenshot 1', { exact: true }).waitFor({ state: 'hidden' });
    const removedAt = mock.chatRequests().length;
    mock.setScript({ errorStatus: 0, chunks: ['Old screenshot answer.'], delayMs: 5 });
    await new Promise(resolve => setTimeout(resolve, 4500));
    assert.equal(mock.chatRequests().slice(removedAt).filter(entry => JSON.stringify(entry.body).includes('data:image/')).length, 0);
    assert.equal(await overlay.getByRole('button', { name: 'Stop', exact: true }).isVisible(), true, 'old retry cleanup preserves the new dictation');
  } finally {
    mock.setScript({ errorStatus: 0 });
    if (await overlay.getByRole('button', { name: 'Stop', exact: true }).isVisible()) await overlay.getByRole('button', { name: 'Stop', exact: true }).click();
  }
});

test('S42-04 removing the attached screenshot through the actual UI revokes its failed request', async () => {
  await overlay.evaluate(() => { window.electronAPI.onGeminiStreamError((_error, metadata) => { window.__s42ImageFailure = metadata; }); });
  await pressScreenshotShortcut();
  await overlay.getByAltText('Screenshot 1', { exact: true }).waitFor();
  mock.setScript({ errorStatus: 400 });
  try {
    await ask('S42 screenshot to withdraw');
    await overlay.getByRole('button', { name: 'Retry', exact: true }).waitFor({ state: 'visible' });
    const before = mock.chatRequests().length;
    await overlay.getByRole('button', { name: 'Remove all' }).click();
    await overlay.getByRole('button', { name: 'Retry', exact: true }).waitFor({ state: 'hidden' });
    const error = await overlay.evaluate(() => window.electronAPI.retryGeneration(window.__s42ImageFailure.requestId).then(() => '', e => String(e)));
    assert.match(error, /no longer available/); assert.equal(mock.chatRequests().length, before);
  } finally { mock.setScript({ errorStatus: 0 }); }
});

test('after cancel, and after a new stream has started, events of the old stream are not shown', async () => {
  await installStreamIdSpy();
  await installDeliveryRecorder();

  // Cancellation rebuilds the streaming DOM; use delivered tokens, not a UI snapshot,
  // to identify LATE chunks legitimately received before cancellation.
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

  const lateAtCancel = await overlay.evaluate(() => {
    const tokensBeforeCancel = [...window.__marginDelivered.tokens];
    // Preload clears the active id synchronously; no IPC event can interleave here.
    window.electronAPI.cancelChatStream();
    window.__marginDelivered = { tokens: [], done: 0, errors: [] };
    return tokensBeforeCancel.join('').match(/LATE-\d+/g) ?? [];
  });

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
  assert.doesNotMatch(final.tokens.join(''), /LATE-\d+/, 'LATE markers were delivered after cancel');
  assert.deepEqual(final.tokens.filter((t) => /INJECTED|LATE-/.test(t)), ['NEW-INJECTED '], `stale tokens were delivered: ${JSON.stringify(final.tokens)}`);
  const text = await overlayText();
  for (const stale of ['GAP-INJECTED', 'STALE-INJECTED', 'STALE-ERROR-INJECTED', 'NOID-INJECTED']) {
    assert.ok(!text.includes(stale), `${stale} was shown:\n${text.slice(-400)}`);
  }
  const remainingLate = [...lateAtCancel];
  for (const marker of text.match(/LATE-\d+/g) ?? []) {
    const index = remainingLate.indexOf(marker);
    assert.notEqual(index, -1, `${marker} appeared after cancel:\n${text.slice(-400)}`);
    remainingLate.splice(index, 1);
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
  // S34: LLMHelper.processImage encodes with Electron's nativeImage at the original
  // resolution; the 64x48 fixture is sent as a 64x48 JPEG.
  const sent = Buffer.from(serialized.match(/data:image\/jpeg;base64,([A-Za-z0-9+/=]+)/)?.[1] ?? '', 'base64');
  const metadata = await sharp(sent).metadata();
  assert.deepEqual([metadata.format, metadata.width, metadata.height], ['jpeg', 64, 48]);
});

test('generateWhatToSay uses the actual preload/IPC and sends one answer request with the original screenshot', async () => {
  mock.setScript({ chunks: ['AG32 direct image answer.'], delayMs: 20 });
  const before = mock.chatRequests().length;
  const result = await overlay.evaluate(async () => {
    const screenshot = await window.electronAPI.takeScreenshot();
    return window.electronAPI.generateWhatToSay('Explain the screen', [screenshot.path]);
  });
  assert.equal(result.answer, 'AG32 direct image answer.');
  assert.equal(result.screenContextStatus, 'not_available', 'no fabricated extracted screen facts');
  assert.equal(result.usedImageInput, true); assert.equal(result.visionModelUsed, MODEL);
  assert.equal(result.visionAttempts, 1); assert.equal(result.generationStatus, 'completed');
  const requests = mock.chatRequests().slice(before);
  assert.equal(requests.length, 1, 'no separate generative screen preanalysis');
  assert.match(JSON.stringify(requests[0].body.messages), /data:image\/(png|jpeg|webp);base64,/);
});

test('a WhatToSay scope refusal through the real renderer action displays one error and sends nothing', async () => {
  const original = await overlay.evaluate(() => window.electronAPI.getProviderDataScopes());
  const before = mock.chatRequests().length;
  const errorsBefore = (await overlayText()).split('Error (what_to_say):').length - 1;
  const transcriptBefore = (await overlayText()).split('Data scope denied').length - 1;
  try {
    await overlay.evaluate(() => window.electronAPI.setProviderDataScopes({ transcript: false }));
    // Exercise the existing screenshot attachment path along with manual answering.
    const removeAll = overlay.locator('button[title="Remove all"]');
    if (await removeAll.count()) await removeAll.click();
    await overlay.waitForFunction(() => !document.querySelector('img[alt="Screenshot 1"]'));
    await pressScreenshotShortcut();
    await overlay.waitForFunction(() => document.querySelector('img[alt="Screenshot 1"]')?.src.startsWith('data:image'));
    await app.evaluate(({ BrowserWindow }) => {
      for (const window of BrowserWindow.getAllWindows()) if (window.webContents.getURL().includes('window=overlay')) window.webContents.send('global-shortcut', { action: 'whatToAnswer' });
    });
    await overlay.waitForFunction(count => document.body.innerText.split('Error (what_to_say):').length - 1 === count + 1, errorsBefore, { timeout: 15_000 });
    const text = await overlayText();
    assert.equal(text.split('Error (what_to_say):').length - 1, errorsBefore + 1);
    assert.equal(text.split('Data scope denied').length - 1, transcriptBefore + 1, 'the scope refusal must be shown exactly once');
    assert.equal(mock.chatRequests().length, before);
  } finally { await overlay.evaluate(scopes => window.electronAPI.setProviderDataScopes(scopes), original); }
});

test('a provider error is shown and the next question still works', async () => {
  mock.setScript({ errorStatus: 400 });
  const before = mock.chatRequests().length;
  await ask('This one fails.');
  await overlay.waitForFunction(() => document.body.innerText.includes('Gateway request failed (HTTP 400)'), null, { timeout: 15_000 });
  assert.doesNotMatch(await overlayText(), /mock: injected error/, 'raw gateway errors are not reflected into the renderer');
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
  // Focus, not click: once the pill has focus its backdrop (z-90) covers the input
  // (z-40), so a click times out if the input was focused first (CI 38000301350).
  await search.focus();
  await search.fill('Launcher question that fails');
  await search.press('ArrowDown');
  await search.press('Enter');
  await launcher.waitForFunction(() => document.body.innerText.includes('margin: injected setup failure'), null, { timeout: 15_000 });
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

test('R3-1 real preload refuses a changed origin without key reentry and keeps runtime, stored selections and key availability', async () => {
  const snapshot = () => overlay.evaluate(async () => ({
    stored: await window.electronAPI.getStoredCredentials(),
    selection: await window.electronAPI.getCurrentLlmConfig(),
    defaultModel: await window.electronAPI.getDefaultModel(),
    generationPolicy: await window.electronAPI.getGenerationPolicy(),
  }));
  const before = await snapshot(), sends = mock.chatRequests().length;
  const changed = { ...before.stored.gateways.find(item => item.id === answerGateway), baseUrl: 'http://127.0.0.1:1/v1' };
  const result = await overlay.evaluate(config => window.electronAPI.setGatewayConfiguration(config), changed);
  assert.equal(result.ok, false);
  assert.match(result.message, /re-enter.*API key/i);
  assert.deepEqual(await snapshot(), before);
  assert.equal(before.stored.hasOpenaiKey, true);
  assert.equal(mock.chatRequests().length, sends);
});

test('a complete compatible target saved through preload drives a real typed UI question', async () => {
  const previous = await overlay.evaluate(async id => ({
    configuration: (await window.electronAPI.getStoredCredentials()).gateways.find(item => item.id === id),
    selection: await window.electronAPI.getCurrentLlmConfig(),
    defaultModel: await window.electronAPI.getDefaultModel(),
  }), answerGateway);
  const configuration = { id: answerGateway, protocol: 'chat-completions', baseUrl: mock.baseURL, model: 'opaque/ag31-model' };
  const selection = `llm-gateway:${answerGateway}:chat-completions:${encodeURIComponent(configuration.model)}`;
  try {
    // Omit apiKey: the existing synthetic key must survive the complete configuration transaction.
    const saved = await overlay.evaluate(value => window.electronAPI.setGatewayConfiguration(value), configuration);
    assert.equal(saved.ok, true, `configuration save failed: ${JSON.stringify(saved)}`);
    const stored = await overlay.evaluate(() => window.electronAPI.getStoredCredentials());
    assert.deepEqual(stored.gateways.find(item => item.id === answerGateway), { ...configuration, hasKey: true });
    assert.equal(stored.hasOpenaiKey, true);
    await overlay.evaluate(value => window.electronAPI.setModel(value), selection);
    assert.deepEqual(await overlay.evaluate(() => window.electronAPI.getCurrentLlmConfig()), { provider: 'gateway', model: selection });
    const removeAll = overlay.getByRole('button', { name: 'Remove all' });
    if (await removeAll.count()) await removeAll.click();
    mock.setScript({ errorStatus: 0, chunks: ['AG31 ', 'opaque ', 'target ', 'answer.'], delayMs: 50 });
    const before = mock.chatRequests().length;
    await ask('Synthetic AG31 saved target question');
    await overlay.waitForFunction(() => document.body.innerText.includes('AG31 opaque target answer.'), null, { timeout: 20_000 });
    const requests = mock.chatRequests().slice(before);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, '/v1/chat/completions');
    assert.equal(requests[0].body.model, configuration.model);
    assert.ok(JSON.stringify(requests[0].body.messages).includes('Synthetic AG31 saved target question'));
    assert.equal(requests[0].body.prompt_cache_key, undefined, 'unknown compatible endpoint receives no OpenAI cache parameter');
  } finally {
    const restored = await overlay.evaluate(value => window.electronAPI.setGatewayConfiguration(value), previous.configuration);
    assert.equal(restored.ok, true, 'restore the original synthetic configuration');
    if (previous.defaultModel?.model) {
      const result = await overlay.evaluate(value => window.electronAPI.setDefaultModel(value), previous.defaultModel.model);
      assert.equal(result.ok, true, 'restore the original default model');
    }
    await overlay.evaluate(value => window.electronAPI.setModel(value), previous.selection.model);
    assert.deepEqual(await overlay.evaluate(() => window.electronAPI.getCurrentLlmConfig()), previous.selection);
  }
});

test('AG33 unknown image capability preserves the real renderer input and attachment; explicit confirmation enables retry', async () => {
  const original = (await overlay.evaluate(() => window.electronAPI.getStoredCredentials())).gateways.find(item => item.id === answerGateway);
  const unconfirmed = { ...original }; delete unconfirmed.imageSupportConfirmedFor;
  const input = overlay.locator('input[type="text"]').last();
  const before = mock.chatRequests().length;
  try {
    assert.equal((await overlay.evaluate(config => window.electronAPI.setGatewayConfiguration(config), unconfirmed)).ok, true);
    const removeAll = overlay.getByRole('button', { name: 'Remove all' });
    if (await removeAll.count()) await removeAll.click();
    await pressScreenshotShortcut();
    await overlay.waitForFunction(() => document.querySelector('img[alt="Screenshot 1"]')?.src.startsWith('data:image'));
    await input.fill('AG33 image confirmation question'); await input.press('Enter');
    await overlay.waitForFunction(() => document.body.innerText.includes('Image support is unconfirmed'), null, { timeout: 15_000 });
    assert.equal(await input.inputValue(), 'AG33 image confirmation question');
    assert.equal(await overlay.locator('img[alt="Screenshot 1"]').count(), 1);
    assert.equal(mock.chatRequests().length, before);
    assert.equal((await overlay.evaluate(config => window.electronAPI.setGatewayConfiguration(config), original)).ok, true);
    mock.setScript({ errorStatus: 0, chunks: ['AG33 image retry accepted.'], delayMs: 20 });
    await input.press('Enter');
    await overlay.waitForFunction(() => document.body.innerText.includes('AG33 image retry accepted.'), null, { timeout: 15_000 });
    await overlay.waitForFunction(() => document.querySelector('input[type="text"]')?.value === '' || [...document.querySelectorAll('input[type="text"]')].at(-1)?.value === '');
    assert.equal(mock.chatRequests().length, before + 1);
    assert.match(JSON.stringify(mock.chatRequests().at(-1).body.messages), /data:image/);
    await overlay.waitForFunction(() => [...document.querySelectorAll('[data-generation-status="completed"]')].some(node => node.textContent.includes('gpt-5.4')));
  } finally { await overlay.evaluate(config => window.electronAPI.setGatewayConfiguration(config), original); }
});

test('AG33 one webContents delivers chat events only to the owning UI subscription', async () => {
  await overlay.evaluate(() => {
    window.__ag33Owners = { natively: '', global: '', meeting: '' };
    for (const owner of ['natively', 'global', 'meeting']) window.electronAPI.onGeminiStreamToken(token => { window.__ag33Owners[owner] += token; }, owner);
  });
  mock.setScript({ errorStatus: 0, chunks: ['AG33 owner-scoped answer.'], delayMs: 20 });
  await overlay.evaluate(() => window.electronAPI.streamGeminiChat('AG33 owner question', undefined, undefined, { owner: 'global' }));
  const owners = await overlay.evaluate(() => window.__ag33Owners);
  assert.deepEqual(owners, { natively: '', global: 'AG33 owner-scoped answer.', meeting: '' });
});

test('AG33 real Written typed and captured-image questions survive interview TTFT, preserve cancellation and retry as separate records', async () => {
  const delayFirstBody = entry => entry.chunksSent === 1 ? new Promise(resolve => setTimeout(resolve, 11_000)) : undefined;
  try {
    await overlay.getByLabel('Question mode').selectOption('written');
    const deliveredBefore = await overlay.locator('[data-generation-status="cancelled"]').count();
    mock.setScript({ errorStatus: 0, chunks: ['', 'Written ', 'partial ', 'OLD-WRITTEN-TAIL'], delayMs: 800, afterChunk: delayFirstBody });
    await ask('Synthetic written screenshot-free question');
    await overlay.waitForFunction(() => document.body.innerText.includes('Written partial'));
    await overlay.evaluate(() => window.electronAPI.cancelChatStream('natively'));
    await overlay.waitForFunction(() => document.body.innerText.includes('Written partial') && document.body.innerText.includes('cancelled'));
    assert.equal(await overlay.locator('[data-generation-status="cancelled"]').count(), deliveredBefore + 1);
    mock.setScript({ errorStatus: 0, chunks: ['Written explicit retry completed.'], delayMs: 20 });
    await ask('Synthetic written explicit retry');
    await overlay.waitForFunction(() => document.body.innerText.includes('Written explicit retry completed.'));
    assert.ok((await overlayText()).includes('Written partial'), 'cancelled partial remains its own record after retry');
    assert.ok(!(await overlayText()).includes('OLD-WRITTEN-TAIL'));
    const beforeCapture = mock.chatRequests().length;
    mock.setScript({ errorStatus: 0, chunks: ['', 'Written captured image answer.'], delayMs: 20, afterChunk: delayFirstBody });
    const screenshot = await overlay.evaluate(() => window.electronAPI.takeScreenshot());
    await sendOverlayStreamEvent('capture-and-process', screenshot);
    await overlay.waitForFunction(() => document.body.innerText.includes('Written captured image answer.'), null, { timeout: 20_000 });
    assert.equal(mock.chatRequests().length, beforeCapture + 1);
    assert.match(JSON.stringify(mock.chatRequests().at(-1).body.messages), /data:image/);
  } finally {
    await overlay.getByLabel('Question mode').selectOption('auto');
  }
});

test('AG51 Question mode uses automatic written prompts and explicit interview prompts on the wire', async () => {
  const { scenarioPrompt } = require('../../dist-electron/electron/llm/scenarioPrompts.js');
  try {
    for (const [selection, scene] of [['auto', 'written'], ['interview', 'interview'], ['written', 'written']]) {
      await overlay.getByLabel('Question mode').selectOption(selection);
      const answer = `AG51 ${selection} completed.`;
      mock.setScript({ errorStatus: 0, chunks: [answer], delayMs: 20 });
      await ask(`AG51 synthetic ${selection} question`);
      await overlay.getByText(answer, { exact: true }).waitFor();
      const system = mock.chatRequests().at(-1).body.messages.find(message => message.role === 'system').content;
      assert.ok(system.startsWith(scenarioPrompt(scene)));
    }
  } finally { await overlay.getByLabel('Question mode').selectOption('auto'); }
});

test('AG33 real Natively renderer ignores automatic intelligence while manual chat owns its placeholder', async () => {
  let release; const gate = new Promise(resolve => { release = resolve; });
  let paused; const entered = new Promise(resolve => { paused = resolve; });
  mock.setScript({ errorStatus: 0, chunks: ['Manual source ', 'answer intact.'], delayMs: 100, afterChunk(entry) { if (entry.chunksSent === 1) { paused(); return gate; } } });
  try {
    await ask('Synthetic mixed source question'); await entered;
    const metadata = { requestId: 'AG33-stale-automatic', provider: 'synthetic', model: 'automatic', status: 'completed', attempts: 1, partial: false };
    await sendOverlayStreamEvent('intelligence-generation-started', metadata);
    await sendOverlayStreamEvent('intelligence-token-batch', { ...metadata, kind: 'suggested_answer', items: [{ token: 'AUTOMATIC-LATE-TOKEN' }] });
    await sendOverlayStreamEvent('intelligence-suggested-answer', { ...metadata, answer: 'AUTOMATIC-LATE-DONE' });
    await sendOverlayStreamEvent('intelligence-generation-terminal', { ...metadata, error: 'AUTOMATIC-LATE-ERROR' });
    release();
    await overlay.waitForFunction(() => document.body.innerText.includes('Manual source answer intact.'));
    assert.doesNotMatch(await overlayText(), /AUTOMATIC-LATE-|automatic ·/);
  } finally { release(); }
});

test('AG33 existing SQLite meeting storage round-trips exact generation status/target/partial/timeout and legacy items', async () => {
  const databasePath = path.resolve(import.meta.dirname, '../../dist-electron/electron/db/DatabaseManager.js');
  const metadata = { requestId: 'AG33-sqlite-synthetic', provider: 'openai', model: 'actual-backup', status: 'failed', timeout: 'total', attempts: 2, partial: true };
  const result = await app.evaluate(({}, { filename, generation }) => {
    const { DatabaseManager } = process.mainModule.require(filename);
    const db = DatabaseManager.getInstance();
    db.saveMeeting({ id: 'AG33-sqlite-roundtrip', title: 'Synthetic metadata only', date: '2026-10-10T00:00:00Z', duration: '0:01', summary: '', usage: [
      { type: 'chat', timestamp: 1, question: 'synthetic', answer: 'saved partial', ...generation },
      { type: 'followup_questions', timestamp: 2, items: ['legacy one', 'legacy two'] },
    ] }, 0, 1000);
    const saved = db.getMeetingDetails('AG33-sqlite-roundtrip');
    db.saveMeeting(saved, 0, 1000);
    const resaved = db.getMeetingDetails('AG33-sqlite-roundtrip');
    return { usage: saved.usage, resavedUsage: resaved.usage, raw: db.db.prepare('SELECT metadata_json FROM ai_interactions WHERE meeting_id = ? ORDER BY timestamp').all('AG33-sqlite-roundtrip').map(row => JSON.parse(row.metadata_json)) };
  }, { filename: databasePath, generation: metadata });
  assert.deepEqual(result.usage[0].generation, metadata); assert.equal(result.usage[0].answer, 'saved partial');
  assert.deepEqual(result.usage[1].items, ['legacy one', 'legacy two']);
  assert.deepEqual(result.resavedUsage, result.usage, 'saving the loader output preserves generation metadata and legacy items');
  assert.deepEqual(result.raw[0], { generation: metadata }); assert.deepEqual(result.raw[1], ['legacy one', 'legacy two']);
});

test('AG33 real Natively late action invoke cannot change the newer manual answer or erase prior UI records', async () => {
  mock.setScript({ errorStatus: 0, chunks: ['AG33 prior retained record.'], delayMs: 20 });
  await ask('AG33 prior retained record question');
  await overlay.waitForFunction(() => document.body.innerText.includes('AG33 prior retained record.') && document.querySelector('[data-generation-status="completed"]'));
  await app.evaluate(({ ipcMain }) => {
    const handlers = ipcMain._invokeHandlers; const real = handlers.get('generate-what-to-say');
    handlers.set('generate-what-to-say', event => {
      handlers.set('generate-what-to-say', real);
      const metadata = { requestId: 'AG33-delayed-action', provider: 'synthetic', model: 'old-action', attempts: 1, partial: true };
      event.sender.send('intelligence-generation-started', metadata);
      event.sender.send('intelligence-token-batch', { ...metadata, kind: 'suggested_answer', items: [{ token: 'Old action partial preserved.' }] });
      return new Promise((resolve, reject) => { globalThis.__ag33RejectOldAction = () => setTimeout(() => reject(Error('LATE-ACTION-INVOKE')), 0); });
    });
  });
  await sendOverlayStreamEvent('global-shortcut', { action: 'whatToAnswer' });
  await overlay.waitForFunction(() => document.body.innerText.includes('Old action partial preserved.'));
  let release; const gate = new Promise(resolve => { release = resolve; });
  let entered; const paused = new Promise(resolve => { entered = resolve; });
  mock.setScript({ errorStatus: 0, chunks: ['New manual source ', 'finishes intact.'], delayMs: 20, afterChunk(entry) { if (entry.chunksSent === 1) { entered(); return gate; } } });
  try {
    await ask('AG33 new manual over delayed action'); await paused;
    await app.evaluate(() => { globalThis.__ag33RejectOldAction(); return true; });
    await overlay.waitForFunction(() => [...document.querySelectorAll('[data-generation-status="cancelled"]')].some(node => node.textContent.includes('old-action')));
    release();
    await overlay.waitForFunction(() => document.body.innerText.includes('New manual source finishes intact.'));
    const text = await overlayText();
    assert.doesNotMatch(text, /LATE-ACTION-INVOKE/); assert.ok(text.includes('Old action partial preserved.'));
    assert.ok(text.includes('AG33 prior retained record.'), 'cancellation preserves prior UI records');
  } finally { release(); }
});
