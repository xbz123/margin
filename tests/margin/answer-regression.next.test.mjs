// Margin answer regression suite, rebuilt on tests/margin/regression-harness.mjs
// (docs/margin/REGRESSION-SUITE-REBUILD.md, W2). Same scenarios as
// tests/margin/answer-regression.test.mjs (PLAN.md AG-09) except the SQLite round trip
// (moved to the storage suite) and S50 (deleted).
//
// Drives the real renderer -> preload -> IPC -> LLMHelper path against a loopback mock
// OpenAI server, inside the X2 isolation. Every case starts with resetCase(), so the
// overlay's message list is empty and every assertion on answer text is scoped to the
// rows this case produced (rows(), rowsText()). The one exception is the launcher's chat
// (old line 509), which session-reset does not clear; it is read from its own page.
//
// Prerequisites: `node scripts/build-electron.js` and `npx vite build`.
// Run:
//   node scripts/margin/isolation/run-node.mjs --allow-exec Electron \
//     --test --test-timeout=180000 tests/margin/answer-regression.next.test.mjs

import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { windowWithQuery } from './launch-app.mjs';
import {
  MODEL, RENDERER_UNSUBS, ctx, startSuite, endSuite, resetCase, ask, typeAndEnter, rows, rowsText, rowsTextContent,
  rowLocator, waitRows, waitRowsText, waitText, waitPage, waitVisible, waitHidden, until, observeWindow, holdStream,
  mainRead, patchOnce, record, recorded, installStreamIdSpy, streamIds, sendOverlayEvent, pressScreenshotShortcut,
  overlayInput,
} from './regression-harness.mjs';

const require = createRequire(import.meta.url);
const sharp = require('sharp');

let mock;
let app;
let overlay;
let answerGateway;

before(async () => {
  await startSuite();
  ({ mock, app, overlay, answerGateway } = ctx);
});

after(async () => {
  const { blocked, ollama, mainErrors } = await endSuite();
  assert.deepEqual(blocked, [], 'no outbound attempts during the regression run');
  // AG-14: nothing may probe, start or reach Ollama (port 11434 is a watched port, so a
  // connection would also show up above as kind "watched-port").
  assert.deepEqual(ollama, [], 'no Ollama probe or port 11434 traffic during the regression run');
  // The launch loaded record-main-errors.cjs (launchApp checks); it may not have had an uncaught exception or unhandled rejection in the main process.
  assert.deepEqual(mainErrors, [], 'no main-process exception during the regression run');
});

beforeEach(async () => { await resetCase(); });

const cancelledRows = async () => (await rows((r) => r.status === 'cancelled')).length;
const occurrences = (text, needle) => text.split(needle).length - 1;

// old line 164
test('a typed question streams the mock answer into the overlay', async () => {
  const hold = holdStream({ afterChunks: 2 });
  mock.setScript({ chunks: ['Margin ', 'regression ', 'answer ', 'one.'], delayMs: 150, afterChunk: hold.afterChunk });
  const before = mock.chatRequests().length;
  try {
    // The main process sends done only after the renderer's first-visible receipt;
    // waiting for done keeps this answer's late receipt and done out of the next test's listeners (S42-04).
    await overlay.evaluate((key) => {
      window.__t151Done = 0;
      window[key].push(window.electronAPI.onGeminiStreamDone(() => { window.__t151Done += 1; }));
    }, RENDERER_UNSUBS);
    await ask('What is two plus two?');
    const req = await hold.reached(15_000);
    // Hold the server's tail while observing the real renderer: slow browser
    // round trips cannot turn a partial-state assertion into a completed sample.
    await waitText('Margin regression', { timeoutMs: 15_000 });
    const partial = await rowsText();
    assert.equal(req.chunksSent, 2, 'only the first two chunks were sent while observing the partial');
    assert.ok(partial.includes('Margin regression'), 'the renderer must display the paused partial');
    assert.ok(!partial.includes('Margin regression answer one.'), 'first visible state should be partial');
    hold.release();
    await waitText('Margin regression answer one.', { timeoutMs: 15_000 });
    await waitPage(overlay, () => window.__t151Done >= 1, null, { timeoutMs: 15_000 });
  } finally {
    hold.release();
  }

  const req = mock.chatRequests().at(-1);
  assert.equal(mock.chatRequests().length, before + 1, 'exactly one request per question');
  assert.equal(req.body.model, MODEL);
  assert.equal(req.body.stream, true);
  assert.ok(JSON.stringify(req.body.messages).includes('What is two plus two?'));
});

