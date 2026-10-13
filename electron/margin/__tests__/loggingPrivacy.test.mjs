import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { REPO } from '../../../scripts/margin/isolation/env.mjs';
import { assertCriticalEvents } from '../../../tests/margin/logging-evidence.mjs';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const read = file => fs.readFileSync(path.join(REPO, file), 'utf8');
const CANARY = 'SYNTHETIC_AG23_PRIVATE_TEXT';
const compile = (source, fileName = 'module.ts') => {
  // Static imports run before a module body (as in the production esbuild bundle).
  // Keep that order in the dependency-free TypeScript/VM harness as well.
  const ast = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  const imports = ast.statements.filter(node => ts.isImportDeclaration(node));
  const rest = ast.statements.filter(node => !ts.isImportDeclaration(node));
  return ts.transpileModule([...imports, ...rest].map(node => node.getFullText(ast)).join('\n'), {
    fileName, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true, jsx: ts.JsxEmit.React },
  }).outputText;
};

// Runs the actual bootstrap/main/preload modules, but substitutes every external
// service, path and process. No Electron, provider, filesystem or device is used.
function runtime({ redactorFault, fileFault, terminalFault, verbose = false } = {}) {
  const file = [], terminal = [], sent = [], handlers = new Map(), ipcEvents = new Map(), ipcHandlers = new Map(), listenerCounts = new Map();
  let enabled = false, inspected = 0, outboundImports = 0;
  const fakeFs = {
    mkdirSync() {}, existsSync: () => ['stat', 'unlink', 'rename'].includes(fileFault),
    writeFileSync: filename => { sent.push(['create', filename]); },
    statSync() { if (fileFault === 'stat') throw Error(CANARY); return { size: 10 * 1024 * 1024 }; },
    renameSync() { if (fileFault === 'rename') throw Error(CANARY); },
    unlinkSync() { if (fileFault === 'unlink') throw Error(CANARY); },
    appendFileSync(name, data) { if (fileFault) throw Error(CANARY); file.push({ name, data }); },
  };
  const console = Object.fromEntries(['log', 'info', 'debug', 'warn', 'error', 'trace', 'dir', 'dirxml', 'table', 'assert', 'group', 'groupCollapsed', 'groupEnd', 'time', 'timeLog', 'timeEnd', 'count', 'countReset', 'clear'].map(name => [name, (...args) => {
    if (terminalFault) throw Error(CANARY);
    terminal.push({ name, args });
  }]));
  const fakeProcess = {
    env: {}, platform: 'synthetic', execPath: '/synthetic/electron', resourcesPath: '/synthetic',
    stdout: { on() {} }, stderr: { on() {} },
    on(name, callback) { handlers.set(name, callback); listenerCounts.set(name, (listenerCounts.get(name) ?? 0) + 1); },
  };
  const app = {
    isPackaged: true, setName() {}, setPath() {}, setAppUserModelId() {},
    setAppLogsPath() { enabled = true; },
    getPath(name) { if (name === 'logs' && fileFault === 'path') throw Error(CANARY); return name === 'logs' ? (enabled ? '/synthetic/temp' : '/synthetic/wrong-log-root') : '/synthetic'; },
    requestSingleInstanceLock: () => false, exit() {}, on() {},
  };
  const electron = {
    app, contextBridge: { exposeInMainWorld() {} },
    ipcMain: { removeHandler() {}, handle: (name, fn) => ipcHandlers.set(name, fn), removeAllListeners() {}, on: (name, fn) => ipcEvents.set(name, fn) },
    shell: { openPath: async filename => { sent.push(['openPath', filename]); } },
    ipcRenderer: { on(name, callback) { ipcEvents.set(name, callback); }, removeListener() {}, invoke: async () => verbose,
      send: (...args) => sent.push(args) },
  };
  const cache = new Map();
  const context = vm.createContext({ console, process: fakeProcess, Buffer, setTimeout, clearTimeout, URL, Request,
    fetch: () => Promise.resolve(new Response('synthetic')),
    document: { documentElement: { setAttribute() {} }, getElementById() {} },
    localStorage: { getItem: () => null }, window: { electronAPI: {}, addEventListener() {} },
    __MARGIN_APP_IDENTITY__: { variant: 'temp', name: 'temp', appId: 'synthetic.temp' } });
  const load = fileName => {
    if (cache.has(fileName)) return cache.get(fileName).exports;
    const module = { exports: {} }; cache.set(fileName, module);
    const localRequire = id => {
      if (id === 'electron') return electron;
      if (id === './ipc/sttHandlers') return { registerDomesticSttHandlers() {} };
      if (id === './ipc/localContextHandlers') return { registerLocalContextHandlers() {} };
      if (id === './ipc/speechActions') return { SpeechActions: class {} };
      if (id === 'fs' || id === 'node:fs') return fakeFs;
      if (id === 'path' || id === 'node:path') return path;
      if (id === 'react') return { createElement() {}, StrictMode: 'synthetic' };
      if (id === 'events') return require('node:events');
      if (id === 'ws') return { OPEN: 1 };
      if (id === 'axios') {
        outboundImports++;
        console.log(CANARY, new Error(CANARY)); // actual outbound dependency import boundary
        return { create(options) {
          assert.equal(options.maxRedirects, 0);
          return { interceptors: { request: { use() {} } } };
        } };
      }
      if (id === 'react-dom/client') return { createRoot: () => ({ render() {} }) };
      if (id === './i18n') return { startUiLanguageSync() {} };
      if (id.endsWith('redactForLog')) {
        if (redactorFault === 'load') throw Error(CANARY);
        if (redactorFault === 'call') return { redactForLog() { throw Error(CANARY); } };
      }
      if (id.startsWith('.')) {
        const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(fileName), id)) + '.ts';
        if (['electron/bootstrap.ts', 'electron/main.ts', 'electron/logging.ts', 'electron/utils/consoleLogging.ts',
          'electron/utils/redactForLog.ts', 'electron/margin/appIdentity.ts', 'electron/services/outbound.ts', 'electron/services/navigationPolicy.ts', 'src/logging.ts'].includes(resolved)) return load(resolved);
        if (id === './WindowHelper') console.log(CANARY, new Error(CANARY)); // actual import boundary
        if (id === './App') console.log(CANARY); // actual renderer business import boundary
        return {};
      }
      if (id === 'dotenv') return { config() {} };
      return {};
    };
    const code = fileName.endsWith('.js') ? read(fileName) : compile(read(fileName), fileName);
    const wrapper = vm.runInContext(`(function(require,module,exports){${code}\n})`, context);
    wrapper(localRequire, module, module.exports);
    return module.exports;
  };
  return { load, console, file, terminal, sent, handlers, ipcEvents, ipcHandlers, context, fakeFs, listenerCounts,
    get inspected() { return inspected; }, get outboundImports() { return outboundImports; },
    hostile: { get value() { inspected++; throw Error(CANARY); }, toJSON() { inspected++; return CANARY; }, toString() { inspected++; return CANARY; } } };
}

