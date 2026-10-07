// Self-test for the Node layer of the isolation guard. Run it through the runner:
//   node scripts/margin/isolation/run-node.mjs --test scripts/margin/isolation/__tests__/guard.node.test.mjs
// Each case deliberately tries to leave the machine and must be blocked; loopback must
// keep working. example.com is used because it is reserved for documentation.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import dns from 'node:dns';
import childProcess from 'node:child_process';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
const isBlocked = (err) => err?.code === 'EMARGINISOLATION' || err?.cause?.code === 'EMARGINISOLATION';

test('guard is active and the environment is clean', () => {
  assert.equal(process.env.MARGIN_ISOLATION_ACTIVE, '1');
  assert.match(os.homedir(), /margin-isolation-/);
  const leaked = Object.keys(process.env).filter((k) => /(_API_KEY|_TOKEN|SECRET|GOOGLE_APPLICATION_CREDENTIALS|PROXY)$/i.test(k) && k !== 'NO_PROXY');
  assert.deepEqual(leaked, []);
});

test('fetch to a public host is blocked', async () => {
  await assert.rejects(fetch('https://example.com/'), isBlocked);
});

test('https.get to a public host is blocked', async () => {
  await new Promise((resolve, reject) => {
    const req = https.get('https://example.com/', () => reject(new Error('request was not blocked')));
    req.on('error', (err) => (isBlocked(err) ? resolve() : reject(err)));
  });
});

test('raw TCP to a public IP is blocked', async () => {
  await new Promise((resolve, reject) => {
    const s = net.connect({ host: '93.184.215.14', port: 443 }, () => reject(new Error('socket connected')));
    s.on('error', (err) => (isBlocked(err) ? resolve() : reject(err)));
  });
});

test('DNS lookups for public names are blocked', async () => {
  await assert.rejects(dns.promises.lookup('example.com'), isBlocked);
  await new Promise((resolve) => dns.lookup('example.com', (err) => { assert.ok(isBlocked(err)); resolve(); }));
});

test('WebSocket (ws package) to a public host is blocked', async () => {
  const WebSocket = require('ws');
  await new Promise((resolve, reject) => {
    const ws = new WebSocket('wss://example.com/');
    ws.on('open', () => reject(new Error('websocket opened')));
    ws.on('error', (err) => (isBlocked(err) ? resolve() : reject(err)));
  });
});

test('child processes are blocked unless allowed', () => {
  assert.throws(() => childProcess.spawnSync('curl', ['https://example.com']), isBlocked);
  assert.throws(() => childProcess.execSync('curl https://example.com'), isBlocked);
  assert.throws(() => childProcess.execSync('echo hi && curl https://example.com'), isBlocked);
  assert.throws(() => childProcess.spawnSync('echo', ['hi'], { shell: true }), isBlocked);
  assert.throws(() => childProcess.spawnSync('/bin/sh', ['-c', 'curl https://example.com']), isBlocked);
  assert.throws(() => childProcess.execFileSync('defaults', ['read']), isBlocked);
});

test('node, simple utilities and sandbox-local test doubles may run', () => {
  assert.equal(childProcess.execFileSync(process.execPath, ['-e', 'process.stdout.write("ok")']).toString(), 'ok');
  assert.equal(childProcess.execSync('echo ok').toString().trim(), 'ok');
  assert.equal(childProcess.execFileSync('/bin/echo', ['ok']).toString().trim(), 'ok');
  // Missing commands are not blocked; they fail on their own with ENOENT.
  assert.throws(() => childProcess.execFileSync('/nonexistent/margin-bin'), (e) => e.code === 'ENOENT');
  const script = path.join(os.tmpdir(), `margin-guard-double-${process.pid}.sh`);
  fs.writeFileSync(script, '#!/bin/sh\necho double\n', { mode: 0o755 });
  assert.equal(childProcess.execFileSync(script).toString().trim(), 'double');
});

test('keytar is replaced by an in-memory stub', async () => {
  const keytar = require('keytar');
  assert.equal(await keytar.getPassword('svc', 'acct'), null);
  await assert.rejects(keytar.setPassword('svc', 'acct', 'x'), isBlocked);
});

test('loopback traffic still works', async () => {
  const server = http.createServer((_req, res) => res.end('ok'));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  try {
    assert.equal(await (await fetch(`http://127.0.0.1:${port}/`)).text(), 'ok');
    assert.equal(await (await fetch(`http://localhost:${port}/`)).text(), 'ok');
  } finally {
    server.close();
  }
});
