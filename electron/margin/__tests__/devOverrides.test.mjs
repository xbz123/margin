// Unit tests for the development-only regression hooks (PLAN.md X4 / AG-09).
// Run after `node scripts/build-electron.js`:
//   node scripts/margin/isolation/run-node.mjs --test electron/margin/__tests__/devOverrides.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { resolveDevOpenAIBaseUrl, resolveDevScreenshotFixture, devOpenAIBaseUrl } =
  require(path.resolve('dist-electron/electron/margin/devOverrides.js'));

test('base URL override is honoured only for loopback http in unpackaged builds', () => {
  const env = (v) => ({ MARGIN_DEV_OPENAI_BASE_URL: v });
  assert.equal(resolveDevOpenAIBaseUrl(env('http://127.0.0.1:4010/v1'), false), 'http://127.0.0.1:4010/v1');
  assert.equal(resolveDevOpenAIBaseUrl(env('http://localhost:4010/v1'), false), 'http://localhost:4010/v1');
  assert.equal(resolveDevOpenAIBaseUrl(env('http://[::1]:4010/v1'), false), 'http://[::1]:4010/v1');
});

test('base URL override is ignored in packaged builds', () => {
  assert.equal(resolveDevOpenAIBaseUrl({ MARGIN_DEV_OPENAI_BASE_URL: 'http://127.0.0.1:4010/v1' }, true), undefined);
});

test('base URL override rejects anything that is not plain loopback http', () => {
  for (const v of [
    'https://127.0.0.1:4010/v1',
    'http://example.com/v1',
    'http://127.0.0.1.example.com/v1',
    'http://10.0.0.2:4010/v1',
    'http://localhost@evil.example/v1',
    '',
    undefined,
  ]) {
    assert.equal(resolveDevOpenAIBaseUrl({ MARGIN_DEV_OPENAI_BASE_URL: v }, false), undefined, String(v));
  }
});

test('screenshot fixture requires an unpackaged build and an existing file', () => {
  const env = { MARGIN_DEV_SCREENSHOT_FIXTURE: '/tmp/fixture.png' };
  assert.equal(resolveDevScreenshotFixture(env, false, () => true), '/tmp/fixture.png');
  assert.equal(resolveDevScreenshotFixture(env, true, () => true), undefined);
  assert.equal(resolveDevScreenshotFixture(env, false, () => false), undefined);
  assert.equal(resolveDevScreenshotFixture({}, false, () => true), undefined);
});

test('outside Electron the wrappers fail closed', () => {
  // require('electron') in plain Node yields a path string, so app is undefined:
  // the wrapper must treat that as packaged and return nothing.
  process.env.MARGIN_DEV_OPENAI_BASE_URL = 'http://127.0.0.1:4010/v1';
  try {
    assert.equal(devOpenAIBaseUrl(), undefined);
  } finally {
    delete process.env.MARGIN_DEV_OPENAI_BASE_URL;
  }
});
