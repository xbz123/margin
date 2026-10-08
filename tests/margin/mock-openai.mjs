// Loopback mock of the OpenAI Chat Completions streaming API, for the Margin answer
// regression harness (PLAN.md AG-09). Listens on 127.0.0.1 only, records every
// request, and streams a scripted reply as server-sent events with a delay between
// chunks so tests can observe streaming and cancellation. `setScript({ errorStatus })`
// makes chat requests fail with that HTTP status instead, and `setScript({ respond })`
// (a function of the request body returning the reply text, or undefined to use
// `chunks`) answers each request on its own; `setScript({ hold: true })` records chat
// requests and never answers them (until `close`). `afterChunk(entry)` may pause a
// stream after a chunk is written, so a test can observe it before releasing the tail.
// Also serves the Groq SDK's path
// (/openai/v1/chat/completions), so a Groq client can be pointed here too.

import http from 'node:http';

export async function startMockOpenAI() {
  const requests = [];
  let script = { chunks: ['Mock ', 'answer.'], delayMs: 20 };
  const openStreams = new Set();

  const server = http.createServer(async (req, res) => {
    let body = '';
    for await (const c of req) body += c;
    let json = null;
    try { json = body ? JSON.parse(body) : null; } catch { /* not JSON */ }
    const entry = { method: req.method, url: req.url, body: json, at: Date.now(), closedEarly: false, chunksSent: 0 };
    requests.push(entry);

    if (req.method === 'GET' && req.url.startsWith('/v1/models')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ object: 'list', data: [{ id: 'gpt-5.4', object: 'model' }] }));
      return;
    }
    const isChat = req.url.startsWith('/v1/chat/completions') || req.url.startsWith('/openai/v1/chat/completions');
    if (req.method !== 'POST' || !isChat) {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { message: `mock: no route ${req.method} ${req.url}` } }));
      return;
    }
    const { delayMs, errorStatus, respond, hold, afterChunk } = script;
    if (hold) {
      openStreams.add(res);
      res.on('close', () => openStreams.delete(res));
      return;
    }
    const reply = typeof respond === 'function' ? respond(json) : undefined;
    const chunks = typeof reply === 'string' ? [reply] : script.chunks;
    if (errorStatus) {
      res.writeHead(errorStatus, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'mock: injected error', type: 'invalid_request_error', code: 'mock_error' } }));
      return;
    }
    const id = `chatcmpl-mock-${requests.length}`;
    const model = json?.model || 'gpt-5.4';
    if (!json?.stream) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        id, object: 'chat.completion', created: Math.floor(Date.now() / 1000), model,
        choices: [{ index: 0, message: { role: 'assistant', content: chunks.join('') }, finish_reason: 'stop' }],
      }));
      return;
    }
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
    openStreams.add(res);
    res.on('close', () => { if (!res.writableEnded) entry.closedEarly = true; openStreams.delete(res); });
    const send = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);
    for (const piece of chunks) {
      if (res.destroyed) return;
      send({ id, object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model,
        choices: [{ index: 0, delta: { content: piece }, finish_reason: null }] });
      entry.chunksSent++;
      if (typeof afterChunk === 'function') await afterChunk(entry);
      await new Promise((r) => setTimeout(r, delayMs));
    }
    if (res.destroyed) return;
    send({ id, object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model,
      choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] });
    res.write('data: [DONE]\n\n');
    res.end();
  });

  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  return {
    baseURL: `http://127.0.0.1:${port}/v1`,
    requests,
    chatRequests: () => requests.filter((r) => /^\/(openai\/)?v1\/chat\/completions/.test(r.url)),
    setScript(next) { script = { errorStatus: 0, respond: undefined, hold: false, ...script, afterChunk: undefined, ...next }; },
    async close() {
      for (const s of openStreams) s.destroy();
      await new Promise((r) => server.close(r));
    },
  };
}
