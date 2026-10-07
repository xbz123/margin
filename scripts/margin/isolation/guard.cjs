// Isolation guard for Margin tests and smoke launches (PLAN.md X2, gate G4).
//
// Loaded with `--require` (Node) or NODE_OPTIONS=--require (Electron main). Blocks and
// records every attempt to leave the machine:
//   - Node sockets (net/tls/http/https/fetch/ws all end in net.Socket#connect), UDP
//     sends and DNS lookups for anything but loopback;
//   - Chromium requests from any Electron session (webRequest), and Chromium DNS via
//     the --host-resolver-rules switch added by run-electron.mjs;
//   - child processes, unless their command basename is in MARGIN_ISOLATION_ALLOW_EXEC;
//   - the `keytar` module (real OS keychain) is replaced with an empty in-memory stub.
// Not covered: native addons that open sockets themselves, and WebRTC/UDP from
// Chromium. See PLAN.md X2 for how those are handled.

'use strict';

const fs = require('node:fs');
const net = require('node:net');
const dns = require('node:dns');
const dgram = require('node:dgram');
const childProcess = require('node:child_process');
const Module = require('node:module');
const path = require('node:path');

const LOG = process.env.MARGIN_ISOLATION_LOG || '';
const ALLOW_EXEC = new Set((process.env.MARGIN_ISOLATION_ALLOW_EXEC || '').split(':').filter(Boolean));

function record(kind, detail) {
  const entry = { t: new Date().toISOString(), pid: process.pid, script: process.argv[1], kind, detail };
  if (LOG) {
    try { fs.appendFileSync(LOG, JSON.stringify(entry) + '\n'); } catch { /* best effort */ }
  }
  try { process.stderr.write(`[isolation] blocked ${kind}: ${detail}\n`); } catch { /* closed stderr */ }
}

function blockedError(kind, detail) {
  record(kind, detail);
  const err = new Error(`[isolation] ${kind} blocked: ${detail}`);
  err.code = 'EMARGINISOLATION';
  return err;
}

const LOOPBACK_NAMES = new Set(['localhost', 'localhost.', '::1', '[::1]']);
function isLoopbackHost(host) {
  if (!host) return true; // unix sockets and "default" hosts resolve locally
  const h = String(host).toLowerCase();
  if (LOOPBACK_NAMES.has(h) || h.endsWith('.localhost')) return true;
  if (net.isIPv4(h)) return h.startsWith('127.');
  if (net.isIPv6(h.replace(/^\[|\]$/g, ''))) return h.replace(/^\[|\]$/g, '') === '::1';
  return false;
}

// ---- sockets ----------------------------------------------------------------
const origConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function guardedConnect(...args) {
  let opts = args[0];
  if (Array.isArray(opts)) opts = opts[0]; // internal normalized form
  let host;
  let port;
  if (opts && typeof opts === 'object') {
    if (opts.path) return origConnect.apply(this, args); // IPC / unix socket
    host = opts.host;
    port = opts.port;
  } else if (typeof opts === 'string' && !/^\d+$/.test(opts)) {
    return origConnect.apply(this, args); // unix socket path
  } else {
    port = opts;
    host = typeof args[1] === 'string' ? args[1] : undefined;
  }
  if (!isLoopbackHost(host)) {
    const err = blockedError('socket', `${host}:${port}`);
    process.nextTick(() => this.destroy(err));
    return this;
  }
  return origConnect.apply(this, args);
};

const origSend = dgram.Socket.prototype.send;
dgram.Socket.prototype.send = function guardedSend(...args) {
  const host = args.find((a, i) => i > 0 && typeof a === 'string');
  if (!isLoopbackHost(host)) {
    const cb = args.find((a) => typeof a === 'function');
    const err = blockedError('udp', String(host));
    if (cb) process.nextTick(() => cb(err));
    return;
  }
  return origSend.apply(this, args);
};

// ---- DNS ----------------------------------------------------------------------
function guardLookup(orig) {
  return function guarded(hostname, ...rest) {
    if (isLoopbackHost(hostname)) return orig.call(this, hostname, ...rest);
    const cb = rest.find((a) => typeof a === 'function');
    const err = blockedError('dns', String(hostname));
    if (cb) process.nextTick(() => cb(err));
    else throw err;
  };
}
dns.lookup = guardLookup(dns.lookup);
for (const name of ['resolve', 'resolve4', 'resolve6', 'resolveAny', 'resolveTxt', 'resolveSrv', 'resolveMx', 'resolveCname']) {
  if (typeof dns[name] === 'function') dns[name] = guardLookup(dns[name]);
}
const origPromisesLookup = dns.promises.lookup;
dns.promises.lookup = async function guarded(hostname, ...rest) {
  if (isLoopbackHost(hostname)) return origPromisesLookup.call(this, hostname, ...rest);
  throw blockedError('dns', String(hostname));
};

