// Builds a clean, isolated environment for Margin tests and smoke launches
// (PLAN.md X2). Nothing from the caller's environment is inherited except the
// variables needed to find tools and render text: no API keys, tokens, Google
// credentials, proxies or dotenv paths. HOME points at a fresh temporary directory, so
// Electron's appData/userData, Documents logs and ~/.codex all land inside it.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const GUARD = fileURLToPath(new URL('./guard.cjs', import.meta.url));
export const REPO = path.resolve(fileURLToPath(new URL('../../..', import.meta.url)));

const PASS_THROUGH = ['PATH', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TERM', 'USER', 'LOGNAME', 'SHELL', '__CF_USER_TEXT_ENCODING'];

export function makeSandbox(label = 'run') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `margin-isolation-${label}-`));
  const home = path.join(root, 'home');
  const work = path.join(root, 'cwd');
  const tmp = path.join(root, 'tmp');
  for (const d of [home, work, tmp]) fs.mkdirSync(d, { recursive: true });
  return { root, home, work, tmp, log: path.join(root, 'isolation.jsonl') };
}

export function isolatedEnv(sandbox, extra = {}) {
  const env = {};
  for (const k of PASS_THROUGH) if (process.env[k] !== undefined) env[k] = process.env[k];
  Object.assign(env, {
    HOME: sandbox.home,
    MARGIN_ISOLATION_HOME: sandbox.home,
    TMPDIR: sandbox.tmp + path.sep,
    CODEX_HOME: path.join(sandbox.home, '.codex'),
    NATIVELY_TEST_USERDATA: path.join(sandbox.home, 'userData'),
    NODE_OPTIONS: `--require=${GUARD}`,
    MARGIN_ISOLATION_LOG: sandbox.log,
    MARGIN_ISOLATION_ALLOW_EXEC: '',
    NO_PROXY: '*',
    // The app's own dev switch: skip the startup screen-recording permission probe.
    NATIVELY_DEV_BYPASS_SCREEN_TCC: '1',
    ELECTRON_NO_ATTACH_CONSOLE: '1',
  }, extra);
  return env;
}

export function readBlocked(sandbox) {
  if (!fs.existsSync(sandbox.log)) return [];
  return fs.readFileSync(sandbox.log, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
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

// Chromium-level switches added to every isolated Electron launch.
export const CHROMIUM_SWITCHES = [
  '--use-mock-keychain',
  '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1',
  '--disable-background-networking',
  '--no-proxy-server',
];
