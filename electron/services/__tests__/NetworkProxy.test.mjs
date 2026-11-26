import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { generateKeyPairSync, randomBytes, sign } from 'node:crypto';

// Network proxy: resolver order, the shared tunnel (HTTP CONNECT and SOCKS5) and the fetch,
// axios and ws channels. Every proxy and target is a local synthetic server on 127.0.0.1; the
// target names (*.synthetic.test) are only ever resolved by the test proxies, never by DNS.

const require = createRequire(import.meta.url);
const dist = '../../../dist-electron/electron';
const proxy = require(`${dist}/services/proxy/index.js`);
const settings = require(`${dist}/services/proxy/settings.js`);
const outbound = require(`${dist}/services/outbound.js`);
const { streamingStttWsOptions } = require(`${dist}/audio/dnsHelpers.js`);
const { WebSocket, WebSocketServer } = require('ws');

const ENV = ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy', 'ALL_PROXY', 'all_proxy', 'NO_PROXY', 'no_proxy'];

async function isolated(run) {
  const saved = Object.fromEntries(ENV.map(name => [name, process.env[name]]));
  for (const name of ENV) delete process.env[name];
  try { return await run(); } finally {
    for (const name of ENV) if (saved[name] === undefined) delete process.env[name]; else process.env[name] = saved[name];
    proxy.configureNetworkProxy(undefined);
    proxy.setSystemProxyResolver(undefined);
    proxy.setProxyTestTrustAnchors(undefined);
  }
}

const manual = (protocol, port, extra = {}) => ({ mode: 'manual', protocol, host: '127.0.0.1', port, bypass: [], ...extra });

async function listen(server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return server.address().port;
}

async function close(...servers) {
  await Promise.all(servers.map(server => new Promise(resolve => {
    server.closeAllConnections?.();
    for (const socket of server.sockets ?? []) socket.destroy();
    server.close(() => resolve());
  })));
}

/** Tracks sockets so close() can end piped tunnels. */
function tracked(server) {
  server.sockets = new Set();
  server.on('connection', socket => { server.sockets.add(socket); socket.on('close', () => server.sockets.delete(socket)); });
  return server;
}

function pipeTunnel(client, port, rest, log, onReady) {
  const upstream = net.connect(port, '127.0.0.1', () => {
    onReady();
    if (rest.length) { log.forwarded.push(rest); upstream.write(rest); }
    client.on('data', chunk => log.forwarded.push(chunk));
    client.pipe(upstream); upstream.pipe(client);
  });
  upstream.on('error', () => client.destroy());
  client.on('error', () => upstream.destroy());
  client.on('close', () => upstream.destroy());
}

/** Local HTTP CONNECT proxy; records each CONNECT and the raw bytes it forwards. */
async function connectProxy({ auth, reply, tls: tlsOptions } = {}) {
  const log = { connects: [], forwarded: [], sockets: 0 };
  const handler = client => {
    log.sockets++;
    let head = Buffer.alloc(0);
    const onData = chunk => {
      head = Buffer.concat([head, chunk]);
      const end = head.indexOf('\r\n\r\n');
      if (end < 0) return;
      client.removeListener('data', onData);
      const [requestLine, ...lines] = head.subarray(0, end).toString('latin1').split('\r\n');
      const rest = head.subarray(end + 4);
      const headers = Object.fromEntries(lines.map(line => [line.slice(0, line.indexOf(':')).toLowerCase(), line.slice(line.indexOf(':') + 1).trim()]));
      const target = requestLine.split(' ')[1];
      log.connects.push({ requestLine, target, headers });
      if (reply) { client.end(reply); return; }
      if (auth && headers['proxy-authorization'] !== 'Basic ' + Buffer.from(auth).toString('base64')) {
        client.end('HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm="synthetic"\r\nContent-Length: 0\r\n\r\n');
        return;
      }
      pipeTunnel(client, Number(target.slice(target.lastIndexOf(':') + 1)), rest, log, () => client.write('HTTP/1.1 200 Connection Established\r\n\r\n'));
    };
    client.on('data', onData);
  };
  const server = tracked(tlsOptions ? (await import('node:tls')).createServer(tlsOptions, handler) : net.createServer(handler));
  return { server, log, port: await listen(server) };
}

function reader(socket) {
  let buffer = Buffer.alloc(0), wake;
  const onData = chunk => { buffer = Buffer.concat([buffer, chunk]); wake?.(); };
  socket.on('data', onData);
  const read = async count => {
    while (buffer.length < count) { if (socket.destroyed) throw Error('closed'); await new Promise(resolve => { wake = resolve; socket.once('close', resolve); }); }
    const out = buffer.subarray(0, count); buffer = buffer.subarray(count); return out;
  };
  read.detach = () => { socket.removeListener('data', onData); return buffer; };
  return read;
}

