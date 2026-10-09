// AG-25 local check of a downloaded temp package. Usage:
//   node scripts/margin/libvips/sharp-smoke-local.mjs <temp.app> [libvips UUID] > report.json
// Runs sharp-smoke.cjs in the repository's Electron (Node mode, so it can read the
// package's app.asar) with the X2 guard preloaded in a fresh sandbox. Exits 1 unless
// sharp ran, the guard was active and blocked nothing, and dyld loaded the package's
// libvips (with the given UUID, when one is given).
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeSandbox, isolatedEnv, readBlocked, REPO, GUARD } from '../isolation/env.mjs';

const PACKAGED_LIBVIPS = '<app>/Contents/Resources/app.asar.unpacked/node_modules/@img/sharp-libvips-darwin-arm64/lib/libvips-cpp.8.17.3.dylib';

export function judge({ exit, output, loaded, guardActive, blocked }, uuid) {
  const failed = [];
  if (exit !== 0) failed.push(`sharp-smoke exited ${exit}`);
  let result = null;
  try { result = JSON.parse(output); } catch { failed.push('no sharp result'); }
  if (result && !(result.vips && result.webp === 'webp' && result.width === 4 && Array.isArray(result.svgFirstPixel))) failed.push('incomplete sharp result');
  if (!guardActive) failed.push('guard not active');
  if (blocked.length) failed.push(`guard blocked ${blocked.length} attempts`);
  const libvips = loaded.filter((line) => line.endsWith(` ${PACKAGED_LIBVIPS}`));
  if (!libvips.length) failed.push('the package libvips was not loaded');
  else if (uuid && !libvips.some((line) => line.includes(`<${uuid}>`))) failed.push(`loaded libvips is not ${uuid}`);
  if (loaded.some((line) => /libvips-cpp/.test(line) && !line.endsWith(` ${PACKAGED_LIBVIPS}`))) failed.push('another libvips was loaded');
  return { passed: failed.length === 0, failed };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [app, uuid] = process.argv.slice(2);
  const electron = path.join(REPO, 'node_modules/electron/dist', fs.readFileSync(path.join(REPO, 'node_modules/electron/path.txt'), 'utf8').trim());
  const sandbox = makeSandbox('sharp-smoke');
  const r = spawnSync(electron, ['-r', GUARD, path.join(REPO, 'scripts/margin/libvips/sharp-smoke.cjs'), app], {
    cwd: sandbox.work, encoding: 'utf8', env: { ...isolatedEnv(sandbox), ELECTRON_RUN_AS_NODE: '1', DYLD_PRINT_LIBRARIES: '1' } });
  const report = {
    exit: r.status, error: r.error?.message, output: (r.stdout ?? '').trim(),
    loaded: (r.stderr ?? '').split('\n').filter((l) => /libvips-cpp|sharp-darwin/.test(l)).map((l) => l.split(app).join('<app>')),
    guardActive: fs.existsSync(path.join(sandbox.root, 'isolation.jsonl')), blocked: readBlocked(sandbox),
  };
  Object.assign(report, judge(report, uuid));
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = report.passed ? 0 : 1;
}
