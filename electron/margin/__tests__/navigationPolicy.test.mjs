import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { REPO } from '../../../scripts/margin/isolation/env.mjs';

const require = createRequire(import.meta.url);
const ts = require('typescript');

// Replaces the source-string checks of the old open-external allowlist with the
// behaviour of the shared rule. The real-window wiring is checked by the
// outbound-renderer gate (tests/margin/outbound-renderer.test.mjs).
function policy({ packaged = true, env = 'production', platform = 'darwin', fail = false } = {}) {
  const opened = [];
  const warnings = [];
  const module = { exports: {} };
  const source = fs.readFileSync(path.join(REPO, 'electron/services/navigationPolicy.ts'), 'utf8');
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText, {
    module, exports: module.exports, URL,
    console: { warn: (...args) => warnings.push(args) },
    process: { env: { NODE_ENV: env }, platform },
    require(id) {
      if (id === 'electron') return {
        app: { getAppPath: () => '/Applications/temp.app/Contents/Resources/app.asar', isPackaged: packaged },
        shell: { openExternal: async url => { if (fail) throw Error('synthetic'); opened.push(url); } },
      };
      return require(id);
    },
  });
  return { ...module.exports, opened, warnings };
}

test('only the bundled page counts as the app page; the dev origin only in an unpackaged dev run', () => {
  const p = policy();
  assert.equal(p.isAppPage('file:///Applications/temp.app/Contents/Resources/app.asar/dist/index.html?window=launcher#x'), true);
  assert.equal(p.isAppPage('file:///Applications/temp.app/Contents/Resources/app.asar/dist/../dist/index.html'), true);
  for (const url of ['file:///etc/hosts', 'file:///Applications/temp.app/Contents/Resources/app.asar/dist/other.html',
    'http://localhost:5180/', 'https://example.com/', 'data:text/html,x', 'not a url']) assert.equal(p.isAppPage(url), false, url);
  assert.equal(policy({ packaged: false, env: 'development' }).isAppPage('http://localhost:5180/?window=overlay'), true);
  assert.equal(policy({ packaged: true, env: 'development' }).isAppPage('http://localhost:5180/'), false);
  assert.equal(policy({ packaged: false, env: 'production' }).isAppPage('http://localhost:5180/'), false);
  assert.equal(policy({ packaged: false, env: 'development' }).isAppPage('http://localhost:5181/'), false);
});

test('links open externally only for https without userinfo, or macOS settings on macOS', async () => {
  const p = policy();
  for (const url of ['https://console.groq.com/keys', 'x-apple.systempreferences:com.apple.preference.security']) {
    assert.equal(await p.openExternalLink(url), true, url);
  }
  for (const url of ['http://example.com/', 'file:///etc/hosts', 'mailto:a@example.com', 'javascript:alert(1)',
    'https://user:pass@example.com/', 'https://user@example.com/', 'ms-windows-store://x', 'not a url', '']) {
    assert.equal(await p.openExternalLink(url), false, url);
  }
  assert.deepEqual(p.opened, ['https://console.groq.com/keys', 'x-apple.systempreferences:com.apple.preference.security']);
  assert.ok(p.warnings.every(args => args.every(arg => !String(arg).includes('example'))), 'refused URLs are not logged');
  const windows = policy({ platform: 'win32' });
  assert.equal(await windows.openExternalLink('x-apple.systempreferences:com.apple.preference.security'), false, 'issue #252');
  assert.equal(await policy({ fail: true }).openExternalLink('https://example.com/'), false, 'a shell failure is reported, not thrown');
});
