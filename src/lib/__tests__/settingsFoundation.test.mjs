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
function sourceModule(file) {
  if (loaded.has(file)) return loaded.get(file);
  const module = { exports: {} };
  const compiled = ts.transpileModule(fs.readFileSync(`${REPO}/${file}`, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  vm.runInNewContext(compiled, {
    module, exports: module.exports,
    require: id => id === './i18n.zh' ? sourceModule('src/i18n.zh.ts')
      : id === '../../i18n' ? sourceModule('src/i18n.tsx')
      : id === './SettingsKit' ? sourceModule('src/components/settings/SettingsKit.tsx') : require(id),
  });
  loaded.set(file, module.exports);
  return module.exports;
}

test('AG60a translation uses English source text when a Chinese entry is missing', () => {
  const { translate } = sourceModule('src/i18n.tsx');
  assert.equal(translate('en', 'Save'), 'Save');
  assert.equal(translate('zh-CN', 'Save'), '保存');
  assert.equal(translate('zh-CN', 'Untranslated text'), 'Untranslated text');
  assert.equal(translate('zh-CN', 'constructor'), 'constructor');
  assert.equal(translate('zh-CN', ''), '');
});

test('AG42 fixed manual-answer messages use the shared English and Chinese translations', () => {
  const { useI18n, setUiLanguage } = sourceModule('src/i18n.tsx');
  const messages = [
    ['Cancelled', '已取消'],
    ['Configure an answer model and its credentials first.', '请先配置回答模型及其凭据。'],
    ['Answer failed. Check the model configuration and try again.', '回答失败，请检查模型配置后重试。'],
    ['Data scope denied. Check Data Scopes in Settings.', '数据范围已禁用，请检查设置中的数据范围。'],
    ['Invalid image path', '图片路径无效'],
  ];
  function Message({ text }) { const { t } = useI18n(); return React.createElement('span', null, t(text)); }
  try {
    for (const [language, index] of [['en', 0], ['zh-CN', 1]]) {
      setUiLanguage(language);
      for (const pair of messages) assert.equal(renderToStaticMarkup(React.createElement(Message, { text: pair[0] })), `<span>${pair[index]}</span>`);
    }
  } finally { setUiLanguage('en'); }
});

test('AG41b domestic STT cards use the shared translations and accessible credential controls', () => {
  const { SpeechProviderSettings } = sourceModule('src/components/settings/SpeechProviderSettings.tsx');
  const { setUiLanguage } = sourceModule('src/i18n.tsx');
  try {
    setUiLanguage('zh-CN');
    for (const provider of ['aliyun', 'doubao']) {
      const html = renderToStaticMarkup(React.createElement(SpeechProviderSettings, { provider }));
      assert.match(html, /type="password"/);
      assert.match(html, /删除凭据/);
      assert.match(html, /测试连接/);
      assert.match(html, /role="status"/);
      const buttons = html.match(/<button\b[^>]*>/g);
      assert.equal(buttons.length, 3);
      for (const button of buttons) {
        assert.match(button, /class="[^"]*bg-bg-input/);
        assert.match(button, /rounded/);
        assert.match(button, /disabled:opacity-50/);
      }
      assert.match(html, provider === 'aliyun' ? /业务空间 ID/ : /App ID/);
      if (provider === 'aliyun') {
        assert.match(html, /业务空间 ID（可选，北京）/);
        assert.match(html, /留空使用北京通用接入地址/);
        assert.doesNotMatch(html, /<select/);
      } else {
        assert.match(html, /资源类型/);
        assert.deepEqual([...html.matchAll(/<option value="([^"]+)"/g)].map(match => match[1]),
          ['volc.seedasr.sauc.duration', 'volc.seedasr.sauc.concurrent']);
        assert.match(html, /小时版/);
        assert.match(html, /并发版/);
      }
    }
  } finally { setUiLanguage('en'); }
});

test('AG60a language switching changes hook output and rejects unsupported languages', () => {
  const { useI18n, setUiLanguage, getUiLanguage } = sourceModule('src/i18n.tsx');
  function Consumer() {
    const { language, t } = useI18n();
    return React.createElement('p', { lang: language }, t('Skills'));
  }
  const render = () => renderToStaticMarkup(React.createElement(Consumer));
  assert.equal(getUiLanguage(), 'en');
  assert.equal(render(), '<p lang="en">Skills</p>');
  try {
    setUiLanguage('zh-CN');
    assert.equal(render(), '<p lang="zh-CN">技能</p>');
    assert.throws(() => setUiLanguage('fr'), /Unsupported UI language/);
    assert.equal(getUiLanguage(), 'zh-CN');
    setUiLanguage('en');
    assert.equal(render(), '<p lang="en">Skills</p>');
  } finally {
    setUiLanguage('en');
  }
});

test('AG60a shared heading and card preserve content, native controls and text escaping', () => {
  const { SettingsHeading, SettingsCard } = sourceModule('src/components/settings/SettingsKit.tsx');
  const markup = renderToStaticMarkup(React.createElement(SettingsCard, null,
    React.createElement(SettingsHeading, { title: 'Skills', description: '<unsafe>' }),
    React.createElement('button', { type: 'button', disabled: true }, 'Refresh')));
  assert.match(markup, /<h3[^>]*>Skills<\/h3>/);
  assert.match(markup, /<p[^>]*>&lt;unsafe&gt;<\/p>/);
  assert.match(markup, /<button type="button" disabled="">Refresh<\/button>/);
  const heading = renderToStaticMarkup(React.createElement(SettingsHeading, { title: '技能' }));
  assert.match(heading, /<h3[^>]*>技能<\/h3>/);
  assert.doesNotMatch(heading, /<p/);
});
