// Shared base of the Margin answer regression suite
// (tests/margin/answer-regression.next.test.mjs; docs/margin/REGRESSION-SUITE-REBUILD.md).
//
// One app for the whole suite; every case starts with resetCase(), a fixed sequence that
// leaves no stream, gate, patch, recorder, attachment or message row behind. Cases scope
// their assertions to the overlay's message rows (rows()), which resetCase() has emptied,
// never to the whole page text.
//
// Waits: every wait here polls on an interval from Node (until()), never with
// requestAnimationFrame-based polling (the overlay is never shown). The only fixed wait
// is observeWindow(), for product clocks and for "something does not happen" windows.
// A harness wait that times out prints one '[harness] timeout dump <json>' line
// (timeoutDump) before it throws its original error.
//
// Main-process calls go through mainRead() (read-only or repeatable, i.e. two runs in a
// row leave the same end state as one: retried up to 3 times on "context was destroyed",
// with a diagnostic line per retry) or mainDo() (side effects that must happen exactly
// once: never retried; a diagnostic line, then the original error). Nothing calls
// state.app.evaluate directly.
//
// Reset proof: when the file diag-out/skip-session-reset exists at the repository root,
// resetCase() skips step 7 (session-reset), so step 9 must fail from the second case on.
// A marker file is used because scripts/margin/isolation/run-node.mjs passes the test
// process only an allow-list of environment variables.

import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { startMockOpenAI } from './mock-openai.mjs';
import { launchApp, windowWithQuery, readMainErrors } from './launch-app.mjs';
import { makeSandbox, readBlocked } from '../../scripts/margin/isolation/env.mjs';

const require = createRequire(import.meta.url);
const sharp = require('sharp');

export const FAKE_KEY = 'sk-margin-regression-not-a-real-key';
export const MODEL = 'gpt-5.4';
export const SKIP_SESSION_RESET_MARKER = fileURLToPath(new URL('../../diag-out/skip-session-reset', import.meta.url));

// A message row is the root element MessageRow renders (src/components/NativelyInterface.tsx:321-323):
// <div class="w-full" data-message-scene data-question-id ...> whose only direct child is
// <div class="flex ... animate-fade-in-up">. That class appears nowhere else in the overlay.
export const ROW_CSS = 'div.w-full:has(> div.animate-fade-in-up)';

const DEFAULT_SCRIPT = { chunks: ['Mock ', 'answer.'], delayMs: 20, errorStatus: 0, respond: undefined, hold: false };

const state = {
  mock: null, app: null, sandbox: null, overlay: null, launcher: null, mainErrorsLog: null, mainPid: null,
  answerGateway: null, answerModel: null, defaultScopes: null, caseCount: 0,
  gates: new Set(), patchedChannels: new Set(), recorderKeys: new Set(), streamIdSpy: false,
};

export const ctx = state;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Wait helpers default to 30 s, Playwright's default timeout, which the old suite's
// waits without an explicit timeout used.

const DUMP_BUDGET_MS = 5_000;
const clip = (value, n) => (typeof value === 'string' && value.length > n ? `${value.slice(0, n)}...` : value);
let dumping = false;

// The text of the last user message of a chat request body.
function lastUserText(body) {
  const user = (body?.messages ?? []).filter((m) => m?.role === 'user').at(-1);
  if (!user) return null;
  if (typeof user.content === 'string') return user.content;
  if (Array.isArray(user.content)) return user.content.filter((p) => typeof p?.text === 'string').map((p) => p.text).join(' ');
  return null;
}