const output = r => JSON.stringify([r.file, r.terminal, r.sent]);
const noCanary = r => assert.ok(!output(r).includes(CANARY), 'no synthetic private text in any production log exit');

test('real bootstrap protects import-time logs and all console exits including stdout/stderr', () => {
  const r = runtime(); r.load('electron/bootstrap.ts');
  for (const name of ['log', 'info', 'debug', 'warn', 'error', 'trace', 'dir', 'table', 'assert', 'group', 'timeLog', 'count']) {
    r.console[name](CANARY, new Error(CANARY), { [CANARY]: CANARY });
  }
  noCanary(r);
  assert.ok(r.terminal.length > 0);
  assert.ok(r.file.length > 0);
  assert.ok(r.file.every(entry => entry.name === '/synthetic/temp/debug.log'));
  assert.equal(r.terminal.filter(entry => entry.name === 'error').length > 0, true);
  assert.equal(r.terminal.filter(entry => entry.name === 'log').length > 0, true);
  assert.equal(r.outboundImports, 1, 'the real outbound module evaluated its dependency inside the installed log boundary');
});

for (const redactorFault of ['load', 'call']) {
  test(`sanitizer ${redactorFault} failure stays closed in every exit and critical handler`, () => {
    const r = runtime({ redactorFault }); r.load('electron/bootstrap.ts');
    r.console.error(CANARY);
    assert.doesNotThrow(() => r.handlers.get('uncaughtException')(new Error(CANARY)));
    assert.doesNotThrow(() => r.handlers.get('unhandledRejection')(CANARY));
    noCanary(r);
    assert.ok(r.file.some(entry => entry.data.includes('[CRITICAL] Uncaught Exception')));
  });
}

