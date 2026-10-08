import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const loadRedactor = () => import(pathToFileURL(path.resolve(dirname, '../../../dist-electron/electron/utils/redactForLog.js')).href);

test('arbitrary credential and user strings have no preview, pattern or minimum-length exception', async () => {
  const { redactForLog, redactValue } = await loadRedactor();
  for (const text of ['sk-short', 'unknown-key-format', 'x-api-key=SYNTHETIC_SECRET', 'Bearer tiny', 'PRIVATE_TRANSCRIPT', '/synthetic/private/shot.png', 'data:audio/private']) {
    assert.equal(redactForLog([text]), JSON.stringify([{ type: 'string', length: text.length }]));
    assert.deepEqual(redactValue(text), { type: 'string', length: text.length });
  }
});

test('objects stay opaque, including private property names and nested content', async () => {
  const { redactForLog } = await loadRedactor();
  const payload = { PRIVATE_KEY_NAME: 'PRIVATE_CONTENT', safeMeta: { providerName: 'openai', count: 12 } };
  assert.equal(redactForLog([payload]), '[{"type":"object"}]');
});

test('numbers, bigint, booleans, symbols and functions never print values or descriptions', async () => {
  const { redactForLog } = await loadRedactor();
  assert.equal(redactForLog([123456, 123456n, true, Symbol('PRIVATE_SYMBOL'), function PRIVATE_FUNCTION() {}]),
    '[{"type":"number"},{"type":"bigint"},{"type":"boolean"},{"type":"symbol"},{"type":"function"}]');
});

test('Errors and cycles cannot disclose message, stack, cause or custom properties', async () => {
  const { redactForLog } = await loadRedactor();
  const error = new Error('PRIVATE_MESSAGE', { cause: 'PRIVATE_CAUSE' });
  error.name = 'PRIVATE_ERROR_NAME'; error.code = 'PRIVATE_CODE';
  const cyclic = {}; cyclic.self = cyclic;
  assert.equal(redactForLog([error, cyclic]), '[{"type":"object"},{"type":"object"}]');
});

test('hostile serializers, getters, revoked proxies and array proxies remain safe', async () => {
  const { redactForLog } = await loadRedactor();
  let hooks = 0;
  const hostile = { get value() { hooks++; throw Error('PRIVATE_GETTER'); }, toJSON() { hooks++; return 'PRIVATE_JSON'; }, toString() { hooks++; return 'PRIVATE_STRING'; } };
  const proxy = Proxy.revocable({}, {}); proxy.revoke();
  const array = new Proxy([], { get() { hooks++; return 'PRIVATE_LENGTH'; } });
  const prototypeTrap = new Proxy({}, { getPrototypeOf() { hooks++; return null; } });
  assert.equal(redactForLog([hostile, proxy.proxy, array, prototypeTrap]), '[{"type":"object"},{"type":"object"},{"type":"array"},{"type":"object"}]');
  assert.equal(hooks, 0);
});