// On a timed-out harness wait: prints ONE line '[harness] timeout dump <json>' with the
// overlay's rows, the awaited text or locator, the input value, the mock's request log and
// the saved written-exam mode. Never throws and takes at most DUMP_BUDGET_MS (each part
// guarded on its own; the line is printed with whatever was gathered by then), so the
// caller's original error is thrown unchanged. Renderer reads only, no main-process
// evaluate. `needle`: awaited row text; `locator`: awaited Playwright locator.
export async function timeoutDump(what, { needle, locator } = {}) {
  if (dumping) return;
  dumping = true;
  let timer;
  const dump = { what: clip(String(what), 300), caseCount: state.caseCount };
  try {
    const parts = async () => {
      try {
        const requests = state.mock?.chatRequests() ?? [];
        dump.mock = {
          count: requests.length,
          openStreamCount: state.mock?.openStreamCount(),
          requests: requests.map((r) => ({
            lastUser: clip(lastUserText(r.body), 120),
            image: JSON.stringify(r.body?.messages ?? []).includes('data:image/'),
            chunksSent: r.chunksSent,
            aborted: r.closedEarly,
          })),
        };
      } catch (e) { dump.mockError = String(e?.message ?? e); }
      const overlay = state.overlay;
      if (!overlay) { dump.overlay = null; return; }
      try {
        Object.assign(dump, await overlay.evaluate(({ sel, text }) => {
          const visible = (el) => (typeof el.checkVisibility === 'function' ? el.checkVisibility() : el.getClientRects().length > 0);
          const rowList = [...document.querySelectorAll(sel)].map((row) => {
            const status = row.querySelector('[data-generation-status]');
            return {
              text: (row.innerText ?? '').slice(0, 200),
              data: { ...row.dataset },
              status: status ? (status.dataset.generationStatus ?? null) : null,
              streaming: !!row.querySelector('.overlay-subtle-surface'),
            };
          });
          const inputs = [...document.querySelectorAll('input[type="text"]')];
          let matches;
          if (text) {
            // Deepest elements whose text contains the awaited text.
            const all = [...document.body.querySelectorAll('*')].filter((el) => (el.textContent ?? '').includes(text)
              && ![...el.children].some((child) => (child.textContent ?? '').includes(text)));
            matches = { count: all.length, visible: all.slice(0, 20).map(visible) };
          }
          return { rows: rowList, inputValue: inputs.length ? inputs.at(-1).value : null, ...(matches ? { needleMatches: matches } : {}) };
        }, { sel: ROW_CSS, text: needle ?? null }));
      } catch (e) { dump.overlayError = String(e?.message ?? e).split('\n')[0]; }
      if (locator) {
        try {
          const count = await locator.count();
          const vis = [];
          for (let i = 0; i < Math.min(count, 10); i++) vis.push(await locator.nth(i).isVisible());
          dump.locatorMatches = { count, visible: vis };
        } catch (e) { dump.locatorError = String(e?.message ?? e).split('\n')[0]; }
      }
      try {
        const exam = await overlay.evaluate(() => window.electronAPI?.getWrittenExam?.());
        dump.writtenExam = exam && typeof exam === 'object' ? { enabled: exam.enabled ?? exam.settings?.enabled ?? null, running: exam.running ?? null } : exam ?? null;
      } catch (e) { dump.writtenExamError = String(e?.message ?? e).split('\n')[0]; }
    };
    await Promise.race([
      parts().catch((e) => { dump.error = String(e?.message ?? e); }),
      new Promise((resolve) => { timer = setTimeout(() => { dump.incomplete = `dump budget ${DUMP_BUDGET_MS} ms exceeded`; resolve(); }, DUMP_BUDGET_MS); }),
    ]);
    let line;
    try { line = JSON.stringify(dump); } catch (e) { line = JSON.stringify({ what: dump.what, stringifyError: String(e?.message ?? e) }); }
    console.error(`[harness] timeout dump ${line}`);
  } catch (e) {
    try { console.error(`[harness] timeout dump failed: ${e?.message ?? e}`); } catch { /* nothing left to do */ }
  } finally {
    clearTimeout(timer);
    dumping = false;
  }
}