test('isolated preload never emits raw console arguments even with verbose forwarding', async () => {
  const r = runtime({ verbose: true }); r.load('electron/preload.ts');
  await Promise.resolve(); await Promise.resolve();
  r.console.warn(CANARY, { text: CANARY });
  noCanary(r);
  assert.ok(r.sent.some(args => args[0] === 'forward-log-to-file'));
});

test('redactor suppresses arbitrary strings, errors, object keys and serialization hooks', () => {
  const r = runtime(); const { redactForLog, redactValue } = r.load('electron/utils/redactForLog.ts');
  const cyclic = { [CANARY]: CANARY }; cyclic.self = cyclic;
  let prototypeInspections = 0;
  const prototypeTrap = new Proxy({}, { getPrototypeOf() { prototypeInspections++; return null; } });
  for (const value of [CANARY, `x-api-key=${CANARY}`, new Error(CANARY), cyclic, r.hostile, Buffer.from(CANARY),
    Symbol(CANARY), new Proxy([], { get: () => CANARY }), prototypeTrap, vm.runInNewContext(`new Error('${CANARY}')`)]) {
    assert.ok(!redactForLog([value]).includes(CANARY));
    assert.ok(!JSON.stringify(redactValue(value)).includes(CANARY));
  }
  assert.equal(r.inspected, 0, 'no getter, toJSON or toString was invoked');
  assert.equal(prototypeInspections, 0, 'no unknown object prototype was inspected');
  assert.equal(redactForLog([123456, 123456n, true]), '[{"type":"number"},{"type":"bigint"},{"type":"boolean"}]');
});

test('main-world renderer protects business imports independently of preload', () => {
  const r = runtime(); r.load('src/main.tsx');
  r.console.error(CANARY, new Error(CANARY));
  noCanary(r);
  assert.ok(r.terminal.length > 0);
  assert.equal(r.sent.length, 0, 'main-world privacy does not rely on isolated-world IPC');
});

test('verbose toggling only forwards already-safe metadata', async () => {
  const r = runtime(); r.load('electron/preload.ts');
  await Promise.resolve(); await Promise.resolve();
  r.console.log(CANARY); assert.equal(r.sent.length, 0);
  r.ipcEvents.get('verbose-logging-changed')({}, true);
  r.console.log(CANARY); assert.equal(r.sent.length, 1);
  r.ipcEvents.get('verbose-logging-changed')({}, false);
  r.console.log(CANARY); assert.equal(r.sent.length, 1);
  noCanary(r);
});

test('duplicate bundled installers keep one console boundary and controlled events', () => {
  const r = runtime(); const api = r.load('electron/utils/consoleLogging.ts');
  const summarize = r.load('electron/utils/redactForLog.ts').redactForLog;
  let calls = 0;
  api.installConsoleLogging(r.console, () => calls++, summarize);
  api.installConsoleLogging(r.console, () => { throw Error(CANARY); }, summarize);
  r.console.log(CANARY);
  api.logAppEvent('app-ready', r.console);
  api.logAppEvent('app-quitting', r.console);
  assert.equal(calls, 3);
  assert.ok(output(r).includes('app-ready'));
  assert.ok(output(r).includes('app-quitting'));
  noCanary(r);
});

