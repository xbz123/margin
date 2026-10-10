import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { REPO } from '../../../scripts/margin/isolation/env.mjs';

const require = createRequire(import.meta.url), ts = require('typescript');
const compile = file => ts.transpileModule(fs.readFileSync(path.join(REPO, file), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true },
}).outputText;
function boot(files, fail = false) {
  const module = { exports: {} };
  vm.runInNewContext(compile('electron/services/SettingsManager.ts'), {
    module, exports: module.exports, console: { log() {}, error() {}, warn() {} },
    require(id) {
      if (id === 'electron') return { app: { isReady: () => true, getPath: () => '/synthetic' } };
      if (id === '../../src/types/codexSource') {
        const shared = { exports: {} }; vm.runInNewContext(compile('src/types/codexSource.ts'), { module: shared, exports: shared.exports }); return shared.exports;
      }
      if (id === 'fs') return { existsSync: p => files.has(p), readFileSync: p => files.get(p),
        writeFileSync(p, value) { if (fail === true || fail?.active) throw Error('synthetic disk failure'); files.set(p, value); },
        renameSync(a, b) { if (fail?.rename) throw Error('synthetic rename'); files.set(b, files.get(a)); files.delete(a); }, unlinkSync: p => files.delete(p) };
      return require(id);
    },
  });
  return module.exports.SettingsManager.getInstance();
}
for (const mode of ['private', 'private_vision']) for (const fail of [false, true, { rename: true }]) test(`R3-5 ${mode} preserves screenshot refusal, other scopes and restart protection with migration save failure ${JSON.stringify(fail)}`, () => {
  const original = JSON.stringify({ screenUnderstandingMode: mode, providerDataScopes: {
    screenshots: true, transcript: false, profile_history: true, post_call_summary: false,
  }, verboseLogging: true });
  const files = new Map([['/synthetic/settings.json', original]]);
  const expected = { screenshots: false, transcript: false, profile_history: true, post_call_summary: false };
  const manager = boot(files, fail);
  assert.deepEqual(JSON.parse(JSON.stringify(manager.get('providerDataScopes'))), expected);
  assert.equal(manager.get('verboseLogging'), true);
  if (fail) assert.equal(files.get('/synthetic/settings.json'), original, 'failed migration retains the original private decision on disk');
  assert.equal(files.has('/synthetic/settings.json.tmp'), Boolean(fail?.rename), 'only rename failure occurs after the migrated candidate was written');
  const restarted = boot(files);
  assert.deepEqual(JSON.parse(JSON.stringify(restarted.get('providerDataScopes'))), expected);
  const persisted = JSON.parse(files.get('/synthetic/settings.json'));
  assert.equal(Object.hasOwn(persisted, 'screenUnderstandingMode'), false);
  assert.deepEqual(persisted.providerDataScopes, expected);
  assert.deepEqual(JSON.parse(JSON.stringify(boot(files).get('providerDataScopes'))), expected);
});

test('AG34 enabling requires current explicit confirmation, not legacy enabled', () => {
  const files = new Map([['/synthetic/settings.json', JSON.stringify({ codexCliEnabled: true })]]);
  const manager = boot(files);
  const config = manager.getCodexSourceConfig();
  assert.equal(config.enabled, false);
  assert.equal(config.riskConfirmedVersion, undefined);
  assert.throws(() => manager.saveCodexSourceConfig({ enabled: true }), /confirm/i);
});
test('AG34 failed confirmation save publishes no consent and restart stays disabled', () => {
  const files = new Map(), manager = boot(files, true);
  assert.throws(() => manager.saveCodexSourceConfig({ enabled: true, acceptRisk: true }), /save/i);
  assert.equal(manager.getCodexSourceConfig().enabled, false);
  assert.equal(boot(files).getCodexSourceConfig().enabled, false);
});
test('AG34 legacy writer counterexample: failed disk save must not publish enabled', () => {
  const manager = boot(new Map(), true);
  try { manager.set('codexCliEnabled', true); } catch {}
  assert.notEqual(manager.get('codexCliEnabled'), true);
});
test('AG34 consent and tier/effort survive restart; legacy enabled does not migrate consent', () => {
  const files = new Map([['/synthetic/settings.json', JSON.stringify({ codexCliEnabled: true, codexCliModel: 'legacy', codexCliFastModel: 'legacy-fast', codexCliServiceTier: 'flex', codexCliModelReasoningEffort: 'xhigh' })]]);
  const manager = boot(files); const before = manager.getCodexSourceConfig();
  assert.equal(before.enabled, false); assert.equal(before.model, 'legacy'); assert.equal(before.serviceTier, 'flex'); assert.equal(before.modelReasoningEffort, 'xhigh');
  manager.saveCodexSourceConfig({ enabled: true, acceptRisk: true });
  assert.equal(boot(files).getCodexSourceConfig().enabled, true); assert.equal(boot(files).getCodexSourceConfig().riskConfirmedVersion, 1);
  assert.equal(JSON.stringify([...files.values()]).includes('codexCli'), false);
});
test('AG34 failed withdrawal stays closed live; later partial saves cannot silently restore consent', () => {
  const files = new Map(), fault = {}; const manager = boot(files, fault);
  manager.saveCodexSourceConfig({ enabled: true, acceptRisk: true }); fault.active = true;
  manager.withdrawCodexSourceConsent(); assert.throws(() => manager.saveCodexSourceConfig({ enabled: false }));
  assert.equal(manager.getCodexSourceConfig().enabled, false);
  assert.throws(() => manager.saveCodexSourceConfig({ enabled: true }), /confirm/);
  fault.active = false; manager.saveCodexSourceConfig({ model: 'changed' });
  assert.equal(manager.getCodexSourceConfig().enabled, false); assert.equal(boot(files).getCodexSourceConfig().enabled, false);
});
test('AG34 rename failure keeps old consent/model memory and disk', () => {
  const files = new Map(), fault = {}, manager = boot(files, fault); manager.saveCodexSourceConfig({ enabled: true, acceptRisk: true });
  const previous = files.get('/synthetic/settings.json'); fault.rename = true;
  assert.throws(() => manager.saveCodexSourceConfig({ model: 'changed' })); assert.equal(manager.getCodexSourceConfig().model, 'gpt-5.4'); assert.equal(files.get('/synthetic/settings.json'), previous);
  assert.equal(files.size, 1);
});