// Interval polling from Node. Returns the first truthy value of `check`; on timeout
// prints a timeout dump (unless dump: false) and throws (or, with throwOnTimeout: false,
// returns the last value without a dump). `needle` / `locator` only feed the dump.
export async function until(check, { timeoutMs = 15_000, intervalMs = 100, what = 'condition', throwOnTimeout = true, dump = true, needle, locator } = {}) {
  const deadline = Date.now() + timeoutMs;
  let last;
  for (;;) {
    last = await check();
    if (last) return last;
    if (Date.now() >= deadline) break;
    await sleep(intervalMs);
  }
  if (throwOnTimeout) {
    const error = new Error(`timed out after ${timeoutMs} ms waiting for ${what} (last: ${JSON.stringify(last)})`);
    if (dump) await timeoutDump(what, { needle, locator });
    throw error;
  }
  return last;
}

// A page condition, polled from Node on an interval (not page.waitForFunction).
export const waitPage = (page, fn, arg, { timeoutMs = 30_000, what = String(fn) } = {}) =>
  until(() => page.evaluate(fn, arg), { timeoutMs, what });

export const waitVisible = (locator, { timeoutMs = 30_000, what = String(locator) } = {}) =>
  until(() => locator.isVisible(), { timeoutMs, what: `${what} visible`, locator });

export const waitHidden = (locator, { timeoutMs = 30_000, what = String(locator) } = {}) =>
  until(async () => !(await locator.isVisible()), { timeoutMs, what: `${what} hidden`, locator });

export const waitDetached = (locator, { timeoutMs = 30_000, what = String(locator) } = {}) =>
  until(async () => (await locator.count()) === 0, { timeoutMs, what: `${what} detached`, locator });

// The only fixed wait. Allowed for product clocks and "something does not happen"
// observation windows (docs/margin/REGRESSION-SUITE-REBUILD.md, kept list).
export async function observeWindow(ms, reason) {
  if (!reason) throw new Error('observeWindow needs a reason');
  console.log(`[harness] observeWindow ${ms} ms: ${reason}`);
  await sleep(ms);
}

const appAlive = () => state.app?.process().exitCode === null && state.app?.process().signalCode === null;

// Read-only (or idempotent) main-process call.
export async function mainRead(fn, arg, label = 'mainRead') {
  for (let attempt = 0; ; attempt++) {
    try { return await state.app.evaluate(fn, arg); } catch (e) {
      const retry = attempt < 3 && appAlive() && /context was destroyed/.test(e.message);
      console.error(`[harness] ${label} attempt ${attempt + 1} failed: ${e.message.split('\n')[0]} alive=${appAlive()}${retry ? `; retry ${attempt + 1}/3` : ''}`);
      if (!retry) throw e;
      await sleep(200);
    }
  }
}

// Main-process call with side effects: never retried.
export async function mainDo(fn, arg, label = 'mainDo') {
  try { return await state.app.evaluate(fn, arg); } catch (e) {
    console.error(`[harness] ${label} failed (not retried): ${e.message.split('\n')[0]} alive=${appAlive()}`);
    throw e;
  }
}

export const overlayInput = () => state.overlay.locator('input[type="text"]').last();
export const rowLocator = () => state.overlay.locator(ROW_CSS);

// Descriptors of the overlay's message rows (all of them exist after this case's reset),
// filtered in Node by `predicate`.
export async function rows(predicate = () => true) {
  const all = await state.overlay.evaluate((sel) => [...document.querySelectorAll(sel)].map((row) => {
    const status = row.querySelector('[data-generation-status]');
    return {
      text: row.innerText,
      textContent: row.textContent,
      questionId: row.dataset.questionId ?? null,
      scene: row.dataset.messageScene ?? null,
      answerRequestId: row.dataset.answerRequestId ?? null,
      status: status?.dataset.generationStatus ?? null,
      statusText: status?.textContent ?? null,
      blue: /blue/.test(row.innerHTML),
      icon: !!row.querySelector('svg[aria-hidden="true"]'),
      images: row.querySelectorAll('img').length,
    };
  }), ROW_CSS);
  return all.filter(predicate);
}

