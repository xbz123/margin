import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import { once } from 'node:events';
import { build } from 'esbuild';
import ts from 'typescript';
import vm from 'node:vm';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { launchApp, windowWithQuery } from './launch-app.mjs';
import { makeSandbox, readBlocked, REPO } from '../../scripts/margin/isolation/env.mjs';

test('AG60a mounted Skills settings switch language without resetting controls or calling extra IPC', async () => {
  const bundle = await build({ stdin: { resolveDir: REPO, loader: 'tsx', contents: `
    import React from 'react'; import { createRoot } from 'react-dom/client';
    import { SkillsSettings } from './src/components/settings/SkillsSettings';
    import { setUiLanguage } from './src/i18n';
    window.changeLanguage = setUiLanguage;
    window.refreshes = 0; window.folderOpens = 0;
    window.electronAPI = {
      getPromptSettings: async () => ({ ok: true, settings: { skills: [], scenes: { interview: { skillId: null, additional: '' }, written: { skillId: null, additional: '' } } } }),
      skillsRefresh: async () => { window.refreshes++; return []; },
      skillsOpenFolder: async () => { window.folderOpens++; return { success: true, path: '/synthetic/skills' }; }
    };
    createRoot(document.getElementById('root')).render(React.createElement(SkillsSettings));
  ` }, bundle: true, write: false, platform: 'browser', format: 'iife', define: { 'process.env.NODE_ENV': '"production"' } });
  const sandbox = makeSandbox('ag60a-settings');
  let app;
  try {
    ({ app } = await launchApp(sandbox, { NODE_ENV: 'production' }));
    await windowWithQuery(app, 'window=launcher', 30_000);
    const opened = app.waitForEvent('window');
    await app.evaluate(async ({ BrowserWindow }) => {
      const window = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
      await window.loadURL('data:text/html,<div id="root"></div>');
    });
    const page = await opened;
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.getByRole('heading', { name: 'Skills', exact: true }).waitFor();
    await page.waitForFunction(() => window.refreshes === 1);
    await page.getByRole('button', { name: 'Open Folder', exact: true }).click();
    await page.getByText('/synthetic/skills', { exact: true }).waitFor();
    await page.evaluate(() => window.changeLanguage('zh-CN'));
    await page.getByRole('heading', { name: '技能', exact: true }).waitFor();
    await page.getByRole('heading', { name: '技能文件夹', exact: true }).waitFor();
    assert.equal(await page.getByText('/synthetic/skills', { exact: true }).count(), 1);
    assert.equal(await page.evaluate(() => window.refreshes), 1);
    await page.getByRole('button', { name: '刷新', exact: true }).click();
    await page.waitForFunction(() => window.refreshes === 2);
    await page.getByRole('button', { name: '打开文件夹', exact: true }).click();
    assert.equal(await page.evaluate(() => window.folderOpens), 2);
    await page.evaluate(() => window.changeLanguage('en'));
    await page.getByRole('heading', { name: 'Skills', exact: true }).waitFor();
    assert.equal(await page.getByText('/synthetic/skills', { exact: true }).count(), 1);
    assert.equal(await page.evaluate(() => window.refreshes), 2);
    await page.close();
  } finally {
    if (app) await app.close();
  }
  assert.deepEqual(readBlocked(sandbox).filter(record => !['permission', 'device', 'local-exec'].includes(record.kind)), []);
});