test('separate real build bundles share app events through the console marker', () => {
  const r = runtime();
  r.load('electron/bootstrap.ts');
  r.load('dist-electron/electron/logging.js').installMainLogging()();
  const separate = r.load('dist-electron/electron/utils/consoleLogging.js');
  separate.logAppEvent('app-ready', r.console);
  separate.logAppEvent('app-quitting', r.console);
  const events = r.file.map(e => e.data);
  assert.equal(events.filter(line => line.includes('app-ready')).length, 1);
  assert.equal(events.filter(line => line.includes('app-quitting')).length, 1);
  assert.equal(events.filter(line => line.includes('logging-ready')).length, 1);
  assert.equal(r.listenerCounts.get('uncaughtException'), 1);
  assert.equal(r.listenerCounts.get('unhandledRejection'), 1);
  noCanary(r);
});

test('critical evidence rejects missing, extra and unknown events and has no payload-prefix trust', () => {
  const r = runtime(); r.load('electron/bootstrap.ts');
  r.console.error('[CRITICAL] Uncaught Exception ' + CANARY);
  assertCriticalEvents(r.file.map(e => e.data).join(''), []);
  r.handlers.get('uncaughtException')(new Error(CANARY));
  r.handlers.get('unhandledRejection')(CANARY);
  const fileText = r.file.map(e => e.data).join('');
  const terminalText = r.terminal.map(e => e.args.join(' ')).join('\n');
  const expected = ['uncaughtException', 'unhandledRejection'];
  assertCriticalEvents(fileText, expected); assertCriticalEvents(terminalText, expected);
  for (const bad of ['', '[CRITICAL] Uncaught Exception []\n', fileText + '[CRITICAL] Uncaught Exception []\n', fileText + '[CRITICAL] Unknown []\n']) {
    assert.throws(() => assertCriticalEvents(bad, expected));
  }
  noCanary(r);
});

test('real log IPC uses identity logs and hostile forwarded payloads stay opaque', async () => {
  const r = runtime(); r.load('electron/bootstrap.ts');
  r.load('electron/ipcHandlers.ts').initializeIpcHandlers({ getVerboseLogging: () => true });
  assert.equal(await r.ipcHandlers.get('get-log-file-path')(), '/synthetic/temp/debug.log');
  assert.equal((await r.ipcHandlers.get('open-log-file')()).success, true);
  assert.deepEqual(r.sent, [['create', '/synthetic/temp/debug.log'], ['openPath', '/synthetic/temp/debug.log']]);
  r.ipcEvents.get('forward-log-to-file')({ sender: { id: 1, once() {} } }, 'error', '\r\n[CRITICAL] ' + CANARY);
  noCanary(r);
  assertCriticalEvents(r.file.map(e => e.data).join(''), []);
});


test('sink failures cannot expose data, throw or recurse through console', () => {
  for (const options of ['path', 'stat', 'unlink', 'rename', 'append'].map(fileFault => ({ fileFault })).concat([{ terminalFault: true }, { fileFault: true, terminalFault: true }])) {
    const r = runtime(options); r.load('electron/bootstrap.ts');
    assert.doesNotThrow(() => r.console.error(CANARY, r.hostile));
    assert.doesNotThrow(() => r.handlers.get('uncaughtException')(CANARY));
    noCanary(r);
  }
});

test('recursive inspectors and sinks are dropped without losing later safe events', () => {
  const r = runtime(); const api = r.load('electron/utils/consoleLogging.ts');
  const summarize = r.load('electron/utils/redactForLog.ts').redactForLog;
  let sinks = 0;
  api.installConsoleLogging(r.console, () => { sinks++; r.console.log(CANARY); }, summarize);
  const proxy = new Proxy({}, { getPrototypeOf() { r.console.error(CANARY); return null; } });
  assert.doesNotThrow(() => r.console.log(proxy));
  r.console.log(CANARY);
  assert.equal(sinks, 2);
  noCanary(r);
});
