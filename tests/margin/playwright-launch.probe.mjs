// Diagnostic probe (not part of the suite): can Playwright launch Electron with the
// isolation environment? Launches a minimal main script and reports what it saw.
//   node scripts/margin/isolation/run-node.mjs --allow-exec Electron tests/margin/playwright-launch.probe.mjs [app]

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { makeSandbox, isolatedEnv, CHROMIUM_SWITCHES, REPO, GUARD } from '../../scripts/margin/isolation/env.mjs';

const require = createRequire(import.meta.url);
const { _electron } = require('playwright');
const ELECTRON = path.join(REPO, 'node_modules/electron/dist',
  fs.readFileSync(path.join(REPO, 'node_modules/electron/path.txt'), 'utf8').trim());

const appArg = process.argv[2] || path.join(REPO, 'scripts/margin/isolation/selftest/native-load.cjs');
const variant = process.argv[3] || 'full';
const sandbox = makeSandbox('pwprobe');
const env = isolatedEnv(sandbox, { NODE_ENV: 'production', MARGIN_ISOLATION_DEBUG: '1' });
// Playwright drops NODE_OPTIONS, so the guard is always passed with -r.
const args = variant === 'no-switches' ? ['-r', GUARD, appArg] : ['-r', GUARD, appArg, ...CHROMIUM_SWITCHES];
const t0 = Date.now();
try {
  const app = await _electron.launch({ executablePath: ELECTRON, args, cwd: sandbox.work, env, timeout: 30_000 });
  console.log(JSON.stringify({ launched: true, ms: Date.now() - t0, windows: app.windows().map((w) => w.url()) }));
  await app.close();
} catch (e) {
  console.log(JSON.stringify({ launched: false, ms: Date.now() - t0, error: String(e.message).split('\n').slice(0, 60) }));
}
console.log('sandbox', sandbox.root);
