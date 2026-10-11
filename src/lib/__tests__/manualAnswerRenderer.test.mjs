import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { createRequire } from 'node:module';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const require = createRequire(import.meta.url);
function translationModule(file) {
  const module = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../../' + file, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText, { module, exports: module.exports,
    require: id => id === './i18n.zh' ? translationModule('i18n.zh.ts') : require(id) });
  return module.exports;
}
const i18n = translationModule('i18n.tsx');

const source = fs.readFileSync(new URL('../../components/NativelyInterface.tsx', import.meta.url), 'utf8');
const tree = ts.createSourceFile('NativelyInterface.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function handler(name, bindings) {
  let expression;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(tree) === name) expression = node.initializer.getText(tree);
    ts.forEachChild(node, visit);
  }
  visit(tree); assert.ok(expression, name);
  const code = ts.transpileModule('const run = ' + expression + '; run;', { compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText;
  return vm.runInNewContext(code, bindings);
}

test('AG42 recording sends retained speech on finalize rejection and drops a cancelled wait', async () => {
  for (const cancel of [false, true]) {
    const sent = [], warnings = [], messages = [];
    const ref = current => ({ current });
    const epoch = ref(0);
    const bindings = {
      isManualRecording: true, tryBeginOverlayAction: () => true, generationEpochRef: epoch,
      isRecordingRef: ref(true), voiceInputRef: ref('Retained speech'), manualTranscriptRef: ref('tail'),
      attachedContext: [], submittedChatRef: ref(), messagesEndRef: ref(),
      streamingMsgIdRef: ref(), streamingIntentRef: ref(), streamingTextRef: ref(''),
      streamingNodeRef: ref(null), streamingRafRef: ref(null), requestStartTimeRef: ref(null),
      setIsManualRecording() {}, setManualTranscript() {}, setVoiceInput() {}, setIsProcessing() {},
      setMessages: update => { messages.splice(0, messages.length, ...update(messages)); },
      genMessageId: () => String(messages.length), setTimeout() {}, pinAnswerPanel() {}, endOverlayAction() {},
      console: { warn: (...args) => warnings.push(args) },
      window: { electronAPI: {
        finalizeMicSTT: async () => { if (cancel) epoch.current++; throw Error('PRIVATE_STT_ERROR'); },
        streamGeminiChat: async (...args) => sent.push(args),
      } },
    };
    await handler('handleAnswerNow', bindings)();
    assert.equal(sent.length, cancel ? 0 : 1);
    if (!cancel) assert.equal(sent[0][0], 'Retained speech tail');
    assert.doesNotMatch(JSON.stringify({ sent, warnings, messages }), /PRIVATE_STT_ERROR/);
    assert.equal(warnings.length, 1);
  }
});

test('AG42 real answer row and feedback callback use shared translations and show one scope error', async () => {
  const Row = handler('MessageRow', { React, useI18n: i18n.useI18n, Copy: () => null });
  try {
    for (const [language, cancelled, denied] of [
      ['en', 'Cancelled', 'Data scope denied. Check Data Scopes in Settings.'],
      ['zh-CN', '已取消', '数据范围已禁用，请检查设置中的数据范围。'],
    ]) {
      i18n.setUiLanguage(language);
      const markup = renderToStaticMarkup(React.createElement(Row, {
        msg: { role: 'system', text: '', generation: { status: 'cancelled', provider: 'mock', model: 'mock' } },
        appearance: {}, renderMessageText: () => null,
      }));
      assert.ok(markup.includes(cancelled));
      const messages = [], ref = current => ({ current });
      await handler('handleWhatToSay', {
        questionMode: 'interview', tryBeginOverlayAction: () => true, generationEpochRef: ref(0),
        setIsExpanded() {}, setIsProcessing() {}, prepareIntelligenceStreamPlaceholder() {},
        pendingCaptureRef: ref(null), attachedContext: [], setScreenContextStatus() {}, setLatestUsedImageInput() {},
        setLatestVisionProviderUsed() {}, setLatestVisionModelUsed() {}, setLatestVisionFailureReason() {},
        streamingTextRef: ref(''), streamingNodeRef: ref(null), streamingMsgIdRef: ref(null),
        streamingIntentRef: ref(null), streamingRafRef: ref(null),
        setMessages: update => { messages.splice(0, messages.length, ...update(messages)); },
        applyWhatToAnswerNullFeedbackMessages: (prev, feedback) => [...prev, { text: feedback }],
        pinAnswerPanel() {}, endOverlayAction() {}, genMessageId: () => 'error',
        t: english => i18n.translate(language, english),
        window: { electronAPI: { cancelChatStream() {}, generateWhatToSay: async () => ({
          answer: null, error: 'Data scope denied. Check Data Scopes in Settings.',
        }) } },
      })();
      assert.equal(messages.length, 1);
      assert.equal(messages[0].text, '❌ Error (what_to_say): ' + denied);
    }
  } finally { i18n.setUiLanguage('en'); }
});