/** Local SOCKS5 proxy (RFC 1928 / 1929); records offered methods and the requested address type. */
async function socksProxy({ auth } = {}) {
  const log = { greetings: [], requests: [], forwarded: [], sockets: 0, credentials: [] };
  const server = tracked(net.createServer(async client => {
    log.sockets++;
    client.on('error', () => {});
    try {
      const read = reader(client);
      const [, count] = await read(2);
      const methods = [...await read(count)];
      log.greetings.push(methods);
      if (auth) {
        if (!methods.includes(2)) { client.end(Buffer.from([5, 0xff])); return; }
        client.write(Buffer.from([5, 2]));
        const [, userLength] = await read(2);
        const user = (await read(userLength)).toString();
        const [passLength] = await read(1);
        const pass = (await read(passLength)).toString();
        log.credentials.push(`${user}:${pass}`);
        const ok = `${user}:${pass}` === auth;
        client.write(Buffer.from([1, ok ? 0 : 1]));
        if (!ok) { client.end(); return; }
      } else {
        if (!methods.includes(0)) { client.end(Buffer.from([5, 0xff])); return; }
        client.write(Buffer.from([5, 0]));
      }
      const [, , , atyp] = await read(4);
      let host;
      if (atyp === 3) host = (await read((await read(1))[0])).toString();
      else if (atyp === 1) host = [...await read(4)].join('.');
      else host = (await read(16)).toString('hex');
      const port = (await read(2)).readUInt16BE();
      log.requests.push({ atyp, host, port });
      const rest = read.detach();
      pipeTunnel(client, port, rest, log, () => client.write(Buffer.from([5, 0, 0, 1, 127, 0, 0, 1, port >> 8, port & 255])));
    } catch { client.destroy(); }
  }));
  return { server, log, port: await listen(server) };
}

async function httpTarget() {
  const log = [];
  const server = tracked(http.createServer((req, res) => { log.push({ url: req.url, headers: req.headers }); res.end('target ok'); }));
  return { server, log, port: await listen(server) };
}

async function wsTarget() {
  const server = tracked(http.createServer());
  const log = [];
  const wss = new WebSocketServer({ server });
  wss.on('connection', (socket, req) => { log.push(req.headers); socket.on('message', data => socket.send('echo:' + data)); });
  const port = await listen(server);
  return { server, wss, log, port };
}

async function wsRoundTrip(url) {
  const ws = new WebSocket(url, streamingStttWsOptions(url));
  try {
    await once(ws, 'open');
    ws.send('synthetic');
    const [data] = await once(ws, 'message');
    return String(data);
  } finally { ws.terminate(); }
}

async function wsFailure(url) {
  const ws = new WebSocket(url, streamingStttWsOptions(url));
  const [error] = await once(ws, 'error');
  ws.terminate();
  return error;
}

const proxyCode = error => {
  for (let current = error; current; current = current.cause) if (current.name === 'ProxyError') return current.code;
  return undefined;
};

// ---- self-signed certificate (DER built in-test; no fixture key is stored) ------------------
function selfSignedCertificate(hostname) {
  const length = n => n < 128 ? Buffer.from([n]) : (bytes => Buffer.from([0x80 | bytes.length, ...bytes]))(n.toString(16).padStart(n > 255 ? 4 : 2, '0').match(/../g).map(h => parseInt(h, 16)));
  const der = (tag, ...parts) => { const body = Buffer.concat(parts); return Buffer.concat([Buffer.from([tag]), length(body.length), body]); };
  const seq = (...parts) => der(0x30, ...parts);
  const oid = text => {
    const [a, b, ...rest] = text.split('.').map(Number);
    const bytes = [40 * a + b];
    for (let value of rest) { const stack = [value & 0x7f]; while ((value >>= 7)) stack.unshift((value & 0x7f) | 0x80); bytes.push(...stack); }
    return der(0x06, Buffer.from(bytes));
  };
  const time = date => der(0x17, Buffer.from(date.toISOString().replace(/[-:T]/g, '').slice(2, 14) + 'Z'));
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const algorithm = seq(oid('1.2.840.10045.4.3.2'));
  const name = seq(der(0x31, seq(oid('2.5.4.3'), der(0x0c, Buffer.from('Margin synthetic proxy test')))));
  const san = seq(oid('2.5.29.17'), der(0x04, seq(der(0x82, Buffer.from(hostname)))));
  const tbs = seq(der(0xa0, der(0x02, Buffer.from([2]))), der(0x02, Buffer.concat([Buffer.from([1]), randomBytes(8)])), algorithm, name,
    seq(time(new Date(Date.now() - 3600_000)), time(new Date(Date.now() + 86400_000))), name,
    publicKey.export({ type: 'spki', format: 'der' }), der(0xa3, seq(san)));
  const certificate = seq(tbs, algorithm, der(0x03, Buffer.concat([Buffer.from([0]), sign('sha256', tbs, privateKey)])));
  return {
    cert: `-----BEGIN CERTIFICATE-----\n${certificate.toString('base64').match(/.{1,64}/g).join('\n')}\n-----END CERTIFICATE-----\n`,
    key: privateKey.export({ type: 'pkcs8', format: 'pem' }),
  };
}

// ---- 1. settings and resolution ----------------------------------------------------------------

