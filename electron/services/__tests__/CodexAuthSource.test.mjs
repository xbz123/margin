import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { CodexAuthSource, CodexSourceError, parseCodexAuth, readCodexAuthFile, codexRequestBody, MAX_CODEX_AUTH_BYTES, DEFAULT_CODEX_SOURCE_CONFIG, validateCodexSourceConfig } = require('../../../dist-electron/electron/services/CodexAuthSource.js');
const { GenerationTask, generateTask } = require('../../../dist-electron/electron/llm/generateTask.js');
const config = { enabled: true, riskConfirmedVersion: 1, model: 'gpt-5.4', fastModel: 'gpt-5.3-codex-spark', serviceTier: 'default' };
const policy = { interviewFirstTokenSeconds: 1, interviewTotalSeconds: 2, writtenTotalSeconds: 2 };
const endpoint = 'https://chatgpt.com/backend-api/codex/responses';
const fixtureExpiry = Date.now() / 1000 + 3600;
const token = (nonce = 'one', account = 'account-a', exp = fixtureExpiry) => `e30.${Buffer.from(JSON.stringify({ exp, nonce, 'https://api.openai.com/auth': { chatgpt_account_id: account } })).toString('base64url')}.synthetic`;
const auth = (nonce = 'one', account = 'account-a', exp) => JSON.stringify({ auth_mode: 'chatgpt', tokens: { access_token: token(nonce, account, exp), account_id: account, refresh_token: 'NEVER_USED' } });
const frame = event => `data: ${JSON.stringify(event)}\r\n\r\n`;
const completed = text => new Response(frame({ type: 'response.output_text.delta', delta: text }) + frame({ type: 'response.completed', response: { usage: { output_tokens: 2 } } }), { headers: { 'content-type': 'text/event-stream' } });
const collect = async source => { const result = []; for await (const event of source) result.push(event); return result; };
function run(options = {}) {
  const reads = [], sends = [];
  let valid = true;
  const source = new CodexAuthSource(async () => { reads.push(1); return options.read ? options.read(reads.length) : auth(); }, async (url, init) => {
    sends.push({ url, init }); return options.send ? options.send(sends.length, init) : completed('hello');
  });
  const task = new GenerationTask('codex', options.backup, options.policy ?? policy, options.kind ?? 'written', options.signal);
  const session = source.session(() => { task.check(); if (!valid) throw new Error('live gate withdrawn'); });
  const events = () => generateTask(task, target => session.generate(config, { model: target === 'backup' ? 'backup' : config.model, contents: [{ text: 'USER' }], systemInstruction: 'SYSTEM', signal: task.signal }, () => task.claimSend(target)), { recoverAuthentication: (_, error) => session.recover(error) });
  return { reads, sends, task, session, source, revoke: () => { valid = false; }, drain: async () => { try { return await collect(events()); } finally { session.dispose(); task.close(); } }, events };
}

