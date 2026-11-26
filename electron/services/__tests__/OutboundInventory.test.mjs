import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { REPO } from '../../../scripts/margin/isolation/env.mjs';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const registered = {
  'electron/audio/DomesticStreamingSTT.ts': { 'new WebSocket': 1 },
  'electron/LLMHelper.ts': { 'new Groq': 1, 'new OpenAI': 3, 'new Anthropic': 2, 'new GoogleGenAI': 2 },
  'electron/audio/SonioxStreamingSTT.ts': { 'new WebSocket': 1 },
  'electron/audio/OpenAIStreamingSTT.ts': { 'new WebSocket': 1, 'axios.post': 1 },
  'electron/audio/RestSTT.ts': { 'axios.post': 1 },
  'electron/ipcHandlers.ts': { 'new WebSocket': 1, 'axios.post': 1 },
  'electron/services/CodexAuthSource.ts': { createOutboundFetch: 1 },
  'electron/services/outbound.ts': { createOutboundFetch: 2 },
  // Network proxy: one undici dispatcher for fetch, routing agents for axios/ws, one tunnel.
  'electron/services/proxy/index.ts': { 'new UndiciAgent': 1, 'new RoutingHttpAgent': 1, 'new RoutingHttpsAgent': 1 },
  'electron/services/proxy/tunnel.ts': { 'net.connect': 1, 'tls.connect': 2 },
  'electron/utils/modelFetcher.ts': { 'axios.get': 6 },
};

function productionFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    if (entry.name === '__tests__') return [];
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? productionFiles(file) : /\.(?:ts|tsx)$/.test(file) && !file.endsWith('.d.ts') ? [file] : [];
  });
}

test('known application HTTP/WS/SDK construction sites match the outbound inventory; additions require registration', () => {
  const found = {};
  for (const file of [...productionFiles(path.join(REPO, 'electron')), ...productionFiles(path.join(REPO, 'src'))]) {
    const ast = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
    const relative = path.relative(REPO, file).split(path.sep).join('/');
    function visit(node) {
      let entry;
      if (ts.isNewExpression(node) && /^(?:Groq|OpenAI|Anthropic|GoogleGenAI|SpeechClient|WebSocket|XMLHttpRequest|UndiciAgent|RoutingHttpAgent|RoutingHttpsAgent)$/.test(node.expression.getText(ast))) entry = `new ${node.expression.getText(ast)}`;
      if (ts.isCallExpression(node) && /^(?:(?:globalThis\.)?fetch|outboundFetch|createOutboundFetch|createClient|(?:axios|outboundAxios|http|https|net|tls)\.(?:get|post|put|patch|delete|request|connect))$/.test(node.expression.getText(ast))) entry = node.expression.getText(ast);
      if (entry) { found[relative] ??= {}; found[relative][entry] = (found[relative][entry] ?? 0) + 1; }
      ts.forEachChild(node, visit);
    }
    visit(ast);
  }
  assert.deepEqual(found, registered);
});

test('fixed endpoint origins in transport modules match the documented provider inventory', () => {
  const origins = new Set();
  const dynamicAuthorities = [];
  const sortedAuthorities = () => dynamicAuthorities.sort();
  for (const file of [...Object.keys(registered), 'electron/audio/AliyunStreamingSTT.ts', 'electron/audio/DoubaoStreamingSTT.ts', 'electron/llm/llmTarget.ts', 'src/types/codexSource.ts']) {
    const ast = ts.createSourceFile(file, fs.readFileSync(path.join(REPO, file), 'utf8'), ts.ScriptTarget.Latest, true);
    function visit(node) {
      if (ts.isStringLiteralLike(node) && /^(?:https?|wss?):\/\//.test(node.text)) origins.add(new URL(node.text).origin);
      if (ts.isTemplateExpression(node) && /^(?:https?|wss?):\/\//.test(node.head.text)) {
        if (/^(?:https?|wss?):\/\/$/.test(node.head.text)) dynamicAuthorities.push(`${file}:${node.getText(ast)}`);
        else origins.add(new URL(node.head.text + 'synthetic').origin);
      }
      ts.forEachChild(node, visit);
    }
    visit(ast);
  }
  assert.deepEqual(sortedAuthorities(), [
    'electron/audio/AliyunStreamingSTT.ts:`wss://${workspace}.cn-beijing.maas.aliyuncs.com/api-ws/v1/inference`',
    // Parsing helpers for proxy environment variables and system (PAC) results; never request targets.
    'electron/services/proxy/index.ts:`http://${value}`',
    'electron/services/proxy/index.ts:`http://${match[2]}`',
  ].sort());
  assert.deepEqual([...origins].sort(), [
    'https://api.anthropic.com', 'https://api.deepseek.com', 'https://api.groq.com', 'https://api.openai.com',
    'https://generativelanguage.googleapis.com', 'https://chatgpt.com', 'wss://api.openai.com', 'wss://stt-rt.soniox.com',
    'wss://openspeech.bytedance.com', 'wss://dashscope.aliyuncs.com',
  ].sort());
});

function productionSources() {
  return [...productionFiles(path.join(REPO, 'electron')), ...productionFiles(path.join(REPO, 'src'))].map(file => ({
    relative: path.relative(REPO, file).split(path.sep).join('/'),
    ast: ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true),
  }));
}

const unwrap = node => {
  while (node && (ts.isAsExpression(node) || ts.isParenthesizedExpression(node) || ts.isTypeAssertionExpression?.(node) || ts.isSatisfiesExpression?.(node))) node = node.expression;
  return node;
};

test('every WebSocket takes its options from streamingStttWsOptions for the same URL (IPv4 lookup, timeout, proxy agent)', () => {
  const sites = [];
  for (const { relative, ast } of productionSources()) {
    (function visit(node) {
      if (ts.isNewExpression(node) && node.expression.getText(ast) === 'WebSocket') {
        const [url, options] = node.arguments ?? [];
        const call = unwrap(options);
        assert.ok(call && ts.isCallExpression(call) && call.expression.getText(ast) === 'streamingStttWsOptions', `${relative}: ${node.getText(ast)}`);
        assert.equal(call.arguments[0]?.getText(ast), url.getText(ast), `${relative}: options are computed for the connected URL`);
        sites.push(relative);
      }
      ts.forEachChild(node, visit);
    })(ast);
  }
  assert.equal(sites.length, 4);
});

test('axios is used only through outboundAxios and undici only inside the proxy module', () => {
  const imports = {};
  for (const { relative, ast } of productionSources()) {
    (function visit(node) {
      let specifier;
      if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) specifier = node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier) ? node.moduleSpecifier.text : undefined;
      if (ts.isCallExpression(node) && ['require', 'import'].includes(node.expression.getText(ast)) && node.arguments[0] && ts.isStringLiteralLike(node.arguments[0])) specifier = node.arguments[0].text;
      if (specifier && /^(?:axios|undici|node-fetch|got|superagent|https?-proxy-agent|socks(?:-proxy-agent)?|proxy-agent)(?:\/|$)/.test(specifier)) {
        imports[specifier] = [...new Set([...(imports[specifier] ?? []), relative])];
      }
      if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier) && /services\/outbound$/.test(node.moduleSpecifier.text)) {
        for (const element of node.importClause?.namedBindings?.elements ?? []) {
          if (element.name.text === 'axios') assert.equal((element.propertyName ?? element.name).text, 'outboundAxios', relative);
        }
      }
      ts.forEachChild(node, visit);
    })(ast);
  }
  assert.deepEqual(imports, { axios: ['electron/services/outbound.ts'], undici: ['electron/services/proxy/index.ts'] });
});