test('settings validation canonicalises hosts and bypass entries and rejects ambiguous input', () => {
  const { normalizeNetworkProxySettings: normalize } = settings;
  assert.deepEqual({ ...normalize({ mode: 'system' }) }, { mode: 'system', protocol: 'http', host: '', port: 0, bypass: [] });
  assert.deepEqual({ ...normalize({ mode: 'manual', protocol: 'https', host: 'Proxy.Example.TEST', port: 443, bypass: ['*.Corp.test', '.lan.test', 'Host.test', '10.0.0.1', '[fd00::1]', 'host.test'] }) },
    { mode: 'manual', protocol: 'https', host: 'proxy.example.test', port: 443, bypass: ['.corp.test', '.lan.test', 'host.test', '10.0.0.1', 'fd00::1'] });
  assert.equal(normalize({ mode: 'manual', protocol: 'http', host: '[2001:db8::1]', port: 1 }).host, '2001:db8::1');
  assert.equal(normalize({ mode: 'manual', protocol: 'http', host: '2001:db8::1', port: 1 }).host, '2001:db8::1');
  for (const bad of [
    { mode: 'manual', protocol: 'http', host: 'socks5://h.test', port: 1 }, { mode: 'manual', protocol: 'http', host: 'h.test:80', port: 1 },
    { mode: 'manual', protocol: 'http', host: 'u:p@h.test', port: 1 }, { mode: 'manual', protocol: 'http', host: 'h.test/x', port: 1 },
    { mode: 'manual', protocol: 'http', host: 'h.test?x', port: 1 }, { mode: 'manual', protocol: 'http', host: 'h.test#x', port: 1 },
    { mode: 'manual', protocol: 'http', host: 'h .test', port: 1 }, { mode: 'manual', protocol: 'http', host: '[h.test]', port: 1 },
    { mode: 'manual', protocol: 'http', host: 'h.test', port: 70000 }, { mode: 'manual', protocol: 'http', host: 'h.test' },
    { mode: 'manual', protocol: 'ftp', host: 'h.test', port: 1 }, { mode: 'auto' },
    { mode: 'system', bypass: ['*.'] }, { mode: 'system', bypass: ['*.10.0.0.1'] }, { mode: 'system', bypass: ['a.test/16'] },
    { mode: 'system', bypass: ['x'.repeat(256)] }, { mode: 'manual', protocol: 'http', host: 'h.test', port: 1, username: 'u\r' },
  ]) assert.throws(() => normalize(bad), /Invalid proxy settings/, JSON.stringify(bad));
});

test('built-in domestic services, loopback, private literals and bypass are direct in every mode; off is direct', () => isolated(async () => {
  const direct = ['https://dashscope.aliyuncs.com/api', 'wss://dashscope.aliyuncs.com/api-ws/v1/inference', 'wss://ws1.cn-beijing.maas.aliyuncs.com/api-ws/v1/inference',
    'wss://openspeech.bytedance.com/api/v3/sauc', 'http://localhost:1234/v1', 'http://127.9.9.9/', 'http://[::1]:8/', 'http://10.2.3.4/',
    'http://172.16.0.1/', 'http://172.31.255.1/', 'http://192.168.1.1/', 'http://169.254.1.1/', 'http://[fd12::1]/', 'https://corp.synthetic.test/',
    'https://a.b.corp.synthetic.test/', 'https://exact.synthetic.test/'];
  const proxied = ['https://api.openai.com/v1', 'wss://stt-rt.soniox.com/x', 'http://172.32.0.1/', 'http://11.0.0.1/', 'https://xcorp.synthetic.test/',
    'https://sub.exact.synthetic.test/', 'https://bytedance.com/', 'https://aliyuncs.com.evil.test/'];
  proxy.setSystemProxyResolver(async () => 'PROXY sys.synthetic.test:3128');
  for (const mode of ['manual', 'system']) {
    proxy.configureNetworkProxy({ ...manual('http', 8080), host: 'proxy.synthetic.test', mode, bypass: ['.corp.synthetic.test', 'exact.synthetic.test'] });
    for (const url of direct) assert.equal(await proxy.resolveProxyFor(url), 'direct', `${mode} ${url}`);
    for (const url of proxied) assert.notEqual(await proxy.resolveProxyFor(url), 'direct', `${mode} ${url}`);
  }
  proxy.configureNetworkProxy({ ...manual('socks5', 1080), username: 'u', password: 'p' });
  assert.deepEqual(await proxy.resolveProxyFor('https://api.openai.com/'), { protocol: 'socks5', host: '127.0.0.1', port: 1080, auth: { username: 'u', password: 'p' } });
  process.env.HTTPS_PROXY = 'http://env.synthetic.test:1';
  proxy.configureNetworkProxy({ ...manual('http', 8080), mode: 'off' });
  for (const url of [...direct, ...proxied]) assert.equal(await proxy.resolveProxyFor(url), 'direct');
  assert.throws(() => proxy.configureNetworkProxy({ mode: 'manual', protocol: 'http', host: '', port: 1 }));
  assert.equal(proxy.currentNetworkProxyMode(), 'off', 'invalid settings change nothing');
}));