test('AG34 actual Settings React + preload + IPC fence consent saves, local checks and failed withdrawal', async () => {
  const require = createRequire(import.meta.url), compile = source => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText;
  const shared = { exports: {} }; vm.runInNewContext(compile(fs.readFileSync(`${REPO}/src/types/codexSource.ts`, 'utf8')), { module: shared, exports: shared.exports });
  const files = new Map([['/synthetic/settings.json', JSON.stringify({ codexCliEnabled: true })]]), fault = { active: false };
  const boot = () => {
    const module = { exports: {} };
    vm.runInNewContext(compile(fs.readFileSync(`${REPO}/electron/services/SettingsManager.ts`, 'utf8')), { module, exports: module.exports, console: { log() {}, error() {}, warn() {} },
      require(id) {
        if (id === 'electron') return { app: { isReady: () => true, getPath: () => '/synthetic' } };
        if (id === '../../src/types/codexSource') return shared.exports;
        if (id === 'fs') return { existsSync: p => files.has(p), readFileSync: p => files.get(p),
          writeFileSync(p, value) { if (fault.active) throw Error('synthetic save failure'); files.set(p, value); }, renameSync(a, b) { files.set(b, files.get(a)); files.delete(a); }, unlinkSync: p => files.delete(p) };
        return require(id);
      } });
    return module.exports.SettingsManager.getInstance();
  };
  const manager = boot(), electronId = require.resolve('electron'), previous = require.cache[electronId];
  require.cache[electronId] = { id: electronId, filename: electronId, loaded: true, exports: { app: { getPath: () => os.tmpdir(), isPackaged: true, getVersion: () => 'synthetic' } } };
  let LLMHelper;
  try { ({ LLMHelper } = require(`${REPO}/dist-electron/electron/LLMHelper.js`)); }
  finally { if (previous) require.cache[electronId] = previous; else delete require.cache[electronId]; }
  const { CodexAuthSource } = require(`${REPO}/dist-electron/electron/services/CodexAuthSource.js`);
  let reads = 0, sends = 0;
  const helper = Object.assign(Object.create(LLMHelper.prototype), { currentModelId: 'gemini-3.1-flash-lite-preview', activeGenerationTasks: new Set(), getProviderScopePolicy: () => ({}) });
  helper.setCodexCliConfig(manager.getCodexSourceConfig());
  helper.codexAuthSource = new CodexAuthSource(async () => { reads++; return JSON.stringify({ tokens: { account_id: 'synthetic-account', access_token: `e30.${Buffer.from(JSON.stringify({ exp: 4_000_000_000 })).toString('base64url')}.synthetic` } }); }, async () => { sends++; throw Error('Unexpected real-service request'); });
  const arrow = (file, predicate, context) => {
    const source = fs.readFileSync(`${REPO}/${file}`, 'utf8'), ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true); let found;
    const visit = node => { if (!found && ts.isArrowFunction(node) && predicate(node)) found = node.getText(ast); ts.forEachChild(node, visit); }; visit(ast); assert.ok(found);
    const module = { exports: {} }; vm.runInNewContext(compile(`module.exports = (${found});`), { module, exports: module.exports, ...context }); return module.exports;
  };
  const handlers = {};
  for (const channel of ['get-codex-cli-config', 'set-codex-cli-config', 'test-codex-cli']) handlers[channel] = arrow('electron/ipcHandlers.ts', node => ts.isCallExpression(node.parent) && node.parent.expression.getText() === 'safeHandle' && node.parent.arguments[0]?.text === channel,
    { DEFAULT_CODEX_SOURCE_CONFIG: shared.exports.DEFAULT_CODEX_SOURCE_CONFIG, SettingsManager: { getInstance: () => manager }, appState: { processingHelper: { getLLMHelper: () => helper }, sendModelChanged() {} } });
  const bridge = {};
  for (const name of ['getCodexCliConfig', 'setCodexCliConfig', 'testCodexCli']) bridge[name] = arrow('electron/preload.ts', node => ts.isPropertyAssignment(node.parent) && node.parent.name.getText() === name,
    { ipcRenderer: { invoke: (channel, ...args) => handlers[channel]({}, ...args) } });
  assert.equal((await bridge.getCodexCliConfig()).enabled, false); assert.equal(reads, 0);
  const bundle = await build({ stdin: { resolveDir: REPO, loader: 'tsx', contents: `
    import React from 'react'; import { createRoot } from 'react-dom/client'; import { flushSync } from 'react-dom';
    import { AIProvidersSettings as Settings } from './src/components/settings/AIProvidersSettings'; import { DEFAULT_GENERATION_POLICY } from './src/types/generationPolicy';
    window.electronAPI = { getGenerationPolicy: async () => DEFAULT_GENERATION_POLICY, getStoredCredentials: async () => ({}),
      getGroqFastTextMode: async () => ({ enabled: false }), getDefaultModel: async () => ({ model: 'gemini-3.1-flash-lite-preview' }), getProviderDataScopes: async () => ({}),
      getCodexCliConfig: () => window.invokeCodex('getCodexCliConfig', []), setCodexCliConfig: config => window.invokeCodex('setCodexCliConfig', [config]), testCodexCli: () => window.invokeCodex('testCodexCli', []) };
    const root = createRoot(document.getElementById('root')); window.show = () => flushSync(() => root.render(React.createElement(Settings)));
  ` }, bundle: true, write: false, platform: 'browser', format: 'iife', loader: { '.svg': 'dataurl', '.png': 'dataurl', '.css': 'empty' }, define: { 'process.env.NODE_ENV': '"production"' } });
  const sandbox = makeSandbox('ag34-consent-components'); let app;
  try {
    ({ app } = await launchApp(sandbox, { NODE_ENV: 'production' })); await windowWithQuery(app, 'window=launcher', 30_000);
    const created = app.waitForEvent('window'); await app.evaluate(async ({ BrowserWindow }) => { const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } }); await win.loadURL('data:text/html,<div id="root"></div>'); });
    const page = await created; await page.exposeFunction('invokeCodex', (name, args) => bridge[name](...args)); await page.addScriptTag({ content: bundle.outputFiles[0].text }); await page.evaluate(() => window.show());
    const enable = page.getByRole('button', { name: 'Enable Codex login source', exact: true }), risk = page.getByRole('checkbox', { name: 'Accept Codex login-source risks', exact: true });
    await page.waitForFunction(() => document.body.innerText.includes('Codex login source (file only)')); assert.equal(await enable.isDisabled(), true); assert.equal(reads, 0); assert.equal(sends, 0);
    assert.match(await page.locator('body').innerText(), /consent is not provider authorization|Your consent is not provider authorization/);
    await risk.check(); fault.active = true; await enable.click(); await page.waitForFunction(() => document.body.innerText.includes('Unable to save Codex configuration'));
    assert.equal(helper.getCodexCliConfig().enabled, false); assert.equal(boot().getCodexSourceConfig().enabled, false); assert.equal(reads, 0);
    fault.active = false; await risk.check(); await enable.click(); await page.waitForFunction(() => document.body.innerText.includes('Current version is saved'));
    assert.equal(boot().getCodexSourceConfig().enabled, true); assert.equal(reads, 0);
    await page.getByRole('button', { name: 'Check saved local login file', exact: true }).click(); await page.waitForFunction(() => document.body.innerText.includes('Local file checks passed'));
    assert.equal(reads, 1); assert.equal(sends, 0);
    helper.setModel('codex-cli'); const task = helper.beginGenerationTask('written'); fault.active = true;
    await risk.uncheck(); await page.waitForFunction(() => document.body.innerText.includes('restart persistence is unconfirmed'));
    assert.equal(task.signal.aborted, true); task.close(); assert.equal(helper.getCodexCliConfig().enabled, false); assert.equal(manager.getCodexSourceConfig().enabled, false);
    assert.equal((await bridge.testCodexCli({ enabled: true, acceptRisk: true })).status, 'disabled'); assert.equal(reads, 1); assert.equal(sends, 0);
    // Failed persistence is explicitly not claimed to survive restart; retry closes disk too.
    assert.equal(boot().getCodexSourceConfig().enabled, true); fault.active = false;
    await page.getByRole('button', { name: 'Retry saving source settings', exact: true }).click(); await page.waitForFunction(() => !document.body.innerText.includes('Unable to save Codex configuration'));
    assert.equal(boot().getCodexSourceConfig().enabled, false); assert.equal(reads, 1); assert.equal(sends, 0); await page.close();
  } finally { if (app) await app.close(); }
  assert.deepEqual(readBlocked(sandbox).filter(record => !['permission', 'device', 'local-exec'].includes(record.kind)), []);
});

