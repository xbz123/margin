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

test('S44 mounted AI provider settings put answer models first and send per-target reasoning to the real protocol request', async () => {
  const require = createRequire(import.meta.url), electronId = require.resolve('electron'), previous = require.cache[electronId];
  require.cache[electronId] = { id: electronId, filename: electronId, loaded: true, exports: { app: { getPath: () => fs.mkdtempSync(path.join(os.tmpdir(), 's44-ui-')), isPackaged: true, getVersion: () => 'synthetic' } } };
  let LLMHelper, targetApi;
  try { ({ LLMHelper } = require(`${REPO}/dist-electron/electron/LLMHelper.js`)); targetApi = require(`${REPO}/dist-electron/electron/llm/llmTarget.js`); }
  finally { if (previous) require.cache[electronId] = previous; else delete require.cache[electronId]; }
  const bodies = [];
  const server = http.createServer(async (req, res) => {
    let body = ''; for await (const part of req) body += part;
    bodies.push(JSON.parse(body)); res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ choices: [{ message: { content: 'ANSWER' }, finish_reason: 'stop' }] }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const gateway = `http://127.0.0.1:${server.address().port}/v1`;
  const bundle = await build({ stdin: { resolveDir: REPO, loader: 'tsx', contents: `
    import React from 'react'; import { createRoot } from 'react-dom/client'; import { flushSync } from 'react-dom';
    import { AIProvidersSettings as Settings } from './src/components/settings/AIProvidersSettings'; import { LLM_PRESETS } from './src/types/llmTarget';
    import { DEFAULT_GENERATION_POLICY as POLICY } from './src/types/generationPolicy';
    window.saved = [];
    window.electronAPI = { getGenerationPolicy: async () => POLICY,
      getStoredCredentials: async () => ({ providerConfigurations: LLM_PRESETS, hasOpenaiKey: true }),
      getGroqFastTextMode: async () => ({ enabled: false }), getDefaultModel: async () => ({ model: 'llm-target:openai:chat-completions:gpt-5.4' }), getProviderDataScopes: async () => ({}),
      getCodexCliConfig: async () => ({ enabled: false, model: 'synthetic', fastModel: 'synthetic' }),
      setProviderConfiguration: async value => { window.saved.push(value); return { ok: true }; } };
    const root = createRoot(document.getElementById('root')); window.show = () => flushSync(() => root.render(React.createElement(Settings)));
  ` }, bundle: true, write: false, platform: 'browser', format: 'iife', loader: { '.svg': 'dataurl', '.png': 'dataurl', '.css': 'empty' }, define: { 'process.env.NODE_ENV': '"production"', __MARGIN_APP_NAME__: '"temp"' } });
  const sandbox = makeSandbox('s44-provider-settings'); let app;
  try {
    ({ app } = await launchApp(sandbox, { NODE_ENV: 'production' })); await windowWithQuery(app, 'window=launcher', 30_000);
    const created = app.waitForEvent('window'); await app.evaluate(async ({ BrowserWindow }) => { const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } }); await win.loadURL('data:text/html,<div id="root"></div>'); });
    const page = await created; await page.addScriptTag({ content: bundle.outputFiles[0].text }); await page.evaluate(() => window.show());
    const effort = page.getByRole('combobox', { name: 'OpenAI reasoning effort', exact: true });
    await effort.waitFor();
    const text = await page.locator('body').innerText();
    assert.ok(text.indexOf('Answer models') < text.indexOf('Backup model') && text.indexOf('Backup model') < text.indexOf('Cloud Providers'), 'primary and backup lead the page');
    assert.ok(text.indexOf('Generation limits') < text.indexOf('Cloud Providers'));
    assert.match(text, /Cloud provider data scopes/);
    const options = async () => (await effort.locator('option').allTextContents());
    assert.deepEqual((await options()).slice(1), ['none', 'low', 'medium', 'high', 'xhigh'], 'documented gpt-5.4 values on the official endpoint');
    assert.match(text, /Vendor-documented context window: 1,050,000 tokens; maximum output: 128,000 tokens/);
    assert.equal(await page.getByRole('spinbutton', { name: 'OpenAI context window' }).count(), 0, 'no capacity field for the official endpoint');
    await effort.selectOption('xhigh');
    await page.getByRole('textbox', { name: 'OpenAI API base URL', exact: true }).fill(gateway);
    assert.equal(await effort.inputValue(), '', 'changing the endpoint clears the previous target setting');
    assert.deepEqual((await options()).slice(1), ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'], 'a gateway gets protocol values, not a vendor claim');
    assert.match(await page.locator('body').innerText(), /Reasoning values come from the protocol/);
    await page.getByRole('spinbutton', { name: 'OpenAI context window', exact: true }).fill('4096');
    await effort.selectOption('max');
    const save = page.getByRole('button', { name: 'Save', exact: true });
    for (let index = 0; index < await save.count(); index++) if (await save.nth(index).isEnabled()) await save.nth(index).click();
    await page.waitForFunction(() => window.saved.length === 1);
    const [payload] = await page.evaluate(() => JSON.parse(JSON.stringify(window.saved)));
    assert.deepEqual(payload, { provider: 'openai', protocol: 'chat-completions', model: 'gpt-5.4', baseUrl: gateway, reasoning: { effort: 'max' }, contextWindowTokens: 4096 });
    // Per-model settings never carry over to another model, protocol or an official address.
    const context = page.getByRole('spinbutton', { name: 'OpenAI context window', exact: true });
    await page.getByRole('textbox', { name: 'OpenAI model ID', exact: true }).fill('gpt-5.4-other');
    assert.equal(await effort.inputValue(), ''); assert.equal(await context.inputValue(), '');
    await context.fill('2048'); await effort.selectOption('high');
    await page.getByRole('combobox', { name: 'OpenAI protocol', exact: true }).selectOption('responses');
    assert.equal(await effort.inputValue(), ''); assert.equal(await context.inputValue(), '');
    await context.fill('2048');
    await page.getByRole('textbox', { name: 'OpenAI API base URL', exact: true }).fill('https://api.openai.com/v1');
    assert.equal(await context.count(), 0, 'the gateway-only note is gone for the explicit official address');
    assert.equal(await page.getByRole('alert').count(), 0);
    await page.waitForFunction(() => ![...document.querySelectorAll('button')].some(button => button.textContent === 'Saved!'));
    for (let index = 0; index < await save.count(); index++) if (await save.nth(index).isEnabled()) await save.nth(index).click();
    await page.waitForFunction(() => window.saved.length === 2);
    const official = await page.evaluate(() => JSON.parse(JSON.stringify(window.saved[1])));
    assert.deepEqual(official, { provider: 'openai', protocol: 'responses', model: 'gpt-5.4-other', baseUrl: 'https://api.openai.com/v1' });
    assert.doesNotThrow(() => targetApi.validateProviderConfiguration(official));
    await page.close();
    const helper = new LLMHelper(); helper.getProviderScopePolicy = () => ({});
    helper.configureProvider(targetApi.validateProviderConfiguration(payload), 'synthetic-only');
    helper.setModel('llm-target:openai:chat-completions:gpt-5.4');
    assert.equal(await helper.generateContentStructured('USER'), 'ANSWER');
    assert.equal(bodies.length, 1); assert.equal(bodies[0].reasoning_effort, 'max'); assert.equal(bodies[0].model, 'gpt-5.4');
  } finally { if (app) await app.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
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