// Visible text of all rows, one row per line (the scoped replacement of body.innerText).
export const rowsText = async () => (await rows()).map((r) => r.text).join('\n');
export const rowsTextContent = async () => (await rows()).map((r) => r.textContent).join('\n');

export const waitRows = (predicate, { timeoutMs = 30_000, what = 'matching row' } = {}) =>
  until(async () => { const found = await rows(predicate); return found.length ? found : false; }, { timeoutMs, what });

export const waitRowsText = (predicate, { timeoutMs = 30_000, what = 'rows text', needle } = {}) =>
  until(async () => predicate(await rowsText()), { timeoutMs, what, needle });

export const waitText = (needle, { timeoutMs = 30_000 } = {}) =>
  waitRowsText((text) => text.includes(needle), { timeoutMs, what: `rows to show ${JSON.stringify(needle)}`, needle });

// Fill and submit once; accepted means the mock received a chat request. No refill, no re-press.
// It does not wait for an earlier answer of the case to finish; a case that submits after
// an earlier answer waits for that answer's terminal row status itself (waitRows), unless
// the overlap is what it tests.
export async function ask(text, { timeoutMs = 15_000 } = {}) {
  const input = overlayInput();
  const before = state.mock.chatRequests().length;
  await input.fill(text);
  await input.press('Enter');
  const accepted = await until(() => state.mock.chatRequests().length > before, { timeoutMs, throwOnTimeout: false });
  if (!accepted) {
    const error = new Error(`overlay did not accept ${JSON.stringify(text)} within ${timeoutMs} ms (input now ${JSON.stringify(await input.inputValue())})`);
    await timeoutDump(`the mock to receive the request for ${JSON.stringify(text)}`);
    throw error;
  }
}

// Fill and press Enter only; acceptance is not required (held-back or retained drafts).
export async function typeAndEnter(text) {
  const input = overlayInput();
  await input.fill(text);
  await input.press('Enter');
}

// A gate on the mock stream, built on its afterChunk hook: any request that has just
// written its `afterChunks`-th chunk waits until release(). Pass hold.afterChunk to
// mock.setScript. resetCase() releases every gate.
export function holdStream({ afterChunks = 1 } = {}) {
  let open;
  const gate = new Promise((resolve) => { open = resolve; });
  let reach;
  const reachedPromise = new Promise((resolve) => { reach = resolve; });
  const hold = {
    afterChunks,
    released: false,
    entry: null,
    afterChunk(entry) {
      if (entry.chunksSent !== afterChunks) return undefined;
      hold.entry ??= entry;
      reach(entry);
      return gate;
    },
    async reached(timeoutMs = 15_000) {
      let timer;
      try {
        return await Promise.race([reachedPromise, new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error(`mock stream did not pause after ${afterChunks} chunk(s) within ${timeoutMs} ms`)), timeoutMs);
        })]);
      } catch (e) {
        await timeoutDump(`a mock stream to pause after ${afterChunks} chunk(s)`);
        throw e;
      } finally { clearTimeout(timer); }
    },
    release() { hold.released = true; open(); },
  };
  state.gates.add(hold);
  return hold;
}

export const release = (hold) => hold.release();

function releaseAllGates() {
  for (const hold of state.gates) hold.release();
  state.gates.clear();
}