test('system mode: environment variables first (with NO_PROXY), then the injected system resolver, cached per origin', () => isolated(async () => {
  let calls = [];
  let answer = 'PROXY a.synthetic.test:1; DIRECT';
  proxy.setSystemProxyResolver(async url => { calls.push(url); return answer; });
  proxy.configureNetworkProxy({ mode: 'system', protocol: 'http', host: '', port: 0, bypass: [] });
  assert.deepEqual(await proxy.resolveProxyFor('https://api.openai.com/v1/x?key=1'), { protocol: 'http', host: 'a.synthetic.test', port: 1 });
  assert.deepEqual(await proxy.resolveProxyFor('https://api.openai.com/other'), { protocol: 'http', host: 'a.synthetic.test', port: 1 });
  assert.deepEqual(calls, ['https://api.openai.com:443/'], 'one lookup per origin, without path or query');
  for (const [result, expected] of [
    ['SOCKS5 s.synthetic.test:1080', { protocol: 'socks5', host: 's.synthetic.test', port: 1080 }],
    ['SOCKS s.synthetic.test:1081; DIRECT', { protocol: 'socks5', host: 's.synthetic.test', port: 1081 }],
    ['HTTPS h.synthetic.test:443', { protocol: 'https', host: 'h.synthetic.test', port: 443 }],
    ['PROXY [2001:db8::5]:8080', { protocol: 'http', host: '2001:db8::5', port: 8080 }],
    ['DIRECT', 'direct'], ['SOCKS4 s.synthetic.test:1080', 'direct'], ['QUIC q.synthetic.test:443', 'direct'], ['PROXY bad host', 'direct'], ['', 'direct'],
  ]) {
    answer = result;
    proxy.configureNetworkProxy({ mode: 'system', protocol: 'http', host: '', port: 0, bypass: [] });
    assert.deepEqual(await proxy.resolveProxyFor('wss://stt-rt.soniox.com/x'), expected, result);
  }
  calls = [];
  proxy.setSystemProxyResolver(async () => { calls.push('failed'); throw Error('synthetic'); });
  assert.equal(await proxy.resolveProxyFor('https://api.groq.com/'), 'direct');
  // Environment variables take precedence over the system resolver.
  proxy.setSystemProxyResolver(async url => { calls.push(url); return 'PROXY sys.synthetic.test:9'; });
  calls = [];
  process.env.HTTPS_PROXY = 'http://user:p%40ss@env.synthetic.test:8443';
  process.env.ALL_PROXY = 'socks5h://all.synthetic.test';
  process.env.NO_PROXY = 'skip.synthetic.test, .wild.synthetic.test,10.0.0.0/8,[2001:db8::9]:443';
  assert.deepEqual(await proxy.resolveProxyFor('https://api.openai.com/'), { protocol: 'http', host: 'env.synthetic.test', port: 8443, auth: { username: 'user', password: 'p@ss' } });
  assert.deepEqual(await proxy.resolveProxyFor('ws://api.openai.com/'), { protocol: 'socks5', host: 'all.synthetic.test', port: 1080 });
  for (const url of ['https://skip.synthetic.test/', 'https://a.skip.synthetic.test/', 'https://x.wild.synthetic.test/', 'https://11.0.0.1/', 'https://[2001:db8::9]/']) {
    const expected = url === 'https://11.0.0.1/' ? 'env.synthetic.test' : 'direct';
    const decision = await proxy.resolveProxyFor(url);
    assert.equal(decision === 'direct' ? 'direct' : decision.host, expected, url);
  }
  assert.equal(await proxy.resolveProxyFor('https://dashscope.aliyuncs.com/'), 'direct', 'built-in direct wins over the environment');
  process.env.HTTPS_PROXY = 'socks4://old.synthetic.test:1080';
  assert.equal(await proxy.resolveProxyFor('https://api.openai.com/'), 'direct', 'unsupported environment proxy is not used');
  assert.deepEqual(calls, [], 'environment variables answer before the system resolver');
  for (const name of ['HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY']) delete process.env[name];
  process.env.https_proxy = 'env2.synthetic.test:3128';
  assert.deepEqual(await proxy.resolveProxyFor('https://api.openai.com/'), { protocol: 'http', host: 'env2.synthetic.test', port: 3128 });
  delete process.env.https_proxy;
  // Settings changes clear the cache.
  proxy.configureNetworkProxy({ mode: 'system', protocol: 'http', host: '', port: 0, bypass: [] });
  await proxy.resolveProxyFor('https://api.anthropic.com/'); await proxy.resolveProxyFor('https://api.anthropic.com/');
  proxy.configureNetworkProxy({ mode: 'system', protocol: 'http', host: '', port: 0, bypass: [] });
  await proxy.resolveProxyFor('https://api.anthropic.com/');
  assert.deepEqual(calls, ['https://api.anthropic.com:443/', 'https://api.anthropic.com:443/']);
}));

// ---- 2. fetch, axios and ws through each proxy kind -------------------------------------------

