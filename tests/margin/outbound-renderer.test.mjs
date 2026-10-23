import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import { EventEmitter, once } from 'node:events';
import { build } from 'esbuild';
import ts from 'typescript';
import vm from 'node:vm';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { launchApp, windowWithQuery } from './launch-app.mjs';
import { makeSandbox, readBlocked, REPO } from '../../scripts/margin/isolation/env.mjs';

test('AG62 mounted Launcher checks local setup, refreshes on return and cleans up stale reads without outbound actions', async () => {
  const bundle = await build({ stdin: { resolveDir: REPO, loader: 'tsx', contents: `
    import React from 'react'; import { createRoot } from 'react-dom/client';
    import Launcher from './src/components/Launcher'; import { setUiLanguage } from './src/i18n';
    const listeners = new Map(); const subscribe = (name, fn) => { const set = listeners.get(name) || new Set(); set.add(fn); listeners.set(name, set); return () => set.delete(fn); };
    window.listenerCount = name => listeners.get(name)?.size || 0;
    window.emit = (name, value) => { for (const fn of listeners.get(name) || []) fn(value); };
    const focusListeners = new Set(), add = window.addEventListener.bind(window), remove = window.removeEventListener.bind(window);
    window.addEventListener = (name, fn, ...rest) => { if (name === 'focus') focusListeners.add(fn); add(name, fn, ...rest); };
    window.removeEventListener = (name, fn, ...rest) => { if (name === 'focus') focusListeners.delete(fn); remove(name, fn, ...rest); };
    window.focusListenerCount = () => focusListeners.size;
    window.selection = { provider: 'openai', model: 'synthetic' };
    window.credentials = { providerConfigurations: { openai: { provider: 'openai', protocol: 'chat-completions', model: 'synthetic' } }, hasOpenaiKey: false, hasClaudeKey: true, sttProvider: 'none', hasSonioxKey: false };
    window.permissions = { platform: 'darwin', microphone: 'denied', screen: 'not-determined' };
    window.codex = { enabled: false, model: 'synthetic', riskConfirmedVersion: 1 };
    window.reads = []; window.forbidden = []; window.pending = []; window.tabs = []; window.permissionReviews = 0;
    const forbid = name => { window.forbidden.push(name); throw Error('Forbidden setup action: ' + name); };
    window.fetch = () => forbid('fetch'); window.WebSocket = function() { forbid('WebSocket'); }; window.EventSource = function() { forbid('EventSource'); };
    const api = {
      getCurrentLlmConfig: async () => { window.reads.push('selection'); return { ...window.selection }; },
      getStoredCredentials: () => { window.reads.push('credentials'); if (window.deferCredentials) return new Promise(resolve => window.pending.push(resolve)); if (window.failCredentials) return Promise.reject(Error('synthetic read failure')); return Promise.resolve(structuredClone(window.credentials)); },
      checkPermissions: async () => { window.reads.push('permissions'); return { ...window.permissions }; },
      getDomesticStt: async provider => { window.reads.push('domestic:' + provider); return { hasKey: true, workspaceId: '', resourceId: 'volc.seedasr.sauc.concurrent' }; },
      getCodexCliConfig: async () => { window.reads.push('codex'); return { ...window.codex }; },
      getWindowPreferences: async () => [], getKeybindStatus: async () => ({ success: true, keybinds: [], failedActions: [] }),
      getRecentMeetings: async () => [], getMeetingActive: async () => false, seedDemo: async () => ({ success: true })
    };
    window.electronAPI = new Proxy(api, { get(target, name) {
      if (name in target) return target[name];
      if (String(name).startsWith('on')) return fn => subscribe(name, fn);
      if (/^(test|fetch|request|start|capture)/i.test(String(name))) return () => forbid(String(name));
      return async () => undefined;
    } });
    const root = createRoot(document.getElementById('root')); let settingsOpen = false;
    const mount = () => root.render(React.createElement(Launcher, {
      settingsOpen, onStartMeeting() { forbid('startMeeting'); },
      onOpenSettings(tab) { window.tabs.push(tab); settingsOpen = true; mount(); },
      onReviewPermissions() { window.permissionReviews++; }
    }));
    window.returnFromSettings = () => { settingsOpen = false; mount(); };
    window.changeLanguage = setUiLanguage; window.unmountConsumer = () => root.unmount(); mount();
  ` }, bundle: true, write: false, loader: { '.png': 'dataurl', '.jpg': 'dataurl', '.svg': 'dataurl', '.css': 'empty' }, platform: 'browser', format: 'iife', define: { 'process.env.NODE_ENV': '"production"', 'import.meta.env': '{}', __MARGIN_APP_NAME__: '"temp"' } });
  const sandbox = makeSandbox('ag62-setup'); let app;
  try {
    ({ app } = await launchApp(sandbox, { NODE_ENV: 'production' }));
    await windowWithQuery(app, 'window=launcher', 30_000);
    const opened = app.waitForEvent('window');
    await app.evaluate(async ({ BrowserWindow }) => { const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } }); await win.loadURL('data:text/html,<div id="root"></div>'); });
    const page = await opened, pageErrors = []; page.on('pageerror', error => pageErrors.push(error.message));
    await page.evaluate(() => {
      const storage = new Map();
      Object.defineProperty(window, 'localStorage', { value: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, String(value)), removeItem: key => storage.delete(key) } });
    });
    const assets = path.join(REPO, 'dist/assets');
    for (const css of fs.readdirSync(assets).filter(name => name.endsWith('.css'))) await page.addStyleTag({ path: path.join(assets, css) });
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    const status = (label, text) => page.getByRole('status', { name: label, exact: true }).filter({ hasText: text }).waitFor();
    const localReads = () => page.evaluate(() => window.reads.filter(name => name === 'selection').length);
    const cleaned = () => page.waitForFunction(() => ['onCredentialsChanged', 'onModelChanged', 'onSttConfigChanged'].every(name => window.listenerCount(name) === 0) && window.focusListenerCount() === 0);
    await status('Answer source and model', 'Needs configuration'); await status('Speech provider', 'Needs configuration');
    await status('System permissions', 'Needs configuration');
    assert.equal(await page.getByRole('button', { name: /Start temp$/ }).isDisabled(), false);
    await page.getByRole('button', { name: 'Review Answer source and model', exact: true }).click(); await cleaned();
    assert.deepEqual(await page.evaluate(() => window.tabs), ['ai-providers']);
    await page.evaluate(() => { window.credentials.hasOpenaiKey = true; window.returnFromSettings(); });
    await status('Answer source and model', 'Configured (not connection-tested)');
    await page.getByRole('button', { name: 'Review Speech provider', exact: true }).click(); await cleaned();
    assert.deepEqual(await page.evaluate(() => window.tabs), ['ai-providers', 'audio']);
    await page.evaluate(() => { window.credentials.sttProvider = 'soniox'; window.credentials.hasSonioxKey = true; window.permissions.microphone = 'granted'; window.permissions.screen = 'granted'; window.returnFromSettings(); });
    await status('Speech provider', 'Configured (not connection-tested)'); await status('System permissions', 'OS reports permissions allowed');
    await page.getByRole('button', { name: 'Review System permissions', exact: true }).click();
    assert.equal(await page.evaluate(() => window.permissionReviews), 1);
    const beforeLanguage = await localReads();
    await page.evaluate(() => window.changeLanguage('zh-CN'));
    await status('回答来源与模型', '已配置（未测试连接）'); await status('语音服务商', '已配置（未测试连接）');
    assert.equal(await localReads(), beforeLanguage);
    await page.getByRole('button', { name: '暂时隐藏', exact: true }).click();
    await page.evaluate(() => window.changeLanguage('en'));
    await page.getByRole('button', { name: 'Show setup checklist', exact: true }).waitFor();
    assert.equal(await localReads(), beforeLanguage);
    await page.getByRole('button', { name: 'Show setup checklist', exact: true }).click(); await status('Answer source and model', 'Configured');
    // Read failure clears the previously configured result; focus uses only local metadata.
    await page.evaluate(() => { window.failCredentials = true; window.dispatchEvent(new Event('focus')); });
    await status('Answer source and model', 'Needs checking'); await status('Speech provider', 'Needs checking');
    await page.evaluate(() => { window.failCredentials = false; window.credentials.hasOpenaiKey = false; window.emit('onCredentialsChanged'); });
    await status('Answer source and model', 'Needs configuration');
    // Codex consent is a local configuration check, not a login or connection probe.
    await page.evaluate(() => { window.selection = { provider: 'codex-cli', model: 'codex-cli' }; window.codex = { enabled: true, model: 'synthetic' }; window.emit('onModelChanged', 'codex-cli'); });
    await status('Answer source and model', 'Needs configuration');
    await page.evaluate(() => { window.codex.riskConfirmedVersion = 1; window.emit('onModelChanged', 'codex-cli'); });
    await status('Answer source and model', 'Configured');
    await page.evaluate(() => { window.credentials.sttProvider = 'aliyun'; window.emit('onSttConfigChanged', { provider: 'aliyun', configured: true }); });
    await status('Speech provider', 'Configured');
    assert.equal(await page.evaluate(() => window.reads.includes('domestic:aliyun')), true);
    // A newer refresh wins even if an older local read resolves last.
    await page.evaluate(() => { window.selection = { provider: 'openai', model: 'synthetic' }; window.deferCredentials = true; window.emit('onCredentialsChanged'); });
    await page.waitForFunction(() => window.pending.length === 1);
    await page.getByRole('button', { name: 'Refresh local checks', exact: true }).click(); await page.waitForFunction(() => window.pending.length === 2);
    await page.evaluate(() => window.pending[1]({ ...window.credentials, hasOpenaiKey: false })); await status('Answer source and model', 'Needs configuration');
    await page.evaluate(() => window.pending[0]({ ...window.credentials, hasOpenaiKey: true }));
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await status('Answer source and model', 'Needs configuration');
    await page.evaluate(() => { window.pending = []; window.emit('onCredentialsChanged'); }); await page.waitForFunction(() => window.pending.length === 1);
    await page.evaluate(() => window.emit('onMeetingStateChanged', { isActive: true })); await cleaned();
    const beforeMeeting = await localReads();
    await page.evaluate(() => { window.pending[0]({ ...window.credentials, hasOpenaiKey: true }); window.emit('onCredentialsChanged'); window.dispatchEvent(new Event('focus')); });
    assert.equal(await localReads(), beforeMeeting);
    assert.equal(await page.getByRole('region', { name: 'Setup checklist', exact: true }).count(), 0);
    await page.evaluate(() => { window.deferCredentials = false; window.emit('onMeetingStateChanged', { isActive: false }); });
    await status('Answer source and model', 'Needs configuration');
    await page.getByRole('button', { name: 'Optional: Local Context and Skills', exact: true }).click(); await cleaned();
    assert.equal(await page.evaluate(() => window.tabs.at(-1)), 'context');
    await page.evaluate(() => window.returnFromSettings()); await status('Answer source and model', 'Needs configuration');
    await page.getByRole('button', { name: 'Privacy and data scopes', exact: true }).click(); await cleaned();
    assert.equal(await page.evaluate(() => window.tabs.at(-1)), 'privacy');
    await page.evaluate(() => window.returnFromSettings()); await status('Answer source and model', 'Needs configuration');
    await page.evaluate(() => window.unmountConsumer()); await cleaned();
    const beforeUnmount = await localReads();
    await page.evaluate(() => { window.emit('onModelChanged'); window.dispatchEvent(new Event('focus')); });
    assert.equal(await localReads(), beforeUnmount);
    assert.deepEqual(await page.evaluate(() => window.forbidden), []); assert.deepEqual(pageErrors, []);
    await page.close();
  } finally { if (app) await app.close(); }
  assert.deepEqual(readBlocked(sandbox).filter(record => !['permission', 'device', 'local-exec'].includes(record.kind)), []);
});