// Installs a one-time patch of the ipcMain invoke handler `channel`. The harness saves
// the real handler first; `install` (a main-process function, ({ ipcMain, ... }, arg))
// does the patching itself. resetCase() puts the saved handler back.
// Both steps are repeatable, so both go through mainRead: the save keeps the first saved
// handler, and the install step first puts the saved (real) handler back, then runs
// `install`, so a second run replaces the first run's patch instead of wrapping it.
// `install` is sent as source text and evaluated in the main process, as Playwright
// itself does with the function it is given.
export async function patchOnce(channel, install, arg) {
  state.patchedChannels.add(channel);
  await mainRead(({ ipcMain }, ch) => {
    const real = ipcMain._invokeHandlers?.get(ch);
    if (!real) throw new Error(`${ch} handler not found`);
    globalThis.__marginSavedInvoke ??= {};
    if (!globalThis.__marginSavedInvoke[ch]) globalThis.__marginSavedInvoke[ch] = real;
  }, channel, `patchOnce save ${channel}`);
  return mainRead(async (electron, { ch, src, a }) => {
    const saved = globalThis.__marginSavedInvoke?.[ch];
    if (!saved) throw new Error(`${ch}: no saved handler to patch`);
    electron.ipcMain._invokeHandlers.set(ch, saved);
    return (0, eval)(`(${src})`)(electron, a);
  }, { ch: channel, src: install.toString(), a: arg }, `patchOnce install ${channel}`);
}

// Records the first argument of every ipcMain `channel` event under `key`; read with
// recorded(key). resetCase() removes the listener.
// Repeatable (mainRead): a second run finds this key's listener already registered on
// the same channel and does nothing. A key reused within a case is refused in Node.
export async function record(channel, key) {
  if (state.recorderKeys.has(key)) throw new Error(`recorder ${key} already installed`);
  state.recorderKeys.add(key);
  await mainRead(({ ipcMain }, { ch, k }) => {
    globalThis.__marginRecorders ??= {};
    const existing = globalThis.__marginRecorders[k];
    if (existing) {
      if (existing.channel === ch && ipcMain.listeners(ch).includes(existing.listener)) return;
      throw new Error(`recorder ${k} already installed on ${existing.channel}`);
    }
    const entry = { channel: ch, values: [], listener: (_event, value) => entry.values.push(value) };
    globalThis.__marginRecorders[k] = entry;
    ipcMain.on(ch, entry.listener);
  }, { ch: channel, k: key }, `record ${channel}`);
}

export const recorded = (key) => mainRead((_, k) => globalThis.__marginRecorders?.[k]?.values ?? null, key, `recorded ${key}`);

// Main side: records the stream id of every chat token the app sends to the overlay.
// Installed at the start of the case that uses it. Repeatable (mainRead): the id list is
// created only if missing (resetCase() deletes it) and an already wrapped window is skipped,
// so a second run keeps the ids the first run's wrapper recorded.
export async function installStreamIdSpy() {
  state.streamIdSpy = true;
  return mainRead(({ BrowserWindow }) => {
    globalThis.__marginStreamIds ??= [];
    for (const w of BrowserWindow.getAllWindows()) {
      const wc = w.webContents;
      if (!wc.getURL().includes('window=overlay') || wc.__marginRealSend) continue;
      wc.__marginRealSend = wc.send.bind(wc);
      wc.send = (ch, ...args) => {
        if (ch === 'gemini-stream-token' && !globalThis.__marginStreamIds.includes(args[1])) globalThis.__marginStreamIds.push(args[1]);
        return wc.__marginRealSend(ch, ...args);
      };
    }
  }, undefined, 'installStreamIdSpy');
}

export const streamIds = () => mainRead(() => globalThis.__marginStreamIds, undefined, 'streamIds');

// Sends an event to the overlay over the real main -> preload -> renderer IPC path.
export function sendOverlayEvent(channel, ...args) {
  return mainDo(({ BrowserWindow }, [ch, a]) => {
    for (const w of BrowserWindow.getAllWindows()) {
      if (w.webContents.getURL().includes('window=overlay')) (w.webContents.__marginRealSend ?? w.webContents.send.bind(w.webContents))(ch, ...a);
    }
  }, [channel, args], `send ${channel}`);
}

// The real shortcut path: main sends 'global-shortcut' {action:'takeScreenshot'} to the overlay.
export const pressScreenshotShortcut = () => sendOverlayEvent('global-shortcut', { action: 'takeScreenshot' });