for (const kind of ['http', 'http-auth', 'socks5', 'socks5-auth']) {
  test(`fetch, axios and ws reach a local target through a ${kind} proxy; the target never sees proxy credentials`, () => isolated(async () => {
    const auth = kind.endsWith('-auth') ? 'synthetic-user:synthetic-proxy-secret' : undefined;
    const local = kind.startsWith('socks5') ? await socksProxy({ auth }) : await connectProxy({ auth });
    const target = await httpTarget();
    const socket = await wsTarget();
    try {
      proxy.configureNetworkProxy(manual(kind.startsWith('socks5') ? 'socks5' : 'http', local.port, auth ? { username: 'synthetic-user', password: 'synthetic-proxy-secret' } : {}));
      const base = `http://svc.synthetic.test:${target.port}`;
      assert.equal(await (await outbound.outboundFetch(`${base}/fetch`, { headers: { authorization: 'Bearer synthetic-target-key' } })).text(), 'target ok');
      assert.equal((await outbound.outboundAxios.get(`${base}/axios`)).data, 'target ok');
      assert.equal(await wsRoundTrip(`ws://svc.synthetic.test:${socket.port}/ws`), 'echo:synthetic');
      assert.deepEqual(target.log.map(entry => entry.url), ['/fetch', '/axios']);
      for (const headers of [...target.log.map(entry => entry.headers), ...socket.log]) {
        assert.equal(headers['proxy-authorization'], undefined);
        assert.ok(!JSON.stringify(headers).includes('synthetic-proxy-secret'));
      }
      assert.equal(target.log[0].headers.authorization, 'Bearer synthetic-target-key');
      if (kind.startsWith('socks5')) {
        assert.deepEqual(local.log.requests.map(({ atyp, host }) => [atyp, host]), [[3, 'svc.synthetic.test'], [3, 'svc.synthetic.test'], [3, 'svc.synthetic.test']], 'names are sent to the proxy (ATYP 3)');
        for (const methods of local.log.greetings) assert.deepEqual(methods, auth ? [0, 2] : [0]);
        if (auth) assert.deepEqual(new Set(local.log.credentials), new Set([auth]));
      } else {
        assert.deepEqual(local.log.connects.map(entry => entry.target), [`svc.synthetic.test:${target.port}`, `svc.synthetic.test:${target.port}`, `svc.synthetic.test:${socket.port}`]);
        for (const entry of local.log.connects) {
          assert.equal(entry.headers.host, entry.target);
          assert.equal(entry.headers['proxy-authorization'], auth ? 'Basic ' + Buffer.from(auth).toString('base64') : undefined);
        }
      }
      const forwarded = Buffer.concat(local.log.forwarded).toString('latin1');
      assert.ok(!forwarded.includes('synthetic-proxy-secret') && !/proxy-authorization/i.test(forwarded), 'proxy credentials never enter the tunnel');
    } finally {
      socket.wss.close();
      await close(local.server, target.server, socket.server);
    }
  }));
}

test('direct targets keep the unchanged path: no dispatcher, no agent, IPv4 lookup kept', () => isolated(async () => {
  const target = await httpTarget();
  try {
    proxy.configureNetworkProxy(manual('http', 9));
    let init;
    const wrapped = outbound.createOutboundFetch((input, options) => { init = options; return Promise.resolve(new Response('direct')); });
    assert.equal(await (await wrapped(`http://127.0.0.1:${target.port}/`)).text(), 'direct');
    assert.equal(init.dispatcher, undefined);
    assert.equal(init.redirect, 'error');
    await wrapped('https://api.openai.com/v1/models');
    assert.ok(init.dispatcher, 'a proxied target gets the proxy dispatcher');
    assert.equal(init.redirect, 'error');
    const local = streamingStttWsOptions('wss://dashscope.aliyuncs.com/api-ws/v1/inference', { headers: { a: 'b' } });
    assert.equal(local.agent, undefined); assert.equal(local.family, 4); assert.equal(typeof local.lookup, 'function'); assert.equal(local.handshakeTimeout, 15000);
    assert.deepEqual(local.headers, { a: 'b' });
    assert.ok(streamingStttWsOptions('wss://api.openai.com/v1/realtime').agent);
    proxy.configureNetworkProxy({ mode: 'off', protocol: 'http', host: '', port: 0, bypass: [] });
    assert.equal(streamingStttWsOptions('wss://api.openai.com/v1/realtime').agent, undefined);
    assert.equal((await outbound.outboundAxios.get(`http://127.0.0.1:${target.port}/direct`)).data, 'target ok');
  } finally { await close(target.server); }
}));

// ---- 3. real SDKs through a manual proxy keep refusing redirects ------------------------------

// Electron 43 runs Node 24, whose built-in fetch is undici 7 like the bundled dispatcher. A newer
// test Node may ship another undici major in its fetch, so the SDKs run on the installed undici 7
// fetch here, as in the application. (Node 26's fetch passes request headers in a form undici 7's
// dispatcher rejects for an explicit content-length, which Groq sets.)
const electronFetch = () => {
  const undici = require('undici');
  assert.equal(require('undici/package.json').version.split('.')[0], '7', 'undici 7 matches the Electron runtime fetch');
  return undici.fetch;
};

