// Builds a clean, isolated environment for Margin tests and smoke launches
// (PLAN.md X2). Nothing from the caller's environment is inherited except the
// variables needed to find tools and render text: no API keys, tokens, Google
// credentials, proxies or dotenv paths. HOME points at a fresh temporary directory, so
// Electron's appData/userData, Documents logs and ~/.codex all land inside it.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const GUARD = fileURLToPath(new URL('./guard.cjs', import.meta.url));
export const REPO = path.resolve(fileURLToPath(new URL('../../..', import.meta.url)));

const PASS_THROUGH = ['PATH', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TERM', 'USER', 'LOGNAME', 'SHELL', '__CF_USER_TEXT_ENCODING'];
// Windows needs these to start processes and load system DLLs; none names the user.
const WINDOWS_PASS_THROUGH = ['SystemRoot', 'windir', 'ComSpec', 'PATHEXT', 'SystemDrive', 'NUMBER_OF_PROCESSORS', 'PROCESSOR_ARCHITECTURE', 'OS'];
const LEGACY_NAMES = ['Natively', 'natively', 'natively-local', 'Natively Local', 'ai assistant', 'Margin', 'temp'];

export function makeSandbox(label = 'run') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `margin-isolation-${label}-`));
  const home = path.join(root, 'home');
  const work = path.join(root, 'cwd');
  const tmp = path.join(root, 'tmp');
  for (const d of [home, work, tmp]) fs.mkdirSync(d, { recursive: true });
  // Synthetic legacy data exists before the guarded process starts. No real data is read.
  const dataRoots = ['Library/Application Support', ...(process.platform === 'win32' ? ['AppData/Roaming'] : [])];
  for (const root of dataRoots) {
    for (const name of LEGACY_NAMES) {
      const dir = path.join(home, root, name);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'identity-sentinel'), 'synthetic protected data\n');
    }
  }
  return { root, home, work, tmp, log: path.join(root, 'isolation.jsonl') };
}

// On Windows, Node and Electron find the profile, app data and temp directories
// through USERPROFILE, APPDATA, LOCALAPPDATA and TEMP/TMP, not HOME/TMPDIR, so those
// point into the sandbox as well.
export function windowsProfileEnv(sandbox, source = process.env) {
  const env = {};
  for (const k of WINDOWS_PASS_THROUGH) if (source[k] !== undefined) env[k] = source[k];
  return Object.assign(env, {
    USERPROFILE: sandbox.home,
    APPDATA: path.join(sandbox.home, 'AppData', 'Roaming'),
    LOCALAPPDATA: path.join(sandbox.home, 'AppData', 'Local'),
    TEMP: sandbox.tmp,
    TMP: sandbox.tmp,
  });
}

export function isolatedEnv(sandbox, extra = {}) {
  const env = {};
  for (const k of PASS_THROUGH) if (process.env[k] !== undefined) env[k] = process.env[k];
  if (process.platform === 'win32') Object.assign(env, windowsProfileEnv(sandbox));
  Object.assign(env, {
    HOME: sandbox.home,
    MARGIN_ISOLATION_HOME: sandbox.home,
    TMPDIR: sandbox.tmp + path.sep,
    CODEX_HOME: path.join(sandbox.home, '.codex'),
    NATIVELY_TEST_USERDATA: path.join(sandbox.home, 'userData'),
    NODE_OPTIONS: `--require=${GUARD}`,
    MARGIN_ISOLATION_LOG: sandbox.log,
    MARGIN_ISOLATION_ALLOW_EXEC: '',
    // The retired Ollama port (AG-14): any attempt is blocked and recorded.
    MARGIN_ISOLATION_WATCH_PORTS: '11434',
    NO_PROXY: '*',
    // The app's own dev switch: skip the startup screen-recording permission probe.
    NATIVELY_DEV_BYPASS_SCREEN_TCC: '1',
    ELECTRON_NO_ATTACH_CONSOLE: '1',
  }, extra);
  if (process.env.MARGIN_APP_VARIANT === 'local') env.MARGIN_APP_VARIANT = 'local';
  // Release runtime checks run only on CI; do not inherit arbitrary caller variables.
  if (process.env.CI === 'true' && process.env.GITHUB_ACTIONS === 'true') {
    env.CI = 'true';
    env.GITHUB_ACTIONS = 'true';
    if (process.env.MARGIN_APP_VARIANT === 'release') env.MARGIN_APP_VARIANT = 'release';
  }
  return env;
}

