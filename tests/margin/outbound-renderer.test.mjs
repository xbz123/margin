import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import { once } from 'node:events';
import { build } from 'esbuild';
import ts from 'typescript';
import { launchApp, windowWithQuery } from './launch-app.mjs';
import { makeSandbox, readBlocked, REPO } from '../../scripts/margin/isolation/env.mjs';

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