// old line 211. The answer is hidden by injected CSS (the product checks element style,
// src/lib/visibleGeneration.ts), not by hiding the window. Visibility is restored well
// inside the 10 s interview first-token timeout: the hidden text must appear within 6 s.
test('S42-04 actual hidden DOM cannot acknowledge quick EOF until the answer becomes visible', async () => {
  mock.setScript({ chunks: ['S42 actual visible body.'], delayMs: 1 });
  await record('generation:first-visible', 's42Visible');
  await overlay.evaluate((key) => {
    const style = document.createElement('style'); style.id = 's42-hidden-answer';
    style.textContent = 'body { visibility: hidden !important; }'; document.head.append(style);
    window.__s42Done = [];
    window[key].push(window.electronAPI.onGeminiStreamDone(metadata => window.__s42Done.push(metadata)));
    void window.electronAPI.streamGeminiChat('S42 original hidden DOM question', undefined, undefined, { generationKind: 'interview' });
  }, RENDERER_UNSUBS);
  const hiddenAt = Date.now();
  try {
    await until(async () => (await rowsTextContent()).includes('S42 actual visible body.'),
      { timeoutMs: 6_000, what: 'the hidden answer text in a row' });
    assert.deepEqual(await recorded('s42Visible'), []);
    assert.deepEqual(await overlay.evaluate(() => window.__s42Done), []);
    await overlay.evaluate(() => document.getElementById('s42-hidden-answer').remove());
    console.log(`[S42-04 hidden] visibility restored ${Date.now() - hiddenAt} ms after the request`);
    await waitPage(overlay, () => window.__s42Done.length === 1, null, { timeoutMs: 10_000 });
    const metadata = await overlay.evaluate(() => window.__s42Done[0]);
    assert.equal((await recorded('s42Visible')).filter(id => id === metadata.requestId).length, 1);
    assert.ok(metadata.timing.firstVisibleMs >= metadata.timing.modelToVisibleMs);
  } finally { await overlay.evaluate(() => document.getElementById('s42-hidden-answer')?.remove()); }
});

// old line 236
test('S42-04 actual Retry preserves the partial row and original wire input while creating a separately linked answer', async () => {
  mock.setScript({ chunks: ['S42 retained partial.'], delayMs: 50, disconnectAfterChunks: 1 });
  await ask('S42 original retry question');
  const retry = overlay.getByRole('button', { name: 'Retry', exact: true });
  await waitVisible(retry);
  const original = structuredClone(mock.chatRequests().at(-1).body);
  const originalQuestionId = (await rows((r) => r.questionId)).at(-1)?.questionId;
  assert.ok(originalQuestionId, 'a row carries the question id');
  mock.setScript({ chunks: ['S42 independent retry body.'], delayMs: 1 });
  await retry.click();
  await waitText('S42 independent retry body.');
  assert.deepEqual(mock.chatRequests().at(-1).body.messages, original.messages);
  const text = await rowsText(); assert.match(text, /S42 retained partial\./);
  const linked = (await rows((r) => r.questionId === originalQuestionId)).map((r) => r.textContent);
  assert.ok(linked.some(row => row.includes('S42 retained partial.') && !row.includes('S42 independent retry body.')));
  assert.ok(linked.some(row => row.includes('S42 independent retry body.') && !row.includes('S42 retained partial.')));
});

// old line 252
test('F1 actual Retry then Answer then Remove all cannot resend the withdrawn screenshot', async () => {
  const shot = overlay.getByAltText('Screenshot 1', { exact: true });
  const stop = overlay.getByRole('button', { name: 'Stop', exact: true });
  await pressScreenshotShortcut();
  await waitVisible(shot);
  mock.setScript({ errorStatus: 400 });
  try {
    await ask('F1 original screenshot question');
    const retry = overlay.getByRole('button', { name: 'Retry', exact: true });
    await waitVisible(retry);
    const before = mock.chatRequests().length;
    mock.setScript({ errorStatus: 503, retryAfterSeconds: 4 });
    await retry.click();
    await until(() => mock.chatRequests().length !== before, { timeoutMs: 2_000, intervalMs: 20, throwOnTimeout: false });
    assert.equal(mock.chatRequests().length, before + 1);
    await overlay.getByRole('button', { name: 'Answer', exact: true }).click();
    await waitVisible(stop);
    await overlay.getByRole('button', { name: 'Remove all', exact: true }).click();
    await waitHidden(shot);
    const removedAt = mock.chatRequests().length;
    mock.setScript({ errorStatus: 0, chunks: ['Old screenshot answer.'], delayMs: 5 });
    await observeWindow(4_500, 'past the 4 s Retry-After of the 503: the old retry may not resend the removed screenshot');
    assert.equal(mock.chatRequests().slice(removedAt).filter(entry => JSON.stringify(entry.body).includes('data:image/')).length, 0);
    assert.equal(await stop.isVisible(), true, 'old retry cleanup preserves the new dictation');
  } finally {
    mock.setScript({ errorStatus: 0 });
    if (await stop.isVisible()) await stop.click();
  }
});

// old line 279
test('S42-04 removing the attached screenshot through the actual UI revokes its failed request', async () => {
  await overlay.evaluate((key) => {
    window.__s42ImageFailure = undefined;
    window[key].push(window.electronAPI.onGeminiStreamError((_error, metadata) => { window.__s42ImageFailure = metadata; }));
  }, RENDERER_UNSUBS);
  await pressScreenshotShortcut();
  await waitVisible(overlay.getByAltText('Screenshot 1', { exact: true }));
  mock.setScript({ errorStatus: 400 });
  try {
    await ask('S42 screenshot to withdraw');
    const retry = overlay.getByRole('button', { name: 'Retry', exact: true });
    await waitVisible(retry);
    const before = mock.chatRequests().length;
    await overlay.getByRole('button', { name: 'Remove all' }).click();
    await waitHidden(retry);
    const error = await overlay.evaluate(() => window.electronAPI.retryGeneration(window.__s42ImageFailure.requestId).then(() => '', e => String(e)));
    assert.match(error, /no longer available/); assert.equal(mock.chatRequests().length, before);
  } finally { mock.setScript({ errorStatus: 0 }); }
});