test('OpenAI, Anthropic, Groq and Gemini SDKs reach the service through the proxy and still refuse 307', () => isolated(async () => {
  let targetRequests = 0;
  const target = tracked(http.createServer((req, res) => { targetRequests++; res.end('{}'); }));
  const targetPort = await listen(target);
  const initial = [];
  const server = tracked(http.createServer((req, res) => {
    initial.push(req.url);
    if (req.url.includes('/models/allowed:')) { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'allowed' }] } }] })); return; }
    res.writeHead(307, { location: `http://127.0.0.1:${targetPort}/unconfigured` }); res.end();
  }));
  const port = await listen(server);
  const local = await connectProxy({ auth: 'synthetic-user:synthetic-proxy-secret' });
  const oldFetch = globalThis.fetch, oldGeminiBase = process.env.GOOGLE_GEMINI_BASE_URL;
  try {
    proxy.configureNetworkProxy(manual('http', local.port, { username: 'synthetic-user', password: 'synthetic-proxy-secret' }));
    globalThis.fetch = electronFetch();
    outbound.installOutboundFetchPolicy();
    const base = `http://sdk.synthetic.test:${port}`;
    const { GoogleGenAI } = require('@google/genai');
    process.env.GOOGLE_GEMINI_BASE_URL = base;
    const gemini = new GoogleGenAI({ apiKey: 'synthetic-only' });
    assert.equal((await gemini.models.generateContent({ model: 'allowed', contents: 'synthetic' })).text, 'allowed');
    await assert.rejects(gemini.models.generateContent({ model: 'test', contents: 'synthetic' }));
    for (const [pkg, method] of [['openai', 'chat'], ['groq-sdk', 'chat'], ['@anthropic-ai/sdk', 'messages']]) {
      const Client = require(pkg).default;
      const client = new Client({ apiKey: 'synthetic-only', baseURL: base, maxRetries: 0, fetch: outbound.outboundFetch });
      if (method === 'chat') await assert.rejects(client.chat.completions.create({ model: 'test', messages: [{ role: 'user', content: 'synthetic' }] }));
      else await assert.rejects(client.messages.create({ model: 'test', max_tokens: 1, messages: [{ role: 'user', content: 'synthetic' }] }));
    }
    await assert.rejects(outbound.outboundAxios.post(base + '/redirect', 'synthetic', { maxRedirects: 10 }));
    assert.equal(initial.length, 6, 'each initial request reaches the configured service through the proxy');
    assert.equal(targetRequests, 0, 'no redirect target request, directly or through the proxy');
    assert.ok(local.log.connects.length >= 1);
    assert.ok(local.log.connects.every(entry => entry.target === `sdk.synthetic.test:${port}`));
  } finally {
    globalThis.fetch = oldFetch;
    if (oldGeminiBase === undefined) delete process.env.GOOGLE_GEMINI_BASE_URL; else process.env.GOOGLE_GEMINI_BASE_URL = oldGeminiBase;
    await close(server, target, local.server);
  }
}));

test('a rejected proxy password reaches every SDK caller as the fixed proxy error, not a generic connection failure', () => isolated(async () => {
  const target = await httpTarget();
  const local = await connectProxy({ auth: 'synthetic-user:synthetic-proxy-secret' });
  const oldFetch = globalThis.fetch, oldGeminiBase = process.env.GOOGLE_GEMINI_BASE_URL;
  const fixed = 'The proxy server rejected the proxy credentials.';
  try {
    proxy.configureNetworkProxy(manual('http', local.port, { username: 'synthetic-user', password: 'synthetic-wrong' }));
    globalThis.fetch = electronFetch();
    outbound.installOutboundFetchPolicy();
    const base = `http://sdk.synthetic.test:${target.port}`;
    const { GoogleGenAI } = require('@google/genai');
    process.env.GOOGLE_GEMINI_BASE_URL = base;
    const gemini = await new GoogleGenAI({ apiKey: 'synthetic-only' }).models.generateContent({ model: 'test', contents: 'synthetic' }).then(() => undefined, error => error);
    assert.equal(gemini?.message, fixed, 'Gemini passes the fixed text through');
    for (const [pkg, call] of [['openai', c => c.chat.completions.create({ model: 'test', messages: [{ role: 'user', content: 'synthetic' }] })],
      ['@anthropic-ai/sdk', c => c.messages.create({ model: 'test', max_tokens: 1, messages: [{ role: 'user', content: 'synthetic' }] })]]) {
      const Client = require(pkg).default;
      const error = await call(new Client({ apiKey: 'synthetic-only', baseURL: base, maxRetries: 0, fetch: outbound.outboundFetch })).then(() => undefined, e => e);
      assert.equal(proxy.proxyErrorIn(error)?.code, 'PROXY_AUTH_FAILED', `${pkg}: the ProxyError stays in the cause chain`);
    }
    const axiosError = await outbound.outboundAxios.get(base + '/models').then(() => undefined, e => e);
    assert.equal(proxy.proxyErrorIn(axiosError)?.message ?? axiosError?.message, fixed);
    assert.equal(target.log.length, 0, 'nothing reached the service and nothing went direct');
  } finally {
    globalThis.fetch = oldFetch;
    if (oldGeminiBase === undefined) delete process.env.GOOGLE_GEMINI_BASE_URL; else process.env.GOOGLE_GEMINI_BASE_URL = oldGeminiBase;
    await close(local.server, target.server);
  }
}));