test('AG34 native launcher preload and IPC gate synthetic local auth and cancel delayed file reads', async () => {
  const sandbox = makeSandbox('ag34-native-ipc'), authFile = path.join(sandbox.home, '.codex', 'auth.json');
  fs.mkdirSync(path.dirname(authFile), { recursive: true });
  fs.writeFileSync(authFile, JSON.stringify({ tokens: { account_id: 'synthetic-account', access_token: `e30.${Buffer.from(JSON.stringify({ exp: 4_000_000_000 })).toString('base64url')}.synthetic` } }), { mode: 0o600 });
  let app;
  try {
    ({ app } = await launchApp(sandbox, { NODE_ENV: 'production' }));
    const page = await windowWithQuery(app, 'window=launcher', 30_000);
    await page.waitForFunction(() => Boolean(window.electronAPI?.getCodexCliConfig));
    await app.evaluate((_electron, filename) => {
      const fs = process.getBuiltinModule('fs'), original = fs.promises.open;
      const probe = { opens: 0, bytes: 0, closes: 0, delayed: false, started: false, release: undefined };
      fs.promises.open = async function (...args) {
        if (String(args[0]) !== filename) return original.apply(this, args);
        probe.opens++;
        if (probe.delayed) { probe.started = true; await new Promise(resolve => { probe.release = resolve; }); }
        const file = await original.apply(this, args), read = file.read.bind(file), close = file.close.bind(file);
        file.read = async (...values) => { const result = await read(...values); probe.bytes += result.bytesRead; return result; };
        file.close = async () => { probe.closes++; return close(); };
        return file;
      };
      globalThis.__ag34AuthProbe = { probe, restore: () => { fs.promises.open = original; } };
    }, authFile);
    const counts = () => app.evaluate(() => { const { opens, bytes, closes, started } = globalThis.__ag34AuthProbe.probe; return { opens, bytes, closes, started }; });
    assert.equal((await page.evaluate(() => window.electronAPI.getCodexCliConfig())).enabled, false);
    assert.equal((await page.evaluate(() => window.electronAPI.testCodexCli())).status, 'disabled');
    assert.equal((await counts()).opens, 0);
    assert.equal((await page.evaluate(() => window.electronAPI.setCodexCliConfig({ enabled: true }))).success, false);
    assert.equal((await counts()).opens, 0);
    const enabled = await page.evaluate(() => window.electronAPI.setCodexCliConfig({ enabled: true, acceptRisk: true }));
    assert.equal(enabled.success, true); assert.equal(enabled.config.riskConfirmedVersion, 1);
    assert.equal((await counts()).opens, 0);
    const status = await page.evaluate(() => window.electronAPI.testCodexCli());
    assert.equal(status.status, 'locally-valid'); assert.match(status.message, /unverified/);
    const baseline = await counts(); assert.equal(baseline.opens, 1); assert.ok(baseline.bytes > 0); assert.equal(baseline.closes, 1);
    assert.equal((await page.evaluate(() => window.electronAPI.setModel('codex-cli'))).success, true);
    await app.evaluate(() => { globalThis.__ag34AuthProbe.probe.delayed = true; });
    await page.evaluate(() => {
      window.ag34Errors = [];
      window.ag34Unsubscribe = window.electronAPI.onGeminiStreamError((error, metadata) => window.ag34Errors.push({ error, metadata }));
      window.ag34Pending = window.electronAPI.streamGeminiChat('Synthetic cancellation control', undefined, undefined, { generationKind: 'written', ignoreKnowledgeMode: true })
        .then(() => { window.ag34Finished = true; }, () => { window.ag34Finished = true; });
    });
    const deadline = Date.now() + 10_000;
    while (!(await counts()).started && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 25));
    assert.equal((await counts()).started, true, 'native generation must reach the exact synthetic auth file');
    assert.equal((await page.evaluate(() => window.electronAPI.setCodexCliConfig({ enabled: false }))).success, true);
    await page.waitForFunction(() => window.ag34Finished && window.ag34Errors.length === 1);
    const metadata = await page.evaluate(() => window.ag34Errors[0].metadata);
    assert.equal(metadata.status, 'cancelled'); assert.equal(metadata.attempts, 0);
    await app.evaluate(() => { globalThis.__ag34AuthProbe.probe.release(); });
    const closeDeadline = Date.now() + 10_000;
    while ((await counts()).closes !== 2 && Date.now() < closeDeadline) await new Promise(resolve => setTimeout(resolve, 25));
    const after = await counts(); assert.equal(after.opens, 2); assert.equal(after.closes, 2); assert.equal(after.bytes, baseline.bytes);
    assert.equal((await page.evaluate(() => window.electronAPI.getCodexCliConfig())).enabled, false);
    assert.equal((await page.evaluate(() => window.electronAPI.testCodexCli())).status, 'disabled');
    assert.equal((await counts()).opens, 2);
    assert.equal((await page.evaluate(() => window.electronAPI.setCodexCliConfig({ enabled: true, acceptRisk: true }))).success, true);
    await app.evaluate(() => { const probe = globalThis.__ag34AuthProbe.probe; probe.started = false; probe.release = undefined; });
    await page.evaluate(() => { window.ag34LocalCheck = window.electronAPI.testCodexCli().then(result => { window.ag34LocalResult = result; }); });
    const statusDeadline = Date.now() + 10_000;
    while (!(await counts()).started && Date.now() < statusDeadline) await new Promise(resolve => setTimeout(resolve, 25));
    assert.equal((await counts()).started, true, 'local status must reach the same exact synthetic auth file');
    assert.equal((await page.evaluate(() => window.electronAPI.setCodexCliConfig({ enabled: false }))).success, true);
    await app.evaluate(() => { globalThis.__ag34AuthProbe.probe.release(); });
    await page.waitForFunction(() => Boolean(window.ag34LocalResult));
    assert.equal((await page.evaluate(() => window.ag34LocalResult)).status, 'disabled');
    const statusAfter = await counts(); assert.equal(statusAfter.opens, 3); assert.equal(statusAfter.closes, 3); assert.equal(statusAfter.bytes, baseline.bytes);
    await page.evaluate(() => window.ag34Unsubscribe());
  } finally {
    if (app) { await app.evaluate(() => { globalThis.__ag34AuthProbe?.probe.release?.(); globalThis.__ag34AuthProbe?.restore(); }).catch(() => {}); await app.close(); }
  }
  assert.deepEqual(readBlocked(sandbox).filter(record => !['permission', 'device', 'local-exec'].includes(record.kind)), []);
});