// old line 295. The answer is held after its first chunk while the screenshot is removed
// (was: 800 ms between chunks).
test('closing the attached screenshot while its answer streams keeps that answer', async () => {
  const shot = overlay.getByAltText('Screenshot 1', { exact: true });
  await pressScreenshotShortcut();
  await waitVisible(shot);
  const cancelledBefore = await cancelledRows();
  const hold = holdStream({ afterChunks: 1 });
  mock.setScript({ errorStatus: 0, chunks: ['Kept ', 'screenshot ', 'answer complete.'], delayMs: 20, afterChunk: hold.afterChunk });
  try {
    await ask('Screenshot question to keep');
    assert.match(JSON.stringify(mock.chatRequests().at(-1).body.messages), /data:image/);
    await waitText('Kept');
    await overlay.getByRole('button', { name: 'Remove all', exact: true }).click();
    await waitHidden(shot);
    hold.release();
    await waitText('Kept screenshot answer complete.', { timeoutMs: 20_000 });
    assert.equal(await cancelledRows(), cancelledBefore);
    assert.ok(!(await rowsText()).includes('withdrawn'));
  } finally { hold.release(); mock.setScript({ errorStatus: 0 }); }
});

// old line 312
test('after cancel, and after a new stream has started, events of the old stream are not shown', async () => {
  await installStreamIdSpy();
  // Renderer side: subscribes through the same preload API the overlay uses and records
  // exactly which stream events the preload delivers.
  await overlay.evaluate((key) => {
    window.__marginDelivered = { tokens: [], done: 0, errors: [] };
    window[key].push(window.electronAPI.onGeminiStreamToken((t) => window.__marginDelivered.tokens.push(t)));
    window[key].push(window.electronAPI.onGeminiStreamDone(() => { window.__marginDelivered.done += 1; }));
    window[key].push(window.electronAPI.onGeminiStreamError((e) => window.__marginDelivered.errors.push(e)));
  }, RENDERER_UNSUBS);
  const delivered = () => overlay.evaluate(() => JSON.parse(JSON.stringify(window.__marginDelivered)));

  // Cancellation rebuilds the streaming DOM; use delivered tokens, not a UI snapshot,
  // to identify LATE chunks legitimately received before cancellation.
  // The old stream pauses after two chunks until the test has seen the cancel close it, so a
  // slow renderer cannot let it finish on its own first.
  const oldHold = holdStream({ afterChunks: 2 });
  mock.setScript({ chunks: ['Cancel ', 'test ', 'LATE-1 ', 'LATE-2 ', 'LATE-3 ', 'LATE-4.'], delayMs: 800, afterChunk: oldHold.afterChunk });
  await ask('Please give a long answer.');
  await waitText('Cancel test', { timeoutMs: 15_000 });
  const oldReq = mock.chatRequests().at(-1);
  const [oldId] = await streamIds();
  assert.ok(oldId !== undefined && oldId !== null, `main sent no stream id with the tokens: ${JSON.stringify(await streamIds())}`);

  // Positive control: while the stream is live, an injected token with its id is shown,
  // so the injection path below really reaches the overlay.
  await sendOverlayEvent('gemini-stream-token', 'LIVE-INJECTED ', oldId);
  await waitText('LIVE-INJECTED', { timeoutMs: 5_000 });
  assert.equal(oldReq.closedEarly, false, 'the old HTTP stream must still be open before the cancel');

  const lateAtCancel = await overlay.evaluate(() => {
    const tokensBeforeCancel = [...window.__marginDelivered.tokens];
    // Preload clears the active id synchronously; no IPC event can interleave here.
    window.electronAPI.cancelChatStream();
    window.__marginDelivered = { tokens: [], done: 0, errors: [] };
    return tokensBeforeCancel.join('').match(/LATE-\d+/g) ?? [];
  });

  // 1. In the gap after the cancel: a late token and done of the old stream.
  await sendOverlayEvent('gemini-stream-token', 'GAP-INJECTED', oldId);
  await sendOverlayEvent('gemini-stream-done', oldId);
  assert.deepEqual(await delivered(), { tokens: [], done: 0, errors: [] }, 'events after cancel were delivered');
  await until(() => oldReq.closedEarly, { timeoutMs: 5_000, intervalMs: 50, throwOnTimeout: false });
  assert.ok(oldReq.closedEarly, `the client should abort the old HTTP stream (chunks sent: ${oldReq.chunksSent})`);
  oldHold.release();

  // 2. A new stream starts right away; events of the old stream (which main may have
  // sent before it saw the stop) and events without an id must still be dropped. The new
  // stream is held after its first chunk until those events were sent (was: 600 ms between chunks).
  const newHold = holdStream({ afterChunks: 1 });
  mock.setScript({ chunks: ['Fresh ', 'answer ', 'arrives ', 'intact.'], delayMs: 50, afterChunk: newHold.afterChunk });
  try {
    await overlay.evaluate(() => { window.electronAPI.streamGeminiChat('Fresh question'); });
    await waitPage(overlay, () => window.__marginDelivered.tokens.includes('Fresh '), null, { timeoutMs: 15_000 });
    const newId = (await streamIds()).at(-1);
    assert.notEqual(newId, oldId, 'the new stream must have its own id');
    await sendOverlayEvent('gemini-stream-token', 'STALE-INJECTED', oldId);
    await sendOverlayEvent('gemini-stream-done', oldId);
    await sendOverlayEvent('gemini-stream-error', 'STALE-ERROR-INJECTED', oldId);
    await sendOverlayEvent('gemini-stream-token', 'NOID-INJECTED');
    await sendOverlayEvent('gemini-stream-done');
    // Positive control for the new stream: its own id is delivered.
    await sendOverlayEvent('gemini-stream-token', 'NEW-INJECTED ', newId);
    await waitPage(overlay, () => window.__marginDelivered.tokens.includes('NEW-INJECTED '), null, { timeoutMs: 5_000 });
    const midStream = await delivered();
    assert.equal(midStream.done, 0, 'a done of the old stream ended the new one');
    assert.deepEqual(midStream.errors, [], 'an error of the old stream reached the new one');
  } finally { newHold.release(); }

  // The new stream finishes normally: one done, its full text, nothing stale.
  await waitPage(overlay, () => window.__marginDelivered.done === 1, null, { timeoutMs: 15_000 });
  await waitText('intact.', { timeoutMs: 5_000 });
  await observeWindow(4_500, "longer than the old stream's remaining script (4 chunks at 800 ms)");
  const final = await delivered();
  assert.equal(final.done, 1);
  assert.deepEqual(final.errors, []);
  assert.doesNotMatch(final.tokens.join(''), /LATE-\d+/, 'LATE markers were delivered after cancel');
  assert.deepEqual(final.tokens.filter((t) => /INJECTED|LATE-/.test(t)), ['NEW-INJECTED '], `stale tokens were delivered: ${JSON.stringify(final.tokens)}`);
  const text = await rowsText();
  for (const stale of ['GAP-INJECTED', 'STALE-INJECTED', 'STALE-ERROR-INJECTED', 'NOID-INJECTED']) {
    assert.ok(!text.includes(stale), `${stale} was shown:\n${text.slice(-400)}`);
  }
  const remainingLate = [...lateAtCancel];
  for (const marker of text.match(/LATE-\d+/g) ?? []) {
    const index = remainingLate.indexOf(marker);
    assert.notEqual(index, -1, `${marker} appeared after cancel:\n${text.slice(-400)}`);
    remainingLate.splice(index, 1);
  }
});