// Migration coverage of all 35 retired CLI cases: config/argv → config/body;
// JSONL/plain text → explicit Responses/SSE; executable discovery → bounded auth;
// process timeout/abort → the shared task/reader lifecycle. No executable is invoked.
test('migration 01 defaults retain main/fast models and disabled source (no path/sandbox/timeout)', async () => {
  assert.deepEqual(validateCodexSourceConfig({}), DEFAULT_CODEX_SOURCE_CONFIG);
  assert.equal(DEFAULT_CODEX_SOURCE_CONFIG.enabled, false); assert.equal(DEFAULT_CODEX_SOURCE_CONFIG.model, 'gpt-5.4'); assert.equal(DEFAULT_CODEX_SOURCE_CONFIG.fastModel, 'gpt-5.3-codex-spark');
  for (const key of ['path', 'sandboxMode', 'timeoutMs']) assert.equal(key in DEFAULT_CODEX_SOURCE_CONFIG, false);
});
test('enabled is strict boolean and current risk version is not inferred', () => { for (const enabled of [1, 'yes', null]) assert.throws(() => validateCodexSourceConfig({ enabled })); assert.equal(validateCodexSourceConfig({ enabled: true }).riskConfirmedVersion, undefined); });
test('migration 02 invalid tiers and efforts fail, rather than sandbox privilege options', () => {
  assert.throws(() => codexRequestBody({ ...config, serviceTier: 'evil' }, { contents: [], signal: new AbortController().signal }));
  assert.throws(() => codexRequestBody({ ...config, modelReasoningEffort: 'evil' }, { contents: [], signal: new AbortController().signal }));
});
test('migration 03 source default is no auth read', async () => { const r = run(); const result = await r.source.status({ ...config, enabled: false }); assert.equal(result.status, 'disabled'); assert.equal(r.reads.length, 0); r.task.close(); });
test('migration 04 timeout belongs to logical task, not executable config', async () => { const r = run({ policy: { ...policy, writtenTotalSeconds: .015 }, send: async () => new Promise(() => {}) }); await assert.rejects(r.drain(), { name: 'GenerationTimeoutError' }); assert.equal(r.sends.length, 1); });
test('migration 05 no caller executable or compatible endpoint affects fixed request', async () => { const r = run(); await r.drain(); assert.equal(r.sends[0].url, endpoint); assert.equal(r.sends[0].init.redirect, 'error'); });
test('migration 06 legacy enabled without current confirmation has zero reads', async () => { const r = run(); assert.equal((await r.source.status({ ...config, riskConfirmedVersion: undefined })).status, 'confirmation-required'); assert.equal(r.reads.length, 0); r.task.close(); });
test('migration 07 API-key auth mode is rejected', () => { assert.throws(() => parseCodexAuth(JSON.stringify({ auth_mode: 'apikey', OPENAI_API_KEY: 'SECRET' })), { kind: 'invalid' }); });
test('migration 08 whitespace/header-injection account is rejected', () => { const value = JSON.parse(auth()); value.tokens.account_id = 'account\r\nX: y'; assert.throws(() => parseCodexAuth(JSON.stringify(value)), { kind: 'invalid' }); });
test('migration 09 fixed request preserves system/user separation and stream/store flags', async () => { const r = run(); await r.drain(); const body = JSON.parse(r.sends[0].init.body); assert.equal(body.instructions, 'SYSTEM'); assert.equal(body.input[0].content[0].text, 'USER'); assert.equal(body.stream, true); assert.equal(body.store, false); });
test('migration 10 default tier/effort omit unclaimed API parameters', () => { const body = codexRequestBody(config, { model: 'gpt-5.4', contents: [], signal: new AbortController().signal }); for (const key of ['service_tier', 'reasoning', 'temperature', 'max_output_tokens', 'prompt_cache_key', 'include']) assert.equal(key in body, false); });
test('migration 11 explicit allowlisted tier/effort serialize without fallback', () => { const body = codexRequestBody({ ...config, serviceTier: 'fast', modelReasoningEffort: 'high' }, { model: 'gpt-5.4', contents: [], signal: new AbortController().signal }); assert.equal(body.service_tier, 'fast'); assert.deepEqual(body.reasoning, { effort: 'high' }); });
test('migration 12 image input becomes independent inline input, never CLI argv', () => { const body = codexRequestBody(config, { model: 'gpt-5.4', contents: [{ inlineData: { mimeType: 'image/png', data: 'aA==' } }], signal: new AbortController().signal }); assert.equal(body.input[0].content[0].image_url, 'data:image/png;base64,aA=='); });
test('flat text/image parts share one user message; history role order and instructions remain separate', () => {
  const request = { model: 'gpt-5.4', systemInstruction: 'SYSTEM', signal: new AbortController().signal };
  const flat = codexRequestBody(config, { ...request, contents: [{ text: 'USER' }, { inlineData: { mimeType: 'image/png', data: 'aA==' } }] });
  assert.equal(flat.input.length, 1); assert.equal(flat.input[0].content.length, 2); assert.equal(flat.instructions, 'SYSTEM');
  const history = codexRequestBody(config, { ...request, contents: [{ role: 'user', parts: [{ text: 'earlier' }] }, { role: 'model', parts: [{ text: 'prior answer' }] }, { role: 'user', parts: [{ text: 'latest' }] }] });
  assert.deepEqual(history.input.map(row => row.role), ['user', 'assistant', 'user']);
});
test('migration 13 explicit completed delta stream succeeds', async () => { const r = run(); const result = await r.drain(); assert.equal(result[0].text, 'hello'); assert.equal(result.at(-1).status, 'completed'); });
test('migration 14 plain text is not silently considered completed', async () => { const r = run({ send: () => new Response('hello') }); await assert.rejects(r.drain(), { name: 'CodexSourceError' }); assert.equal(r.sends.length, 1); });
test('migration 15 markdown/JSON-looking text stays literal model text', async () => { const r = run({ send: () => completed('```json\n{"x":1}\n```') }); assert.equal((await r.drain())[0].text, '```json\n{"x":1}\n```'); });
test('migration 16 lifecycle without explicit completion is incomplete', async () => { const r = run({ send: () => new Response(frame({ type: 'response.created' }), { headers: { 'content-type': 'text/event-stream' } }) }); assert.equal((await r.drain()).at(-1).status, 'incomplete'); });
test('migration 17 only actual output-text deltas are emitted', async () => { const r = run({ send: () => new Response(frame({ type: 'response.reasoning_text.delta', delta: 'hidden' }) + frame({ type: 'response.output_text.delta', delta: 'visible' }) + frame({ type: 'response.completed' }), { headers: { 'content-type': 'text/event-stream' } }) }); assert.equal((await r.drain())[0].text, 'visible'); });
test('migration 18 explicit remote failure is safe and not success', async () => { const r = run({ send: () => new Response(frame({ type: 'response.failed', response: { error: { message: 'SECRET' } } }), { headers: { 'content-type': 'text/event-stream' } }) }); await assert.rejects(r.drain(), error => error.name === 'CodexSourceError' && !String(error).includes('SECRET')); });
test('migration 19 terminal output_text field alone does not fabricate delta output', async () => { const r = run({ send: () => new Response(frame({ type: 'response.completed', response: { output_text: 'unconsumed' } }), { headers: { 'content-type': 'text/event-stream' } }) }); assert.equal((await r.drain()).at(-1).status, 'empty'); });
test('migration 20 split multibyte SSE frames reconstruct actual content', async () => { const bytes = new TextEncoder().encode(frame({ type: 'response.output_text.delta', delta: '你好' }) + frame({ type: 'response.completed' })); const r = run({ send: () => new Response(new ReadableStream({ start(c) { for (let i = 0; i < bytes.length; i++) c.enqueue(bytes.slice(i, i + 1)); c.close(); } }), { headers: { 'content-type': 'text/event-stream' } }) }); assert.equal((await r.drain())[0].text, '你好'); });
test('migration 21 empty explicit completion remains empty', async () => { const r = run({ send: () => completed(' ') }); assert.equal((await r.drain()).at(-1).status, 'empty'); });
test('migration 22 error envelope preserves only allowlisted safe classification', async () => { const r = run({ send: () => new Response(JSON.stringify({ error: { code: 'invalid_api_key', message: 'SECRET' } }), { status: 401 }) }); await assert.rejects(r.drain(), error => error.code === 'invalid_api_key' && !JSON.stringify(error).includes('SECRET')); assert.equal(r.sends.length, 1); });
test('migration 23 no remote error means no synthetic error on success', async () => { const r = run(); const result = await r.drain(); assert.equal(result.at(-1).error, undefined); });
test('migration 24 arbitrary remote message/code never enter errors', async () => { const r = run({ send: () => new Response(JSON.stringify({ error: { code: 'SECRET', message: 'SECRET' } }), { status: 400 }) }); await assert.rejects(r.drain(), error => error.code === undefined && !String(error).includes('SECRET')); });
test('migration 25 missing auth path never triggers discovery/CLI', async () => { await assert.rejects(readCodexAuthFile(path.join(os.tmpdir(), 'not-present-auth.json')), { kind: 'file-unavailable' }); });
test('migration 26 synthetic regular file read is bounded and readonly', async () => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-auth-')), file = path.join(dir, 'auth.json'); try { const original = auth(); fs.writeFileSync(file, original, { mode: 0o600 }); assert.equal(await readCodexAuthFile(file), original); assert.equal(fs.readFileSync(file, 'utf8'), original); } finally { fs.rmSync(dir, { recursive: true }); } });
test('migration 27 local status reports only local checks, not connection', async () => { const r = run(); const result = await r.source.status(config); assert.equal(result.status, 'locally-valid'); assert.match(result.message, /unverified/); assert.equal(r.sends.length, 0); assert.equal(JSON.stringify(result).includes('account-a'), false); r.task.close(); });
test('migration 28 malformed/oversize/unsupported auth fails without alternate storage', () => { for (const value of ['{}', '[1]', 'not-json', 'x'.repeat(MAX_CODEX_AUTH_BYTES + 1)]) assert.throws(() => parseCodexAuth(value), { kind: 'invalid' }); });
test('migration 29 unavailable reader returns safe local status', async () => { const r = run({ read: () => { throw Error('SECRET'); } }); const result = await r.source.status(config); assert.equal(result.status, 'file-unavailable'); assert.equal(JSON.stringify(result).includes('SECRET'), false); r.task.close(); });
test('migration 30 expired login requires external re-login, no refresh', () => { assert.throws(() => parseCodexAuth(auth('one', 'account-a', 1)), { kind: 'expired' }); });
test('migration 31 first-visible/total deadlines cannot acquire extra retry time', async () => { const r = run({ kind: 'interview', policy: { ...policy, interviewFirstTokenSeconds: .015 }, send: () => new Promise(() => {}) }); await assert.rejects(r.drain(), { name: 'GenerationTimeoutError' }); assert.equal(r.sends.length, 1); });
test('migration 32 pre-aborted request has zero reads and sends', async () => { const controller = new AbortController(); controller.abort(); const r = run({ signal: controller.signal }); await assert.rejects(r.drain(), { name: 'AbortError' }); assert.equal(r.reads.length, 0); assert.equal(r.sends.length, 0); });
test('migration 33 in-flight abort cancels reader and ignores late text', async () => { const controller = new AbortController(); let cancelled = 0; const r = run({ signal: controller.signal, send: () => new Response(new ReadableStream({ start() { setTimeout(() => controller.abort(), 5); }, cancel() { cancelled++; } }), { headers: { 'content-type': 'text/event-stream' } }) }); await assert.rejects(r.drain(), { name: 'AbortError' }); await new Promise(resolve => setTimeout(resolve, 5)); assert.equal(cancelled, 1); assert.equal(r.sends.length, 1); });
test('migration 34 stream preabort likewise cannot read credentials', async () => { const r = run(); r.task.controller.abort(); await assert.rejects(r.drain(), { name: 'AbortError' }); assert.equal(r.reads.length, 0); });
test('migration 35 consumer close releases body without a late event', async () => { let cancelled = 0; const r = run({ send: () => new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(frame({ type: 'response.output_text.delta', delta: 'partial' }))); }, cancel() { cancelled++; } }), { headers: { 'content-type': 'text/event-stream' } }) }); const events = r.events(); assert.equal((await events.next()).value.text, 'partial'); await events.return(); r.session.dispose(); r.task.close(); await new Promise(resolve => setTimeout(resolve, 5)); assert.equal(cancelled, 1); });

