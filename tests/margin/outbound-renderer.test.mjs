import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import { once } from 'node:events';
import { build } from 'esbuild';
import ts from 'typescript';
import { launchApp, windowWithQuery } from './launch-app.mjs';
import { makeSandbox, readBlocked, REPO } from '../../scripts/margin/isolation/env.mjs';

test('AG33 real Global and Meeting React overlays preserve partial failure, fence closed callbacks and create a new retry record', async () => {
  const bundle = await build({ stdin: { resolveDir: REPO, loader: 'tsx', contents: `
    import React from 'react'; import { createRoot } from 'react-dom/client'; import { flushSync } from 'react-dom';
    import Global from './src/components/GlobalChatOverlay'; import Meeting from './src/components/MeetingChatOverlay';
    const root = createRoot(document.getElementById('root')); const listeners = []; const calls = [];
    window.calls = calls; window.listeners = listeners;
    const subscribe = kind => (callback, owner) => { const item = { kind, callback, owner, live: true }; listeners.push(item); return () => item.live = false; };
    window.electronAPI = { onGeminiStreamToken: subscribe('token'), onGeminiStreamDone: subscribe('done'), onGeminiStreamError: subscribe('error'),
      cancelChatStream(owner) { for (const item of listeners.filter(item => item.live && item.owner === owner && item.kind === 'error')) item.callback('Generation cancelled', { requestId: 'cancelled', provider: 'synthetic', model: 'opaque', status: 'cancelled', partial: true, attempts: 1 }); },
      streamGeminiChat(question, images, context, options) { return new Promise((resolve, reject) => calls.push({ question, options, resolve, reject })); } };
    window.show = (kind, query = '', isOpen = true) => flushSync(() => root.render(React.createElement(kind === 'global' ? Global : Meeting,
      { key: kind, isOpen, initialQuery: query, meetingContext: { id: 'synthetic-meeting', title: 'Synthetic' }, onClose: () => {}, onNewQuery: () => {} })));
    window.emit = (kind, value, metadata, force = false) => { for (const item of [...listeners].filter(item => item.kind === kind && (force || item.live))) item.callback(value, metadata); };
  ` }, bundle: true, write: false, platform: 'browser', format: 'iife', loader: { '.svg': 'dataurl', '.png': 'dataurl', '.css': 'empty' }, define: { 'process.env.NODE_ENV': '"production"' } });
  const sandbox = makeSandbox('ag33-components'); let app;
  try {
    ({ app } = await launchApp(sandbox, { NODE_ENV: 'production' }));
    await windowWithQuery(app, 'window=launcher', 30_000);
    for (const owner of ['global', 'meeting']) {
      const created = app.waitForEvent('window');
      await app.evaluate(async ({ BrowserWindow }) => {
        const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
        await win.loadURL('data:text/html,<div id="root"></div>');
      });
      const page = await created;
      await page.addScriptTag({ content: bundle.outputFiles[0].text });
      await page.evaluate(kind => window.show(kind, 'Partial question'), owner);
      await page.waitForFunction(() => window.calls.length === 1);
      assert.equal(await page.evaluate(() => window.calls[0].options.owner), owner);
      await page.evaluate(() => {
        window.emit('token', 'Preserved component partial.');
        window.emit('error', 'Synthetic timeout', { requestId: 'partial', provider: 'synthetic', model: 'actual-backup', status: 'failed', timeout: 'total', partial: true, attempts: 2 });
        window.calls[0].resolve();
      });
      await page.waitForFunction(() => document.body.innerText.includes('Preserved component partial.') && document.body.innerText.includes('timeout:total'));
      assert.match(await page.locator('[data-generation-status="failed"]').innerText(), /actual-backup/);
      await page.evaluate(kind => window.show(kind, 'Explicit retry question'), owner);
      await page.waitForFunction(() => window.calls.length === 2);
      await page.evaluate(() => {
        window.emit('token', 'New component retry answer.');
        // Done has metadata as its first argument, unlike error.
        window.emit('done', { requestId: 'retry', provider: 'synthetic', model: 'actual-primary', status: 'completed', partial: false, attempts: 1 });
        window.calls[1].resolve();
      });
      await page.waitForFunction(() => document.body.innerText.includes('New component retry answer.'));
      assert.equal(await page.locator('[data-generation-status="completed"]').count(), 1);
      assert.equal(await page.locator('[data-generation-status="failed"]').count(), 1, 'retry does not overwrite the partial failure record');
      await page.evaluate(kind => window.show(kind, 'Close active question'), owner);
      await page.waitForFunction(() => window.calls.length === 3);
      await page.evaluate(kind => {
        window.emit('token', 'Before close partial.');
        window.show(kind, '', false);
      }, owner);
      await page.waitForTimeout(300);
      await page.evaluate(kind => {
        // Force delivery even through released subscriptions to test the component's own fence.
        window.emit('token', 'LATE-CLOSED-TOKEN', undefined, true);
        window.emit('error', 'LATE-CLOSED-ERROR', undefined, true);
        window.emit('done', { status: 'completed' }, undefined, true);
        window.calls[2].reject(Error('LATE-CLOSED-INVOKE'));
        window.show(kind, 'After close question');
      }, owner);
      await page.waitForFunction(() => window.calls.length === 4);
      const text = await page.locator('body').innerText();
      assert.doesNotMatch(text, /LATE-CLOSED-/);
      await page.evaluate(() => { window.emit('token', 'Fresh post-close answer.'); window.emit('done', { requestId: 'after-close', status: 'completed', provider: 'synthetic', model: 'opaque', attempts: 1, partial: false }); window.calls[3].resolve(); });
      await page.waitForFunction(() => document.body.innerText.includes('Fresh post-close answer.'));
      assert.equal((await page.locator('body').innerText()).split('Fresh post-close answer.').length - 1, 1);
      await page.evaluate(kind => window.show(kind, '', false), owner);
      await page.waitForTimeout(300);
      await page.evaluate(kind => window.show(kind, 'Delayed close question'), owner);
      await page.waitForFunction(() => document.body.innerText.includes('Delayed close question'));
      await page.evaluate(kind => window.show(kind, '', false), owner);
      await page.waitForTimeout(400);
      assert.equal(await page.evaluate(() => window.calls.length), 4, 'closing inside the 200ms delay makes no provider invocation');
      await page.close();
    }
  } finally { if (app) await app.close(); }
  assert.deepEqual(readBlocked(sandbox).filter(record => !['permission', 'device', 'local-exec'].includes(record.kind)), []);
});

