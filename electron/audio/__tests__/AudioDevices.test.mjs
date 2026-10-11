import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import { fixture } from './meetingAudioFixture.mjs';

function devices(native) {
  const source = fs.readFileSync(new URL('../AudioDevices.ts', import.meta.url), 'utf8');
  const exports = {};
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function('exports', 'require', 'console', code)(exports,
    () => ({ loadNativeModule: () => native }), { error() {} });
  return exports.AudioDevices;
}

test('native enumeration is synchronous, validates rows and excludes private capture aggregates only', () => {
  const inventory = [
    { id: 'mic-id', name: 'Desk mic' }, { id: 'tap-uid', name: 'NativelySystemAudioTap' },
    { id: 'NativelySystemAudioTap', name: 'Virtual capture' }, null, { id: 1, name: 'bad' },
    { id: '', name: 'bad' }, { id: 'cable', name: 'Virtual Cable' },
  ];
  const api = devices({ getInputDevices: () => inventory, getOutputDevices: () => inventory });
  for (const list of [api.getInputDevices(), api.getOutputDevices()]) {
    assert.equal(Array.isArray(list), true);
    assert.deepEqual(list, [{ id: 'mic-id', name: 'Desk mic' }, { id: 'cable', name: 'Virtual Cable' }]);
  }
  assert.equal(inventory.length, 7);
});

test('missing native module, malformed results and enumeration exceptions yield empty lists', () => {
  for (const native of [null, { getInputDevices: () => null, getOutputDevices: () => { throw Error('synthetic'); } }]) {
    const api = devices(native);
    assert.deepEqual(api.getInputDevices(), []);
    assert.deepEqual(api.getOutputDevices(), []);
  }
});

test('existing IPC consumers return the synchronous native inventory', async () => {
  const source = fs.readFileSync(new URL('../../ipcHandlers.ts', import.meta.url), 'utf8');
  const tree = ts.createSourceFile('ipcHandlers.ts', source, ts.ScriptTarget.Latest, true);
  const callbacks = new Map();
  const visit = node => {
    if (ts.isCallExpression(node) && node.expression.getText(tree) === 'safeHandle' &&
      ['get-input-devices', 'get-output-devices'].includes(node.arguments[0]?.text)) {
      const text = ts.transpileModule('return (' + node.arguments[1].getText(tree) + ');', {
        compilerOptions: { target: ts.ScriptTarget.ES2022 },
      }).outputText;
      callbacks.set(node.arguments[0].text, new Function('AudioDevices', text)(devices({
        getInputDevices: () => [{ id: 'input', name: 'Mic' }],
        getOutputDevices: () => [{ id: 'output', name: 'Speaker' }],
      })));
    }
    ts.forEachChild(node, visit);
  };
  visit(tree);
  assert.equal(callbacks.size, 2);
  assert.deepEqual(await callbacks.get('get-input-devices')(), [{ id: 'input', name: 'Mic' }]);
  assert.deepEqual(await callbacks.get('get-output-devices')(), [{ id: 'output', name: 'Speaker' }]);
});

test('selection uses exact IDs, not names; missing selections fall back on both channels', async () => {
  const f = fixture({
    inputDevices: () => [{ id: 'mic-id', name: 'Friendly mic' }],
    outputDevices: () => [{ id: 'speaker-id', name: 'Friendly output' }],
  });
  await f.begin({ audio: { inputDeviceId: 'mic-id', outputDeviceId: 'speaker-id' } });
  assert.equal(f.microphones[0].id, 'mic-id');
  assert.equal(f.systems[0].id, 'speaker-id');
  await f.pipeline.reconfigureAudio('Friendly mic', 'removed');
  assert.equal(f.microphones.at(-1).id, undefined);
  assert.equal(f.systems.at(-1).id, undefined);
  const fallback = f.events.filter(([kind, value]) => kind === 'device-selection' && value.fellBack);
  assert.deepEqual(fallback.map(([, value]) => value.kind), ['input', 'output']);
  await f.pipeline.abortInit();
  await f.pipeline.detachAndDestroy();
});