// Renderer-side subscriptions a case makes push their unsubscribe function here;
// resetCase() calls them all.
export const RENDERER_UNSUBS = '__marginUnsubs';

export async function startSuite() {
  state.mock = await startMockOpenAI();
  state.sandbox = makeSandbox('regression');
  const fixture = path.join(state.sandbox.tmp, 'fixture-screen.png');
  await sharp({ create: { width: 64, height: 48, channels: 3, background: '#2050a0' } }).png().toFile(fixture);

  ({ app: state.app, mainErrorsLog: state.mainErrorsLog, mainPid: state.mainPid } = await launchApp(state.sandbox, {
    NODE_ENV: 'production',
    MARGIN_DEV_OPENAI_BASE_URL: state.mock.baseURL,
    MARGIN_DEV_SCREENSHOT_FIXTURE: fixture,
  }));
  const launcher = await windowWithQuery(state.app, 'window=launcher');
  state.launcher = launcher;
  await launcher.waitForLoadState('domcontentloaded');
  const keyResult = await launcher.evaluate((apiKey) => window.electronAPI.setProviderConfiguration({ provider: 'openai', protocol: 'chat-completions', model: 'gpt-5.4', apiKey }), FAKE_KEY);
  assert.deepEqual(keyResult, { ok: true }, `setProviderConfiguration failed: ${JSON.stringify(keyResult)}`);
  const created = await launcher.evaluate((config) => window.electronAPI.setGatewayConfiguration(config),
    { protocol: 'chat-completions', baseUrl: state.mock.baseURL, model: MODEL, apiKey: FAKE_KEY });
  assert.equal(created.ok, true);
  state.answerGateway = created.gatewayId;
  const imageTarget = { id: state.answerGateway, protocol: 'chat-completions', baseUrl: state.mock.baseURL, model: MODEL,
    imageSupportConfirmedFor: JSON.stringify(['gateway', state.answerGateway, 'chat-completions', state.mock.baseURL.replace(/\/+$/, ''), MODEL]) };
  assert.equal((await launcher.evaluate((config) => window.electronAPI.setGatewayConfiguration(config), imageTarget)).ok, true);

  const overlay = await windowWithQuery(state.app, 'window=overlay');
  state.overlay = overlay;
  await overlay.waitForLoadState('domcontentloaded');
  await until(async () => (await overlay.locator('input[type="text"]').count()) > 0, { timeoutMs: 20_000, what: 'overlay input attached' });

  // The overlay is not shown. Its frames stall for a few seconds after the first launch
  // on a machine (W1); wait until two consecutive one-second samples are >= 30.
  await overlay.evaluate(() => {
    const s = { frames: 0, perSecond: [], stopped: false };
    window.__marginRafSampler = s;
    const tick = () => { if (s.stopped) return; s.frames += 1; requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
    s.timer = setInterval(() => { s.perSecond.push(s.frames); s.frames = 0; }, 1000);
  });
  const t0 = Date.now();
  try {
    await until(() => overlay.evaluate(() => {
      const p = window.__marginRafSampler.perSecond;
      return p.length >= 2 && p.at(-1) >= 30 && p.at(-2) >= 30;
    }), { timeoutMs: 30_000, intervalMs: 250, what: 'two consecutive seconds of >= 30 overlay frames' });
  } finally {
    const samples = await overlay.evaluate(() => {
      const s = window.__marginRafSampler; s.stopped = true; clearInterval(s.timer); return s.perSecond;
    });
    console.log(`[harness] overlay frames per second until steady (${Date.now() - t0} ms): ${JSON.stringify(samples)}`);
  }

  // On mount the overlay reads the saved default model and makes it the runtime model.
  // Select the gateway model from the overlay itself, after two round trips on the same
  // IPC channel order, so that reset cannot land later.
  state.answerModel = `llm-gateway:${state.answerGateway}:chat-completions:${encodeURIComponent(MODEL)}`;
  await overlay.evaluate(async (m) => {
    await window.electronAPI.getDefaultModel();
    await window.electronAPI.getDefaultModel();
    await window.electronAPI.setModel(m);
    await window.electronAPI.getDefaultModel();
  }, state.answerModel);
  const config = await overlay.evaluate(() => window.electronAPI.getCurrentLlmConfig());
  assert.equal(config?.model, state.answerModel, `active model is ${JSON.stringify(config)}`);
  state.defaultScopes = await overlay.evaluate(() => window.electronAPI.getProviderDataScopes());
  return state;
}

// Closes the app and the mock and returns what the suite's after hook asserts.
export async function endSuite() {
  try { await state.app?.close(); } catch { /* already gone */ }
  await state.mock?.close();
  const all = state.sandbox ? readBlocked(state.sandbox) : [];
  return {
    blocked: all.filter((b) => !['permission', 'device', 'local-exec'].includes(b.kind)).map((b) => `${b.kind} ${b.detail}`),
    ollama: all.filter((b) => /11434|ollama|lsof/i.test(`${b.kind} ${b.detail}`)).map((b) => `${b.kind} ${b.detail}`),
    mainErrors: state.mainErrorsLog ? readMainErrors(state.mainErrorsLog, state.mainPid).map((e) => `${e.kind}: ${e.detail.split('\n')[0]}`) : [],
  };
}

async function resetStep(n, name, timeoutMs, fn) {
  let timer;
  try {
    await Promise.race([fn(), new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`timed out after ${timeoutMs} ms`)), timeoutMs);
    })]);
  } catch (e) {
    throw new Error(`resetCase step ${n} (${name}) failed before case ${state.caseCount}: ${e.message}`);
  } finally { clearTimeout(timer); }
}