for (const scenario of ['changed', 'unchanged', 'account-changed', 'expired', 'revoked']) test(`401 recovery: ${scenario}`, async () => {
  let r; r = run({ read: n => n === 1 || scenario === 'unchanged' ? auth() : scenario === 'account-changed' ? auth('two', 'account-b') : scenario === 'expired' ? auth('two', 'account-a', 1) : auth('two'), send: n => {
    if (n === 1) { if (scenario === 'revoked') r.revoke(); return new Response('{}', { status: 401 }); }
    return completed('recovered');
  } });
  if (scenario === 'changed') { assert.equal((await r.drain()).at(-1).status, 'completed'); assert.equal(r.sends.length, 2); assert.notEqual(r.sends[0].init.headers.Authorization, r.sends[1].init.headers.Authorization); assert.equal(r.sends[1].init.headers['ChatGPT-Account-Id'], 'account-a'); }
  else { await assert.rejects(r.drain()); assert.equal(r.sends.length, 1); }
});
test('second 401 cannot cause a third physical send/read', async () => { const r = run({ read: n => auth(String(n)), send: () => new Response('{}', { status: 401 }) }); await assert.rejects(r.drain()); assert.equal(r.sends.length, 2); assert.equal(r.reads.length, 2); });
test('shared budget already consumed by first target permits no source recovery send', async () => { const r = run({ backup: 'backup', read: n => auth(String(n)), send: n => new Response('{}', { status: n === 1 ? 503 : 401 }) }); await assert.rejects(r.drain()); assert.equal(r.sends.length, 2); assert.equal(r.reads.length, 1); });
test('partial output prohibits replay even on transient network interruption', async () => { const r = run({ send: () => new Response(frame({ type: 'response.output_text.delta', delta: 'partial' }) + frame({ type: 'response.failed' }), { headers: { 'content-type': 'text/event-stream' } }) }); await assert.rejects(r.drain()); assert.equal(r.sends.length, 1); });
test('network classification preserves safe transient code but no raw secret/cause', async () => { const r = run({ send: n => { if (n === 1) throw Object.assign(Error('SECRET'), { cause: { code: 'ECONNRESET', message: 'SECRET' } }); return completed('ok'); } }); assert.equal((await r.drain()).at(-1).status, 'completed'); assert.equal(r.sends.length, 2); });
test('503 unsupported_image is terminal without backup', async () => { const r = run({ backup: 'backup', send: () => new Response(JSON.stringify({ error: { code: 'unsupported_image', message: 'SECRET' } }), { status: 503 }) }); await assert.rejects(r.drain()); assert.equal(r.sends.length, 1); });
test('explicit model_not_found can switch backup; generic 404 cannot', async () => { for (const explicit of [true, false]) { const r = run({ backup: 'backup', send: n => n === 1 ? new Response(JSON.stringify({ error: { code: explicit ? 'model_not_found' : 'unknown', message: 'SECRET' } }), { status: 404 }) : completed('backup') }); if (explicit) { await r.drain(); assert.equal(r.sends.length, 2); } else { await assert.rejects(r.drain()); assert.equal(r.sends.length, 1); } } });
for (const type of ['response.failed', 'error']) for (const code of ['model_not_found', 'SECRET', 'unsupported_image']) test(`HTTP 200 SSE ${type} safely classifies ${code}`, async () => {
  const r = run({ backup: 'backup', send: n => n === 1 ? new Response(frame({ type, ...(type === 'error' ? { code, message: 'SECRET' } : { response: { error: { code, message: 'SECRET', cause: 'SECRET' } } }) }), { headers: { 'content-type': 'text/event-stream' } }) : completed('backup') });
  if (code === 'model_not_found') { assert.equal((await r.drain()).at(-1).status, 'completed'); assert.equal(r.sends.length, 2); }
  else { await assert.rejects(r.drain(), error => (code === 'SECRET' ? error.code === undefined : /not support images/.test(error.message)) && !JSON.stringify(error).includes('SECRET')); assert.equal(r.sends.length, 1); }
});
test('HTTP 200 SSE partial model_not_found never replays or switches backup', async () => {
  const r = run({ backup: 'backup', send: () => new Response(frame({ type: 'response.output_text.delta', delta: 'partial' }) + frame({ type: 'response.failed', response: { error: { code: 'model_not_found', message: 'SECRET' } } }), { headers: { 'content-type': 'text/event-stream' } }) });
  await assert.rejects(r.drain()); assert.equal(r.sends.length, 1);
});
test('Retry-After exceeding shared remaining time terminates with one send', async () => { const r = run({ send: () => new Response('{}', { status: 429, headers: { 'retry-after': '120' } }) }); await assert.rejects(r.drain()); assert.equal(r.sends.length, 1); });
test('redirect response cannot leak token into another endpoint', async () => { const r = run({ send: () => new Response('', { status: 302, headers: { location: 'https://evil.example' } }) }); await assert.rejects(r.drain()); assert.equal(r.sends.length, 1); assert.equal(r.sends[0].init.redirect, 'error'); });
test('post-fetch live gate failure releases response body', async () => { let cancelled = 0, r; r = run({ send: () => { r.revoke(); return new Response(new ReadableStream({ cancel() { cancelled++; } }), { headers: { 'content-type': 'text/event-stream' } }); } }); await assert.rejects(r.drain()); assert.equal(cancelled, 1); assert.equal(r.sends.length, 1); });
test('symlink and oversized file fail closed', async () => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-auth-invalid-')); try { const original = path.join(dir, 'regular'); fs.writeFileSync(original, auth()); fs.symlinkSync(original, path.join(dir, 'link')); await assert.rejects(readCodexAuthFile(path.join(dir, 'link')), { kind: 'invalid' }); fs.writeFileSync(original, 'x'.repeat(MAX_CODEX_AUTH_BYTES + 1)); await assert.rejects(readCodexAuthFile(original), { kind: 'invalid' }); } finally { fs.rmSync(dir, { recursive: true }); } });
test('account claim mismatch and unknown expiry are not locally accepted', () => { const value = JSON.parse(auth()); value.tokens.account_id = 'other-account'; assert.throws(() => parseCodexAuth(JSON.stringify(value))); value.tokens.access_token = 'opaque'; assert.throws(() => parseCodexAuth(JSON.stringify(value))); });
test('refusal and incomplete responses remain terminal non-success without extra send', async () => { for (const type of ['response.refusal.delta', 'response.incomplete']) { const r = run({ send: () => new Response(frame({ type }) + frame({ type: 'response.completed' }), { headers: { 'content-type': 'text/event-stream' } }) }); assert.equal((await r.drain()).at(-1).status, type === 'response.incomplete' ? 'incomplete' : 'refused'); assert.equal(r.sends.length, 1); } });
