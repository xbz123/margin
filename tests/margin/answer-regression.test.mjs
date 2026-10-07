// Margin answer regression harness (PLAN.md AG-09).
//
// Drives the real renderer -> preload -> IPC -> LLMHelper path against a loopback
// mock OpenAI server, inside the X2 isolation (temporary HOME, mock keychain, no
// network, no audio devices, no permission prompts). Uses the dev-only hooks from
// electron/margin/devOverrides.ts. Covers: streamed text answers, cancellation with
// late tokens ignored, a superseding question, a screenshot question that sends
// the fixture image, and recovery after a provider error.
//
// Prerequisites: `node scripts/build-electron.js` and `npx vite build`.
// Run:
//   node scripts/margin/isolation/run-node.mjs --allow-exec Electron \
//     --test --test-timeout=180000 tests/margin/answer-regression.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { startMockOpenAI } from './mock-openai.mjs';
import { makeSandbox, isolatedEnv, CHROMIUM_SWITCHES, REPO, readBlocked, GUARD } from '../../scripts/margin/isolation/env.mjs';

const require = createRequire(import.meta.url);
const { _electron } = require('playwright');
const sharp = require('sharp');

const ELECTRON = path.join(REPO, 'node_modules/electron/dist',
  fs.readFileSync(path.join(REPO, 'node_modules/electron/path.txt'), 'utf8').trim());
const FAKE_KEY = 'sk-margin-regression-not-a-real-key';
const MODEL = 'gpt-5.4';

let mock;
let app;
let sandbox;
let overlay;

async function windowWithQuery(appInstance, query, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const w = appInstance.windows().find((p) => p.url().includes(query));
    if (w) return w;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`window ${query} did not appear`);
}

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

test.before(async () => {
  mock = await startMockOpenAI();
  sandbox = makeSandbox('regression');
  const fixture = path.join(sandbox.tmp, 'fixture-screen.png');
  await sharp({ create: { width: 64, height: 48, channels: 3, background: '#2050a0' } }).png().toFile(fixture);

  app = await _electron.launch({
    executablePath: ELECTRON,
    // Playwright deletes NODE_OPTIONS and preloads its own loader with -r, so the
    // isolation guard must be passed the same way or it would not load at all.
    args: ['-r', GUARD, REPO, ...CHROMIUM_SWITCHES],
    cwd: sandbox.work,
    env: isolatedEnv(sandbox, {
      NODE_ENV: 'production',
      MARGIN_DEV_OPENAI_BASE_URL: mock.baseURL,
      MARGIN_DEV_SCREENSHOT_FIXTURE: fixture,
    }),
    timeout: 60_000,
  });
  const output = [];
  app.process().stdout.on('data', (d) => output.push(String(d)));
  app.process().stderr.on('data', (d) => output.push(String(d)));
  app.process().on('exit', (code, signal) => output.push(`[harness] main process exited code=${code} signal=${signal}`));
  // The first main-process evaluate can race start-up ("Execution context was
  // destroyed"); retry while the process is alive, and show its output if it died.
  let guardActive;
  for (let attempt = 1; ; attempt++) {
    try {
      guardActive = await app.evaluate(() => process.env.MARGIN_ISOLATION_ACTIVE);
      break;
    } catch (e) {
      const alive = app.process().exitCode === null && app.process().signalCode === null;
      if (alive && attempt < 10 && /context was destroyed/.test(e.message)) {
        await new Promise((r) => setTimeout(r, 500));
        continue;
      }
      await new Promise((r) => setTimeout(r, 1_000));
      console.error(output.join('').split('\n').filter((l) => !l.includes('isolation-debug')).slice(-40).join('\n'));
      throw e;
    }
  }
  if (guardActive !== '1') {
    await app.close().catch(() => {});
    throw new Error('isolation guard is not active in the Electron main process; aborting');
  }
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

test('cancelChatStream stops the stream and late tokens are not shown', async () => {
  mock.setScript({ chunks: ['Cancel ', 'test ', 'LATE-1 ', 'LATE-2 ', 'LATE-3 ', 'LATE-4.'], delayMs: 400 });
  await ask('Please give a long answer.');
  await overlay.waitForFunction(() => document.body.innerText.includes('Cancel test'), null, { timeout: 15_000 });
  await overlay.evaluate(() => window.electronAPI.cancelChatStream());

  const req = mock.chatRequests().at(-1);
  await new Promise((r) => setTimeout(r, 3_000)); // longer than the remaining script
  const text = await overlayText();
  assert.ok(!text.includes('LATE-3') && !text.includes('LATE-4'), `late tokens leaked into the UI:\n${text.slice(-400)}`);
  assert.ok(req.closedEarly || req.chunksSent < 6, 'the client should abort the HTTP stream');
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
