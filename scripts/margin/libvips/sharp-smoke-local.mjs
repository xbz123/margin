// AG-25 local check of a downloaded temp package. Usage:
//   node scripts/margin/libvips/sharp-smoke-local.mjs <temp.app> > report.json
// Runs sharp-smoke.cjs in the repository's Electron (Node mode, so it can read the
// package's app.asar) with the X2 guard preloaded in a fresh sandbox.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { makeSandbox, isolatedEnv, readBlocked, REPO, GUARD } from '../isolation/env.mjs';
const electron = path.join(REPO, 'node_modules/electron/dist', fs.readFileSync(path.join(REPO, 'node_modules/electron/path.txt'), 'utf8').trim());
const sandbox = makeSandbox('sharp-smoke');
const r = spawnSync(electron, ['-r', GUARD, path.join(REPO, 'scripts/margin/libvips/sharp-smoke.cjs'), process.argv[2]], {
  cwd: sandbox.work, encoding: 'utf8', env: { ...isolatedEnv(sandbox), ELECTRON_RUN_AS_NODE: '1', DYLD_PRINT_LIBRARIES: '1' } });
const loaded = r.stderr.split('\n').filter((l) => /libvips-cpp|sharp-darwin/.test(l)).map((l) => l.split(process.argv[2]).join('<app>'));
console.log(JSON.stringify({ exit: r.status, output: r.stdout.trim(), loaded, guardActive: fs.existsSync(path.join(sandbox.root, 'isolation.jsonl')), blocked: readBlocked(sandbox) }, null, 2));
