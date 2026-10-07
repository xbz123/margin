// Electron self-test for the isolation guard (PLAN.md X2). Launched as the app entry by
//   node scripts/margin/isolation/run-electron.mjs --app scripts/margin/isolation/selftest/electron-main.cjs --allow-blocked
// Tries every network path we know of from the main process and a renderer, and checks
// that safeStorage uses the mock keychain. Prints one SELFTEST_RESULT line and exits 0
// only if every outbound attempt failed and loopback still worked.

'use strict';

const { app, BrowserWindow, net, safeStorage } = require('electron');
const http = require('node:http');

const results = {};

async function attempt(name, fn) {
  try {
    await fn();
    results[name] = 'NOT BLOCKED';
  } catch (err) {
    results[name] = `blocked (${String(err && (err.code || err.message)).slice(0, 80)})`;
  }
}

async function rendererProbe(port) {
  const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true } });
  await win.loadURL('data:text/html,<html><body>probe</body></html>');
  return win.webContents.executeJavaScript(`(async () => {
    const out = {};
    const tryIt = async (name, fn) => { try { await fn(); out[name] = 'NOT BLOCKED'; } catch (e) { out[name] = 'blocked'; } };
    await tryIt('renderer fetch', () => fetch('https://example.com/'));
    await tryIt('renderer image', () => new Promise((res, rej) => { const i = new Image(); i.onload = res; i.onerror = rej; i.src = 'https://example.com/favicon.ico'; }));
    await tryIt('renderer websocket', () => new Promise((res, rej) => { const w = new WebSocket('wss://example.com/'); w.onopen = res; w.onerror = rej; }));
    try { out['renderer loopback'] = await (await fetch('http://127.0.0.1:${port}/')).text(); } catch (e) { out['renderer loopback'] = 'FAILED ' + e; }
    return out;
  })()`);
}

app.whenReady().then(async () => {
  const server = http.createServer((_req, res) => { res.setHeader('access-control-allow-origin', '*'); res.end('ok'); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();

  await attempt('main node fetch', () => fetch('https://example.com/'));
  await attempt('main electron net.fetch', () => net.fetch('https://example.com/'));
  await attempt('main child process', async () => require('node:child_process').execFileSync('curl', ['-sI', 'https://example.com']));
  Object.assign(results, await rendererProbe(port));
  results['main loopback'] = await (await net.fetch(`http://127.0.0.1:${port}/`)).text();

  const { systemPreferences, desktopCapturer } = require('electron');
  results['mic permission request'] = (await systemPreferences.askForMediaAccess('microphone')) === false ? 'refused' : 'NOT BLOCKED';
  results['screen sources'] = (await desktopCapturer.getSources({ types: ['screen'] })).length === 0 ? 'refused' : 'NOT BLOCKED';

  results['safeStorage available'] = safeStorage.isEncryptionAvailable();
  if (results['safeStorage available']) {
    const enc = safeStorage.encryptString('margin-test-value');
    results['safeStorage roundtrip'] = safeStorage.decryptString(enc) === 'margin-test-value';
  }

  const leaked = Object.entries(results).filter(([, v]) => v === 'NOT BLOCKED');
  const loopbackOk = results['main loopback'] === 'ok' && results['renderer loopback'] === 'ok';
  const ok = leaked.length === 0 && loopbackOk;
  console.log('SELFTEST_RESULT ' + JSON.stringify({ ok, results }));
  server.close();
  app.exit(ok ? 0 : 1);
});