// old line 392. The first answer is held after its first chunk while the typed question
// is tried (was: 500 ms between chunks); it is released when the superseding request is
// made, so an unaborted first stream would write its STALE chunks within the 2.5 s window.
test('while an answer streams, a typed question is held back and a new stream request supersedes it', async () => {
  const hold = holdStream({ afterChunks: 1 });
  mock.setScript({ chunks: ['First ', 'STALE-A ', 'STALE-B ', 'STALE-C ', 'STALE-D.'], delayMs: 500, afterChunk: hold.afterChunk });
  try {
    await ask('First question');
    await waitText('First', { timeoutMs: 15_000 });
    const firstReq = mock.chatRequests().at(-1);

    // UI contract: the overlay does not accept a second typed question mid-stream.
    const input = overlayInput();
    const requestsBefore = mock.chatRequests().length;
    await typeAndEnter('Typed during stream');
    await observeWindow(300, 'the held-back question may not be sent or cleared');
    assert.equal(await input.inputValue(), 'Typed during stream', 'typed question should be held back while streaming');
    assert.equal(mock.chatRequests().length, requestsBefore, 'the held-back question is not sent');
    await input.fill('');

    // Main-process contract: a new gemini-chat-stream from the same window aborts the old one.
    mock.setScript({ chunks: ['Second ', 'answer ', 'done.'], delayMs: 50 });
    hold.release();
    await overlay.evaluate(() => window.electronAPI.streamGeminiChat('Second question'));
    await waitText('Second answer done.', { timeoutMs: 15_000 });
    await observeWindow(2_500, 'a superseded stream that kept writing would show STALE-D here');
    const text = await rowsText();
    assert.ok(!text.includes('STALE-D'), `superseded stream kept writing:\n${text.slice(-400)}`);
    assert.ok(firstReq.closedEarly || firstReq.chunksSent < 5, 'the first HTTP stream should be aborted');
  } finally { hold.release(); }
});