// ---- child processes ------------------------------------------------------------
// Allowed: this Node binary, a few side-effect-free utilities, anything named in
// MARGIN_ISOLATION_ALLOW_EXEC, and executables that live inside the sandbox (test
// doubles written to the sandbox TMPDIR). Shells are never allowed by name, and a
// shell command line (exec/execSync) is allowed only when it is a single simple
// command, so `sh -c` / `&& curl` cannot slip through.
const SANDBOX_ROOT = process.env.MARGIN_ISOLATION_HOME ? path.dirname(process.env.MARGIN_ISOLATION_HOME) : null;
const SAFE_BINARIES = new Set(['node', path.basename(process.execPath), 'echo', 'true', 'false', 'sleep']);
// `defaults` (input-method detection) and `lsof` (Ollama port cleanup, removed in AG-14).
const LOCAL_TOOLS = new Set(['defaults', 'lsof']);
const SYSTEM_DIRS = new Set(['/bin', '/usr/bin']);
// A command that cannot be found would fail with ENOENT anyway; letting it through
// keeps tests that expect that failure honest without running anything.
function resolvable(file) {
  if (file.includes('/')) return fs.existsSync(path.resolve(file));
  return (process.env.PATH || '').split(path.delimiter).some((d) => d && fs.existsSync(path.join(d, file)));
}
function allowedCommand(cmd) {
  const file = String(cmd || '');
  if (!resolvable(file)) return true;
  if (ALLOW_EXEC.has(path.basename(file))) return true;
  if (file.includes('/')) {
    const abs = path.resolve(file);
    if (abs === process.execPath) return true;
    if (SAFE_BINARIES.has(path.basename(abs)) && SYSTEM_DIRS.has(path.dirname(abs))) return true;
    let real = abs;
    try { real = fs.realpathSync(abs); } catch { /* missing file: let the spawn fail normally */ }
    return Boolean(SANDBOX_ROOT) && (abs.startsWith(SANDBOX_ROOT + path.sep) || real.startsWith(fs.realpathSync(SANDBOX_ROOT) + path.sep));
  }
  return SAFE_BINARIES.has(file);
}
function guardExec(name, orig) {
  const shellLine = name === 'exec' || name === 'execSync';
  return function guarded(...args) {
    let cmd;
    if (shellLine) {
      const line = String(args[0] || '').trim();
      if (/[;&|`$<>()\n]/.test(line)) throw blockedError('exec', `${name} (shell syntax) ${line.slice(0, 80)}`);
      cmd = line.split(/\s+/)[0];
    } else {
      cmd = args[0];
    }
    const opts = args.find((a) => a && typeof a === 'object' && !Array.isArray(a));
    if (opts && opts.shell && !shellLine) throw blockedError('exec', `${name} with shell:true ${String(cmd)}`);
    if (!allowedCommand(cmd)) {
      // Local read-only system tools are still refused (tests must not read the real
      // system state) but are recorded as local stand-ins, not as egress attempts.
      const kind = LOCAL_TOOLS.has(path.basename(String(cmd))) ? 'local-exec' : 'exec';
      throw blockedError(kind, `${name} ${String(cmd)}`);
    }
    return orig.apply(this, args);
  };
}
for (const name of ['spawn', 'spawnSync', 'execFile', 'execFileSync', 'exec', 'execSync']) {
  childProcess[name] = guardExec(name, childProcess[name]);
}

// ---- modules ----------------------------------------------------------------------
const keytarStub = {
  getPassword: async () => null,
  setPassword: async () => { throw blockedError('keychain', 'keytar.setPassword'); },
  deletePassword: async () => false,
  findCredentials: async () => [],
  findPassword: async () => null,
};
// The `electron` module is not usable while --require preloads run, so the Chromium
// guard is installed the first time the app itself loads `electron`.
let electronGuarded = false;
const origLoad = Module._load;
// Audio devices: tests and smoke launches must not touch CoreAudio. Device
// enumeration from an unapproved process blocks on a microphone permission decision
// (observed at the first L0 launch: main thread stuck in natively_audio
// get_input_devices -> cpal -> HALC_ProxyObject mach_msg). The native module is
// wrapped so device lists are empty and capture objects refuse to start.
const NATIVE_AUDIO_RE = /native-module[\\/](index\.js|index\.[\w-]+\.node)$/;
function deviceDouble(real) {
  const refuse = (what) => class {
    constructor() { throw blockedError('device', `${what} construction`); }
  };
  const wrapped = Object.create(null);
  for (const k of Object.keys(real)) wrapped[k] = real[k];
  wrapped.getInputDevices = () => [];
  wrapped.getOutputDevices = () => [];
  if ('getDefaultOutputDeviceId' in real) wrapped.getDefaultOutputDeviceId = () => '';
  if ('MicrophoneCapture' in real) wrapped.MicrophoneCapture = refuse('MicrophoneCapture');
  if ('SystemAudioCapture' in real) wrapped.SystemAudioCapture = refuse('SystemAudioCapture');
  return wrapped;
}

const TRACE_REQUIRES = process.env.MARGIN_ISOLATION_DEBUG === '1';
Module._load = function guardedLoad(request, parent, isMain) {
  if (request === 'keytar') return keytarStub;
  if (TRACE_REQUIRES && !request.startsWith('node:') && !Module.builtinModules.includes(request)) {
    try { process.stderr.write(`[isolation] require ${request}\n`); } catch { /* closed */ }
  }
  if (NATIVE_AUDIO_RE.test(String(request)) && process.env.MARGIN_ISOLATION_REAL_DEVICES !== '1') {
    record('device', `native audio module wrapped (${path.basename(String(request))})`);
    return deviceDouble(origLoad.call(this, request, parent, isMain));
  }
  const mod = origLoad.call(this, request, parent, isMain);
  if (request === 'electron' && !electronGuarded && mod && mod.app && process.type === 'browser') {
    electronGuarded = true;
    installChromiumGuard(mod);
  }
  return mod;
};

// ---- Electron (main process only) -------------------------------------------------
function installChromiumGuard(electron) {
  // macOS Electron resolves appData/documents/etc. from the account, not $HOME, so
  // point every well-known path into the sandbox before the app or Chromium uses it.
  const sandboxHome = process.env.MARGIN_ISOLATION_HOME;
  if (sandboxHome) {
    const p = (...s) => path.join(sandboxHome, ...s);
    const name = electron.app.getName(); // from package.json, as Electron's own default
    const paths = {
      home: p(), appData: p('Library/Application Support'), userData: p('Library/Application Support', name),
      sessionData: p('Library/Application Support', name), temp: p('tmp'), logs: p('Library/Logs', name),
      crashDumps: p('Library/Logs', name, 'Crashpad'), documents: p('Documents'), desktop: p('Desktop'),
      downloads: p('Downloads'), music: p('Music'), pictures: p('Pictures'), videos: p('Movies'),
    };
    for (const [key, dir] of Object.entries(paths)) {
      try { fs.mkdirSync(dir, { recursive: true }); electron.app.setPath(key, dir); } catch (e) { record('setPath', `${key}: ${e.message}`); }
    }
  }
  // Never let a test or smoke launch raise an OS permission dialog (microphone,
  // camera, screen recording). Answer "not granted" and record the attempt instead.
  try {
    electron.systemPreferences.askForMediaAccess = async (mediaType) => {
      record('permission', `askForMediaAccess ${mediaType}`);
      return false;
    };
  } catch (e) { record('permission', `cannot stub askForMediaAccess: ${e.message}`); }
  try {
    electron.desktopCapturer.getSources = async (opts) => {
      record('permission', `desktopCapturer.getSources ${JSON.stringify(opts && opts.types)}`);
      return [];
    };
  } catch (e) { record('permission', `cannot stub desktopCapturer.getSources: ${e.message}`); }

  const allowedUrl = (url) => {
    if (/^(file|data|blob|devtools|chrome|chrome-extension|about):/i.test(url)) return true;
    try {
      const u = new URL(url);
      return isLoopbackHost(u.hostname);
    } catch {
      return false;
    }
  };
  const guarded = new WeakSet();
  const guardSession = (ses) => {
    if (!ses || guarded.has(ses)) return;
    guarded.add(ses);
    ses.webRequest.onBeforeRequest((details, callback) => {
      if (allowedUrl(details.url)) return callback({});
      record('chromium', `${details.resourceType} ${details.url}`);
      callback({ cancel: true });
    });
  };
  electron.app.on('session-created', guardSession);
  electron.app.whenReady().then(() => guardSession(electron.session.defaultSession));
  if (process.env.MARGIN_ISOLATION_DEBUG === '1') {
    process.stderr.write(`[isolation] electron loaded by app (pid ${process.pid})\n`);
    electron.app.whenReady().then(() => process.stderr.write('[isolation] app ready\n'));
    electron.app.on('will-quit', () => process.stderr.write('[isolation] will-quit\n'));
  }
  // Electron's own net module uses Chromium sessions, so it is covered above.
}

process.env.MARGIN_ISOLATION_ACTIVE = '1';