// ---- 4. TLS to the target is verified end to end -----------------------------------------------

test('HTTPS targets through a CONNECT proxy verify the target certificate and the proxy sees only ciphertext', () => isolated(async () => {
  const { cert, key } = selfSignedCertificate('secure.synthetic.test');
  const seen = [];
  const target = tracked(https.createServer({ cert, key }, (req, res) => { seen.push(req.headers); res.end('secure ok'); }));
  const port = await listen(target);
  const wss = new WebSocketServer({ server: target });
  wss.on('connection', socket => socket.on('message', data => socket.send('echo:' + data)));
  const local = await connectProxy();
  try {
    proxy.configureNetworkProxy(manual('http', local.port));
    const url = `https://secure.synthetic.test:${port}/tls`;
    const failure = await outbound.outboundFetch(url).then(() => undefined, error => error);
    assert.ok(failure, 'self-signed target is rejected without the test trust anchor');
    assert.match(String(failure.cause?.code ?? failure.cause?.message), /SELF_SIGNED|UNABLE_TO_VERIFY|CERT/);
    await assert.rejects(outbound.outboundAxios.get(url), error => /SELF_SIGNED|UNABLE_TO_VERIFY|CERT/.test(String(error.code ?? error.cause?.code)));
    assert.match(String((await wsFailure(`wss://secure.synthetic.test:${port}/`)).code), /SELF_SIGNED|UNABLE_TO_VERIFY|CERT/);
    assert.equal(seen.length, 0);
    proxy.setProxyTestTrustAnchors(cert);
    const secret = 'synthetic-tls-authorization-value';
    assert.equal(await (await outbound.outboundFetch(url, { headers: { authorization: `Bearer ${secret}` } })).text(), 'secure ok');
    assert.equal((await outbound.outboundAxios.get(url, { headers: { authorization: `Bearer ${secret}` } })).data, 'secure ok');
    assert.equal(await wsRoundTrip(`wss://secure.synthetic.test:${port}/`), 'echo:synthetic');
    assert.equal(seen.length, 2);
    assert.ok(seen.every(headers => headers.authorization === `Bearer ${secret}`));
    const forwarded = Buffer.concat(local.log.forwarded);
    assert.ok(forwarded.length > 0);
    assert.ok(!forwarded.includes(secret) && !forwarded.includes('/tls'), 'the proxy only relays encrypted bytes');
    // A wrong host name fails even with the trust anchor: the name is verified, not just the chain.
    await assert.rejects(outbound.outboundFetch(`https://other.synthetic.test:${port}/`), error => /ERR_TLS_CERT_ALTNAME_INVALID|altnames/i.test(String(error.cause?.code ?? error.cause?.message)));
  } finally {
    wss.close();
    await close(target, local.server);
  }
}));

test('an HTTPS proxy is reached over verified TLS before CONNECT', () => isolated(async () => {
  const { cert, key } = selfSignedCertificate('localhost');
  const local = await connectProxy({ tls: { cert, key } });
  const target = await httpTarget();
  try {
    proxy.configureNetworkProxy({ ...manual('https', local.port), host: 'localhost' });
    const url = `http://svc.synthetic.test:${target.port}/via-https-proxy`;
    const failure = await outbound.outboundFetch(url).then(() => undefined, error => error);
    assert.equal(proxyCode(failure), 'PROXY_UNREACHABLE', 'an untrusted proxy certificate is not accepted');
    proxy.setProxyTestTrustAnchors(cert);
    assert.equal(await (await outbound.outboundFetch(url)).text(), 'target ok');
    assert.deepEqual(local.log.connects.map(entry => entry.target), [`svc.synthetic.test:${target.port}`]);
  } finally { await close(local.server, target.server); }
}));

// ---- 5. proxy failures are fixed errors: no retry, no direct fallback -------------------------