test('AG62 mounted App cancels permission guidance on meeting start and ignores closed toaster replies', async () => {
  const bundle = await build({ stdin: { resolveDir: REPO, loader: 'tsx', contents: `
    import React from 'react'; import { createRoot } from 'react-dom/client';
    import App from './src/App'; import { PermissionsToaster } from './src/components/onboarding/PermissionsToaster';
    const listeners = new Map(); const subscribe = (name, fn) => { const set = listeners.get(name) || new Set(); set.add(fn); listeners.set(name, set); return () => set.delete(fn); };
    window.emitMeeting = isActive => { for (const fn of listeners.get('onMeetingStateChanged') || []) fn({ isActive }); };
    const timers = new Map(); let nextTimer = 1000000; const schedule = window.setTimeout.bind(window), cancel = window.clearTimeout.bind(window);
    window.setTimeout = (fn, ms, ...args) => { if (ms !== 1400) return schedule(fn, ms, ...args); const id = nextTimer++; timers.set(id, fn); return id; };
    window.clearTimeout = id => { if (timers.has(id)) timers.delete(id); else cancel(id); };
    window.permissionTimerCount = () => timers.size;
    window.runPermissionDelay = () => { const [id, fn] = timers.entries().next().value; timers.delete(id); void fn(); };
    window.permissionReplies = []; window.starts = 0; window.forbidden = [];
    const forbid = name => { window.forbidden.push(name); throw Error('Forbidden guidance action: ' + name); };
    const api = {
      getCurrentLlmConfig: async () => ({ provider: 'openai', model: 'synthetic' }), getStoredCredentials: async () => ({}),
      checkPermissions: () => window.deferPermissions ? new Promise(resolve => window.permissionReplies.push(resolve)) : Promise.resolve({ platform: 'darwin', microphone: 'denied', screen: 'denied' }),
      getCredentialLoadStatus: async () => ({ ok: true }), getThemeMode: async () => ({ mode: 'system' }),
      getInputDevices: async () => [], getOutputDevices: async () => [], getRecognitionLanguages: async () => ({}), getAiResponseLanguages: async () => [],
      getOpenAtLogin: async () => false, getMeetingRetention: async () => 'forever', getActionButtonMode: async () => 'recap', getDefaultModel: async () => ({ model: 'synthetic' }),
      getWindowPreferences: async () => [], getKeybindStatus: async () => ({ success: true, keybinds: [], failedActions: [] }),
      getRecentMeetings: async () => [], getMeetingActive: async () => false, seedDemo: async () => ({ success: true }),
      startMeeting: async () => { window.starts++; return { success: true }; }
    };
    window.electronAPI = new Proxy(api, { get(target, name) {
      if (name in target) return target[name]; if (String(name).startsWith('on')) return fn => subscribe(name, fn);
      if (/^(test|fetch|request|start|capture)/i.test(String(name))) return () => forbid(String(name));
      return async () => undefined;
    } });
    const root = createRoot(document.getElementById('root'));
    window.showToaster = isOpen => root.render(React.createElement(PermissionsToaster, { isOpen, onDismiss() { window.showToaster(false); } }));
    window.unmountConsumer = () => root.unmount(); root.render(React.createElement(App));
  ` }, bundle: true, write: false, loader: { '.png': 'dataurl', '.jpg': 'dataurl', '.svg': 'dataurl', '.webp': 'dataurl', '.webm': 'dataurl', '.otf': 'dataurl', '.woff2': 'dataurl', '.css': 'empty' }, platform: 'browser', format: 'iife', define: { 'process.env.NODE_ENV': '"production"', 'import.meta.env': '{}', __MARGIN_APP_NAME__: '"temp"' } });
  const sandbox = makeSandbox('ag62-permissions'); let app;
  try {
    ({ app } = await launchApp(sandbox, { NODE_ENV: 'production' }));
    await windowWithQuery(app, 'window=launcher', 30_000);
    const opened = app.waitForEvent('window');
    await app.evaluate(async ({ BrowserWindow }) => { const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } }); await win.loadURL('data:text/html,<div id="root"></div>'); });
    const page = await opened, errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.evaluate(() => {
      const storage = new Map([['natively_seen_startup_v1', 'true'], ['natively_perms_shown_v1', '1']]);
      Object.defineProperty(window, 'localStorage', { value: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, String(value)), removeItem: key => storage.delete(key) } });
    });
    const assets = path.join(REPO, 'dist/assets');
    for (const css of fs.readdirSync(assets).filter(name => name.endsWith('.css'))) await page.addStyleTag({ path: path.join(assets, css) });
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    const review = () => page.getByRole('button', { name: 'Review System permissions', exact: true });
    const absent = async () => { await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))); assert.equal(await page.getByRole('heading', { name: 'Before we start', exact: true }).count(), 0); };
    await review().waitFor();
    // Starting before the delay expires cancels the scheduled guidance.
    await review().click(); await page.waitForFunction(() => window.permissionTimerCount() === 1);
    await page.getByRole('button', { name: /Start temp$/ }).click();
    await page.waitForFunction(() => window.starts === 1 && window.permissionTimerCount() === 0); await absent();
    // An active-meeting broadcast also closes an already visible card.
    await review().click(); await page.waitForFunction(() => window.permissionTimerCount() === 1);
    await page.evaluate(() => window.runPermissionDelay()); await page.getByRole('heading', { name: 'Before we start', exact: true }).waitFor();
    await page.evaluate(() => window.emitMeeting(true)); await absent();
    // Once the delay has fired, a pending metadata reply cannot resurrect the card.
    await page.evaluate(() => window.emitMeeting(false)); await review().waitFor();
    await review().click(); await page.waitForFunction(() => window.permissionTimerCount() === 1);
    await page.evaluate(() => { window.deferPermissions = true; window.runPermissionDelay(); }); await page.waitForFunction(() => window.permissionReplies.length === 1);
    await page.getByRole('button', { name: /Start temp$/ }).click(); await page.waitForFunction(() => window.starts === 2);
    await page.evaluate(() => window.permissionReplies.shift()({ platform: 'darwin', microphone: 'granted', screen: 'granted' })); await absent();
    // Reopening while an old reply is pending keeps the new card's status authoritative.
    await page.evaluate(() => window.showToaster(true)); await page.waitForFunction(() => window.permissionTimerCount() === 1);
    await page.evaluate(() => window.runPermissionDelay()); await page.waitForFunction(() => window.permissionReplies.length === 1);
    await page.evaluate(() => window.showToaster(false)); await absent();
    await page.evaluate(() => window.showToaster(true)); await page.waitForFunction(() => window.permissionTimerCount() === 1);
    await page.evaluate(() => window.runPermissionDelay()); await page.waitForFunction(() => window.permissionReplies.length === 2);
    await page.evaluate(() => window.permissionReplies[1]({ platform: 'darwin', microphone: 'denied', screen: 'denied' }));
    await page.getByRole('heading', { name: 'Before we start', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Request Access', exact: true }).waitFor();
    await page.evaluate(() => window.permissionReplies[0]({ platform: 'darwin', microphone: 'granted', screen: 'granted' }));
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await page.getByRole('button', { name: 'Request Access', exact: true }).waitFor();
    assert.deepEqual(await page.evaluate(() => window.forbidden), []); assert.deepEqual(errors, []);
    await page.evaluate(() => window.unmountConsumer()); await page.close();
  } finally { if (app) await app.close(); }
  assert.deepEqual(readBlocked(sandbox).filter(record => !['permission', 'device', 'local-exec'].includes(record.kind)), []);
});

test('AG61 mounted production consumers reconcile save/apply failures and ignore stale IPC replies', async () => {
  const bundle = await build({ stdin: { resolveDir: REPO, loader: 'tsx', contents: `
    import React from 'react'; import { createRoot } from 'react-dom/client';
    import SettingsOverlay from './src/components/SettingsOverlay';
    import SettingsPopup from './src/components/SettingsPopup';
    import Launcher from './src/components/Launcher';
    import NativelyInterface from './src/components/NativelyInterface';
    import { setUiLanguage } from './src/i18n';
    const listeners = new Map(); const subscribe = (name, fn) => { const set = listeners.get(name) || new Set(); set.add(fn); listeners.set(name, set); return () => set.delete(fn); };
    const snapshot = { protection: { success: true, kind: 'protection', value: false, revision: 0 }, passthrough: { success: true, kind: 'passthrough', value: false, revision: 0 }, disguise: { success: true, kind: 'disguise', value: 'none', revision: 0 } };
    window.pendingRequests = []; window.language = setUiLanguage;
    window.emitPreference = result => { snapshot[result.kind] = result; for (const listener of listeners.get('onWindowPreferenceResult') || []) listener(result); };
    window.emitKeys = result => { for (const listener of listeners.get('onKeybindResult') || []) listener(result); };
    const pending = (kind, value) => new Promise((resolve, reject) => window.pendingRequests.push({ kind, value, resolve, reject }));
    const api = {
      getWindowPreferences: async () => Object.values(snapshot), onWindowPreferenceResult: fn => subscribe('onWindowPreferenceResult', fn),
      setUndetectable: value => pending('protection', value), setOverlayMousePassthrough: value => pending('passthrough', value), setDisguise: value => pending('disguise', value),
      getKeybindStatus: async () => ({ success: true, keybinds: [], failedActions: [] }), onKeybindResult: fn => subscribe('onKeybindResult', fn),
      getRecentMeetings: async () => [], getStoredCredentials: async () => ({}), getCredentialLoadStatus: async () => ({ ok: true }), getThemeMode: async () => ({ mode: 'system' }),
      getInputDevices: async () => [], getOutputDevices: async () => [], getRecognitionLanguages: async () => ({}), getAiResponseLanguages: async () => [],
      getOpenAtLogin: async () => false, getMeetingActive: async () => false, getMeetingRetention: async () => 'forever', getActionButtonMode: async () => 'recap',
      getDefaultModel: async () => ({ model: 'synthetic' }), resetKeybinds: () => pending('keybinds', null)
    };
    window.electronAPI = new Proxy(api, { get(target, name) { if (name in target) return target[name]; if (String(name).startsWith('on')) return fn => subscribe(name, fn); return async () => undefined; } });
    const root = createRoot(document.getElementById('root'));
    window.mountConsumer = (name, tab = 'general') => {
      const component = name === 'settings' ? React.createElement(SettingsOverlay, { isOpen: true, onClose() {}, initialTab: tab }) : name === 'popup' ? React.createElement(SettingsPopup) : name === 'launcher' ? React.createElement(Launcher, { onStartMeeting() {}, onOpenSettings() {} }) : React.createElement(NativelyInterface);
      root.render(React.createElement(React.Fragment, { key: name + tab }, component));
    };
    window.mountConsumer('settings', 'privacy');
  ` }, bundle: true, write: false, loader: { '.png': 'dataurl', '.jpg': 'dataurl', '.svg': 'dataurl', '.css': 'empty' }, platform: 'browser', format: 'iife', define: { 'process.env.NODE_ENV': '"production"', 'import.meta.env': '{}', __MARGIN_APP_NAME__: '"temp"' } });
  const sandbox = makeSandbox('ag61-consumers'); let app;
  const saveError = 'The window preference could not be saved.';
  const applyError = 'The window preference could not be fully applied. Retry the setting.';
  try {
    ({ app } = await launchApp(sandbox, { NODE_ENV: 'production' }));
    await windowWithQuery(app, 'window=launcher', 30_000);
    const opened = app.waitForEvent('window');
    await app.evaluate(async ({ BrowserWindow }) => { const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } }); await win.loadURL('data:text/html,<div id="root"></div>'); });
    const page = await opened; const pageErrors = []; page.on('pageerror', error => { pageErrors.push(error.message); console.error('[AG61 renderer]', error.message); });
    await page.evaluate(() => {
      const storage = new Map();
      Object.defineProperty(window, 'localStorage', { value: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, String(value)), removeItem: key => storage.delete(key) } });
    });
    const assets = path.join(REPO, 'dist/assets');
    for (const css of fs.readdirSync(assets).filter(name => name.endsWith('.css'))) await page.addStyleTag({ path: path.join(assets, css) });
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    const protection = () => page.getByRole('switch', { name: 'Window protection', exact: true });
    const checked = async (locator, value) => { await page.waitForFunction(({ label, value }) => document.querySelector('[role="switch"][aria-label="' + label + '"]')?.getAttribute('aria-checked') === String(value), { label: await locator.getAttribute('aria-label'), value }); };
    await protection().waitFor(); await checked(protection(), false);
    await protection().press('Space');
    await page.waitForFunction(() => window.pendingRequests.length === 1);
    await page.evaluate(error => window.pendingRequests.shift().resolve({ success: false, kind: 'protection', value: false, revision: 0, code: 'save_failed', error }), saveError);
    await checked(protection(), false); await page.getByRole('alert').filter({ hasText: saveError }).waitFor();
    await protection().click();
    await page.waitForFunction(() => window.pendingRequests.length === 1);
    await page.evaluate(error => { const result = { success: false, kind: 'protection', value: true, revision: 1, code: 'apply_failed', error }; window.emitPreference(result); window.pendingRequests.shift().resolve(result); }, applyError);
    await checked(protection(), true); await page.getByRole('alert').filter({ hasText: applyError }).waitFor();
    // Independent disguise remains selectable while protection is enabled.
    await page.evaluate(() => window.mountConsumer('settings', 'privacy'));
    await page.getByRole('button', { name: 'Terminal', exact: true }).click();
    await page.waitForFunction(() => window.pendingRequests.length === 1);
    assert.equal(await page.evaluate(() => window.pendingRequests[0].value), 'terminal');
    await page.evaluate(() => { const result = { success: true, kind: 'disguise', value: 'terminal', revision: 1 }; window.emitPreference(result); window.pendingRequests.shift().resolve(result); });
    // A second actual consumer receives the saved preference and later broadcast.
    await page.evaluate(() => window.mountConsumer('popup'));
    await protection().waitFor(); await checked(protection(), true);
    await page.getByRole('alert').filter({ hasText: applyError }).waitFor();
    await page.evaluate(() => window.emitPreference({ success: true, kind: 'protection', value: false, revision: 2 }));
    await checked(protection(), false);
    await page.evaluate(() => window.mountConsumer('launcher'));
    await protection().waitFor(); await checked(protection(), false);
    await protection().click(); await page.waitForFunction(() => window.pendingRequests.length === 1);
    await page.evaluate(() => { window.emitPreference({ success: true, kind: 'protection', value: true, revision: 4 }); window.pendingRequests.shift().resolve({ success: true, kind: 'protection', value: false, revision: 3 }); });
    await checked(protection(), true);
    // Consecutive transport failures restore the last authoritative, not optimistic, preference.
    await protection().click(); await protection().click();
    await page.waitForFunction(() => window.pendingRequests.length === 2);
    await page.evaluate(() => { window.pendingRequests.shift().resolve({ success: true, kind: 'protection', value: false, revision: 5 }); window.pendingRequests.shift().reject(Error('transport')); });
    await checked(protection(), true); await page.getByRole('alert').filter({ hasText: applyError }).waitFor();
    await page.evaluate(() => window.mountConsumer('overlay'));
    const passthrough = page.getByRole('switch', { name: 'Mouse passthrough', exact: true });
    await passthrough.waitFor(); await checked(passthrough, false);
    await passthrough.click(); await page.waitForFunction(() => window.pendingRequests.length === 1);
    await page.evaluate(error => { const result = { success: false, kind: 'passthrough', value: false, revision: 1, code: 'apply_failed', error }; window.emitPreference(result); window.pendingRequests.shift().resolve(result); }, applyError);
    await checked(passthrough, false); await page.getByRole('alert').filter({ hasText: applyError }).waitFor();
    await page.evaluate(() => window.emitKeys({ success: false, code: 'apply_failed', keybinds: [], failedActions: [{ id: 'general:take-screenshot', accelerator: 'Control+H' }, { id: 'window:move-up', accelerator: 'Control+Up' }], error: 'Some keyboard shortcuts could not be registered. Choose another shortcut or retry.' }));
    await page.getByRole('alert').filter({ hasText: 'general:take-screenshot' }).waitFor(); await page.getByRole('alert').filter({ hasText: 'window:move-up' }).waitFor();
    assert.deepEqual(pageErrors, []);
    await page.close();
  } finally { if (app) await app.close(); }
  assert.deepEqual(readBlocked(sandbox).filter(record => !['permission', 'device', 'local-exec'].includes(record.kind)), []);
});

