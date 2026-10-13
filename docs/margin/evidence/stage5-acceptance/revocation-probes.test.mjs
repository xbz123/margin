import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
const url = new URL('../../../../electron/services/__tests__/SpeechActions.test.mjs', import.meta.url);
const original = fs.readFileSync(url, 'utf8');
let source = original.slice(0, original.indexOf("test('S42-04"))
  .replace("'typescript'", JSON.stringify(pathToFileURL(createRequire(url).resolve('typescript')).href))
  .replaceAll('import.meta.url', JSON.stringify(url.href))
  .replace('fromWebContents: () => null', 'fromWebContents: () => ({})');
const stub = "if (id === './ipc/localContextHandlers') return { registerLocalContextHandlers() {} };";
if (!source.includes(stub)) throw new Error('Fixture changed');
source = source.replace(stub, `if (id === './ipc/localContextHandlers') {
  const bridge = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../../ipc/localContextHandlers.ts', ${JSON.stringify(url.href)}), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText, { module: bridge, exports: bridge.exports, require(name) {
    if (name === 'electron') return electron;
    if (name === '../services/LocalContextStore') return dist('services/LocalContextStore');
    return require(name);
  } });
  return bridge.exports;
}`);
const checks = `
Error.stackTraceLimit = 0;
test('stage5 F1: starting a new speech action cannot orphan the pending retry image revocation', async () => {
  const c = chain();
  const image = path.join(root, 'retry-image.png'); fs.writeFileSync(image, 'synthetic image');
  c.helper.processImage = async () => ({ mimeType: 'image/jpeg', data: 'V0lUSERSQVdO' });
  const failure = await failTyped(c, [image]);
  let release, entered = false;
  c.helper.rateLimiters = { openai: { acquire: () => new Promise(resolve => { entered = true; release = resolve; }) } };
  c.helper.openaiClient.chat.completions.create = async body => { c.sent.push(body); return [{ choices: [{ delta: { content: 'OLD RETRY' }, finish_reason: 'stop' }] }]; };
  const retry = c.invoke('generation:retry', failure.requestId, Date.now());
  await tick(); assert.equal(entered, true);
  await c.begin('what-to-say');
  await c.invoke('delete-screenshot', image);
  release(); await retry;
  c.releaseSeals(); await c.invoke('cancel-intelligence-generation');
  assert.deepEqual({ laterSends: c.sent.length - 1, withdrawnImage: JSON.stringify(c.sent.slice(1)).includes('V0lUSERSQVdO') },
    { laterSends: 0, withdrawnImage: false }, 'deleted image must not leave in the superseded retry');
});

test('stage5 F2: corrupt prompt store cannot defeat successful Local Context deletion', async () => {
  const c = chain();
  const contextFile = path.join(root, 'local-context.json'), promptFile = path.join(root, 'prompt-settings.json');
  fs.writeFileSync(contextFile, JSON.stringify([{ id: 'withdrawn', name: 'ref.txt', content: 'REMOVED CONTEXT SENTINEL' }]));
  fs.writeFileSync(promptFile, '{corrupt');
  let release;
  c.helper.rateLimiters = { openai: { acquire: () => new Promise(resolve => { release = resolve; }) } };
  try {
    const request = c.helper.generateContentStructured('non-owned request');
    await tick(); assert.equal(typeof release, 'function');
    const result = await c.invoke('local-context:remove', 'withdrawn');
    const stored = JSON.parse(fs.readFileSync(contextFile, 'utf8'));
    release(); await request.catch(() => undefined);
    assert.deepEqual(stored, [], 'the delete really persisted');
    assert.deepEqual({ sends: c.sent.length, withdrawnContext: JSON.stringify(c.sent).includes('REMOVED CONTEXT SENTINEL'), ok: result.ok },
      { sends: 0, withdrawnContext: false, ok: true }, 'successful deletion must revoke the old context and report success');
  } finally { fs.rmSync(contextFile, { force: true }); fs.rmSync(promptFile, { force: true }); }
});
`;
await import('data:text/javascript;base64,' + Buffer.from(source + checks).toString('base64'));
