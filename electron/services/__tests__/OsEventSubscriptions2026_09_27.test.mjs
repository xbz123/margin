import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import ts from 'typescript';

const exports = {};
const source = fs.readFileSync(new URL('../../osEventSubscriptions.ts', import.meta.url), 'utf8');
new Function('exports', 'console', ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText)(exports, { error() {} });
const register = exports.registerOsEventSubscriptions;

test('sleep, resume, display changes and disposal invoke the production subscription functions', async () => {
  const powerMonitor = new EventEmitter(), screen = new EventEmitter(), calls = [];
  const dispose = register({
    powerMonitor, screen,
    suspendCaptures: async () => { calls.push('suspend'); },
    restartCapturesAfterResume: async () => { calls.push('restart'); },
    revalidateShortcuts: () => calls.push('shortcuts'),
  });
  powerMonitor.emit('suspend');
  powerMonitor.emit('resume');
  powerMonitor.emit('unlock-screen');
  for (const event of ['display-added', 'display-removed', 'display-metrics-changed']) screen.emit(event);
  assert.deepEqual(calls, ['suspend', 'restart', 'shortcuts', 'shortcuts', 'shortcuts', 'shortcuts', 'shortcuts']);
  dispose();
  dispose();
  assert.equal(powerMonitor.eventNames().length, 0);
  assert.equal(screen.eventNames().length, 0);
  powerMonitor.emit('resume');
  assert.equal(calls.length, 7);
});

test('synchronous and asynchronous restart failures do not suppress shortcut recovery or escape as rejections', async () => {
  for (const restart of [() => { throw Error('sync'); }, async () => { throw Error('async'); }]) {
    const powerMonitor = new EventEmitter();
    let shortcuts = 0;
    const dispose = register({ powerMonitor, restartCapturesAfterResume: restart,
      suspendCaptures: async () => {}, revalidateShortcuts: () => shortcuts++ });
    powerMonitor.emit('resume');
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(shortcuts, 1);
    dispose();
  }
});