test('AG60a mounted Skills settings switch language without resetting controls or calling extra IPC', async () => {
  const bundle = await build({ stdin: { resolveDir: REPO, loader: 'tsx', contents: `
    import React from 'react'; import { createRoot } from 'react-dom/client';
    import { PromptSettings } from './src/components/settings/PromptSettings';
    import { setUiLanguage } from './src/i18n';
    window.changeLanguage = setUiLanguage;
    window.refreshes = 0;
    window.electronAPI = {
      getPromptSettings: async () => { window.refreshes++; return { ok: true, settings: { skills: [], scenes: { interview: { skillId: null, additional: '' }, written: { skillId: null, additional: '' } } } }; }
    };
    createRoot(document.getElementById('root')).render(React.createElement(PromptSettings));
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
    await page.getByRole('heading', { name: 'Prompt Skills and additional instructions', exact: true }).waitFor();
    await page.waitForFunction(() => window.refreshes === 1);
    await page.getByRole('textbox').fill('UNSAVED DRAFT');
    await page.evaluate(() => window.changeLanguage('zh-CN'));
    await page.getByRole('heading', { name: '提示词 Skills 与附加指令', exact: true }).waitFor();
    assert.equal(await page.getByRole('textbox').inputValue(), 'UNSAVED DRAFT');
    assert.equal(await page.evaluate(() => window.refreshes), 1);
    await page.getByRole('button', { name: '重新加载提示词设置', exact: true }).click();
    await page.waitForFunction(() => window.refreshes === 2);
    await page.waitForFunction(() => document.querySelector('textarea')?.value === '');
    await page.getByRole('textbox').fill('SECOND DRAFT');
    await page.evaluate(() => window.changeLanguage('en'));
    await page.getByRole('heading', { name: 'Prompt Skills and additional instructions', exact: true }).waitFor();
    assert.equal(await page.getByRole('textbox').inputValue(), 'SECOND DRAFT');
    assert.equal(await page.evaluate(() => window.refreshes), 2);
    await page.close();
  } finally {
    if (app) await app.close();
  }
  assert.deepEqual(readBlocked(sandbox).filter(record => !['permission', 'device', 'local-exec'].includes(record.kind)), []);
});

test('AG60 real launcher, overlay and menu share a saved interface language without losing drafts', async () => {
  const sandbox = makeSandbox('ag60-ui-language');
  const lang = page => page.evaluate(() => document.documentElement.lang);
  const menuLabels = app => app.evaluate(({ Menu }) => Menu.getApplicationMenu()?.items.map(item => item.label) ?? []);
  let app, userDataPath;
  try {
    ({ app, userDataPath } = await launchApp(sandbox, { NODE_ENV: 'production' }));
    const launcher = await windowWithQuery(app, 'window=launcher', 30_000);
    const overlay = await windowWithQuery(app, 'window=overlay', 30_000);
    // Skip the existing first-run screens so the launcher home and Settings are reachable.
    await launcher.evaluate(() => { localStorage.setItem('natively_seen_startup_v1', 'true'); localStorage.setItem('natively_perms_shown_v1', '1'); });
    await launcher.reload();
    await launcher.getByRole('button', { name: 'Settings', exact: true }).first().click();
    await launcher.getByRole('heading', { name: 'Interface Language', exact: true }).waitFor();
    assert.equal(await lang(launcher), 'en');
    assert.ok((await menuLabels(app)).includes('View'));

    // A change saved from another window reaches the launcher without remounting its draft.
    await launcher.getByRole('button', { name: 'Context & Skills', exact: true }).click();
    const draft = launcher.locator('textarea').first();
    await draft.waitFor();
    await draft.fill('UNSAVED AG60 DRAFT');
    await draft.evaluate(element => { element.ag60Marker = true; });
    assert.deepEqual(await overlay.evaluate(() => window.electronAPI.setUiLanguage('zh-CN')), { ok: true, language: 'zh-CN' });
    await launcher.getByRole('button', { name: '上下文与技能', exact: true }).waitFor();
    assert.equal(await draft.inputValue(), 'UNSAVED AG60 DRAFT');
    assert.equal(await draft.evaluate(element => element.ag60Marker), true);
    assert.equal(await lang(launcher), 'zh-CN');
    await overlay.waitForFunction(() => document.documentElement.lang === 'zh-CN');
    await overlay.waitForFunction(() => document.body.textContent.includes('该怎么回答？'));
    assert.ok((await menuLabels(app)).includes('视图'));

    // The settings control saves through main; invalid values from a renderer change nothing.
    await launcher.getByRole('button', { name: '通用', exact: true }).click();
    await launcher.getByRole('radio', { name: 'English', exact: true }).click();
    await launcher.getByRole('heading', { name: 'Interface Language', exact: true }).waitFor();
    await overlay.waitForFunction(() => document.documentElement.lang === 'en');
    assert.ok((await menuLabels(app)).includes('View'));
    assert.deepEqual(await overlay.evaluate(() => window.electronAPI.setUiLanguage('fr')), { ok: false, message: 'Unsupported interface language.' });
    await launcher.getByRole('radio', { name: '简体中文', exact: true }).click();
    await launcher.getByRole('heading', { name: '界面语言', exact: true }).waitFor();
    assert.equal(await launcher.getByRole('radio', { name: '简体中文', exact: true }).getAttribute('aria-checked'), 'true');
    await overlay.waitForFunction(() => document.documentElement.lang === 'zh-CN');
    assert.equal(JSON.parse(fs.readFileSync(path.join(userDataPath, 'settings.json'), 'utf8')).uiLanguage, 'zh-CN');

    // A failed write reports an error and leaves every window and the saved file unchanged.
    const saved = fs.readFileSync(path.join(userDataPath, 'settings.json'), 'utf8');
    fs.chmodSync(userDataPath, 0o500);
    try {
      await launcher.getByRole('radio', { name: 'English', exact: true }).click();
      await launcher.getByRole('alert').filter({ hasText: '无法保存界面语言' }).waitFor();
    } finally { fs.chmodSync(userDataPath, 0o700); }
    assert.equal(await lang(launcher), 'zh-CN');
    assert.equal(await lang(overlay), 'zh-CN');
    assert.equal(await launcher.getByRole('radio', { name: '简体中文', exact: true }).getAttribute('aria-checked'), 'true');
    assert.equal(fs.readFileSync(path.join(userDataPath, 'settings.json'), 'utf8'), saved);
    assert.deepEqual(fs.readdirSync(userDataPath).filter(name => name.includes('.language.')), []);
    await app.close(); app = undefined;

    ({ app } = await launchApp(sandbox, { NODE_ENV: 'production' }));
    const restarted = await windowWithQuery(app, 'window=launcher', 30_000);
    await restarted.waitForFunction(() => document.documentElement.lang === 'zh-CN');
    await restarted.getByRole('button', { name: '设置', exact: true }).first().waitFor();
    assert.ok((await menuLabels(app)).includes('视图'));
  } finally {
    if (userDataPath) fs.chmodSync(userDataPath, 0o700);
    if (app) await app.close();
  }
  assert.deepEqual(readBlocked(sandbox).filter(record => !['permission', 'device', 'local-exec'].includes(record.kind)), []);
});

test('AG60 mounted help, meeting history and a visible error fallback switch language while preserving content', async () => {
  const bundle = await build({ stdin: { resolveDir: REPO, loader: 'tsx', contents: `
    import React from 'react'; import { createRoot } from 'react-dom/client'; import { flushSync } from 'react-dom';
    import MeetingDetails from './src/components/MeetingDetails';
    import { HelpSettings } from './src/components/settings/HelpSettings';
    import ErrorBoundary from './src/components/ErrorBoundary';
    import { startUiLanguageSync } from './src/i18n';
    let broadcast; window.requests = 0;
    window.electronAPI = { getUiLanguage: async () => 'en', onUiLanguageChanged: callback => { broadcast = callback; return () => {}; },
      getKeybinds: async () => [], onKeybindsUpdate: () => () => {},
      updateMeetingTitle: async () => { window.requests++; return true; } };
    startUiLanguageSync(); window.changeLanguage = language => broadcast(language);
    const meeting = { id: 'synthetic-ag60', title: 'Untranslated meeting title', date: '2026-10-13T10:00:00Z', duration: '2 min', summary: '',
      transcript: [{ speaker: 'user', text: 'Untranslated user speech', timestamp: 1 }, { speaker: 'interviewer', text: 'Untranslated remote speech', timestamp: 2 }],
      usage: [{ type: 'assist', timestamp: 3, question: 'Untranslated user question', answer: 'Untranslated generated answer',
        generation: { requestId: 'synthetic-history', provider: 'openai', model: 'opaque-model-id', status: 'completed', partial: false, attempts: 1 } }] };
    const root = createRoot(document.getElementById('root'));
    const Crash = () => { throw Error('Untranslated diagnostic'); };
    window.show = surface => flushSync(() => root.render(surface === 'help' ? React.createElement(HelpSettings)
      : surface === 'error' ? React.createElement(ErrorBoundary, { context: 'Launcher' }, React.createElement(Crash))
      : React.createElement(MeetingDetails, { meeting, onBack() {}, onOpenSettings() {} })));
    window.show('history');
  ` }, bundle: true, write: false, platform: 'browser', format: 'iife', loader: { '.svg': 'dataurl', '.png': 'dataurl', '.css': 'empty' }, define: { 'process.env.NODE_ENV': '"production"', __MARGIN_APP_NAME__: '"Margin"' } });
  const sandbox = makeSandbox('ag60-retained-surfaces'); let app;
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
    await page.getByRole('button', { name: 'Transcript', exact: true }).waitFor();
    await page.evaluate(() => window.changeLanguage('zh-CN'));
    await page.getByRole('button', { name: '转写', exact: true }).waitFor();
    for (const text of ['Untranslated meeting title', 'Untranslated user speech', 'Untranslated remote speech']) assert.ok((await page.locator('body').innerText()).includes(text));
    await page.getByRole('button', { name: '使用记录', exact: true }).click();
    for (const text of ['Untranslated user question', 'Untranslated generated answer', 'opaque-model-id']) assert.ok((await page.locator('body').innerText()).includes(text));
    await page.evaluate(() => window.changeLanguage('en'));
    await page.getByRole('button', { name: 'Usage', exact: true }).waitFor();
    assert.ok((await page.locator('body').innerText()).includes('Untranslated generated answer'));
    assert.equal(await page.evaluate(() => window.requests), 0);

    await page.evaluate(() => { window.changeLanguage('zh-CN'); window.show('help'); });
    await page.getByRole('heading', { name: '帮助与设置指南', exact: true }).waitFor();
    for (const title of ['1. 应用权限设置', '2. 语音转写服务商设置（麦克风）', '3. AI 服务商与提示词引擎', '4. Margin 界面操作', '5. 会议记录', '6. 全局搜索与快捷键', '7. 其他', '8. 隐身与窗口控制']) {
      await page.getByRole('button', { name: title, exact: true }).click();
    }
    const help = await page.locator('body').innerText();
    for (const text of ['支持五家语音识别服务商', '连接测试会向所选语音服务商发送合成静音', '新请求使用该模型', '其转写及会中的问答保存在本机', '真实屏幕共享中的不可见性尚未验证', '系统设计面试', '通过 LPU 进行 Whisper 转写', '为什么购物车会话', '我们需要有序集合']) assert.ok(help.includes(text), text);
    for (const text of ['When an active session concludes', 'Fast Response applies', 'The process completely disguises', '7+ providers']) assert.ok(!help.includes(text), text);

    await page.evaluate(() => { window.changeLanguage('en'); window.show('error'); });
    await page.getByRole('button', { name: 'Try to recover', exact: true }).waitFor();
    await page.evaluate(() => window.changeLanguage('zh-CN'));
    await page.getByRole('button', { name: '尝试恢复', exact: true }).waitFor();
    await page.getByRole('heading', { name: '启动器 已崩溃', exact: true }).waitFor();
    assert.equal(await page.locator('code').innerText(), 'Untranslated diagnostic');
    await page.evaluate(() => window.changeLanguage('en'));
    await page.getByRole('button', { name: 'Reload UI', exact: true }).waitFor();
    assert.equal(await page.locator('code').innerText(), 'Untranslated diagnostic');
    await page.close();
  } finally { if (app) await app.close(); }
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

test('S45 mounted settings preserve drafts, order save/test and pass gateway reasoning to the real protocol; S48 no official per-model reasoning', async () => {
  const require = createRequire(import.meta.url), electronId = require.resolve('electron'), previous = require.cache[electronId];
  require.cache[electronId] = { id: electronId, filename: electronId, loaded: true, exports: { app: { getPath: () => fs.mkdtempSync(path.join(os.tmpdir(), 's45-ui-')), isPackaged: true, getVersion: () => 'synthetic' } } };
  let LLMHelper;
  try { ({ LLMHelper } = require(REPO + '/dist-electron/electron/LLMHelper.js')); }
  finally { if (previous) require.cache[electronId] = previous; else delete require.cache[electronId]; }
  const bodies = [];
  const server = http.createServer(async (req, res) => {
    let body = ''; for await (const part of req) body += part;
    bodies.push(JSON.parse(body)); res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ choices: [{ message: { content: 'ANSWER' }, finish_reason: 'stop' }] }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = 'http://127.0.0.1:' + server.address().port + '/v1';
  const bundle = await build({ stdin: { resolveDir: REPO, loader: 'tsx', contents: `
    import React from 'react'; import { createRoot } from 'react-dom/client'; import { flushSync } from 'react-dom';
    import { AIProvidersSettings as Settings } from './src/components/settings/AIProvidersSettings'; import { LLM_PRESETS } from './src/types/llmTarget';
    import { DEFAULT_GENERATION_POLICY as POLICY } from './src/types/generationPolicy'; import { setUiLanguage } from './src/i18n';
    window.events = []; window.models = [{ id: 'gpt-5.4', label: 'Upstream GPT' }, { id: 'gpt-5.4-other', label: 'Other upstream model' }];
    window.creds = { providerConfigurations: structuredClone(LLM_PRESETS), hasOpenaiKey: true, gateways: [] };
    window.policy = structuredClone(POLICY); window.gatewayCreates = 0;
    window.electronAPI = { getGenerationPolicy: async () => structuredClone(window.policy),
      setGenerationPolicy: async policy => { window.policy = structuredClone(policy); return { ok: true }; },
      getStoredCredentials: async () => structuredClone(window.creds),
      getGroqFastTextMode: async () => ({ enabled: false }), getDefaultModel: async () => ({ model: 'llm-target:openai:chat-completions:gpt-5.4' }), getProviderDataScopes: async () => ({}),
      getCodexCliConfig: async () => ({ enabled: false, model: 'synthetic', fastModel: 'synthetic' }),
      fetchProviderModels: async () => { window.events.push('fetch'); if (window.deferModels) return new Promise(resolve => window.resolveModels = resolve); return { success: true, models: window.models }; },
      setProviderConfiguration: async value => { window.events.push('save'); if (window.failSave) return { ok: false, message: 'synthetic save failure' }; window.creds.providerConfigurations[value.provider] = value; return { ok: true }; },
      testLlmConnection: async (provider, unused, expected) => { window.events.push('test'); window.tested = expected; if (window.deferTest) return new Promise(resolve => window.resolveTest = resolve); return { success: true }; },
      setGatewayConfiguration: async value => { window.events.push('gateway-save'); if (window.failSave) return { ok: false, message: 'synthetic save failure' };
        if (!value.id) window.gatewayCreates++;
        if (window.deferSave) await new Promise(resolve => window.resolveSave = resolve);
        const previous = window.gatewaySaved;
        const { apiKey, ...config } = value; window.gatewaySaved = { ...config, id: value.id || 'gw-synthetic' };
        if (previous && window.policy.backupModel === 'llm-gateway:' + previous.id + ':' + previous.protocol + ':' + encodeURIComponent(previous.model))
          window.policy.backupModel = 'llm-gateway:' + window.gatewaySaved.id + ':' + value.protocol + ':' + encodeURIComponent(value.model);
        window.creds.gateways = [{ ...window.gatewaySaved, hasKey: true }]; return { ok: true, gatewayId: window.gatewaySaved.id }; },
      testGatewayConnection: async (id, expected) => { window.events.push('gateway-test'); window.gatewayTested = expected; if (window.deferTest) return new Promise(resolve => window.resolveTest = resolve); return { success: true }; },
      fetchGatewayModels: async () => { window.events.push('gateway-fetch'); return { success: true, models: [] }; },
      setProviderDataScopes: async scopes => { window.scopes = scopes; }, openExternal: async url => { window.external = url; }
    };
    const root = createRoot(document.getElementById('root')); window.show = () => flushSync(() => root.render(React.createElement(Settings)));
    window.language = setUiLanguage;
  ` }, bundle: true, write: false, platform: 'browser', format: 'iife', loader: { '.svg': 'dataurl', '.png': 'dataurl', '.css': 'empty' }, define: { 'process.env.NODE_ENV': '"production"', __MARGIN_APP_NAME__: '"temp"' } });
  const sandbox = makeSandbox('s45-provider-settings'); let app;
  try {
    ({ app } = await launchApp(sandbox, { NODE_ENV: 'production' })); await windowWithQuery(app, 'window=launcher', 30_000);
    const created = app.waitForEvent('window'); await app.evaluate(async ({ BrowserWindow }) => { const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } }); await win.loadURL('data:text/html,<div id="root"></div>'); });
    const page = await created; await page.addScriptTag({ content: bundle.outputFiles[0].text }); await page.evaluate(() => window.show());
    await page.getByRole('button', { name: /^OpenAI/ }).click();
    // S48: the official card has no reasoning control; the protocol select is the draft field here.
    const protocol = page.getByRole('combobox', { name: 'OpenAI protocol', exact: true });
    await protocol.waitFor();
    assert.equal(await page.getByRole('combobox', { name: 'OpenAI reasoning effort', exact: true }).count(), 0);
    const cloud = page.getByRole('tabpanel', { name: 'Cloud services', exact: true });
    const text = await page.locator('body').innerText();
    assert.ok(text.indexOf('Answer models') < text.indexOf('Backup model') && text.indexOf('Generation limits') < text.indexOf('Cloud services'));
    assert.equal(await page.getByRole('textbox', { name: 'OpenAI API base URL', exact: true }).count(), 0);
    assert.equal(await page.getByRole('combobox', { name: 'OpenAI connection', exact: true }).count(), 0);
    assert.equal(await page.getByRole('textbox', { name: 'OpenAI model ID', exact: true }).count(), 0);
    assert.doesNotMatch(await page.getByRole('combobox', { name: 'Primary model', exact: true }).innerText(), /Groq|llama/i);
    assert.equal(await page.getByRole('button', { name: /^Groq/ }).count(), 0);
    assert.deepEqual(await page.evaluate(() => window.events), [], 'mount and expand are local only');
    const model = page.getByRole('combobox', { name: 'OpenAI model', exact: true });
    const toAdd = page.getByRole('combobox', { name: 'OpenAI model to add', exact: true });
    assert.deepEqual(await model.locator('option').allTextContents(), ['gpt-5.4'], 'only saved candidates can be edited');
    assert.equal(await toAdd.isDisabled(), true);
    await cloud.getByRole('button', { name: 'Fetch Models', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('[aria-label="OpenAI model to add"]').options.length === 2);
    await toAdd.selectOption('gpt-5.4-other'); await toAdd.selectOption('');
    assert.deepEqual(await model.locator('option').allTextContents(), ['gpt-5.4'], 'a listed model is not added by choosing it');
    assert.deepEqual(await page.evaluate(() => window.events), ['fetch'], 'discovery never selects or saves automatically');
    await page.evaluate(() => { window.deferModels = true; });
    await cloud.getByRole('button', { name: 'Fetch Models', exact: true }).click();
    await protocol.selectOption('responses');
    await page.waitForFunction(() => document.querySelector('[aria-label="OpenAI model to add"]').options.length === 1);
    await page.evaluate(() => window.resolveModels({ success: true, models: [{ id: 'stale', label: 'Stale result' }] }));
    assert.equal(await toAdd.locator('option', { hasText: 'Stale result' }).count(), 0);
    assert.equal(await toAdd.locator('option', { hasText: 'Other upstream model' }).count(), 0, 'S49 a changed protocol also clears the previously fetched catalogue');
    await page.getByRole('tab', { name: 'Cloud services', exact: true }).press('ArrowRight');
    assert.equal(await page.getByRole('tab', { name: 'Gateway', exact: true }).getAttribute('aria-selected'), 'true');
    await page.getByRole('tab', { name: 'Gateway', exact: true }).press('End');
    await page.getByRole('switch', { name: 'Allow Screenshots to cloud providers', exact: true }).click();
    assert.equal(await page.evaluate(() => window.scopes.screenshots), false);
    await page.getByRole('tab', { name: 'Privacy', exact: true }).press('Home');
    assert.equal(await protocol.inputValue(), 'responses', 'tab switch preserves the draft');
    await page.evaluate(() => { window.failSave = true; });
    await cloud.getByRole('button', { name: 'Save and test', exact: true }).click();
    await page.waitForFunction(() => document.body.innerText.includes('synthetic save failure'));
    assert.equal(await page.evaluate(() => window.events.filter(x => x === 'test').length), 0);
    await page.evaluate(() => { window.failSave = false; });
    await cloud.getByRole('button', { name: 'Save and test', exact: true }).click();
    await page.waitForFunction(() => window.events.includes('test'));
    assert.deepEqual(await page.evaluate(() => window.events.slice(-2)), ['save', 'test']);
    assert.equal(await page.evaluate(() => window.tested.protocol), 'responses');
    assert.equal(await page.evaluate(() => 'reasoning' in window.tested), false, 'an official save carries no per-model reasoning');
    await page.waitForFunction(() => document.body.innerText.includes('Connection test passed'));
    // A late test result cannot mark a newer draft connected.
    await page.evaluate(() => { window.deferTest = true; });
    await cloud.getByRole('button', { name: 'Save and test', exact: true }).click();
    await page.waitForFunction(() => !!window.resolveTest);
    await protocol.selectOption('chat-completions');
    await page.evaluate(() => { window.resolveTest({ success: true }); window.deferTest = false; window.resolveTest = undefined; });
    assert.doesNotMatch(await cloud.innerText(), /Connection test passed/);

    await page.getByRole('tab', { name: 'Gateway', exact: true }).click();
    const gateway = page.getByRole('tabpanel', { name: 'Gateway', exact: true });
    await page.getByRole('textbox', { name: 'Gateway URL', exact: true }).fill(address);
    await page.getByLabel('Gateway API key', { exact: true }).fill('synthetic-only');
    await page.getByLabel('Gateway model', { exact: true }).fill('gpt-5.4');
    const gatewayEffort = page.getByRole('combobox', { name: 'Gateway reasoning effort', exact: true });
    await gatewayEffort.selectOption('max');
    await page.getByRole('spinbutton', { name: 'Gateway context window', exact: true }).fill('4096');
    await page.getByRole('tab', { name: 'Gateway', exact: true }).press('ArrowRight');
    await page.getByRole('tab', { name: 'Privacy', exact: true }).press('ArrowLeft');
    assert.equal(await gatewayEffort.inputValue(), 'max');
    await page.evaluate(() => { window.failSave = true; });
    await gateway.getByRole('button', { name: 'Save and test', exact: true }).click();
    await page.waitForFunction(() => document.getElementById('ai-panel-gateway').innerText.includes('synthetic save failure'));
    assert.equal(await page.evaluate(() => window.events.filter(x => x === 'gateway-test').length), 0);
    await page.evaluate(() => { window.failSave = false; window.deferSave = true; });
    await gateway.getByRole('button', { name: 'Save and test', exact: true }).click();
    await page.waitForFunction(() => !!window.resolveSave);
    await page.getByLabel('Gateway model', { exact: true }).fill('new-draft');
    assert.equal(await gateway.getByRole('button', { name: 'Save and test', exact: true }).isDisabled(), true, 'editing cannot unlock an in-flight creation');
    await page.evaluate(() => { window.deferSave = false; window.resolveSave(); });
    await page.waitForFunction(() => !!window.gatewaySaved && !document.querySelector('#ai-panel-gateway button').disabled);
    assert.equal(await page.getByLabel('Gateway model', { exact: true }).inputValue(), 'new-draft');
    assert.equal(await page.evaluate(() => window.events.filter(x => x === 'gateway-test').length), 0, 'superseded save cannot trigger a test');
    await page.getByLabel('Gateway model', { exact: true }).fill('gpt-5.4');
    await gatewayEffort.selectOption('max');
    await gateway.getByRole('button', { name: 'Save and test', exact: true }).click();
    await page.waitForFunction(() => window.events.includes('gateway-test'));
    assert.deepEqual(await page.evaluate(() => window.events.slice(-2)), ['gateway-save', 'gateway-test']);
    const payload = await page.evaluate(() => JSON.parse(JSON.stringify(window.gatewaySaved)));
    assert.deepEqual(await page.evaluate(() => window.gatewayTested), payload);
    assert.equal(await gateway.getByLabel('Gateway model', { exact: true }).count(), 1, 'first save keeps one stable panel');
    assert.equal(await page.getByLabel('Gateway API key', { exact: true }).inputValue(), '');
    assert.equal(await page.evaluate(() => window.gatewayCreates), 1, 'one first save creates exactly one gateway');
    const primaryOptions = await page.getByRole('combobox', { name: 'Primary model', exact: true }).locator('option').evaluateAll(options => options.map(o => o.value));
    assert.ok(primaryOptions.includes('llm-target:openai:chat-completions:gpt-5.4'));
    assert.ok(primaryOptions.includes('llm-gateway:gw-synthetic:chat-completions:gpt-5.4'));
    const backup = page.getByRole('combobox', { name: 'Backup model', exact: true });
    await backup.selectOption('llm-gateway:gw-synthetic:chat-completions:gpt-5.4');
    await page.getByRole('button', { name: 'Save backup and time limits', exact: true }).click();
    await page.waitForFunction(() => window.policy.backupModel?.includes('gw-synthetic'));
    const deadline = page.getByRole('spinbutton', { name: 'Interview first visible text (seconds)', exact: true });
    await deadline.fill('33');
    await page.getByLabel('Gateway model', { exact: true }).fill('next-model');
    await gateway.getByRole('button', { name: 'Save', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('[aria-label="Backup model"]').value.endsWith(':next-model'));
    assert.equal(await deadline.inputValue(), '33', 'following the saved backup keeps unsaved deadline edits');
    await page.getByRole('textbox', { name: 'Gateway URL', exact: true }).fill('https://changed.example/v1');
    const before = await page.evaluate(() => window.events.length);
    await gateway.getByRole('button', { name: 'Save and test', exact: true }).click();
    await page.waitForFunction(() => document.body.innerText.includes('Re-enter the API key'));
    assert.equal(await page.evaluate(() => window.events.length), before, 'changed origin without key sends and saves nothing');
    // The payload produced by the UI goes through the real adapter against a loopback service.
    const helper = new LLMHelper(); helper.getProviderScopePolicy = () => ({});
    helper.configureGateway(payload, 'synthetic-only');
    helper.setModel('llm-gateway:gw-synthetic:chat-completions:gpt-5.4');
    assert.equal(await helper.generateContentStructured('USER'), 'ANSWER');
    assert.equal(bodies.length, 1); assert.equal(bodies[0].reasoning_effort, 'max'); assert.equal(bodies[0].model, 'gpt-5.4');
    await page.evaluate(() => window.language('zh-CN'));
    await page.waitForFunction(() => document.body.innerText.includes('网关'));
    await page.close();
  } finally { if (app) await app.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  assert.deepEqual(readBlocked(sandbox).filter(record => !['permission', 'device', 'local-exec'].includes(record.kind)), []);
});
test('S49 mounted provider discards a late list after an external protocol update and can fetch again', async () => {
  const bundle = await build({ stdin: { resolveDir: REPO, loader: 'tsx', contents: `
    import React, { useState } from 'react'; import { createRoot } from 'react-dom/client';
    import { ProviderCard } from './src/components/settings/ProviderCard';
    window.fetchCalls = 0; window.resolved = false;
    window.electronAPI = { fetchProviderModels: async () => {
      window.fetchCalls++;
      if (window.fetchCalls === 1) return new Promise(resolve => { window.resolveList = value => { window.resolved = true; resolve(value); }; });
      return { success: true, models: [{ id: 'gpt-5.4-mini', label: 'Current protocol model' }] };
    } };
    function ExternalProtocolFixture() {
      const [config, setConfig] = useState({ provider: 'openai', protocol: 'responses', model: 'gpt-5.4' });
      window.replaceConfig = () => setConfig({ ...config, protocol: 'chat-completions' });
      return <ProviderCard providerId="openai" providerName="OpenAI" icon={null} configuration={config}
        hasStoredKey={true} keyPlaceholder="synthetic" keyUrl="https://example.invalid"
        onSave={async () => ({ ok: true })} onRemoveKey={async () => {}} />;
    }
    createRoot(document.getElementById('root')).render(<ExternalProtocolFixture />);
  ` }, bundle: true, write: false, platform: 'browser', format: 'iife', loader: { '.css': 'empty' }, define: { 'process.env.NODE_ENV': '"production"' } });
  const sandbox = makeSandbox('s49-external-protocol'); let app;
  try {
    ({ app } = await launchApp(sandbox, { NODE_ENV: 'production' })); await windowWithQuery(app, 'window=launcher', 30_000);
    const created = app.waitForEvent('window');
    await app.evaluate(async ({ BrowserWindow }) => { const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } }); await win.loadURL('data:text/html,<div id="root"></div>'); });
    const page = await created; await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.getByRole('button', { name: /^OpenAI/ }).click();
    const fetch = page.getByRole('button', { name: 'Fetch Models', exact: true });
    const list = page.getByRole('combobox', { name: 'OpenAI model to add', exact: true });
    await fetch.click(); await page.waitForFunction(() => !!window.resolveList);
    await page.evaluate(() => window.replaceConfig());
    await page.waitForFunction(() => document.querySelector('[aria-label="OpenAI protocol"]').value === 'chat-completions');
    await page.evaluate(() => window.resolveList({ success: true, models: [{ id: 'gpt-5.4-pro', label: 'Stale Responses-only model' }] }));
    await page.waitForFunction(() => window.resolved);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await list.locator('option', { hasText: 'Stale Responses-only model' }).count(), 0);
    assert.equal(await fetch.isEnabled(), true, 'a superseded fetch cannot leave the card busy');
    await fetch.click();
    await page.waitForFunction(() => document.querySelector('[aria-label="OpenAI model to add"]').options.length === 2);
    assert.deepEqual(await list.locator('option').allTextContents(), ['Choose a model to add', 'Current protocol model']);
    assert.equal(await page.getByRole('combobox', { name: 'OpenAI model', exact: true }).inputValue(), 'gpt-5.4');
  } finally { await app?.close().catch(() => {}); }
  assert.deepEqual(readBlocked(sandbox).filter(record => !['permission', 'device', 'local-exec'].includes(record.kind)), []);
});

test('S47 mounted settings and session selector share saved candidates through the real manager, IPC callbacks and LLMHelper', async () => {
  const require = createRequire(import.meta.url), compile = source => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText;
  const load = file => { const module = { exports: {} }; vm.runInNewContext(compile(fs.readFileSync(`${REPO}/${file}`, 'utf8')), { module, exports: module.exports, URL }); return module.exports; };
  const types = load('src/types/llmTarget.ts'), policyTypes = load('src/types/generationPolicy.ts'), codexTypes = load('src/types/codexSource.ts');
  const targetApi = require(`${REPO}/dist-electron/electron/llm/llmTarget.js`);
  // Synthetic encrypted store in memory; nothing touches a real profile or keychain.
  const filename = '/synthetic/credentials.enc', files = new Map([[filename, Buffer.from('cipher:{}')]]), fault = { rename: false };
  const fakeFs = { existsSync: file => files.has(file), readFileSync: file => files.get(file), unlinkSync: file => files.delete(file),
    writeFileSync(file, bytes) { files.set(file, Buffer.from(bytes)); }, renameSync(from, to) { if (fault.rename) throw Error('synthetic rename'); files.set(to, files.get(from)); files.delete(from); } };
  const boot = () => {
    const module = { exports: {} };
    vm.runInNewContext(compile(fs.readFileSync(`${REPO}/electron/services/CredentialsManager.ts`, 'utf8')), { module, exports: module.exports, Buffer, URL, console: { log() {}, warn() {}, error() {} },
      require(id) {
        if (id === 'electron') return { app: { getPath: () => '/synthetic' }, safeStorage: { isEncryptionAvailable: () => true, encryptString: text => Buffer.from('cipher:' + text), decryptString: bytes => bytes.toString().slice(7) } };
        if (id === 'fs') return fakeFs;
        if (id === './outbound') return require(`${REPO}/dist-electron/electron/services/outbound.js`);
        if (id === '../utils/validateSttBaseUrl') return require(`${REPO}/dist-electron/electron/utils/validateSttBaseUrl.js`);
        if (id === '../../src/types/llmTarget') return types;
        if (id === '../../src/types/generationPolicy') return policyTypes;
        if (id === '../../src/types/codexSource') return codexTypes;
        if (id === '../llm/llmTarget') return targetApi;
        if (id === '../../src/types/modelCapabilities') return load('src/types/modelCapabilities.ts');
        if (id === '../llm/answerReasoning') return require(`${REPO}/dist-electron/electron/llm/answerReasoning.js`);
        return require(id);
      } });
    const instance = module.exports.CredentialsManager.getInstance(); instance.init(); return instance;
  };
  const manager = boot();
  assert.equal(manager.setProviderConfiguration({ provider: 'openai', protocol: 'chat-completions', model: 'gpt-5.4', apiKey: 'synthetic-openai' }).ok, true);
  assert.equal(manager.setProviderConfiguration({ provider: 'claude', protocol: 'messages', model: 'claude-sonnet-4-6', apiKey: 'synthetic-claude' }).ok, true);
  assert.equal(manager.setProviderConfiguration({ provider: 'deepseek', protocol: 'chat-completions', model: 'shared-model', apiKey: 'synthetic-deepseek' }).ok, true);
  const primary = 'llm-target:claude:messages:claude-sonnet-4-6', id = model => `llm-target:openai:chat-completions:${model}`;
  assert.equal(manager.setDefaultModel(primary).ok, true);

  const electronId = require.resolve('electron'), previous = require.cache[electronId], userData = fs.mkdtempSync(path.join(os.tmpdir(), 's47-ui-'));
  const built = require.resolve(`${REPO}/dist-electron/electron/LLMHelper.js`), cachedHelper = require.cache[built]; delete require.cache[built];
  require.cache[electronId] = { id: electronId, filename: electronId, loaded: true, exports: { app: { getPath: () => userData, isPackaged: true, getVersion: () => 'synthetic' } } };
  let LLMHelper;
  try { ({ LLMHelper } = require(built)); }
  finally { if (previous) require.cache[electronId] = previous; else delete require.cache[electronId]; if (cachedHelper) require.cache[built] = cachedHelper; else delete require.cache[built]; }
  const helper = new LLMHelper(); helper.getProviderScopePolicy = () => ({});
  // The send itself is covered on the wire elsewhere; here every connection test is recorded and nothing leaves the machine.
  const tests = []; let deferredTest;
  helper.testProviderConnection = (provider, model) => { tests.push([provider, model]); return deferredTest ? deferredTest.promise : Promise.resolve('ANSWER'); };
  const changed = [];
  const processingHelper = { getLLMHelper: () => helper,
    applyStoredProvider: provider => helper.configureProvider(manager.getProviderConfigurations()[provider], manager.getProviderApiKey(provider)),
    refreshAnswerRuntime: () => changed.push(helper.getCurrentModelSelection()) };
  for (const config of Object.values(manager.getProviderConfigurations())) processingHelper.applyStoredProvider(config.provider);
  helper.setModel(manager.getDefaultModel()); helper.setGenerationPolicy(manager.getGenerationPolicy());
  const appState = { processingHelper, sendModelChanged: value => changed.push(value), modelSelectorWindowHelper: { hideWindow() {} } };
  const listed = [];
  const arrow = (predicate, context) => {
    const source = fs.readFileSync(`${REPO}/electron/ipcHandlers.ts`, 'utf8'), ast = ts.createSourceFile('ipcHandlers.ts', source, ts.ScriptTarget.Latest, true); let found;
    const visit = node => { if (!found && predicate(node)) found = node.getText(ast); ts.forEachChild(node, visit); }; visit(ast); assert.ok(found);
    const module = { exports: {} }; vm.runInNewContext(compile(`module.exports = (${found});`), { module, exports: module.exports, console: { log() {}, warn() {}, error() {} }, ...context }); return module.exports;
  };
  const named = name => node => ts.isArrowFunction(node) && ts.isVariableDeclaration(node.parent) && node.parent.name.getText() === name;
  const context = { ...targetApi, LLM_PRESETS: types.LLM_PRESETS, ANSWER_PROVIDERS: types.ANSWER_PROVIDERS, modelTargetId: types.modelTargetId, providerCandidates: types.providerCandidates, appState,
    sanitizeErrorMessage: message => message,
    require: module => module.includes('modelFetcher') ? { fetchProviderModels: async provider => { listed.push(provider); return [{ id: 'gpt-5.4', label: 'gpt-5.4' }, { id: 'model-b', label: 'model-b' }, { id: 'shared-model', label: 'shared-model' }]; } }
      : { CredentialsManager: { getInstance: () => manager } } };
  context.persistCredentials = arrow(named('persistCredentials'), {});
  context.boundedProviderError = arrow(named('boundedProviderError'), { sanitizeErrorMessage: message => message });
  context.ANSWER_APPLY_WARNING = arrow(node => ts.isStringLiteral(node) && ts.isVariableDeclaration(node.parent) && node.parent.name.getText() === 'ANSWER_APPLY_WARNING', {});
  const handlers = {};
  for (const channel of ['get-generation-policy', 'set-generation-policy', 'get-stored-credentials', 'get-default-model', 'set-default-model', 'fetch-provider-models',
    'set-provider-configuration', 'test-llm-connection', 'remove-provider-api-key', 'set-model', 'get-current-llm-config']) {
    handlers[channel] = arrow(node => ts.isArrowFunction(node) && ts.isCallExpression(node.parent) && node.parent.expression.getText() === 'safeHandle' && node.parent.arguments[0]?.text === channel, context);
  }
  const preload = {};
  for (const name of ['getGenerationPolicy', 'setGenerationPolicy', 'getStoredCredentials', 'getDefaultModel', 'setDefaultModel', 'fetchProviderModels',
    'setProviderConfiguration', 'testLlmConnection', 'removeProviderApiKey', 'setModel', 'getCurrentLlmConfig']) {
    const source = fs.readFileSync(`${REPO}/electron/preload.ts`, 'utf8'), ast = ts.createSourceFile('preload.ts', source, ts.ScriptTarget.Latest, true); let found;
    const visit = node => { if (!found && ts.isArrowFunction(node) && ts.isPropertyAssignment(node.parent) && node.parent.name.getText() === name) found = node.getText(ast); ts.forEachChild(node, visit); }; visit(ast); assert.ok(found, name);
    const module = { exports: {} }; vm.runInNewContext(compile(`module.exports = (${found});`), { module, exports: module.exports, ipcRenderer: { invoke: (channel, ...args) => handlers[channel]({}, ...args) } });
    preload[name] = module.exports;
  }
  // Values cross the page boundary as JSON, as structured clone would carry them.
  const call = async (name, args) => JSON.parse(JSON.stringify((await preload[name](...args)) ?? null));
  const bundle = await build({ stdin: { resolveDir: REPO, loader: 'tsx', contents: `
    import React from 'react'; import { createRoot } from 'react-dom/client'; import { flushSync } from 'react-dom';
    import { AIProvidersSettings as Settings } from './src/components/settings/AIProvidersSettings'; import Selector from './src/components/ModelSelectorWindow';
    const memory = new Map(); Object.defineProperty(window, 'localStorage', { configurable: true, value: { getItem: key => memory.has(key) ? memory.get(key) : null, setItem: (key, value) => memory.set(key, String(value)), removeItem: key => memory.delete(key) } });
    const bridge = name => (...args) => window.invokeMain(name, args);
    window.electronAPI = { getGroqFastTextMode: async () => ({ enabled: false }), getProviderDataScopes: async () => ({}), getCodexCliConfig: async () => ({ enabled: false, model: 'synthetic', fastModel: 'synthetic' }),
      onModelChanged: () => () => {}, onThemeChanged: () => () => {} };
    for (const name of ${JSON.stringify(Object.keys(preload))}) window.electronAPI[name] = bridge(name);
    let settings, selector;
    window.mountSettings = () => { settings?.unmount(); const node = document.getElementById('settings'); settings = createRoot(node); flushSync(() => settings.render(React.createElement(Settings))); };
    window.mountSelector = () => { selector?.unmount(); selector = createRoot(document.getElementById('selector')); flushSync(() => selector.render(React.createElement(Selector))); };
  ` }, bundle: true, write: false, platform: 'browser', format: 'iife', loader: { '.svg': 'dataurl', '.png': 'dataurl', '.css': 'empty' }, define: { 'process.env.NODE_ENV': '"production"', __MARGIN_APP_NAME__: '"temp"' } });
  const sandbox = makeSandbox('s47-candidates'); let app;
  try {
    ({ app } = await launchApp(sandbox, { NODE_ENV: 'production' })); await windowWithQuery(app, 'window=launcher', 30_000);
    const created = app.waitForEvent('window'); await app.evaluate(async ({ BrowserWindow }) => { const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } }); await win.loadURL('data:text/html,<div id="settings"></div><div id="selector"></div>'); });
    const page = await created; page.on('dialog', dialog => dialog.accept());
    await page.exposeFunction('invokeMain', (name, args) => call(name, args));
    await page.addScriptTag({ content: bundle.outputFiles[0].text }); await page.evaluate(() => { window.mountSettings(); window.mountSelector(); });
    const settings = page.locator('#settings'), selector = page.locator('#selector');
    const primarySelect = page.getByRole('combobox', { name: 'Primary model', exact: true }), backupSelect = page.getByRole('combobox', { name: 'Backup model', exact: true });
    const optionValues = locator => locator.locator('option').evaluateAll(options => options.map(option => option.value));
    await page.waitForFunction(id => [...document.querySelectorAll('[aria-label="Primary model"] option')].some(option => option.value === id), primary);
    const state = () => ({ primary: manager.getDefaultModel(), backup: manager.getGenerationPolicy().backupModel, session: helper.getCurrentModelSelection() });
    const until = async (condition, message) => { for (let i = 0; i < 100 && !condition(); i++) await new Promise(resolve => setTimeout(resolve, 20)); assert.ok(condition(), message); };
    assert.deepEqual(state(), { primary, backup: undefined, session: primary });
    const before = await optionValues(primarySelect);
    assert.ok(before.includes(id('gpt-5.4')) && before.includes('llm-target:deepseek:chat-completions:shared-model'));

    await page.getByRole('button', { name: /^OpenAI/ }).click();
    const cloud = page.getByRole('tabpanel', { name: 'Cloud services', exact: true });
    const editSelect = page.getByRole('combobox', { name: 'OpenAI model', exact: true }), addSelect = page.getByRole('combobox', { name: 'OpenAI model to add', exact: true });
    await cloud.getByRole('button', { name: 'Fetch Models', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('[aria-label="OpenAI model to add"]').options.length === 3);
    assert.deepEqual(listed, ['openai']); assert.deepEqual(await optionValues(editSelect), ['gpt-5.4'], 'fetching adds nothing');
    for (const model of ['model-b', 'shared-model']) { await addSelect.selectOption(model); await cloud.getByRole('button', { name: 'Add model', exact: true }).click(); }
    assert.deepEqual(await optionValues(editSelect), ['gpt-5.4', 'model-b', 'shared-model']);
    // S48: an official card has no per-candidate reasoning, thinking or image confirmation controls.
    for (const candidate of ['model-b', 'gpt-5.4']) {
      await editSelect.selectOption(candidate);
      assert.equal(await cloud.getByRole('combobox', { name: /^(OpenAI|Gemini|Claude|DeepSeek) (thinking|reasoning effort)$/ }).count(), 0, candidate);
      assert.equal(await cloud.getByRole('checkbox', { name: /^(OpenAI|Gemini|Claude|DeepSeek) model supports images$/ }).count(), 0, candidate);
    }
    assert.equal((await optionValues(primarySelect)).includes(id('model-b')), false, 'an unsaved draft is not offered');
    assert.deepEqual(state(), { primary, backup: undefined, session: primary });

    await cloud.getByRole('button', { name: 'Save', exact: true }).click();
    await page.waitForFunction(() => document.body.innerText.includes('Saved. The connection has not been tested.'));
    assert.deepEqual(tests, [], 'Save sends nothing');
    assert.deepEqual(JSON.parse(JSON.stringify(boot().getProviderConfigurations().openai)), { provider: 'openai', protocol: 'chat-completions', model: 'gpt-5.4',
      models: [{ model: 'model-b' }, { model: 'shared-model' }] });
    assert.deepEqual(state(), { primary, backup: undefined, session: primary }, 'adding candidates changes no selection');
    const offered = await optionValues(primarySelect);
    for (const model of ['gpt-5.4', 'model-b', 'shared-model']) assert.ok(offered.includes(id(model)), model);
    assert.ok(offered.includes('llm-target:deepseek:chat-completions:shared-model'), 'the same model name of another provider keeps its own identity');

    await backupSelect.selectOption(id('model-b'));
    await page.getByRole('button', { name: 'Save backup and time limits', exact: true }).click();
    await until(() => manager.getGenerationPolicy().backupModel === id('model-b'), 'backup saved');
    assert.equal(manager.getDefaultModel(), primary); assert.equal(await primarySelect.inputValue(), primary);

    await page.evaluate(() => window.mountSelector());
    const row = name => selector.getByRole('button', { name, exact: true });
    await row('shared-model (OpenAI)').waitFor();
    assert.deepEqual(await selector.getByRole('button').allTextContents(), ['gpt-5.4 (OpenAI)', 'model-b (OpenAI)', 'shared-model (OpenAI)', 'claude-sonnet-4-6 (Claude)', 'shared-model (DeepSeek)']);
    await row('shared-model (OpenAI)').click();
    await until(() => helper.getCurrentModelSelection() === id('shared-model'), 'session switched');
    assert.deepEqual(state(), { primary, backup: id('model-b'), session: id('shared-model') }, 'the session switch changes only the session');

    // Save and test checks only the edited candidate; a late result cannot mark another candidate tested.
    await editSelect.selectOption('model-b');
    let release; deferredTest = { promise: new Promise(resolve => { release = resolve; }) };
    await cloud.getByRole('button', { name: 'Save and test', exact: true }).click();
    await until(() => tests.length === 1, 'test started');
    await editSelect.selectOption('gpt-5.4'); release('ANSWER'); deferredTest = undefined;
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.doesNotMatch(await cloud.innerText(), /Connection test passed|Test passed/);
    await editSelect.selectOption('model-b');
    await cloud.getByRole('button', { name: 'Save and test', exact: true }).click();
    await page.waitForFunction(() => document.body.innerText.includes('Test passed: model-b'));
    assert.deepEqual(tests, [['openai', 'model-b'], ['openai', 'model-b']], 'one test per click, only the edited candidate');

    // Removing a used candidate is refused by the main process; switching the session first allows it.
    const stored = files.get(filename);
    await editSelect.selectOption('shared-model'); await cloud.getByRole('button', { name: 'Remove model', exact: true }).click();
    assert.deepEqual(await optionValues(editSelect), ['gpt-5.4', 'model-b']);
    await cloud.getByRole('button', { name: 'Save', exact: true }).click();
    await page.waitForFunction(() => document.body.innerText.includes('is used as the primary, backup or current answer model'));
    assert.deepEqual(files.get(filename), stored); assert.deepEqual(state(), { primary, backup: id('model-b'), session: id('shared-model') });
    await row('gpt-5.4 (OpenAI)').click();
    await until(() => helper.getCurrentModelSelection() === id('gpt-5.4'), 'session switched again');
    await cloud.getByRole('button', { name: 'Save', exact: true }).click();
    await until(() => manager.getProviderConfigurations().openai.models?.length === 1, 'used candidate removed after the switch');
    assert.deepEqual(JSON.parse(JSON.stringify(boot().getProviderConfigurations().openai.models)), [{ model: 'model-b' }]);
    assert.deepEqual(state(), { primary, backup: id('model-b'), session: id('gpt-5.4') });

    // Reopened settings and a cold manager keep the saved candidates.
    await page.evaluate(() => window.mountSettings());
    await page.waitForFunction(id => [...document.querySelectorAll('[aria-label="Primary model"] option')].some(option => option.value === id), id('model-b'));
    await page.getByRole('button', { name: /^OpenAI/ }).click();
    assert.deepEqual(await optionValues(page.getByRole('combobox', { name: 'OpenAI model', exact: true })), ['gpt-5.4', 'model-b']);
    assert.deepEqual(JSON.parse(JSON.stringify(boot().resolveSelection(id('model-b')))), { provider: 'openai', protocol: 'chat-completions', model: 'model-b' });

    // Removing the key hides every OpenAI candidate and keeps their configuration.
    await page.getByRole('tabpanel', { name: 'Cloud services', exact: true }).getByRole('button', { name: 'Remove API Key', exact: true }).click();
    await page.waitForFunction(() => ![...document.querySelectorAll('[aria-label="Primary model"] option')].some(option => option.value.startsWith('llm-target:openai:') && !option.textContent.includes('unavailable')));
    await page.evaluate(() => window.mountSelector());
    // The selector first shows its cached list, then the fresh one.
    await page.waitForFunction(() => !document.getElementById('selector').innerText.includes('(OpenAI)'));
    assert.deepEqual(await selector.getByRole('button').allTextContents(), ['claude-sonnet-4-6 (Claude)', 'shared-model (DeepSeek)']);
    assert.equal(boot().getProviderApiKey('openai') || undefined, undefined, 'no usable OpenAI key remains');
    assert.deepEqual(JSON.parse(JSON.stringify(boot().getProviderConfigurations().openai.models)), [{ model: 'model-b' }]);
    await page.close();
  } finally { if (app) await app.close(); helper.scrubKeys(); fs.rmSync(userData, { recursive: true, force: true }); }
  assert.deepEqual(readBlocked(sandbox).filter(record => !['permission', 'device', 'local-exec'].includes(record.kind)), []);
});

test('S48 mounted settings and overlay show each model\'s own levels from the main process; default, session override and A→B→A stay honest', async () => {
  const require = createRequire(import.meta.url), compile = source => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText;
  const load = file => { const module = { exports: {} }; vm.runInNewContext(compile(fs.readFileSync(`${REPO}/${file}`, 'utf8')), { module, exports: module.exports, URL }); return module.exports; };
  const types = load('src/types/llmTarget.ts'), policyTypes = load('src/types/generationPolicy.ts'), codexTypes = load('src/types/codexSource.ts'), capTypes = load('src/types/modelCapabilities.ts');
  const targetApi = require(`${REPO}/dist-electron/electron/llm/llmTarget.js`), reasoningApi = require(`${REPO}/dist-electron/electron/llm/answerReasoning.js`);
  // Synthetic encrypted store in memory; nothing touches a real profile or keychain.
  const filename = '/synthetic/credentials.enc', files = new Map([[filename, Buffer.from('cipher:{}')]]);
  const fakeFs = { existsSync: file => files.has(file), readFileSync: file => files.get(file), unlinkSync: file => files.delete(file),
    writeFileSync(file, bytes) { files.set(file, Buffer.from(bytes)); }, renameSync(from, to) { files.set(to, files.get(from)); files.delete(from); } };
  const boot = () => {
    const module = { exports: {} };
    vm.runInNewContext(compile(fs.readFileSync(`${REPO}/electron/services/CredentialsManager.ts`, 'utf8')), { module, exports: module.exports, Buffer, URL, console: { log() {}, warn() {}, error() {} },
      require(id) {
        if (id === 'electron') return { app: { getPath: () => '/synthetic' }, safeStorage: { isEncryptionAvailable: () => true, encryptString: text => Buffer.from('cipher:' + text), decryptString: bytes => bytes.toString().slice(7) } };
        if (id === 'fs') return fakeFs;
        if (id === './outbound') return require(`${REPO}/dist-electron/electron/services/outbound.js`);
        if (id === '../utils/validateSttBaseUrl') return require(`${REPO}/dist-electron/electron/utils/validateSttBaseUrl.js`);
        if (id === '../../src/types/llmTarget') return types;
        if (id === '../../src/types/generationPolicy') return policyTypes;
        if (id === '../../src/types/codexSource') return codexTypes;
        if (id === '../../src/types/modelCapabilities') return capTypes;
        if (id === '../llm/llmTarget') return targetApi;
        if (id === '../llm/answerReasoning') return reasoningApi;
        return require(id);
      } });
    const instance = module.exports.CredentialsManager.getInstance(); instance.init(); return instance;
  };
  const manager = boot();
  assert.equal(manager.setProviderConfiguration({ provider: 'gemini', protocol: 'gemini', model: 'gemini-3.1-flash-lite',
    models: [{ model: 'gemini-3.1-pro-preview' }, { model: 'gemini-3.1-flash-lite-preview' }, { model: 'gemini-unlisted' }], apiKey: 'synthetic-gemini' }).ok, true);
  assert.equal(manager.setProviderConfiguration({ provider: 'claude', protocol: 'messages', model: 'claude-sonnet-4-6', models: [{ model: 'claude-opus-5-5' }], apiKey: 'synthetic-claude' }).ok, true);
  assert.equal(manager.setProviderConfiguration({ provider: 'openai', protocol: 'chat-completions', model: 'gpt-5.4', apiKey: 'synthetic-openai' }).ok, true);
  const gateway = manager.setGatewayConfiguration({ protocol: 'chat-completions', baseUrl: 'https://gateway.invalid/v1', model: 'gw-model', apiKey: 'synthetic-gateway' });
  assert.equal(gateway.ok, true);
  const SONNET = 'llm-target:claude:messages:claude-sonnet-4-6', OPUS = 'llm-target:claude:messages:claude-opus-5-5', GPT = 'llm-target:openai:chat-completions:gpt-5.4';
  const LITE = 'llm-target:gemini:gemini:gemini-3.1-flash-lite', PRO = 'llm-target:gemini:gemini:gemini-3.1-pro-preview', GATEWAY = `llm-gateway:${gateway.gatewayId}:chat-completions:gw-model`;
  assert.equal(manager.setDefaultModel(SONNET).ok, true);

  const electronId = require.resolve('electron'), previous = require.cache[electronId], userData = fs.mkdtempSync(path.join(os.tmpdir(), 's48-ui-'));
  const built = require.resolve(`${REPO}/dist-electron/electron/LLMHelper.js`), cachedHelper = require.cache[built]; delete require.cache[built];
  require.cache[electronId] = { id: electronId, filename: electronId, loaded: true, exports: { app: { getPath: () => userData, isPackaged: true, getVersion: () => 'synthetic' } } };
  let LLMHelper;
  try { ({ LLMHelper } = require(built)); }
  finally { if (previous) require.cache[electronId] = previous; else delete require.cache[electronId]; if (cachedHelper) require.cache[built] = cachedHelper; else delete require.cache[built]; }
  const helper = new LLMHelper(); helper.getProviderScopePolicy = () => ({});
  helper.testProviderConnection = async () => 'ANSWER';
  const processingHelper = { getLLMHelper: () => helper,
    applyStoredProvider: provider => helper.configureProvider(manager.getProviderConfigurations()[provider], manager.getProviderApiKey(provider)),
    applyStoredGateway: id => helper.configureGateway(manager.getGateways()[id], manager.getGatewayApiKey(id)), refreshAnswerRuntime() {} };
  for (const config of Object.values(manager.getProviderConfigurations())) processingHelper.applyStoredProvider(config.provider);
  processingHelper.applyStoredGateway(gateway.gatewayId);
  helper.setModel(manager.getDefaultModel()); helper.setGenerationPolicy(manager.getGenerationPolicy()); helper.setSavedReasoning(manager.getSavedReasoning());
  let page;
  const broadcasts = [];
  const appState = { processingHelper, modelSelectorWindowHelper: { hideWindow() {} },
    getAnswerReasoningState: notice => reasoningApi.answerReasoningState(manager, helper.getSessionReasoningState(), notice),
    broadcastAnswerReasoning: notice => { const state = JSON.parse(JSON.stringify(appState.getAnswerReasoningState(notice))); broadcasts.push(state); page?.evaluate(value => window.emitReasoning(value), state).catch(() => {}); },
    sendModelChanged: (_value, notice) => appState.broadcastAnswerReasoning(notice) };
  const arrow = (predicate, context) => {
    const source = fs.readFileSync(`${REPO}/electron/ipcHandlers.ts`, 'utf8'), ast = ts.createSourceFile('ipcHandlers.ts', source, ts.ScriptTarget.Latest, true); let found;
    const visit = node => { if (!found && predicate(node)) found = node.getText(ast); ts.forEachChild(node, visit); }; visit(ast); assert.ok(found);
    const module = { exports: {} }; vm.runInNewContext(compile(`module.exports = (${found});`), { module, exports: module.exports, console: { log() {}, warn() {}, error() {} }, ...context }); return module.exports;
  };
  const named = name => node => ts.isArrowFunction(node) && ts.isVariableDeclaration(node.parent) && node.parent.name.getText() === name;
  const context = { ...targetApi, LLM_PRESETS: types.LLM_PRESETS, ANSWER_PROVIDERS: types.ANSWER_PROVIDERS, modelTargetId: types.modelTargetId, providerCandidates: types.providerCandidates, appState,
    sanitizeErrorMessage: message => message, require: () => ({ CredentialsManager: { getInstance: () => manager } }) };
  context.persistCredentials = arrow(named('persistCredentials'), {});
  context.boundedProviderError = arrow(named('boundedProviderError'), { sanitizeErrorMessage: message => message });
  context.ANSWER_APPLY_WARNING = arrow(node => ts.isStringLiteral(node) && ts.isVariableDeclaration(node.parent) && node.parent.name.getText() === 'ANSWER_APPLY_WARNING', {});
  const handlers = {};
  const channels = { getGenerationPolicy: 'get-generation-policy', setGenerationPolicy: 'set-generation-policy', getStoredCredentials: 'get-stored-credentials', getDefaultModel: 'get-default-model',
    setDefaultModel: 'set-default-model', setProviderConfiguration: 'set-provider-configuration', testLlmConnection: 'test-llm-connection', setModel: 'set-model', getCurrentLlmConfig: 'get-current-llm-config',
    getAnswerReasoning: 'get-answer-reasoning', setDefaultReasoning: 'set-default-reasoning', setSessionReasoning: 'set-session-reasoning' };
  for (const channel of Object.values(channels)) {
    handlers[channel] = arrow(node => ts.isArrowFunction(node) && ts.isCallExpression(node.parent) && node.parent.expression.getText() === 'safeHandle' && node.parent.arguments[0]?.text === channel, context);
  }
  const preload = {};
  for (const name of Object.keys(channels)) {
    const source = fs.readFileSync(`${REPO}/electron/preload.ts`, 'utf8'), ast = ts.createSourceFile('preload.ts', source, ts.ScriptTarget.Latest, true); let found;
    const visit = node => { if (!found && ts.isArrowFunction(node) && ts.isPropertyAssignment(node.parent) && node.parent.name.getText() === name) found = node.getText(ast); ts.forEachChild(node, visit); }; visit(ast); assert.ok(found, name);
    const module = { exports: {} }; vm.runInNewContext(compile(`module.exports = (${found});`), { module, exports: module.exports, ipcRenderer: { invoke: (channel, ...args) => handlers[channel]({}, ...args) } });
    preload[name] = module.exports;
  }
  const call = async (name, args) => JSON.parse(JSON.stringify((await preload[name](...args)) ?? null));
  const bundle = await build({ stdin: { resolveDir: REPO, loader: 'tsx', contents: `
    import React from 'react'; import { createRoot } from 'react-dom/client'; import { flushSync } from 'react-dom';
    import { AIProvidersSettings as Settings } from './src/components/settings/AIProvidersSettings'; import NativelyInterface from './src/components/NativelyInterface';
    import { setUiLanguage } from './src/i18n';
    const memory = new Map(); Object.defineProperty(window, 'localStorage', { configurable: true, value: { getItem: key => memory.has(key) ? memory.get(key) : null, setItem: (key, value) => memory.set(key, String(value)), removeItem: key => memory.delete(key) } });
    const reasoning = new Set(); window.emitReasoning = state => { for (const listener of reasoning) listener(state); };
    window.reasoningWrites = [];
    const api = { getGroqFastTextMode: async () => ({ enabled: false }), getProviderDataScopes: async () => ({}), getCodexCliConfig: async () => ({ enabled: false, model: 'synthetic', fastModel: 'synthetic' }),
      onAnswerReasoningChanged: listener => { reasoning.add(listener); return () => reasoning.delete(listener); }, getMeetingActive: async () => true };
    for (const name of ${JSON.stringify(Object.keys(preload))}) api[name] = (...args) => { if (/Reasoning$/.test(name) && name.startsWith('set')) window.reasoningWrites.push([name, ...args]); return window.invokeMain(name, args); };
    window.electronAPI = new Proxy(api, { get(target, name) { if (name in target) return target[name]; if (String(name).startsWith('on')) return () => () => {}; return async () => undefined; } });
    window.language = setUiLanguage;
    createRoot(document.getElementById('settings')).render(React.createElement(Settings));
    createRoot(document.getElementById('overlay')).render(React.createElement(NativelyInterface));
  ` }, bundle: true, write: false, platform: 'browser', format: 'iife', loader: { '.svg': 'dataurl', '.png': 'dataurl', '.jpg': 'dataurl', '.css': 'empty' }, define: { 'process.env.NODE_ENV': '"production"', 'import.meta.env': '{}', __MARGIN_APP_NAME__: '"temp"' } });
  const sandbox = makeSandbox('s48-reasoning'); let app;
  try {
    ({ app } = await launchApp(sandbox, { NODE_ENV: 'production' })); await windowWithQuery(app, 'window=launcher', 30_000);
    const created = app.waitForEvent('window');
    await app.evaluate(async ({ BrowserWindow }) => { const win = new BrowserWindow({ show: false, width: 900, height: 1400, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
      await win.loadURL('data:text/html,<div id="settings"></div><div id="overlay"></div>'); });
    page = await created; const pageErrors = []; page.on('pageerror', error => pageErrors.push(error.message)); page.on('dialog', dialog => dialog.accept());
    const assets = path.join(REPO, 'dist/assets');
    for (const css of fs.readdirSync(assets).filter(name => name.endsWith('.css'))) await page.addStyleTag({ path: path.join(assets, css) });
    await page.exposeFunction('invokeMain', (name, args) => call(name, args));
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    const settings = page.locator('#settings'), overlay = page.locator('#overlay');
    const defaultControl = settings.getByRole('combobox', { name: 'Default reasoning', exact: true }), sessionControl = overlay.getByRole('combobox', { name: 'Reasoning for this meeting', exact: true });
    const primarySelect = settings.getByRole('combobox', { name: 'Primary model', exact: true });
    const values = locator => locator.locator('option').evaluateAll(options => options.map(option => option.value));
    const shows = async (locator, value, options) => {
      await page.waitForFunction(({ selector, value, options }) => { const node = document.querySelector(selector); return node && !node.disabled && node.value === value && JSON.stringify([...node.options].map(option => option.value)) === JSON.stringify(options); },
        { selector: await locator.evaluate(node => `#${node.closest('[id]').id} select[aria-label="${node.getAttribute('aria-label')}"]`), value, options });
    };
    const sent = () => { const task = helper.beginGenerationTask('interview'); try { return JSON.parse(JSON.stringify(task.primary.target.reasoning ?? null)); } finally { task.close(); } };
    const SONNET_LEVELS = ['default', 'off', 'low', 'medium', 'high', 'max'], OPUS_LEVELS = ['default', 'low', 'medium', 'high', 'xhigh', 'max'];
    const GPT_LEVELS = ['default', 'none', 'low', 'medium', 'high', 'xhigh'], LITE_LEVELS = ['default', 'minimal', 'low', 'medium', 'high'], PRO_LEVELS = ['default', 'low', 'medium', 'high'];
    await shows(defaultControl, 'default', SONNET_LEVELS); await shows(sessionControl, 'default', SONNET_LEVELS);
    assert.equal(await settings.locator('select[aria-label="Default reasoning"] option[value="off"]').textContent(), 'Reasoning off');
    assert.equal(await settings.locator('select[aria-label="Default reasoning"] option[value="default"]').textContent(), 'Provider default');

    // Saving the default reaches the saved file, the next request and the overlay; it switches no model.
    await defaultControl.selectOption('max');
    await shows(sessionControl, 'max', SONNET_LEVELS);
    assert.deepEqual(JSON.parse(JSON.stringify(boot().getSavedReasoning())), { choice: 'max' });
    assert.equal(helper.getCurrentModelSelection(), SONNET); assert.deepEqual(sent(), { thinking: 'adaptive', effort: 'max' });

    // A → B → A: options follow the exact model; an unavailable level becomes the provider default with a notice.
    await primarySelect.selectOption(OPUS);
    await shows(defaultControl, 'max', OPUS_LEVELS); await shows(sessionControl, 'max', OPUS_LEVELS);
    assert.deepEqual(sent(), { effort: 'max' }, 'Opus never receives a thinking field');
    await primarySelect.selectOption(GPT);
    await shows(defaultControl, 'default', GPT_LEVELS); await shows(sessionControl, 'default', GPT_LEVELS);
    await settings.getByText('The selected reasoning level is not available for this model, so the provider default is used.').first().waitFor();
    assert.deepEqual(JSON.parse(JSON.stringify(boot().getSavedReasoning())), { choice: 'default' }); assert.equal(sent(), null);
    await primarySelect.selectOption(SONNET);
    await shows(defaultControl, 'default', SONNET_LEVELS); await shows(sessionControl, 'default', SONNET_LEVELS);
    assert.equal(sent(), null, 'returning to A restores no hidden per-model level');
    for (const [model, levels] of [[LITE, LITE_LEVELS], [PRO, PRO_LEVELS]]) { await primarySelect.selectOption(model); await shows(defaultControl, 'default', levels); }

    // The session override lives in the main process; the saved default is untouched.
    await primarySelect.selectOption(SONNET); await shows(sessionControl, 'default', SONNET_LEVELS);
    await defaultControl.selectOption('high'); await shows(sessionControl, 'high', SONNET_LEVELS);
    const stored = files.get(filename);
    await sessionControl.selectOption('low');
    await page.waitForFunction(() => window.reasoningWrites.some(write => write[0] === 'setSessionReasoning' && write[2] === 'low'));
    await shows(sessionControl, 'low', SONNET_LEVELS); await shows(defaultControl, 'high', SONNET_LEVELS);
    assert.deepEqual(sent(), { thinking: 'adaptive', effort: 'low' }); assert.deepEqual(files.get(filename), stored, 'the session override is not saved');
    assert.deepEqual(JSON.parse(JSON.stringify(helper.getSessionReasoningState())).overridden, true);
    // A late write from a window that still shows the old model is refused; the overlay re-reads the main state.
    helper.setModel(OPUS);
    await sessionControl.selectOption('high');
    await shows(sessionControl, 'low', OPUS_LEVELS);
    assert.deepEqual(sent(), { effort: 'low' }, 'the refused write changed nothing');
    assert.deepEqual(await page.evaluate(() => window.reasoningWrites.at(-1)), ['setSessionReasoning', SONNET, 'high'], 'the overlay named the model it showed');
    helper.setModel(SONNET); helper.clearSessionReasoning(); appState.broadcastAnswerReasoning();
    await shows(sessionControl, 'high', SONNET_LEVELS);

    // Gateways set reasoning in their own configuration: the shared control is disabled and explains why.
    await primarySelect.selectOption(GATEWAY);
    await page.waitForFunction(() => { const node = document.querySelector('#settings select[aria-label="Default reasoning"]'); return node.disabled && node.options[0].textContent === 'Set in the gateway or Codex configuration'; });
    assert.equal(await sessionControl.isDisabled(), true);
    // A gateway does not take the shared level, so it is neither applied nor reset; back on Sonnet it applies again.
    assert.deepEqual(JSON.parse(JSON.stringify(boot().getSavedReasoning())), { choice: 'high' });
    await primarySelect.selectOption(SONNET); await shows(defaultControl, 'high', SONNET_LEVELS);

    // Provider cards: no per-model reasoning or image confirmation; capability text from the record.
    await page.getByRole('button', { name: /^Gemini/ }).click();
    const cloud = page.getByRole('tabpanel', { name: 'Cloud services', exact: true }), edit = cloud.getByRole('combobox', { name: 'Gemini model', exact: true });
    assert.equal(await cloud.getByRole('combobox', { name: /^(OpenAI|Gemini|Claude|DeepSeek) (thinking|reasoning effort)$/ }).count(), 0);
    const officialImageBox = cloud.getByRole('checkbox', { name: /^(OpenAI|Gemini|Claude|DeepSeek) model supports images$/ });
    assert.equal(await officialImageBox.count(), 0, 'no image confirmation checkbox');
    // Each card shows its own lines; read the Gemini card body that holds the edited model.
    const card = () => edit.evaluate(node => node.closest('[id]').innerText);
    const retired = 'Google shut down Gemini 3.1 Flash-Lite Preview on 2026-05-25. Choose gemini-3.1-flash-lite instead.';
    assert.match(await card(), /Image input: supported according to the official model record\./); assert.doesNotMatch(await card(), /shut down/);
    await edit.selectOption('gemini-3.1-flash-lite-preview');
    await page.waitForFunction(text => document.querySelector('select[aria-label="Gemini model"]').closest('[id]').querySelector('[role="note"]')?.textContent === text, retired);
    assert.match(await card(), /Image input: supported according to the official model record\./);
    await edit.selectOption('gemini-unlisted');
    await page.waitForFunction(() => document.querySelector('select[aria-label="Gemini model"]').closest('[id]').innerText.includes('Image input has not been verified for this model yet. Image questions are refused before sending; text works.'));
    assert.doesNotMatch(await card(), /shut down/);
    assert.equal(await officialImageBox.count(), 0);
    assert.deepEqual(await values(primarySelect).then(list => list.filter(value => value.includes('flash-lite-preview'))), ['llm-target:gemini:gemini:gemini-3.1-flash-lite-preview'], 'the retired preview stays selectable, never replaced');

    // The overlay shell has a fixed width (600px collapsed, the narrowest real window; 780px expanded) and the window follows it.
    // Inside the shell the bottom row keeps the model button, the reasoning control and send apart, and the control never covers Answer/Stop.
    const measure = () => page.evaluate(async () => {
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const select = document.querySelector('#overlay select[aria-label="Reasoning for this meeting"], #overlay select[aria-label="本次会议推理强度"]');
      const shell = select.closest('.overlay-shell-surface'), outer = shell.getBoundingClientRect();
      const box = node => { const r = node?.getBoundingClientRect(); return r && r.width > 0 ? { left: r.left, right: r.right, top: r.top, bottom: r.bottom } : null; };
      const answer = [...shell.querySelectorAll('button')].find(node => /^(Answer|Stop|回答|停止)$/.test(node.textContent.trim()));
      const row = select.closest('.justify-between');
      return { shell: { left: outer.left, right: outer.right, width: outer.width }, model: box(shell.querySelector('[data-model-selector-toggle]')), reasoning: box(select), answer: box(answer), send: box(row?.lastElementChild) };
    });
    const apart = (a, b) => a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top;
    const layoutHolds = boxes => {
      assert.equal(Math.round(boxes.shell.width), 600, 'collapsed shell width');
      for (const name of ['model', 'reasoning', 'answer', 'send']) {
        assert.ok(boxes[name], `${name} is rendered`);
        assert.ok(boxes[name].left >= boxes.shell.left - 1 && boxes[name].right <= boxes.shell.right + 1, `${name} stays inside the shell ${JSON.stringify(boxes)}`);
      }
      for (const [a, b] of [['model', 'reasoning'], ['reasoning', 'send'], ['model', 'send'], ['reasoning', 'answer']]) assert.ok(apart(boxes[a], boxes[b]), `${a} and ${b} do not overlap`);
    };
    layoutHolds(await measure());

    // Chinese accessible names and option texts.
    await page.evaluate(() => window.language('zh-CN'));
    await page.locator('#settings').getByRole('combobox', { name: '默认推理强度', exact: true }).waitFor();
    await overlay.getByRole('combobox', { name: '本次会议推理强度', exact: true }).waitFor();
    assert.equal(await settings.locator('select[aria-label="默认推理强度"] option[value="default"]').textContent(), '服务商默认');
    assert.equal(await settings.locator('select[aria-label="默认推理强度"] option[value="off"]').textContent(), '关闭推理');
    layoutHolds(await measure());
    assert.deepEqual(pageErrors, []);
    await page.close();
  } finally { if (app) await app.close(); helper.scrubKeys(); fs.rmSync(userData, { recursive: true, force: true }); }
  assert.deepEqual(readBlocked(sandbox).filter(record => !['permission', 'device', 'local-exec'].includes(record.kind)), []);
});

test('S42-01 mounted domestic STT settings save, reload and test the chosen workspace and resource without returning keys', async () => {
  const require = createRequire(import.meta.url), compile = source => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText;
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'margin-s42-stt-')), storage = { fail: false };
  const safeStorage = { isEncryptionAvailable: () => true, decryptString: bytes => bytes.toString().slice(7),
    encryptString(text) { if (storage.fail) throw Error('synthetic encryption failure'); return Buffer.from('cipher:' + text); } };
  const managerId = require.resolve(`${REPO}/dist-electron/electron/services/CredentialsManager.js`), electronId = require.resolve('electron');
  const previousManagerModule = require.cache[managerId];
  // A fresh module reads the saved file again, as after a restart.
  const boot = () => {
    const previous = require.cache[electronId];
    require.cache[electronId] = { id: electronId, filename: electronId, loaded: true, exports: { app: { getPath: () => userData, isPackaged: true }, safeStorage } };
    delete require.cache[managerId];
    try { const manager = require(managerId).CredentialsManager.getInstance(); assert.equal(manager.init().ok, true); return manager; }
    finally { if (previous) require.cache[electronId] = previous; else delete require.cache[electronId]; }
  };
  let manager = boot();
  const created = [], replies = [], calls = [];
  class Stream extends EventEmitter {
    constructor(key, options) { super(); created.push({ provider: new.target.name, key, options: { ...options } }); }
    start() {} write() {} async finalize() { this.emit('completed'); } stop() {}
  }
  class AliyunStreamingSTT extends Stream {}
  class DoubaoStreamingSTT extends Stream {}
  const stt = { exports: {} };
  vm.runInNewContext(compile(fs.readFileSync(`${REPO}/electron/ipc/sttHandlers.ts`, 'utf8')), { module: stt, exports: stt.exports, Buffer,
    require: id => id === '../services/CredentialsManager' ? { CredentialsManager: { getInstance: () => manager } }
      : id === '../audio/AliyunStreamingSTT' ? { AliyunStreamingSTT } : id === '../audio/DoubaoStreamingSTT' ? { DoubaoStreamingSTT } : require(id) });
  const handlers = new Map();
  stt.exports.registerDomesticSttHandlers((channel, listener) => handlers.set(channel, listener), async () => {});
  const ipcRenderer = { async invoke(channel, ...args) {
    calls.push([channel, args]);
    const reply = JSON.stringify(await handlers.get(channel)({}, ...args));
    replies.push(reply);
    return JSON.parse(reply);
  } };
  const preload = fs.readFileSync(`${REPO}/electron/preload.ts`, 'utf8'), tree = ts.createSourceFile('preload.ts', preload, ts.ScriptTarget.Latest, true), bridge = {};
  const visit = node => {
    if (ts.isPropertyAssignment(node) && ['getDomesticStt', 'saveDomesticStt', 'testDomesticStt'].includes(node.name.getText(tree))) {
      const module = { exports: {} };
      vm.runInNewContext(compile(`module.exports = (${node.initializer.getText(tree)});`), { module, exports: module.exports, ipcRenderer });
      bridge[node.name.getText(tree)] = module.exports;
    }
    ts.forEachChild(node, visit);
  };
  visit(tree);
  assert.deepEqual(Object.keys(bridge).sort(), ['getDomesticStt', 'saveDomesticStt', 'testDomesticStt']);
  const bundle = await build({ stdin: { resolveDir: REPO, loader: 'tsx', contents: `
    import React from 'react'; import { createRoot } from 'react-dom/client'; import { flushSync } from 'react-dom';
    import { SpeechProviderSettings } from './src/components/settings/SpeechProviderSettings';
    window.electronAPI = { getDomesticStt: provider => window.invokeStt('getDomesticStt', [provider]),
      saveDomesticStt: (provider, input) => window.invokeStt('saveDomesticStt', [provider, input]), testDomesticStt: provider => window.invokeStt('testDomesticStt', [provider]) };
    const root = createRoot(document.getElementById('root')); let mount = 0;
    window.show = provider => flushSync(() => root.render(React.createElement(SpeechProviderSettings, { key: mount++, provider })));
  ` }, bundle: true, write: false, platform: 'browser', format: 'iife', define: { 'process.env.NODE_ENV': '"production"' } });
  const sandbox = makeSandbox('s42-domestic-stt'); let app;
  try {
    ({ app } = await launchApp(sandbox, { NODE_ENV: 'production' })); await windowWithQuery(app, 'window=launcher', 30_000);
    const opened = app.waitForEvent('window');
    await app.evaluate(async ({ BrowserWindow }) => { const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } }); await win.loadURL('data:text/html,<div id="root"></div>'); });
    const page = await opened; await page.exposeFunction('invokeStt', (name, args) => bridge[name](...args)); await page.addScriptTag({ content: bundle.outputFiles[0].text });
    const status = text => page.waitForFunction(value => document.querySelector('[role="status"]')?.textContent === value, text);
    const show = async provider => {
      const loads = calls.filter(([channel]) => channel === 'get-domestic-stt').length;
      await page.evaluate(value => window.show(value), provider);
      while (replies.length < calls.length || calls.filter(([channel]) => channel === 'get-domestic-stt').length === loads) await new Promise(resolve => setTimeout(resolve, 25));
      await page.waitForTimeout(100);
    };
    const button = name => page.getByRole('button', { name, exact: true });

    await show('doubao');
    const resource = page.getByLabel('Resource type');
    assert.equal(await resource.inputValue(), 'volc.seedasr.sauc.duration', 'hourly until the user chooses');
    await resource.selectOption('volc.seedasr.sauc.concurrent');
    await page.getByLabel('API key / Access Key').fill('synthetic-doubao-key');
    await button('Save').click(); await status('Saved');
    assert.deepEqual(JSON.parse(JSON.stringify(boot().getDomesticStt('doubao'))),
      { key: 'synthetic-doubao-key', workspaceId: '', appId: '', resourceId: 'volc.seedasr.sauc.concurrent' });
    manager = boot();
    await button('Test connection').click(); await status('Connected');
    assert.deepEqual(created.at(-1), { provider: 'DoubaoStreamingSTT', key: 'synthetic-doubao-key', options: { appId: '', resourceId: 'volc.seedasr.sauc.concurrent' } });
    await show('doubao');
    assert.equal(await resource.inputValue(), 'volc.seedasr.sauc.concurrent', 'the saved choice is shown again');

    storage.fail = true;
    await resource.selectOption('volc.seedasr.sauc.duration');
    await page.getByLabel('API key / Access Key').fill('synthetic-replacement-key');
    await button('Save').click(); await status('Credentials could not be saved. The previous credentials were kept.');
    storage.fail = false;
    assert.equal(boot().getDomesticStt('doubao').resourceId, 'volc.seedasr.sauc.concurrent');
    assert.equal(boot().getDomesticStt('doubao').key, 'synthetic-doubao-key');
    const invalid = await page.evaluate(() => window.electronAPI.saveDomesticStt('doubao', { key: 'synthetic-invalid-key', workspaceId: '', appId: '', resourceId: 'volc.seedasr.sauc.unknown' }));
    assert.equal(invalid.ok, false);
    assert.equal(boot().getDomesticStt('doubao').key, 'synthetic-doubao-key');

    await button('Delete credentials').click(); await status('Saved');
    manager = boot();
    assert.equal(manager.getDomesticStt('doubao'), undefined);
    assert.equal(await button('Test connection').isDisabled(), true);
    const constructed = created.length;
    assert.deepEqual(await page.evaluate(() => window.electronAPI.testDomesticStt('doubao')), { success: false, error: 'Save STT credentials first.' });
    assert.equal(stt.exports.createDomesticStt('doubao'), null);
    assert.equal(created.length, constructed, 'deleted credentials construct no connection');

    await show('aliyun');
    const workspace = page.getByLabel('Workspace ID');
    assert.equal(await workspace.inputValue(), '');
    await page.getByLabel('API key / Access Key').fill('synthetic-aliyun-key');
    await button('Save').click(); await status('Saved');
    manager = boot();
    await button('Test connection').click(); await status('Connected');
    assert.deepEqual(created.at(-1), { provider: 'AliyunStreamingSTT', key: 'synthetic-aliyun-key', options: { workspaceId: '' } });
    await workspace.fill('evil.example');
    await page.getByLabel('API key / Access Key').fill('synthetic-other-key');
    await button('Save').click(); await status('Invalid STT configuration; previous credentials kept.');
    assert.deepEqual(JSON.parse(JSON.stringify(boot().getDomesticStt('aliyun'))), { key: 'synthetic-aliyun-key', workspaceId: '', appId: '' });
    await workspace.fill('ws_01');
    await page.getByLabel('API key / Access Key').fill('synthetic-aliyun-key');
    await button('Save').click(); await status('Saved');
    manager = boot();
    await button('Test connection').click(); await status('Connected');
    assert.deepEqual(created.at(-1).options, { workspaceId: 'ws_01' });

    assert.doesNotMatch(replies.join('\n'), /synthetic-[a-z]+-key/, 'no IPC reply returns a key');
    await page.close();
  } finally {
    if (app) await app.close();
    fs.rmSync(userData, { recursive: true, force: true });
    if (previousManagerModule) require.cache[managerId] = previousManagerModule; else delete require.cache[managerId];
  }
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

