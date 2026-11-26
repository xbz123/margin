import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { createRequire } from 'node:module';
import { localizeErrorText, PROXY_ERROR_MESSAGES } from '../localizedErrorText.mjs';

const require = createRequire(import.meta.url);
function translationModule(file) {
  const module = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../../' + file, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText, { module, exports: module.exports,
    require: id => id === './i18n.zh' ? translationModule('i18n.zh.ts') : require(id) });
  return module.exports;
}
const { translate } = translationModule('i18n.tsx');
const zh = english => translate('zh-CN', english);
const en = english => translate('en', english);

const PROXY = [
  ['The proxy server could not be reached.', '无法连接代理服务器。'],
  ['The proxy server requires authentication.', '代理服务器需要用户名和密码。'],
  ['The proxy server rejected the proxy credentials.', '代理服务器拒绝了代理用户名或密码。'],
];

test('proxy messages mirror the fixed messages in tunnel.ts', () => {
  const tunnel = fs.readFileSync(new URL('../../../electron/services/proxy/tunnel.ts', import.meta.url), 'utf8');
  const block = tunnel.match(/const MESSAGES[^{]*\{([\s\S]*?)\};/)[1];
  assert.deepEqual([...block.matchAll(/:\s*'([^']+)'/g)].map(match => match[1]), [...PROXY_ERROR_MESSAGES]);
});

test('bare proxy messages follow the UI language', () => {
  for (const [english, chinese] of PROXY) {
    assert.equal(localizeErrorText(english, zh), chinese);
    assert.equal(localizeErrorText(english, en), english);
    assert.equal(localizeErrorText(new Error(english), zh), chinese);
  }
});

test('wrapped proxy messages are translated in place, the wrapper text is kept', () => {
  for (const [english, chinese] of PROXY) {
    assert.equal(localizeErrorText(`Generation failed: ${english}`, zh), `Generation failed: ${chinese}`);
    assert.equal(localizeErrorText(`Error invoking remote method 'x': Error: ${english} (retry)`, zh), `Error invoking remote method 'x': Error: ${chinese} (retry)`);
    assert.equal(localizeErrorText(`Generation failed: ${english}`, en), `Generation failed: ${english}`);
  }
});

test('with the Error line template the whole chat line follows the UI language', () => {
  const [english, chinese] = PROXY[1];
  assert.equal(translate('zh-CN', 'Error: {message}', { message: localizeErrorText(english, zh) }), `错误：${chinese}`);
  assert.equal(translate('en', 'Error: {message}', { message: localizeErrorText(english, en) }), `Error: ${english}`);
});

test('unrelated errors are left unchanged; known whole messages still translate', () => {
  for (const tr of [zh, en]) {
    assert.equal(localizeErrorText('Request failed with status 500: upstream {x}', tr), 'Request failed with status 500: upstream {x}');
    assert.equal(localizeErrorText(undefined, tr), '');
  }
  assert.equal(localizeErrorText('Connection failed', zh), '连接失败');
});
