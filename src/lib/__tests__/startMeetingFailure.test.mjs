import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';
import { REPO } from '../../../scripts/margin/isolation/env.mjs';

const require = createRequire(import.meta.url);
const loaded = new Map();
function sourceModule(file, globals = {}) {
  if (loaded.has(file)) return loaded.get(file);
  const module = { exports: {} };
  const compiled = ts.transpileModule(fs.readFileSync(`${REPO}/${file}`, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  vm.runInNewContext(compiled, {
    ...globals, module, exports: module.exports,
    require: id => id === './i18n.zh' ? sourceModule('src/i18n.zh.ts')
      : id === '../i18n' ? sourceModule('src/i18n.tsx')
      : id === '../lib/startMeetingFailure' ? sourceModule('src/lib/startMeetingFailure.ts') : require(id),
  });
  loaded.set(file, module.exports);
  return module.exports;
}

const failure = sourceModule('src/lib/startMeetingFailure.ts');
const { describeStartFailure } = failure;

// Exact messages main throws (CredentialsManager.requireSttConfigured, formatPermissionMessage('mic-denied')).
const STT_ERROR = 'STT is not configured. Select a speech provider and save its credentials before starting a meeting. / 请先选择语音服务商并保存凭据。';
const MIC_ERROR_MAC = 'Microphone access denied. Please allow microphone access in System Settings → Privacy & Security → Microphone, then restart Margin.';
const MIC_ERROR_WIN = 'Microphone access denied. Please allow microphone access in Settings → Privacy → Microphone, then restart Margin.';

test('missing speech credentials map to the audio settings action', () => {
  const result = describeStartFailure({ success: false, error: STT_ERROR }, { isMac: false });
  assert.equal(result.kind, 'stt-not-configured');
  assert.equal(result.message, failure.START_FAILURE_STT_NOT_CONFIGURED);
  assert.equal(result.reason, undefined);
});

test('a denied microphone maps to platform-specific guidance', () => {
  const mac = describeStartFailure({ success: false, error: MIC_ERROR_MAC }, { isMac: true });
  assert.equal(mac.kind, 'microphone-denied');
  assert.equal(mac.message, failure.START_FAILURE_MIC_DENIED_MAC);
  const win = describeStartFailure({ success: false, error: MIC_ERROR_WIN }, { isMac: false });
  assert.equal(win.kind, 'microphone-denied');
  assert.equal(win.message, failure.START_FAILURE_MIC_DENIED_OTHER);
});

test('success, the unsaved-meeting refusal, quitting and no reply show nothing here', () => {
  assert.equal(describeStartFailure({ success: true }, { isMac: false }), null);
  assert.equal(describeStartFailure({ success: false, error: 'Save or discard the unsaved meeting before starting a new one.', code: 'pending-unsaved-meeting' }, { isMac: false }), null);
  assert.equal(describeStartFailure({ success: false, error: 'Application is quitting' }, { isMac: false }), null);
  assert.equal(describeStartFailure(undefined, { isMac: false }), null);
});

test('any other failure keeps the reason main gave', () => {
  assert.deepEqual({ ...describeStartFailure({ success: false, error: 'Audio device busy' }, { isMac: false }) },
    { kind: 'other', message: failure.START_FAILURE_OTHER, reason: 'Audio device busy' });
  assert.deepEqual({ ...describeStartFailure({ success: false }, { isMac: false }) }, { kind: 'other', message: failure.START_FAILURE_OTHER });
});

test('every start-failure message has a Chinese entry', () => {
  const { chinese } = sourceModule('src/i18n.zh.ts');
  for (const key of ['START_FAILURE_STT_NOT_CONFIGURED', 'START_FAILURE_MIC_DENIED_MAC', 'START_FAILURE_MIC_DENIED_OTHER', 'START_FAILURE_OTHER']) {
    assert.ok(Object.hasOwn(chinese, failure[key]), key);
  }
});

function renderNotice(props) {
  const { StartMeetingFailureNotice } = sourceModule('src/components/StartMeetingFailureNotice.tsx', { window: {} });
  return renderToStaticMarkup(React.createElement(StartMeetingFailureNotice, { onOpenSettings: () => {}, appName: 'Margin', ...props }));
}

test('the notice offers audio settings for missing credentials and the mic pane on macOS only', () => {
  const stt = renderNotice({ failure: describeStartFailure({ success: false, error: STT_ERROR }, { isMac: true }), isMac: true });
  assert.match(stt, /role="alert"/);
  assert.match(stt, /Open Speech &amp; Audio settings/);
  const mac = renderNotice({ failure: describeStartFailure({ success: false, error: MIC_ERROR_MAC }, { isMac: true }), isMac: true });
  assert.match(mac, /Privacy_Microphone/);
  assert.doesNotMatch(mac, /Open Speech/);
  const win = renderNotice({ failure: describeStartFailure({ success: false, error: MIC_ERROR_WIN }, { isMac: false }), isMac: false });
  assert.match(win, /Settings → Privacy → Microphone, then restart Margin\./);
  assert.doesNotMatch(win, /<button/);
  const other = renderNotice({ failure: describeStartFailure({ success: false, error: 'Audio device busy' }, { isMac: false }), isMac: false });
  assert.match(other, /The meeting could not start\. Audio device busy/);
});

test('the microphone guidance asks for a restart, as main does', () => {
  // main: formatPermissionMessage('mic-denied') ends with 'then restart <app name>'.
  const main = fs.readFileSync(`${REPO}/electron/main.ts`, 'utf8');
  assert.match(main, /Privacy & Security → Microphone, then restart \$\{APP_IDENTITY\.name\}/);
  assert.match(failure.START_FAILURE_MIC_DENIED_MAC, /System Settings → Privacy & Security → Microphone, then restart \{name\}\.$/);
  assert.match(failure.START_FAILURE_MIC_DENIED_OTHER, /then restart \{name\}\.$/);
  for (const message of [failure.START_FAILURE_MIC_DENIED_MAC, failure.START_FAILURE_MIC_DENIED_OTHER]) assert.doesNotMatch(message, /start again/);
  const mac = renderNotice({ failure: describeStartFailure({ success: false, error: MIC_ERROR_MAC }, { isMac: true }), isMac: true });
  assert.match(mac, /then restart Margin\./);
  const { chinese } = sourceModule('src/i18n.zh.ts');
  assert.match(chinese[failure.START_FAILURE_MIC_DENIED_MAC], /重新启动 \{name\}/);
  assert.match(chinese[failure.START_FAILURE_MIC_DENIED_OTHER], /重新启动 \{name\}/);
  const i18n = sourceModule('src/i18n.tsx', { window: {}, localStorage: { getItem: () => null, setItem() {} } });
  assert.equal(i18n.translate('zh-CN', failure.START_FAILURE_MIC_DENIED_MAC, { name: 'Margin' }),
    '麦克风权限被拒绝，会议无法开始。请在“系统设置 → 隐私与安全性 → 麦克风”中允许访问，然后重新启动 Margin。');
});