// Every guarded process writes a "guard-loaded" record when the guard starts (and
// ends itself if it cannot write a record). A missing or empty log, or with `pid` no
// load record from that process, means there is no evidence that the guard ran: that
// is an error, not "nothing blocked" (PLAN.md AG-17 review).
export function readGuardLog(sandbox, { pid } = {}) {
  if (!fs.existsSync(sandbox.log)) throw new Error(`isolation log missing: ${sandbox.log} (the guard did not load or could not write)`);
  const records = fs.readFileSync(sandbox.log, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const loads = records.filter((r) => r.kind === 'guard-loaded');
  if (!loads.length) throw new Error(`isolation log has no guard-loaded record: ${sandbox.log}`);
  if (pid !== undefined && !loads.some((r) => r.pid === pid)) {
    throw new Error(`no guard-loaded record from pid ${pid} in ${sandbox.log} (records from ${[...new Set(loads.map((r) => r.pid))].join(', ')})`);
  }
  return records;
}

export function readBlocked(sandbox, options) {
  return readGuardLog(sandbox, options).filter((e) => e.kind !== 'guard-loaded');
}

// Real-account locations an isolated run must never touch. Snapshot them before and
// after a launch; any change fails the run. The account home comes from the user
// database, not $HOME, because the run itself overrides $HOME.
const REAL_HOME = os.userInfo().homedir;
const WATCHED = [
  'Library/Application Support/Electron',
  'Library/Application Support/Natively',
  'Library/Application Support/natively',
  'Library/Application Support/natively-local',
  'Library/Application Support/Natively Local',
  'Library/Preferences/local.natively.desktop.plist',
  'Library/Logs/Natively Local',
  'Library/Application Support/ai assistant',
  'Library/Application Support/Margin',
  'Library/Application Support/margin',
  'Library/Logs/Natively',
  'Library/Logs/Margin',
  'Documents/natively_debug.log',
  '.codex/auth.json',
].map((p) => path.join(REAL_HOME, p));

export function snapshotRealPaths() {
  const snap = {};
  for (const p of WATCHED) {
    try {
      const st = fs.statSync(p);
      let latest = st.mtimeMs;
      if (st.isDirectory()) {
        for (const e of fs.readdirSync(p)) {
          try { latest = Math.max(latest, fs.statSync(path.join(p, e)).mtimeMs); } catch { /* raced */ }
        }
      }
      snap[p] = latest;
    } catch {
      snap[p] = null;
    }
  }
  return snap;
}

export function changedRealPaths(before, after) {
  return Object.keys(after).filter((p) => before[p] !== after[p]);
}

// Installed apps that legitimately write some watched paths while they run. If an
// owner is running, a change to its path cannot be attributed to the isolated run;
// run-electron reports it separately and checks the sandbox's own log instead.
const OWNERS = [
  { app: 'Natively Local.app', paths: ['Library/Application Support/natively-local', 'Library/Application Support/Natively Local', 'Library/Preferences/local.natively.desktop.plist', 'Library/Logs/Natively Local', 'Documents/natively_debug.log'] },
  { app: 'Natively.app', paths: ['Library/Application Support/Natively', 'Library/Application Support/natively', 'Library/Logs/Natively', 'Documents/natively_debug.log'] },
  { app: 'Margin.app', paths: ['Library/Application Support/Margin', 'Library/Application Support/margin', 'Library/Logs/Margin'] },
  { app: 'ai assistant.app', paths: ['Library/Application Support/ai assistant'] },
];

export function runningOwnersOf(paths) {
  let ps = '';
  try { ps = execFileSync('/bin/ps', ['-axo', 'comm'], { encoding: 'utf8' }); } catch { /* unknown */ }
  const owned = {};
  for (const p of paths) {
    const rel = path.relative(REAL_HOME, p);
    const owners = OWNERS.filter((o) => o.paths.includes(rel) && ps.includes(`/Applications/${o.app}/`)).map((o) => o.app);
    if (owners.length) owned[p] = owners;
  }
  return owned;
}

// Chromium-level switches added to every isolated Electron launch.
export const CHROMIUM_SWITCHES = [
  '--use-mock-keychain',
  '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1',
  '--disable-background-networking',
  '--no-proxy-server',
];
