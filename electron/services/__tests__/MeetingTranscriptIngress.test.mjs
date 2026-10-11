import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

test('production transcript ingress records interim and final text without triggering any answer engine', () => {
  const source = fs.readFileSync(new URL('../../IntelligenceManager.ts', import.meta.url), 'utf8');
  const tree = ts.createSourceFile('IntelligenceManager.ts', source, ts.ScriptTarget.Latest, true);
  const declaration = tree.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'IntelligenceManager');
  const method = declaration.members.find(node => ts.isMethodDeclaration(node) && node.name.getText(tree) === 'handleTranscript');
  const Class = new Function(ts.transpileModule('class Manager {' + method.getText(tree) + '} return Manager;', {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText)();
  const seen = [];
  const manager = new Class();
  manager.session = { handleTranscript: payload => seen.push(payload) };
  manager.engine = { handleTranscript: () => { throw Error('automatic generation must not be reachable'); } };
  const interim = { speaker: 'interviewer', text: 'How do you', final: false, confidence: 1 };
  const tail = { speaker: 'user', text: 'Please expand on that', final: true };
  manager.handleTranscript(interim);
  manager.handleTranscript(tail);
  assert.deepEqual(seen, [interim, tail]);
});