test('AG33 real Global React overlay preserves partial failure, fences closed callbacks and creates a new retry record', async () => {
  const bundle = await build({ stdin: { resolveDir: REPO, loader: 'tsx', contents: `
    import React from 'react'; import { createRoot } from 'react-dom/client'; import { flushSync } from 'react-dom';
    import Global from './src/components/GlobalChatOverlay';
    const root = createRoot(document.getElementById('root')); const listeners = []; const calls = [];
    window.calls = calls; window.listeners = listeners;
    const subscribe = kind => (callback, owner) => { const item = { kind, callback, owner, live: true }; listeners.push(item); return () => item.live = false; };
    window.electronAPI = { onGeminiStreamToken: subscribe('token'), onGeminiStreamDone: subscribe('done'), onGeminiStreamError: subscribe('error'),
      cancelChatStream(owner) { for (const item of listeners.filter(item => item.live && item.owner === owner && item.kind === 'error')) item.callback('Generation cancelled', { requestId: 'cancelled', provider: 'synthetic', model: 'opaque', status: 'cancelled', partial: true, attempts: 1 }); },
      streamGeminiChat(question, images, context, options) { return new Promise((resolve, reject) => calls.push({ question, options, resolve, reject })); } };
    window.show = (kind, query = '', isOpen = true) => flushSync(() => root.render(React.createElement(Global,
      { key: kind, isOpen, initialQuery: query, onClose: () => {} })));
    window.emit = (kind, value, metadata, force = false) => { for (const item of [...listeners].filter(item => item.kind === kind && (force || item.live))) item.callback(value, metadata); };
  ` }, bundle: true, write: false, platform: 'browser', format: 'iife', loader: { '.svg': 'dataurl', '.png': 'dataurl', '.css': 'empty' }, define: { 'process.env.NODE_ENV': '"production"' } });
  const sandbox = makeSandbox('ag33-components'); let app;
  try {
    ({ app } = await launchApp(sandbox, { NODE_ENV: 'production' }));
    await windowWithQuery(app, 'window=launcher', 30_000);
    // The meeting chat overlay was removed in AG-52 (PLAN S33); only the global one is left.
    for (const owner of ['global']) {
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

test('all seven Markdown callers and streaming sanitize block image loads in a real renderer', async () => {
  let callers = 0;
  for (const name of ['NativelyInterface', 'MeetingDetails']) {
    const source = fs.readFileSync(`${REPO}/src/components/${name}.tsx`, 'utf8');
    assert.match(source, /import ReactMarkdown from '\.\/SafeMarkdown'/);
    const ast = ts.createSourceFile(`${name}.tsx`, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    function visit(node) { if (ts.isJsxOpeningElement(node) && node.tagName.getText(ast) === 'ReactMarkdown') callers++; ts.forEachChild(node, visit); }
    visit(ast);
  }
  assert.equal(callers, 7);
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