// old line 418
test('a screenshot question sends the fixture image to the model', async () => {
  mock.setScript({ chunks: ['Screenshot ', 'seen.'], delayMs: 50 });
  await pressScreenshotShortcut();
  // The attached screenshot shows as a preview image in the input area.
  await waitVisible(overlay.getByRole('img', { name: /^Screenshot \d+$/ }).first(), { timeoutMs: 15_000 });
  const before = mock.chatRequests().length;
  await ask('What is on the screen?');
  await waitText('Screenshot seen.', { timeoutMs: 20_000 });
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

// old line 437
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

// old line 453
test('a WhatToSay scope refusal through the real renderer action displays one error and sends nothing', async () => {
  const original = await overlay.evaluate(() => window.electronAPI.getProviderDataScopes());
  const before = mock.chatRequests().length;
  const errorsBefore = occurrences(await rowsText(), 'Error (what_to_say):');
  const transcriptBefore = occurrences(await rowsText(), 'Data scope denied');
  try {
    await overlay.evaluate(() => window.electronAPI.setProviderDataScopes({ transcript: false }));
    // Exercise the existing screenshot attachment path along with manual answering.
    const removeAll = overlay.locator('button[title="Remove all"]');
    if (await removeAll.count()) await removeAll.click();
    await waitPage(overlay, () => !document.querySelector('img[alt="Screenshot 1"]'));
    await pressScreenshotShortcut();
    await waitPage(overlay, () => document.querySelector('img[alt="Screenshot 1"]')?.src.startsWith('data:image'));
    await sendOverlayEvent('global-shortcut', { action: 'whatToAnswer' });
    await waitRowsText(text => occurrences(text, 'Error (what_to_say):') === errorsBefore + 1, { timeoutMs: 15_000, what: 'one what_to_say error row' });
    const text = await rowsText();
    assert.equal(occurrences(text, 'Error (what_to_say):'), errorsBefore + 1);
    assert.equal(occurrences(text, 'Data scope denied'), transcriptBefore + 1, 'the scope refusal must be shown exactly once');
    assert.equal(mock.chatRequests().length, before);
  } finally { await overlay.evaluate(scopes => window.electronAPI.setProviderDataScopes(scopes), original); }
});

// old line 477
test('a provider error is shown and the next question still works', async () => {
  mock.setScript({ errorStatus: 400 });
  const before = mock.chatRequests().length;
  await ask('This one fails.');
  await waitText('Gateway request failed (HTTP 400)', { timeoutMs: 15_000 });
  assert.doesNotMatch(await rowsText(), /mock: injected error/, 'raw gateway errors are not reflected into the renderer');
  await observeWindow(1_000, 'a retry storm would show up here');
  assert.equal(mock.chatRequests().length - before, 1, 'a 400 should not be retried');

  mock.setScript({ errorStatus: 0, chunks: ['Recovered ', 'answer.'], delayMs: 50 });
  await ask('And this one?');
  await waitText('Recovered answer.', { timeoutMs: 20_000 });
});

// old line 509. Third review (PLAN.md AG-17): the launcher's chat registered its stream
// listeners and kept them when the request failed before streaming, so the next answer
// was received twice into one buffer, and the old done handler cleared it.
// Documented exception to the rows rule: this conversation is in the launcher window,
// which session-reset does not clear, so it is read from the launcher's page text.
test('after a chat request fails before streaming, the next answer is shown once and kept', async () => {
  const launcher = await windowWithQuery(app, 'window=launcher');
  // A fresh profile shows the first-run startup sequence instead of the launcher.
  await launcher.evaluate(() => localStorage.setItem('natively_seen_startup_v1', 'true'));
  await launcher.reload();
  await launcher.waitForLoadState('domcontentloaded');
  // Makes the next gemini-chat-stream request fail in its setup, before any stream event,
  // as an exception there does: the renderer's invoke rejects. Later requests go to the
  // real handler again. Electron keeps invoke handlers in ipcMain._invokeHandlers.
  await patchOnce('gemini-chat-stream', ({ ipcMain }) => {
    const handlers = ipcMain._invokeHandlers;
    const real = handlers?.get('gemini-chat-stream');
    if (!real) throw new Error('gemini-chat-stream handler not found');
    handlers.set('gemini-chat-stream', async () => {
      handlers.set('gemini-chat-stream', real);
      throw new Error('margin: injected setup failure');
    });
  });
  const before = mock.chatRequests().length;
  const search = launcher.locator('input[placeholder="Search or ask anything..."]');
  // Focus, not click: once the pill has focus its backdrop (z-90) covers the input
  // (z-40), so a click times out if the input was focused first (CI 38000301350).
  await search.focus();
  await search.fill('Launcher question that fails');
  await search.press('ArrowDown');
  await search.press('Enter');
  await waitPage(launcher, () => document.body.innerText.includes('margin: injected setup failure'), null, { timeoutMs: 15_000 });
  assert.equal(mock.chatRequests().length, before, 'the failed request reached no provider');

  mock.setScript({ errorStatus: 0, chunks: ['Retry ', 'answer ', 'kept.'], delayMs: 100 });
  const chat = launcher.locator('input[placeholder="Ask me anything..."]');
  await chat.fill('Launcher retry question');
  await chat.press('Enter');
  await waitPage(launcher, () => document.body.innerText.includes('Retry answer kept.'), null, { timeoutMs: 20_000 });
  // Past the stream's done event (was: a fixed 1 s): the done handler marks the answer
  // finished, which renders its "Copy message" button (src/components/GlobalChatOverlay.tsx:241-254, 99-106).
  await waitPage(launcher, () => [...document.querySelectorAll('button')].some((b) => b.textContent.includes('Copy message')), null,
    { timeoutMs: 15_000, what: 'the launcher answer to be finished by its done event' });
  const text = await launcher.evaluate(() => document.body.innerText);
  assert.equal(text.split('Retry answer kept.').length - 1, 1, 'the answer is shown exactly once and survives done');
  assert.equal(mock.chatRequests().length, before + 1);
});

// old line 538
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

// old line 555
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
    await waitText('AG31 opaque target answer.', { timeoutMs: 20_000 });
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

// old lines 596 and 624, as two sequential phases of one case.
test('manual send clears the draft before completion and preserves the next identical draft; a failure restores only an empty draft without overwriting new input', async () => {
  const input = overlayInput();

  // Phase 1 (old line 596): manual send clears the draft before completion and preserves the next identical draft.
  {
    const question = '  Synthetic immediate-clear question  ';
    const hold = holdStream({ afterChunks: 1 });
    mock.setScript({ errorStatus: 0, chunks: ['Immediate-clear partial', ' finished.'], delayMs: 0, afterChunk: hold.afterChunk });
    try {
      await overlay.evaluate((key) => {
        window.__draftFinished = false;
        const off = window.electronAPI.onGeminiStreamDone(() => { window.__draftFinished = true; off(); });
        window[key].push(off);
      }, RENDERER_UNSUBS);
      await typeAndEnter(question);
      await waitText('Immediate-clear partial');
      assert.equal(await input.inputValue(), '', 'sent text clears while the answer is still running');
      await input.fill(question);
      hold.release();
      await waitText('Immediate-clear partial finished.');
      await waitPage(overlay, () => window.__draftFinished);
      assert.equal(await input.inputValue(), question, 'completion cannot delete a new draft, even with identical text');
    } finally {
      hold.release();
      await overlay.evaluate(() => window.electronAPI.cancelChatStream('natively'));
      await input.fill('');
    }
  }

  // Phase 2 (old line 624): manual send failure restores only an empty draft without overwriting new input.
  for (const nextDraft of ['', 'My next question']) {
    const question = `  Synthetic failed draft ${nextDraft ? 'with new input' : 'empty'}  `;
    const hold = holdStream({ afterChunks: 1 });
    mock.setScript({ errorStatus: 0, chunks: ['Draft failure partial'], delayMs: 0,
      disconnectAfterChunks: 1, afterChunk: hold.afterChunk });
    try {
      await overlay.evaluate((key) => {
        window.__draftFailed = false;
        const off = window.electronAPI.onGeminiStreamError(() => { window.__draftFailed = true; off(); });
        window[key].push(off);
      }, RENDERER_UNSUBS);
      await typeAndEnter(question);
      await hold.reached(30_000);
      await waitPage(overlay, () => [...document.querySelectorAll('input[type="text"]')].at(-1)?.value === '');
      await input.fill(nextDraft);
      const failedBefore = (await rows((r) => r.status === 'failed')).length;
      hold.release();
      await waitPage(overlay, () => window.__draftFailed);
      // The restored draft and the failed row are committed in the same React batch.
      await until(async () => (await rows((r) => r.status === 'failed')).length === failedBefore + 1,
        { timeoutMs: 30_000, what: 'one more failed row' });
      assert.equal(await input.inputValue(), nextDraft || question);
    } finally {
      hold.release();
      await overlay.evaluate(() => window.electronAPI.cancelChatStream('natively'));
      await input.fill('');
    }
  }
});

// old line 658
test('AG33 unknown image capability preserves the real renderer input and attachment; explicit confirmation enables retry', async () => {
  const original = (await overlay.evaluate(() => window.electronAPI.getStoredCredentials())).gateways.find(item => item.id === answerGateway);
  const unconfirmed = { ...original }; delete unconfirmed.imageSupportConfirmedFor;
  const input = overlayInput();
  const before = mock.chatRequests().length;
  try {
    assert.equal((await overlay.evaluate(config => window.electronAPI.setGatewayConfiguration(config), unconfirmed)).ok, true);
    const removeAll = overlay.getByRole('button', { name: 'Remove all' });
    if (await removeAll.count()) await removeAll.click();
    await pressScreenshotShortcut();
    await waitPage(overlay, () => document.querySelector('img[alt="Screenshot 1"]')?.src.startsWith('data:image'));
    await typeAndEnter('AG33 image confirmation question');
    await waitText('Image support is unconfirmed', { timeoutMs: 15_000 });
    assert.equal(await input.inputValue(), 'AG33 image confirmation question');
    assert.equal(await overlay.locator('img[alt="Screenshot 1"]').count(), 1);
    assert.equal(mock.chatRequests().length, before);
    assert.equal((await overlay.evaluate(config => window.electronAPI.setGatewayConfiguration(config), original)).ok, true);
    mock.setScript({ errorStatus: 0, chunks: ['AG33 image retry accepted.'], delayMs: 20 });
    await input.press('Enter');
    await waitText('AG33 image retry accepted.', { timeoutMs: 15_000 });
    await waitPage(overlay, () => document.querySelector('input[type="text"]')?.value === '' || [...document.querySelectorAll('input[type="text"]')].at(-1)?.value === '');
    assert.equal(mock.chatRequests().length, before + 1);
    assert.match(JSON.stringify(mock.chatRequests().at(-1).body.messages), /data:image/);
    await waitRows((r) => r.status === 'completed' && (r.statusText ?? '').includes('gpt-5.4'), { what: 'a completed row from gpt-5.4' });
  } finally { await overlay.evaluate(config => window.electronAPI.setGatewayConfiguration(config), original); }
});

// old line 685
test('AG33 one webContents delivers chat events only to the owning UI subscription', async () => {
  await overlay.evaluate((key) => {
    window.__ag33Owners = { natively: '', global: '', meeting: '' };
    for (const owner of ['natively', 'global', 'meeting']) window[key].push(window.electronAPI.onGeminiStreamToken(token => { window.__ag33Owners[owner] += token; }, owner));
  }, RENDERER_UNSUBS);
  mock.setScript({ errorStatus: 0, chunks: ['AG33 owner-scoped answer.'], delayMs: 20 });
  await overlay.evaluate(() => window.electronAPI.streamGeminiChat('AG33 owner question', undefined, undefined, { owner: 'global' }));
  const owners = await overlay.evaluate(() => window.__ag33Owners);
  assert.deepEqual(owners, { natively: '', global: 'AG33 owner-scoped answer.', meeting: '' });
});

// old line 696. Each answer's first body chunk is held for a real 11 s, past the 10 s
// interview first-token timeout (a product clock, so a kept observation window). The
// cancelled answer's tail is held until the cancel is visible (was: 800 ms between chunks).
test('AG33 real Written typed and captured-image questions survive interview TTFT, preserve cancellation and retry as separate records', async () => {
  const holds = [];
  try {
    await overlay.evaluate(() => window.electronAPI.saveWrittenExam({ enabled: true }));
    const deliveredBefore = await cancelledRows();
    const firstBody = holdStream({ afterChunks: 1 });
    const tail = holdStream({ afterChunks: 3 });
    holds.push(firstBody, tail);
    mock.setScript({ errorStatus: 0, chunks: ['', 'Written ', 'partial ', 'OLD-WRITTEN-TAIL'], delayMs: 800,
      afterChunk: (entry) => firstBody.afterChunk(entry) ?? tail.afterChunk(entry) });
    await ask('Synthetic written screenshot-free question');
    await firstBody.reached(30_000);
    await observeWindow(11_000, 'first body chunk delayed past the 10 s interview first-token timeout');
    firstBody.release();
    await waitText('Written partial');
    await overlay.evaluate(() => window.electronAPI.cancelChatStream('natively'));
    await waitRowsText((text) => text.includes('Written partial') && text.includes('cancelled'), { what: 'the cancelled written partial' });
    assert.equal(await cancelledRows(), deliveredBefore + 1);
    tail.release();
    mock.setScript({ errorStatus: 0, chunks: ['Written explicit retry completed.'], delayMs: 20 });
    await ask('Synthetic written explicit retry');
    await waitText('Written explicit retry completed.');
    assert.ok((await rowsText()).includes('Written partial'), 'cancelled partial remains its own record after retry');
    assert.ok(!(await rowsText()).includes('OLD-WRITTEN-TAIL'));
    const beforeCapture = mock.chatRequests().length;
    const captureBody = holdStream({ afterChunks: 1 });
    holds.push(captureBody);
    mock.setScript({ errorStatus: 0, chunks: ['', 'Written captured image answer.'], delayMs: 20, afterChunk: captureBody.afterChunk });
    const screenshot = await overlay.evaluate(() => window.electronAPI.takeScreenshot());
    await sendOverlayEvent('capture-and-process', screenshot);
    await captureBody.reached(30_000);
    await observeWindow(11_000, 'captured answer body delayed past the 10 s interview first-token timeout');
    captureBody.release();
    await waitText('Written captured image answer.', { timeoutMs: 20_000 });
    assert.equal(mock.chatRequests().length, beforeCapture + 1);
    assert.match(JSON.stringify(mock.chatRequests().at(-1).body.messages), /data:image/);
  } finally {
    for (const hold of holds) hold.release();
    await overlay.evaluate(() => window.electronAPI.saveWrittenExam({ enabled: false }));
  }
});

// old line 724. The superseded answer is held after its second chunk until the captured
// question has been answered (was: 1.5 s between chunks).
test('AG33 real Written: a new captured question while an answer streams cancels that answer and is answered', async () => {
  const input = overlayInput();
  const hold = holdStream({ afterChunks: 2 });
  try {
    await overlay.evaluate(() => window.electronAPI.saveWrittenExam({ enabled: true }));
    const cancelledBefore = await cancelledRows();
    mock.setScript({ errorStatus: 0, chunks: ['Superseded ', 'written ', 'SUPERSEDED-TAIL'], delayMs: 20, afterChunk: hold.afterChunk });
    await ask('Synthetic superseded written question');
    await waitText('Superseded written');
    const before = mock.chatRequests().length;
    mock.setScript({ errorStatus: 0, chunks: ['Superseding captured answer.'], delayMs: 20 });
    const screenshot = await overlay.evaluate(() => window.electronAPI.takeScreenshot());
    await sendOverlayEvent('capture-and-process', screenshot);
    await waitText('Superseding captured answer.', { timeoutMs: 20_000 });
    assert.equal(mock.chatRequests().length, before + 1);
    assert.match(JSON.stringify(mock.chatRequests().at(-1).body.messages), /data:image/);
    assert.equal(await cancelledRows(), cancelledBefore + 1);
    hold.release();
    assert.ok(!(await rowsText()).includes('SUPERSEDED-TAIL'));
    assert.equal(await input.inputValue(), '', 'the superseded question does not return to the input');
  } finally {
    hold.release();
    await overlay.evaluate(() => window.electronAPI.saveWrittenExam({ enabled: false }));
  }
});

// old line 747
test('AG51 saved written/interview mode selects prompts without a second question-mode control', async () => {
  const { scenarioPrompt, writtenOutputPrompt } = require('../../dist-electron/electron/llm/scenarioPrompts.js');
  // S46-02: the sent question's row keeps the scene of its request, not the current selection.
  const questionRow = async (question) => {
    const row = (await rows((r) => r.scene !== null && r.textContent.includes(question)))[0];
    return row && { scene: row.scene, blue: row.blue, icon: row.icon };
  };
  const modes = [['interview', 'interview'], ['written', 'written']];
  try {
    for (const [selection, scene] of modes) {
      await overlay.evaluate(enabled => window.electronAPI.saveWrittenExam({ enabled }), selection === 'written');
      assert.equal(await overlay.getByLabel('Question mode').count(), 0);
      const answer = `AG51 ${selection} completed.`;
      mock.setScript({ errorStatus: 0, chunks: [answer], delayMs: 20 });
      await ask(`AG51 synthetic ${selection} question`);
      await waitVisible(rowLocator().getByText(answer, { exact: true }).first(), { what: `row text ${answer}` });
      const system = mock.chatRequests().at(-1).body.messages.find(message => message.role === 'system').content;
      assert.ok(system.startsWith(scene === 'written' ? writtenOutputPrompt(scenarioPrompt(scene), 'plain') : scenarioPrompt(scene)));
      assert.equal(system.includes('submittable code first'), scene === 'written');
    }
    for (const [selection, scene] of modes) {
      assert.deepEqual(await questionRow(`AG51 synthetic ${selection} question`), { scene, blue: scene === 'interview', icon: scene === 'written' }, selection);
    }
  } finally { await overlay.evaluate(() => window.electronAPI.saveWrittenExam({ enabled: false })); }
});

// old lines 773 and 826 in one case: 773's complete flow first, then 826's patch.
test('AG33 real Natively renderer ignores automatic intelligence while manual chat owns its placeholder; a late action invoke cannot change the newer manual answer or erase prior UI records', async () => {
  // Phase 1 (old line 773).
  {
    const hold = holdStream({ afterChunks: 1 });
    mock.setScript({ errorStatus: 0, chunks: ['Manual source ', 'answer intact.'], delayMs: 100, afterChunk: hold.afterChunk });
    try {
      await ask('Synthetic mixed source question'); await hold.reached(30_000);
      const metadata = { requestId: 'AG33-stale-automatic', provider: 'synthetic', model: 'automatic', status: 'completed', attempts: 1, partial: false };
      await sendOverlayEvent('intelligence-generation-started', metadata);
      await sendOverlayEvent('intelligence-token-batch', { ...metadata, kind: 'suggested_answer', items: [{ token: 'AUTOMATIC-LATE-TOKEN' }] });
      await sendOverlayEvent('intelligence-suggested-answer', { ...metadata, answer: 'AUTOMATIC-LATE-DONE' });
      await sendOverlayEvent('intelligence-generation-terminal', { ...metadata, error: 'AUTOMATIC-LATE-ERROR' });
      hold.release();
      await waitText('Manual source answer intact.');
      assert.doesNotMatch(await rowsText(), /AUTOMATIC-LATE-|automatic ·/);
    } finally { hold.release(); }
  }
  // The first answer has completed (its row carries the completed status) before the
  // next typed question; in interview mode a question typed mid-answer is held back.
  await waitRows((r) => r.status === 'completed' && r.text.includes('Manual source answer intact.'), { what: 'the phase 1 answer to complete' });

  // Phase 2 (old line 826).
  mock.setScript({ errorStatus: 0, chunks: ['AG33 prior retained record.'], delayMs: 20 });
  await ask('AG33 prior retained record question');
  await waitRows((r) => r.text.includes('AG33 prior retained record.') && r.status === 'completed', { what: 'the prior record to complete' });
  await patchOnce('generate-what-to-say', ({ ipcMain }) => {
    const handlers = ipcMain._invokeHandlers; const real = handlers.get('generate-what-to-say');
    handlers.set('generate-what-to-say', event => {
      handlers.set('generate-what-to-say', real);
      const metadata = { requestId: 'AG33-delayed-action', provider: 'synthetic', model: 'old-action', attempts: 1, partial: true };
      event.sender.send('intelligence-generation-started', metadata);
      event.sender.send('intelligence-token-batch', { ...metadata, kind: 'suggested_answer', items: [{ token: 'Old action partial preserved.' }] });
      return new Promise((resolve, reject) => { globalThis.__ag33RejectOldAction = () => setImmediate(() => reject(Error('LATE-ACTION-INVOKE'))); });
    });
  });
  await sendOverlayEvent('global-shortcut', { action: 'whatToAnswer' });
  await waitText('Old action partial preserved.');
  const hold = holdStream({ afterChunks: 1 });
  mock.setScript({ errorStatus: 0, chunks: ['New manual source ', 'finishes intact.'], delayMs: 20, afterChunk: hold.afterChunk });
  try {
    await ask('AG33 new manual over delayed action'); await hold.reached(30_000);
    // Repeatable: a second call schedules a second reject() of an already settled promise, a no-op.
    await mainRead(() => { globalThis.__ag33RejectOldAction(); return true; }, undefined, 'reject the old action invoke');
    await waitRows((r) => r.status === 'cancelled' && (r.statusText ?? '').includes('old-action'), { what: 'the old action row cancelled' });
    hold.release();
    await waitText('New manual source finishes intact.');
    const text = await rowsText();
    assert.doesNotMatch(text, /LATE-ACTION-INVOKE/); assert.ok(text.includes('Old action partial preserved.'));
    assert.ok(text.includes('AG33 prior retained record.'), 'cancellation preserves prior UI records');
  } finally { hold.release(); }
});
