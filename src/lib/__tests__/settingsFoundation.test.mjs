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

// A separate module instance per window, with synthetic preload, storage and document.
function windowI18n(api, cache = new Map()) {
  const module = { exports: {} };
  const document = { documentElement: { lang: '' } };
  const localStorage = { getItem: key => cache.get(key) ?? null, setItem: (key, value) => cache.set(key, String(value)) };
  const compiled = ts.transpileModule(fs.readFileSync(`${REPO}/src/i18n.tsx`, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  vm.runInNewContext(compiled, { module, exports: module.exports, window: { electronAPI: api }, localStorage, document,
    require: id => id === './i18n.zh' ? sourceModule('src/i18n.zh.ts') : require(id) });
  return { ...module.exports, document, cache };
}

function preload(initial) {
  const listeners = new Set(); const sets = [];
  let reply;
  return { sets, listeners,
    getUiLanguage: () => new Promise(resolve => { reply = resolve; }),
    reply: language => reply(language),
    onUiLanguageChanged(callback) { listeners.add(callback); return () => listeners.delete(callback); },
    emit: language => [...listeners].forEach(callback => callback(language)),
    setUiLanguage: async language => { sets.push(language); return initial(language); },
  };
}
const settle = () => new Promise(resolve => setImmediate(resolve));

test('AG60 interpolation fills named values in both languages and leaves unknown names', () => {
  const { translate } = sourceModule('src/i18n.tsx');
  assert.equal(translate('en', 'Show {name}', { name: 'Margin' }), 'Show Margin');
  assert.equal(translate('zh-CN', 'Show {name}', { name: 'Margin' }), '显示 Margin');
  assert.equal(translate('zh-CN', 'Show {name}', {}), '显示 {name}');
  assert.equal(translate('zh-CN', 'Show {name}', { name: '{other}', other: 'x' }), '显示 {other}');
});

test('AG60 every Chinese entry keeps exactly the placeholders of its English key', () => {
  const { chinese } = sourceModule('src/i18n.zh.ts');
  const names = text => [...text.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort().join(',');
  const mismatched = Object.entries(chinese).filter(([english, zh]) => typeof zh !== 'string' || !zh.trim() || names(english) !== names(zh));
  assert.deepEqual(mismatched, []);
});

test('AG60 every literal built-in label passed to t or mainText has a Chinese entry', () => {
  const { chinese } = sourceModule('src/i18n.zh.ts');
  const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.name === '__tests__' ? []
    : entry.isDirectory() ? walk(`${dir}/${entry.name}`) : /\.tsx?$/.test(entry.name) && !entry.name.endsWith('.d.ts') ? [`${dir}/${entry.name}`] : []);
  const missing = new Set(); let count = 0;
  const collect = (node, file) => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) { count++; if (!Object.hasOwn(chinese, node.text)) missing.add(`${file}: ${node.text}`); }
    else if (ts.isConditionalExpression(node)) { collect(node.whenTrue, file); collect(node.whenFalse, file); }
    else if (ts.isParenthesizedExpression(node)) collect(node.expression, file);
  };
  for (const file of [...walk(`${REPO}/src`), ...walk(`${REPO}/electron`)]) {
    const text = fs.readFileSync(file, 'utf8');
    if (!/\b(t|mainText|translate)\(/.test(text)) continue;
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const visit = node => {
      if (ts.isCallExpression(node)) {
        const name = node.expression.getText(source);
        if (/^(t|tRef\.current|mainText)$/.test(name) && node.arguments[0]) collect(node.arguments[0], file.slice(REPO.length + 1));
        if (/^(translate|mainTextFor)$/.test(name) && node.arguments[1]) collect(node.arguments[1], file.slice(REPO.length + 1));
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  assert.ok(count > 400, `expected the retained UI to route its labels through t(), saw ${count}`);
  assert.deepEqual([...missing], []);
});

test('AG60 window sync applies the cache, then the saved language, and ignores a late initial reply', async () => {
  const api = preload(() => ({ ok: true }));
  const one = windowI18n(api, new Map([['margin_ui_language', 'zh-CN']]));
  const stop = one.startUiLanguageSync();
  assert.equal(one.getUiLanguage(), 'zh-CN');
  assert.equal(one.document.documentElement.lang, 'zh-CN');
  api.emit('en');
  api.emit('fr');
  assert.equal(one.getUiLanguage(), 'en');
  api.reply('zh-CN');
  await settle();
  assert.equal(one.getUiLanguage(), 'en', 'a change event wins over the older initial reply');
  assert.equal(one.cache.get('margin_ui_language'), 'en');
  stop();
  assert.equal(api.listeners.size, 0);
  api.emit('zh-CN');
  assert.equal(one.getUiLanguage(), 'en');

  const fresh = preload(() => ({ ok: true }));
  const two = windowI18n(fresh, new Map([['margin_ui_language', 'bogus']]));
  const stopTwo = two.startUiLanguageSync();
  assert.equal(two.getUiLanguage(), 'en');
  fresh.reply('zh-CN');
  await settle();
  assert.equal(two.getUiLanguage(), 'zh-CN');
  assert.equal(two.document.documentElement.lang, 'zh-CN');
  stopTwo();

  const stopped = preload(() => ({ ok: true }));
  const three = windowI18n(stopped);
  three.startUiLanguageSync()();
  stopped.reply('zh-CN');
  await settle();
  assert.equal(three.getUiLanguage(), 'en', 'an unsubscribed window ignores its pending reply');
});

test('AG60 a language change from one window reaches another without re-requesting the saved value', async () => {
  const launcherApi = preload(language => ({ ok: true, language }));
  const overlayApi = preload(() => ({ ok: true }));
  const launcher = windowI18n(launcherApi), overlay = windowI18n(overlayApi);
  launcher.startUiLanguageSync(); overlay.startUiLanguageSync();
  launcherApi.reply('en'); overlayApi.reply('en');
  await settle();
  const renders = [];
  function Label() { const { t } = overlay.useI18n(); renders.push(t); return React.createElement('span', null, t('Settings')); }
  assert.equal(renderToStaticMarkup(React.createElement(Label)), '<span>Settings</span>');
  assert.deepEqual(await launcher.requestUiLanguage('zh-CN'), { ok: true, language: 'zh-CN' });
  overlayApi.emit('zh-CN');
  assert.equal(launcher.getUiLanguage(), 'zh-CN');
  assert.equal(overlay.getUiLanguage(), 'zh-CN');
  assert.equal(renderToStaticMarkup(React.createElement(Label)), '<span>设置</span>');
  assert.deepEqual(launcherApi.sets, ['zh-CN']);
  assert.deepEqual(overlayApi.sets, []);
});

test('AG60 a newer broadcast wins over a delayed successful save reply', async () => {
  let finishSave;
  const api = preload(() => new Promise(resolve => { finishSave = resolve; }));
  const win = windowI18n(api);
  const stop = win.startUiLanguageSync();
  api.reply('en');
  await settle();
  const pending = win.requestUiLanguage('zh-CN');
  api.emit('zh-CN');
  api.emit('en');
  finishSave({ ok: true, language: 'zh-CN' });
  assert.equal((await pending).ok, true);
  assert.equal(win.getUiLanguage(), 'en');
  assert.equal(win.document.documentElement.lang, 'en');
  assert.equal(win.cache.get('margin_ui_language'), 'en');
  stop();
});

test('AG60 requesting a language never applies it unless main saved it', async () => {
  let outcome;
  const api = preload(() => outcome());
  const win = windowI18n(api);
  const plain = value => JSON.parse(JSON.stringify(value));
  outcome = () => ({ ok: false, message: 'The interface language could not be saved.' });
  assert.deepEqual(plain(await win.requestUiLanguage('zh-CN')), { ok: false, message: 'The interface language could not be saved.' });
  assert.equal(win.getUiLanguage(), 'en');
  outcome = () => { throw new Error('ipc closed'); };
  assert.deepEqual(plain(await win.requestUiLanguage('zh-CN')), { ok: false, message: 'The interface language could not be saved.' });
  outcome = () => ({ ok: true, language: 'fr' });
  assert.equal((await win.requestUiLanguage('zh-CN')).ok, false);
  assert.equal(win.getUiLanguage(), 'en');
  assert.equal(win.cache.has('margin_ui_language'), false);
  assert.deepEqual(plain(await win.requestUiLanguage('de')), { ok: false, message: 'Unsupported interface language.' });
  assert.deepEqual(api.sets, ['zh-CN', 'zh-CN', 'zh-CN']);
  outcome = () => ({ ok: true, language: 'zh-CN' });
  assert.equal((await win.requestUiLanguage('zh-CN')).ok, true);
  assert.equal(win.getUiLanguage(), 'zh-CN');
  assert.equal(win.cache.get('margin_ui_language'), 'zh-CN');
  const offline = windowI18n(undefined);
  assert.equal((await offline.requestUiLanguage('zh-CN')).ok, false);
  assert.equal(offline.getUiLanguage(), 'en');
});

test('AG60 settings keep every section and old tab names open the moved sections', () => {
  const { resolveSettingsTab, SETTINGS_TABS } = sourceModule('src/components/settings/settingsTabs.ts');
  const tabs = ['general', 'ai-providers', 'audio', 'context', 'meeting-records', 'privacy', 'keybinds', 'help', 'about'];
  assert.deepEqual([...SETTINGS_TABS], tabs);
  for (const tab of tabs) assert.equal(resolveSettingsTab(tab), tab);
  assert.equal(resolveSettingsTab('skills'), 'context');
  assert.equal(resolveSettingsTab('local-context'), 'context');
  assert.equal(resolveSettingsTab('window-privacy'), 'privacy');
  for (const unknown of ['constructor', '__proto__', 'Skills', undefined, null, 3]) assert.equal(resolveSettingsTab(unknown), 'general');
  const overlay = fs.readFileSync(`${REPO}/src/components/SettingsOverlay.tsx`, 'utf8');
  assert.match(overlay, /activeTab === 'context'[\s\S]{0,200}<LocalContextSettings \/>[\s\S]{0,200}<PromptSettings \/>/);
});

test('S44 reasoning validation messages and option values are bounded and have Chinese entries', () => {
  const { chinese } = sourceModule('src/i18n.zh.ts');
  const transpile = file => ts.transpileModule(fs.readFileSync(`${REPO}/${file}`, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const images = { exports: {} }; vm.runInNewContext(transpile('src/types/modelImageSupport.ts'), { module: images, exports: images.exports, URL });
  const api = { exports: {} }; vm.runInNewContext(transpile('src/types/modelReasoning.ts'), { module: api, exports: api.exports, URL, require: () => images.exports });
  const { validateReasoning, reasoningOptions } = api.exports;
  const targets = [{ provider: 'openai', protocol: 'responses', model: 'gpt-5.4' }, { provider: 'claude', protocol: 'messages', model: 'unlisted-<script>' },
    { provider: 'deepseek', protocol: 'chat-completions', model: 'deepseek-v4-flash' }, { provider: 'gemini', protocol: 'gemini', model: 'x', baseUrl: 'https://gateway.invalid' }];
  const messages = new Set();
  for (const target of targets) {
    for (const option of [...reasoningOptions(target).effort, ...reasoningOptions(target).thinking]) assert.ok(Object.hasOwn(chinese, option), option);
    for (const value of [{ effort: 'USER<VALUE>' }, { thinking: 'USER<VALUE>' }, { thinking: 'disabled', effort: 'high' }, { extra: 'USER<VALUE>' }, 'USER<VALUE>']) {
      try { validateReasoning(target, value); } catch (error) { messages.add(error.message); }
    }
  }
  assert.ok(messages.size >= 4);
  for (const message of messages) { assert.doesNotMatch(message, /USER|VALUE|script/); assert.ok(Object.hasOwn(chinese, message), message); }
  for (const message of ['Context window must be a positive whole number of tokens.', 'A context window can only be noted for a custom endpoint.']) assert.ok(Object.hasOwn(chinese, message));
});

test('accent tokens keep readable contrast in both themes', () => {
  const css = fs.readFileSync(`${REPO}/src/index.css`, 'utf8');
  const block = selector => css.slice(css.indexOf(`${selector} {`), css.indexOf('}', css.indexOf(`${selector} {`)));
  const token = (text, name) => text.match(new RegExp(`--${name}:\\s*(#[0-9A-Fa-f]{6})`))?.[1];
  const luminance = hex => {
    const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(v => v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const contrast = (a, b) => { const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  for (const [selector, surfaces] of [[':root', ['bg-main', 'bg-card', 'bg-elevated']], ["[data-theme='light']", ['bg-main', 'bg-card', 'bg-elevated']]]) {
    const theme = block(selector);
    const accent = token(theme, 'accent-primary'), onAccent = token(theme, 'on-accent');
    assert.ok(accent && onAccent, selector);
    assert.ok(contrast(accent, onAccent) >= 4.5, `${selector}: text on the accent`);
    for (const surface of surfaces) assert.ok(contrast(accent, token(theme, surface)) >= 4.5, `${selector}: accent text on ${surface}`);
  }
});