// Failed meeting save (PLAN §8): the mounted Launcher banner listens before it queries,
// ignores a query reply older than an event, is highlighted when Start is refused,
// disables both commands while one runs, keeps the meeting after a failed retry or a
// cancelled discard, and removes its listener on unmount. No outbound action.
test('mounted Launcher unsaved meeting banner orders query and events, guards commands and confirms discard', async () => {
  const bundle = await build({ stdin: { resolveDir: REPO, loader: 'tsx', contents: `
    import React from 'react'; import { createRoot } from 'react-dom/client';
    import Launcher from './src/components/Launcher';
    const listeners = new Map(); const subscribe = (name, fn) => { const set = listeners.get(name) || new Set(); set.add(fn); listeners.set(name, set); return () => set.delete(fn); };
    window.listenerCount = name => listeners.get(name)?.size || 0;
    window.emit = (name, value) => { for (const fn of listeners.get(name) || []) fn(value); };
    window.forbidden = []; window.queries = []; window.commands = []; window.pending = []; window.starts = 0;
    const forbid = name => { window.forbidden.push(name); throw Error('Forbidden action: ' + name); };
    window.fetch = () => forbid('fetch'); window.WebSocket = function() { forbid('WebSocket'); };
    const deferred = kind => (id) => new Promise(resolve => { window.commands.push([kind, id]); window.pending.push(resolve); });
    const api = {
      getUnsavedMeeting: () => new Promise(resolve => { window.queries.push(window.listenerCount('onUnsavedMeetingChanged')); window.pending.push(resolve); }),
      retryUnsavedMeeting: deferred('retry'), discardUnsavedMeeting: deferred('discard'),
      getCurrentLlmConfig: async () => ({ provider: 'openai', model: 'synthetic' }),
      getStoredCredentials: async () => ({ providerConfigurations: {}, sttProvider: 'none' }),
      checkPermissions: async () => ({ platform: 'darwin', microphone: 'granted', screen: 'granted' }),
      getCodexCliConfig: async () => ({ enabled: false }), getWindowPreferences: async () => [],
      getKeybindStatus: async () => ({ success: true, keybinds: [], failedActions: [] }),
      getRecentMeetings: async () => [], getMeetingActive: async () => false, seedDemo: async () => ({ success: true })
    };
    window.electronAPI = new Proxy(api, { get(target, name) {
      if (name in target) return target[name];
      if (String(name).startsWith('on')) return fn => subscribe(name, fn);
      if (/^(test|fetch|request|start|capture)/i.test(String(name))) return () => forbid(String(name));
      return async () => undefined;
    } });
    const root = createRoot(document.getElementById('root'));
    root.render(React.createElement(Launcher, {
      settingsOpen: true, onOpenSettings() {}, onReviewPermissions() {},
      async onStartMeeting() { window.starts++; return { success: false, error: 'refused', code: 'pending-unsaved-meeting' }; }
    }));
    window.unmountConsumer = () => root.unmount();
  ` }, bundle: true, write: false, loader: { '.png': 'dataurl', '.jpg': 'dataurl', '.svg': 'dataurl', '.css': 'empty' }, platform: 'browser', format: 'iife', define: { 'process.env.NODE_ENV': '"production"', 'import.meta.env': '{}', __MARGIN_APP_NAME__: '"temp"' } });
  const sandbox = makeSandbox('unsaved-meeting-banner'); let app;
  try {
    ({ app } = await launchApp(sandbox, { NODE_ENV: 'production' }));
    await windowWithQuery(app, 'window=launcher', 30_000);
    const opened = app.waitForEvent('window');
    await app.evaluate(async ({ BrowserWindow }) => { const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } }); await win.loadURL('data:text/html,<div id="root"></div>'); });
    const page = await opened, pageErrors = []; page.on('pageerror', error => pageErrors.push(error.message));
    await page.evaluate(() => {
      const storage = new Map();
      Object.defineProperty(window, 'localStorage', { value: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, String(value)), removeItem: key => storage.delete(key) } });
    });
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    const banner = page.getByTestId('unsaved-meeting-banner');
    const meeting = (id, reason) => ({ id, startedAt: Date.UTC(2026, 9, 17, 9, 0), durationMs: 125_000, transcriptCount: 7, reason });
    const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const resolveNext = value => page.evaluate(v => window.pending.shift()(v), value);

    // The listener exists when the query is sent; an event wins over the older reply.
    await page.waitForFunction(() => window.queries.length === 1);
    assert.deepEqual(await page.evaluate(() => window.queries), [1]);
    await page.evaluate(m => window.emit('onUnsavedMeetingChanged', m), meeting('A', 'write-error'));
    await banner.waitFor();
    await resolveNext(null); await settle();
    assert.equal(await banner.count(), 1, 'the older query reply does not hide the banner');
    const text = await banner.innerText();
    assert.match(text, /2:05 · 7 transcript lines/);
    assert.match(text, /Writing to the meeting database failed\./);
    assert.match(text, /kept only in memory and will be lost if the app quits or crashes/);
    assert.equal(await banner.getByRole('button', { name: /close|dismiss/i }).count(), 0, 'no close control');

    // A refused Start highlights the banner.
    await page.getByRole('button', { name: /Start temp$/ }).click();
    await page.waitForFunction(() => document.querySelector('[data-testid="unsaved-meeting-banner"]')?.dataset.highlighted === 'true');
    assert.equal(await page.evaluate(() => window.starts), 1);
    await banner.getByRole('alert').filter({ hasText: 'Save or discard this meeting before starting a new one.' }).waitFor();
    await page.waitForFunction(() => window.queries.length === 2);
    await resolveNext(meeting('A', 'write-error')); // the refusal re-reads the state

    // Retry: both commands are disabled while it runs; a failed retry keeps the meeting.
    await banner.getByRole('button', { name: 'Retry save', exact: true }).click();
    await banner.getByRole('button', { name: 'Saving…', exact: true }).waitFor();
    assert.equal(await banner.getByRole('button', { name: 'Saving…', exact: true }).isDisabled(), true);
    assert.equal(await banner.getByRole('button', { name: 'Discard', exact: true }).isDisabled(), true);
    await page.evaluate(m => window.emit('onUnsavedMeetingChanged', m), meeting('A', 'database-unavailable'));
    await resolveNext({ ok: false, code: 'save-failed', reason: 'database-unavailable' });
    await banner.getByRole('alert').filter({ hasText: 'The meeting could not be saved. It is still kept in memory.' }).waitFor();
    assert.match(await banner.innerText(), /database is unavailable, so retrying may not work/);
    assert.equal(await banner.getByRole('button', { name: 'Retry save', exact: true }).isDisabled(), false);

    // Discard asks first; Escape and Cancel keep the meeting without a command.
    await banner.getByRole('button', { name: 'Discard', exact: true }).click();
    const dialog = banner.getByRole('alertdialog');
    await dialog.waitFor();
    assert.match(await dialog.innerText(), /permanently lost/);
    assert.equal(await page.evaluate(() => document.activeElement?.textContent), 'Cancel', 'focus moves to Cancel');
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'detached' });
    await banner.getByRole('button', { name: 'Discard', exact: true }).click();
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await dialog.waitFor({ state: 'detached' });
    assert.deepEqual(await page.evaluate(() => window.commands), [['retry', 'A']], 'cancelling sends nothing');
    await banner.getByRole('button', { name: 'Discard', exact: true }).click();
    await dialog.getByRole('button', { name: 'Discard permanently', exact: true }).click();
    assert.equal(await dialog.getByRole('button', { name: 'Discard permanently', exact: true }).isDisabled(), true);
    await resolveNext({ ok: true });
    await banner.waitFor({ state: 'detached' });
    assert.deepEqual(await page.evaluate(() => window.commands), [['retry', 'A'], ['discard', 'A']]);

    // A later meeting: a successful retry removes the banner.
    await page.evaluate(m => window.emit('onUnsavedMeetingChanged', m), meeting('B', 'write-error'));
    await banner.waitFor();
    assert.equal(await banner.getAttribute('data-highlighted'), null, 'the earlier highlight belonged to the resolved meeting');
    await banner.getByRole('button', { name: 'Retry save', exact: true }).click();
    await resolveNext({ ok: true });
    await banner.waitFor({ state: 'detached' });
    assert.deepEqual(await page.evaluate(() => window.commands.at(-1)), ['retry', 'B']);

    await page.evaluate(() => window.unmountConsumer());
    assert.equal(await page.evaluate(() => window.listenerCount('onUnsavedMeetingChanged')), 0, 'the listener is removed on unmount');
    assert.deepEqual(await page.evaluate(() => window.forbidden), []); assert.deepEqual(pageErrors, []);
    await page.close();
  } finally { if (app) await app.close(); }
  assert.deepEqual(readBlocked(sandbox).filter(record => !['permission', 'device', 'local-exec'].includes(record.kind)), []);
});