test('all nine Markdown callers and streaming sanitize block image loads in a real renderer', async () => {
  let callers = 0;
  for (const name of ['NativelyInterface', 'MeetingDetails', 'MeetingChatOverlay']) {
    const source = fs.readFileSync(`${REPO}/src/components/${name}.tsx`, 'utf8');
    assert.match(source, /import ReactMarkdown from '\.\/SafeMarkdown'/);
    const ast = ts.createSourceFile(`${name}.tsx`, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    function visit(node) { if (ts.isJsxOpeningElement(node) && node.tagName.getText(ast) === 'ReactMarkdown') callers++; ts.forEachChild(node, visit); }
    visit(ast);
  }
  assert.equal(callers, 9);
  const source = fs.readFileSync(`${REPO}/src/components/NativelyInterface.tsx`, 'utf8');
  const ast = ts.createSourceFile('NativelyInterface.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let sanitizer;
  function visit(node) { if (ts.isCallExpression(node) && node.expression.getText(ast) === 'DOMPurify.sanitize') sanitizer = node.getText(ast); ts.forEachChild(node, visit); }
  visit(ast); assert.ok(sanitizer);
  const bundle = await build({ stdin: { resolveDir: REPO, loader: 'tsx', contents: `
    import React from 'react'; import { createRoot } from 'react-dom/client'; import { flushSync } from 'react-dom';
    import SafeMarkdown from './src/components/SafeMarkdown'; import Markdown from 'react-markdown';
    import DOMPurify from 'dompurify'; import { marked } from 'marked'; import gfm from 'remark-gfm'; import math from 'remark-math'; import katex from 'rehype-katex';
    const root = createRoot(document.getElementById('markdown'));
    window.render = (text, unsafe = false) => flushSync(() => root.render(React.createElement(unsafe ? Markdown : SafeMarkdown, { children: text, remarkPlugins: [gfm, math], rehypePlugins: [katex] })));
    window.stream = text => { const rawHtml = marked.parse(text); document.getElementById('stream').innerHTML = ${sanitizer}; };
  ` }, bundle: true, write: false, platform: 'browser', format: 'iife' });
  let requests = 0;
  const server = http.createServer((req, res) => { requests++; res.end('synthetic image'); });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const image = `http://127.0.0.1:${server.address().port}/image`;
  const sandbox = makeSandbox('ag24-renderer');
  let app;
  try {
    ({ app } = await launchApp(sandbox, { NODE_ENV: 'production' }));
    await windowWithQuery(app, 'window=launcher', 30_000);
    const created = app.waitForEvent('window');
    await app.evaluate(async ({ BrowserWindow }) => {
      const window = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
      await window.loadURL('data:text/html,<div id="markdown"></div><div id="stream"></div>');
    });
    const page = await created;
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.evaluate(url => window.render(`![synthetic](${url})`, true), image);
    await page.waitForFunction(() => document.querySelector('img')?.complete);
    assert.equal(requests, 1, 'unsafe positive control actually loads the image, with no CSP hiding a component bug');
    await page.evaluate(url => {
      window.render(`safe text ![synthetic](${url})\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\n\`code\` $x$`);
      window.stream(`stream text ![synthetic](${url}) <svg><image href="${url}"></image></svg>`);
    }, image);
    assert.equal(await page.locator('img, svg image').count(), 0);
    assert.equal(await page.locator('table').count(), 1);
    assert.equal(await page.locator('code').count(), 1);
    assert.ok(await page.locator('.katex').count());
    await page.waitForTimeout(200);
    assert.equal(requests, 1, 'safe completed and streaming rendering add no image request');
    const csp = fs.readFileSync(`${REPO}/index.html`, 'utf8');
    assert.match(csp, /img-src 'self' data:;/);
    assert.doesNotMatch(fs.readFileSync(`${REPO}/src/components/StartupSequence.tsx`, 'utf8'), /fonts\.googleapis\.com/);
  } finally {
    if (app) await app.close();
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  }
  const outbound = readBlocked(sandbox).filter(record => !['permission', 'device', 'local-exec'].includes(record.kind));
  assert.deepEqual(outbound, [], 'same egress classification as the existing startup harness');
});

test('app windows refuse foreign navigation and child windows; only https links the user clicks go to the browser', async () => {
  let requests = 0;
  const server = http.createServer((req, res) => { requests++; res.end('<p>synthetic page</p>'); });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const local = `http://127.0.0.1:${server.address().port}`;
  const sandbox = makeSandbox('ag24-navigation');
  let app;
  try {
    ({ app } = await launchApp(sandbox, { NODE_ENV: 'production' }));
    const page = await windowWithQuery(app, 'window=launcher', 30_000);
    const startUrl = page.url();
    const windowCount = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length);
    const before = await windowCount();

    // Positive control: the loopback page itself is reachable, so zero requests below
    // mean the navigations were refused, not that the server was unreachable.
    await app.evaluate(async ({ BrowserWindow }, url) => {
      const control = new BrowserWindow({ show: false });
      await control.loadURL(url);
      control.destroy();
    }, `${local}/control`);
    assert.equal(requests, 1);

    const externalOpens = () => readBlocked(sandbox).filter(record => record.kind === 'external-open').map(record => record.detail).sort();
    const clicked = ['https://links.example/api-clicked', 'https://links.example/clicked', 'https://links.example/clicked-new-tab'];

    // User clicks first (Playwright then waits on the refused navigations below).
    // Playwright sends real input events, which are trusted and grant user activation.
    // Only the https links and openExternal from the click handler of a control that
    // declares that URL reach the browser; a link the page handles itself is left to
    // the page. A handler of a control that declares no URL or another one, and a timer
    // armed before any input that calls openExternal while a click's activation lasts
    // (Astra re-acceptance 2026-10-10, first click on a plain button), open nothing.
    // The controls and the timer are installed without a user gesture (Playwright's
    // evaluate carries one, which would arm the timer before any click).
    const setup = local => {
      const box = document.createElement('div');
      box.style.cssText = 'position:fixed;inset:0;z-index:2147483647;display:flex;flex-direction:column;align-items:flex-start;background:#fff';
      const add = (id, href, target) => { const a = document.createElement('a'); a.id = id; a.href = href; a.textContent = id; if (target) a.target = target; box.append(a); return a; };
      add('clicked', 'https://links.example/clicked');
      add('clicked-new-tab', 'https://links.example/clicked-new-tab', '_blank');
      add('clicked-local', `${local}/clicked`);
      add('clicked-mail', 'mailto:someone@example.com');
      add('handled', 'https://links.example/handled').addEventListener('click', event => event.preventDefault());
      const addButton = (id, declared, opens) => {
        const button = document.createElement('button'); button.id = id; button.textContent = id;
        if (declared) button.dataset.externalUrl = declared;
        button.addEventListener('click', () => window.electronAPI.openExternal(opens));
        box.append(button);
      };
      addButton('api', 'https://links.example/api-clicked', 'https://links.example/api-clicked');
      addButton('api-other-url', 'https://links.example/declared', 'https://links.example/not-declared');
      addButton('api-undeclared', null, 'https://links.example/undeclared');
      const plain = document.createElement('button'); plain.id = 'plain'; plain.textContent = 'plain'; box.append(plain);
      document.body.append(box);
      window.timerAttempts = 0;
      const timer = setInterval(() => {
        if (!navigator.userActivation.isActive) return;
        window.electronAPI.openExternal('https://links.example/timer-after-click');
        window.electronAPI.openExternal('https://links.example/api-clicked');
        if (++window.timerAttempts === 20) clearInterval(timer);
      }, 25);
      return navigator.userActivation.isActive;
    };
    const activeAtSetup = await app.evaluate(({ BrowserWindow }, source) => BrowserWindow.getAllWindows()
      .find(win => win.webContents.getURL().includes('window=launcher')).webContents.executeJavaScript(source, false),
    `(${setup})(${JSON.stringify(local)})`);
    assert.equal(activeAtSetup, false, 'the timer was armed without user activation');
    await page.waitForTimeout(200);
    assert.deepEqual(externalOpens(), [], 'nothing opens before the first click');
    for (const id of ['plain', 'clicked', 'clicked-new-tab', 'clicked-local', 'clicked-mail', 'handled', 'api', 'api-other-url', 'api-undeclared']) await page.click(`#${id}`);
    await page.waitForFunction(() => window.timerAttempts === 20, null, { timeout: 5_000 });
    await page.waitForTimeout(500);
    assert.deepEqual(externalOpens(), clicked);

    // Automatic: script without user activation (the clicks' transient activation
    // has to expire first; Chromium keeps it for 5 s), synthetic (untrusted) clicks
    // and a location change. None may open the browser.
    await page.waitForFunction(() => !navigator.userActivation.isActive, null, { timeout: 15_000 });
    const activated = await page.evaluate(({ local }) => {
      const follow = (href, target) => { const a = document.createElement('a'); a.href = href; if (target) a.target = target; document.body.append(a); a.click(); a.remove(); };
      window.open('https://links.example/opened');
      window.open(`${local}/window-open`);
      window.open('file:///etc/hosts');
      follow('https://links.example/followed');
      follow('https://links.example/new-tab', '_blank');
      follow(`${local}/followed`);
      follow('mailto:someone@example.com');
      window.electronAPI.openExternal('https://links.example/api-without-click');
      window.location.href = `${local}/assigned`;
      return navigator.userActivation.isActive;
    }, { local });
    assert.equal(activated, false, 'the automatic attempts ran without user activation');
    await page.waitForTimeout(1000);

    assert.equal(page.url(), startUrl, 'the app page was not replaced');
    assert.equal(await page.evaluate(() => typeof window.electronAPI), 'object');
    assert.equal(await windowCount(), before, 'no child window was created');
    assert.equal(requests, 1, 'no refused navigation or window reached the loopback page');
    assert.deepEqual(externalOpens(), clicked, 'automatic navigation and window.open do not open the browser');
  } finally {
    if (app) await app.close();
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  }
  const outbound = readBlocked(sandbox).filter(record => !['permission', 'device', 'local-exec', 'external-open'].includes(record.kind));
  assert.deepEqual(outbound, [], 'followed links are counted apart from automatic requests, and nothing else left the machine');
});