test('407, wrong credentials, unreachable proxies and proxy redirects fail with fixed errors and never fall back', () => isolated(async () => {
  const target = await httpTarget();
  const socket = await wsTarget();
  const unreachable = net.createServer(); const deadPort = await listen(unreachable); await close(unreachable);
  const cases = [
    ['407 without credentials', await connectProxy({ auth: 'synthetic-user:synthetic-proxy-secret' }), {}, 'PROXY_AUTH_REQUIRED'],
    ['407 with wrong password', await connectProxy({ auth: 'synthetic-user:synthetic-proxy-secret' }), { username: 'synthetic-user', password: 'synthetic-wrong' }, 'PROXY_AUTH_FAILED'],
    ['302', await connectProxy({ reply: `HTTP/1.1 302 Found\r\nLocation: http://127.0.0.1:${target.port}/\r\nContent-Length: 0\r\n\r\n` }), {}, 'PROXY_REFUSED'],
    ['307', await connectProxy({ reply: `HTTP/1.1 307 Temporary Redirect\r\nLocation: http://127.0.0.1:${target.port}/\r\nContent-Length: 0\r\n\r\n` }), {}, 'PROXY_REFUSED'],
    ['garbage', await connectProxy({ reply: 'SYNTHETIC-PROXY-BODY\r\n\r\n' }), {}, 'PROXY_PROTOCOL'],
    ['socks wrong password', await socksProxy({ auth: 'synthetic-user:synthetic-proxy-secret' }), { username: 'synthetic-user', password: 'synthetic-wrong' }, 'PROXY_AUTH_FAILED', 'socks5'],
    ['socks requires auth', await socksProxy({ auth: 'synthetic-user:synthetic-proxy-secret' }), {}, 'PROXY_AUTH_REQUIRED', 'socks5'],
    ['unreachable', { server: null, port: deadPort, log: { sockets: 0 } }, {}, 'PROXY_UNREACHABLE'],
  ];
  try {
    for (const [label, local, auth, code, protocol = 'http'] of cases) {
      proxy.configureNetworkProxy(manual(protocol, local.port, auth));
      const url = `http://svc.synthetic.test:${target.port}/must-not-arrive?key=synthetic-query-secret`;
      const fetchError = await outbound.outboundFetch(url).then(() => undefined, error => error);
      assert.equal(proxyCode(fetchError), code, `${label}: fetch`);
      assert.equal(fetchError.name, 'ProxyError', `${label}: fetch rejects with the ProxyError itself, not "fetch failed"`);
      const axiosError = await outbound.outboundAxios.get(url).then(() => undefined, error => error);
      assert.equal(proxyCode(axiosError) ?? axiosError?.code, code, `${label}: axios`);
      const wsError = await wsFailure(`ws://svc.synthetic.test:${socket.port}/`);
      assert.equal(proxyCode(wsError), code, `${label}: ws`);
      for (const error of [fetchError, axiosError, wsError]) {
        const text = JSON.stringify({ message: error.message, cause: error.cause?.message });
        assert.ok(!/synthetic-query-secret|synthetic-wrong|synthetic-proxy-secret|SYNTHETIC-PROXY-BODY|Location/i.test(text), `${label}: fixed error text`);
      }
      if (local.server) assert.equal(local.log.sockets, 3, `${label}: one attempt per request, no retry`);
    }
    assert.equal(target.log.length, 0, 'no direct fallback to the target');
    assert.equal(socket.log.length, 0, 'no direct WebSocket fallback');
  } finally {
    socket.wss.close();
    await close(target.server, socket.server, ...cases.map(entry => entry[1].server).filter(Boolean));
  }
}));

test('tunnel limits: oversized CONNECT response, timeout and abort destroy the socket with fixed errors', async () => {
  const huge = await connectProxy({ reply: 'HTTP/1.1 200 OK\r\n' + 'X-Pad: ' + 'a'.repeat(20 * 1024) + '\r\n\r\n' });
  const silent = net.createServer(() => {}); const silentPort = await listen(tracked(silent));
  try {
    await assert.rejects(proxy.openTunnel({ host: 't.synthetic.test', port: 1 }, { protocol: 'http', host: '127.0.0.1', port: huge.port }), error => error.code === 'PROXY_PROTOCOL');
    await assert.rejects(proxy.openTunnel({ host: 't.synthetic.test', port: 1 }, { protocol: 'socks5', host: '127.0.0.1', port: silentPort }, { timeoutMs: 200 }), error => error.code === 'PROXY_UNREACHABLE');
    const controller = new AbortController();
    const pending = proxy.openTunnel({ host: 't.synthetic.test', port: 1 }, { protocol: 'http', host: '127.0.0.1', port: silentPort }, { signal: controller.signal });
    setTimeout(() => controller.abort(), 50);
    await assert.rejects(pending, error => error.name === 'AbortError');
    const ipv6 = await socksProxy();
    const target = await httpTarget();
    try {
      // IP literals use the address types (here IPv4, ATYP 1).
      const tunnel = await proxy.openTunnel({ host: '127.0.0.1', port: target.port }, { protocol: 'socks5', host: '127.0.0.1', port: ipv6.port });
      tunnel.destroy();
      assert.deepEqual(ipv6.log.requests.map(({ atyp, host }) => [atyp, host]), [[1, '127.0.0.1']]);
    } finally { await close(ipv6.server, target.server); }
  } finally { await close(huge.server, silent); }
});

test('production code never disables certificate verification', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const { REPO } = await import('../../../scripts/margin/isolation/env.mjs');
  const files = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.name === '__tests__' ? []
    : entry.isDirectory() ? files(path.join(dir, entry.name)) : /\.(?:ts|tsx)$/.test(entry.name) ? [path.join(dir, entry.name)] : []);
  const hits = [...files(path.join(REPO, 'electron')), ...files(path.join(REPO, 'src'))]
    .filter(file => /rejectUnauthorized|NODE_TLS_REJECT_UNAUTHORIZED|checkServerIdentity/.test(fs.readFileSync(file, 'utf8')));
  assert.deepEqual(hits, []);
});
