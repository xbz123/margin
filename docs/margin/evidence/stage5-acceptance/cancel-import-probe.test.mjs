import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const url = new URL('../../../../electron/services/__tests__/PromptSkillConsumerChain.test.mjs', import.meta.url);
const original = fs.readFileSync(url, 'utf8');
let source = original.slice(0, original.indexOf("test('S42-02"))
  + original.slice(original.indexOf("test('AG51 import ->"));
const needle = "    selection = { canceled: true, filePaths: [] };\n    assert.equal((await invoke('prompt-settings:import')).settings.skills.length, 1);";
if (!source.includes(needle)) throw new Error('Fixture changed');
source = source.replace(needle, `
    let cancellations = 0;
    const cancel = helper.cancelGenerationTasks.bind(helper);
    helper.cancelGenerationTasks = (...args) => { cancellations++; return cancel(...args); };
    const active = helper.beginGenerationTask('interview');
    assert.equal(active.signal.aborted, false);
    selection = { canceled: true, filePaths: [] };
    try {
      assert.equal((await invoke('prompt-settings:import')).settings.skills.length, 1);
      assert.equal(active.signal.aborted, false, 'cancelling the import picker must preserve the current generation task');
      assert.equal(cancellations, 0, 'cancelling the import picker did not modify settings and must not cancel generation');
    } finally { active.close(); }
`)
  .replace("'typescript'", JSON.stringify(pathToFileURL(createRequire(url).resolve('typescript')).href))
  .replaceAll('import.meta.url', JSON.stringify(url.href));
await import('data:text/javascript;base64,' + Buffer.from('Error.stackTraceLimit = 0;\n' + source).toString('base64'));