// The fixed per-case reset (docs/margin/REGRESSION-SUITE-REBUILD.md, "resetCase() 的固定序列").
export async function resetCase() {
  state.caseCount += 1;
  const { overlay, mock } = state;
  const skipSessionReset = fs.existsSync(SKIP_SESSION_RESET_MARKER);

  // 1. Release every gate the harness registered.
  await resetStep(1, 'release gates', 1_000, async () => { releaseAllGates(); });

  // 2. Cancel the current chat stream. cancelChatStream acts only for the owner that
  // started the stream (electron/preload.ts:571-577), so ask each owner the suite uses.
  await resetStep(2, 'cancel chat stream', 5_000, () => overlay.evaluate(() => {
    for (const owner of ['natively', 'global', 'meeting']) window.electronAPI.cancelChatStream(owner);
  }));

  // 3. No stream may stay open on the mock.
  // No dump here: the step's own 15 s bound would expire while it is being built.
  await resetStep(3, 'mock open streams = 0', 15_000, () => until(() => mock.openStreamCount() === 0,
    { timeoutMs: 15_000, what: 'mock open streams to reach 0', dump: false }));

  // 4. Reset intelligence through the preload (electron/preload.ts:1046).
  await resetStep(4, 'resetIntelligence', 10_000, async () => {
    const result = await overlay.evaluate(() => window.electronAPI.resetIntelligence());
    if (!result?.success) throw new Error(`resetIntelligence returned ${JSON.stringify(result)}`);
  });

  // 5. Restore one-time patches, remove recorders and the stream id spy, unsubscribe
  // the renderer listeners cases registered. All idempotent, so retried like a read.
  await resetStep(5, 'restore patches and recorders', 10_000, async () => {
    if (state.patchedChannels.size) {
      await mainRead(({ ipcMain }, channels) => {
        for (const ch of channels) {
          const saved = globalThis.__marginSavedInvoke?.[ch];
          if (saved) { ipcMain._invokeHandlers.set(ch, saved); delete globalThis.__marginSavedInvoke[ch]; }
        }
      }, [...state.patchedChannels], 'restore patches');
      state.patchedChannels.clear();
    }
    if (state.recorderKeys.size) {
      await mainRead(({ ipcMain }, keys) => {
        for (const k of keys) {
          const entry = globalThis.__marginRecorders?.[k];
          if (entry) { ipcMain.removeListener(entry.channel, entry.listener); delete globalThis.__marginRecorders[k]; }
        }
      }, [...state.recorderKeys], 'remove recorders');
      state.recorderKeys.clear();
    }
    if (state.streamIdSpy) {
      await mainRead(({ BrowserWindow }) => {
        for (const w of BrowserWindow.getAllWindows()) {
          const wc = w.webContents;
          if (wc.__marginRealSend) { wc.send = wc.__marginRealSend; delete wc.__marginRealSend; }
        }
        delete globalThis.__marginStreamIds;
      }, undefined, 'remove stream id spy');
      state.streamIdSpy = false;
    }
    await overlay.evaluate((key) => {
      for (const off of window[key] ?? []) { try { off(); } catch { /* already removed */ } }
      window[key] = [];
    }, RENDERER_UNSUBS);
  });

  // 6. No attachments; interview mode; the startup data scopes and answer model.
  await resetStep(6, 'attachments, mode, data scopes', 15_000, async () => {
    const removeAll = overlay.locator('button[title="Remove all"]');
    if (await removeAll.count()) await removeAll.click();
    // Attachment previews are alt "Screenshot <n>" (NativelyInterface.tsx:4594); row images are "Screenshot attached".
    await until(() => overlay.evaluate(() => ![...document.querySelectorAll('img')].some((img) => /^Screenshot \d+$/.test(img.alt))),
      { timeoutMs: 5_000, what: 'no attached screenshot' });
    await overlay.evaluate(() => window.electronAPI.saveWrittenExam({ enabled: false }));
    await overlay.evaluate((scopes) => window.electronAPI.setProviderDataScopes(scopes), state.defaultScopes);
    const config = await overlay.evaluate(() => window.electronAPI.getCurrentLlmConfig());
    if (config?.model !== state.answerModel) await overlay.evaluate((m) => window.electronAPI.setModel(m), state.answerModel);
  });

  // 7. session-reset, only after every request has ended (step 3), or the preload's
  // in-flight flag would stay set. Sent through mainRead: a duplicate is harmless. Its
  // only receivers in the overlay (electron/preload.ts:562 and NativelyInterface.tsx:1311)
  // set fixed values, plus generationEpochRef.current++, which is only ever compared for
  // equality with an epoch captured earlier, so one or two increments invalidate the same
  // generations; and no request is in flight here (step 3).
  if (skipSessionReset) {
    console.error(`[harness] ${SKIP_SESSION_RESET_MARKER} exists: resetCase step 7 (session-reset) skipped`);
  } else {
    await resetStep(7, 'session-reset', 5_000, () => mainRead(({ BrowserWindow }) => {
      let sent = 0;
      for (const w of BrowserWindow.getAllWindows()) {
        if (w.webContents.getURL().includes('window=overlay')) { w.webContents.send('session-reset'); sent += 1; }
      }
      if (!sent) throw new Error('no overlay window to reset');
    }, undefined, 'session-reset'));
  }

  // 8. Empty the mock's request log and restore its default script.
  await resetStep(8, 'mock log and script', 1_000, async () => {
    mock.clearRequests();
    mock.setScript(DEFAULT_SCRIPT);
  });

  // 9. The message list has no rows.
  await resetStep(9, 'no message rows', 5_000, async () => {
    const left = await until(async () => (await rows()).length === 0, { timeoutMs: 4_500, throwOnTimeout: false });
    if (!left) {
      const remaining = await rows();
      throw new Error(`${remaining.length} message row(s) remain: ${JSON.stringify(remaining.map((r) => r.text.slice(0, 80)))}`);
    }
  });
}
