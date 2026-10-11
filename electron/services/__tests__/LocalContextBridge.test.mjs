import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ag50-bridge-'));
test.after(() => fs.rmSync(root, { recursive: true, force: true }));
const repo = path.resolve(import.meta.dirname, '../../..');
const compile = file => ts.transpileModule(fs.readFileSync(path.join(repo, file), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
}).outputText;

test('AG50 real IPC and preload add/view/delete through native selection, reject untrusted sender and unsupported files', async () => {
  const handlers = new Map();
  const sender = {};
  const selected = path.join(root, 'selected.md'); fs.writeFileSync(selected, 'SELECTED CONTENT');
  let result = { canceled: false, filePaths: [selected] };
  const electron = { app: { getPath: () => root }, BrowserWindow: { fromWebContents: candidate => candidate === sender ? {} : null },
    dialog: { showOpenDialog: async (_owner, options) => { assert.deepEqual(Array.from(options.filters[0].extensions), ['md', 'markdown', 'txt']); return result; } } };
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(repo, 'dist-electron/electron/ipc/localContextHandlers.js'), 'utf8'), {
    module, exports: module.exports, Buffer, TextDecoder,
    require: id => id === 'electron' ? electron : require(id),
  });
  let changes = 0;
  module.exports.registerLocalContextHandlers((name, callback) => handlers.set(name, callback), () => { changes++; });
  const ipc = new EventEmitter();
  ipc.send = () => {};
  ipc.invoke = async (channel, ...args) => handlers.has(channel) ? handlers.get(channel)({ sender }, ...args) : false;
  let api;
  vm.runInNewContext(fs.readFileSync(path.join(repo, 'dist-electron/electron/preload.js'), 'utf8'), {
    module: { exports: {} }, exports: {}, URL,
    require: id => { assert.equal(id, 'electron'); return { ipcRenderer: ipc, contextBridge: { exposeInMainWorld: (_key, value) => { api = value; } } }; },
    window: { addEventListener() {} }, process: { platform: 'darwin' }, console: { log() {}, warn() {}, error() {}, info() {}, debug() {} },
  });
  assert.equal((await api.listLocalContext()).entries.length, 0);
  const added = await api.addLocalContext();
  assert.equal(added.entries[0].content, 'SELECTED CONTENT');
  assert.equal((await api.listLocalContext()).entries[0].id, added.entries[0].id);
  result = { canceled: true, filePaths: [] };
  assert.equal((await api.addLocalContext()).entries.length, 1);
  result = { canceled: false, filePaths: [path.join(root, 'unsupported.pdf')] };
  assert.match((await api.addLocalContext()).error, /PDF and DOCX/);
  assert.equal((await handlers.get('local-context:list')({ sender: {} })).ok, false);
  assert.equal((await api.removeLocalContext(added.entries[0].id)).entries.length, 0);
  assert.equal(changes, 2);
  fs.writeFileSync(path.join(root, 'local-context.json'), '{broken');
  assert.equal((await api.listLocalContext()).error, 'Local Context could not be read. Check its local storage.');
  assert.equal((await handlers.get('local-context:clear')({ sender: {} })).ok, false);
  assert.equal(fs.readFileSync(path.join(root, 'local-context.json'), 'utf8'), '{broken');
  assert.equal((await api.clearLocalContext()).entries.length, 0);
  assert.equal((await api.listLocalContext()).entries.length, 0);
  assert.equal(changes, 3);
});

test('AG50 settings card actions display full text, save removal and show localized failure and consent', async () => {
  const dictionary = {};
  new Function('exports', compile('src/i18n.zh.ts'))(dictionary);
  for (const language of ['en', 'zh-CN']) {
    const states = [], effects = []; let cursor = 0, pending, onIdle;
    const perform = callback => new Promise(resolve => { onIdle = resolve; callback(); });
    const calls = [];
    const entry = { id: 'id', name: 'note.txt', content: 'FULL TEXT <script>not executable</script>' };
    const api = {
      listLocalContext: () => pending = Promise.resolve({ ok: true, entries: [] }),
      addLocalContext: () => { calls.push('add'); return pending = Promise.resolve({ ok: true, entries: [entry] }); },
      removeLocalContext: id => { calls.push(id); return pending = Promise.resolve({ ok: true, entries: [] }); },
    };
    const module = { exports: {} };
    vm.runInNewContext(compile('src/components/settings/LocalContextSettings.tsx'), {
      module, exports: module.exports, window: { electronAPI: api },
      require: id => id === 'react' ? {
        useState: initial => { const slot = cursor++; if (!(slot in states)) states[slot] = initial; return [states[slot], value => { states[slot] = value; if (slot === 1 && value === false) onIdle(); }]; },
        useEffect: callback => { effects.push(callback); },
      } : id === '../../i18n' ? { useI18n: () => ({ t: text => language === 'zh-CN' ? dictionary.chinese[text] ?? text : text }) }
        : id === './SettingsKit' ? { SettingsCard: 'section', SettingsHeading: 'header' } : require(id),
    });
    const render = () => { cursor = 0; return module.exports.LocalContextSettings(); };
    const nodes = tree => !tree || typeof tree !== 'object' ? [] : [tree, ...[tree.props?.children].flat(Infinity).flatMap(nodes)];
    render(); await perform(effects.shift());
    let tree = render();
    assert.match(nodes(tree).find(node => node.type === 'header').props.description, language === 'en' ? /selected model provider/ : /所选的模型服务商/);
    await perform(nodes(tree).find(node => node.type === 'button').props.onClick);
    tree = render();
    assert.equal(nodes(tree).find(node => node.type === 'pre').props.children, entry.content);
    await perform(nodes(tree).filter(node => node.type === 'button')[1].props.onClick);
    assert.equal(nodes(render()).some(node => node.type === 'pre'), false);
    assert.deepEqual(calls, ['add', 'id']);
    api.addLocalContext = () => pending = Promise.resolve({ ok: false, error: 'Local Context accepts at most 8 files.' });
    await perform(nodes(render()).find(node => node.type === 'button').props.onClick);
    assert.match(nodes(render()).find(node => node.props?.role === 'alert').props.children, language === 'en' ? /at most 8/ : /最多接受 8/);
    api.listLocalContext = () => Promise.resolve({ ok: false, error: 'Local Context could not be read. Check its local storage.' });
    let failClear = true;
    api.clearLocalContext = () => {
      calls.push('clear');
      return Promise.resolve(failClear ? { ok: false, error: 'Local Context could not be saved. The previous contents were kept.' } : { ok: true, entries: [] });
    };
    await perform(effects.at(-1));
    const button = label => nodes(render()).find(node => node.type === 'button' && node.props.children === (language === 'zh-CN' ? dictionary.chinese[label] : label));
    assert.match(nodes(render()).find(node => node.props?.role === 'alert').props.children, language === 'en' ? /could not be read/ : /无法读取/);
    assert.ok(button('Clear Local Context'));
    button('Clear Local Context').props.onClick();
    assert.ok(button('Confirm clear'));
    button('Cancel').props.onClick();
    assert.deepEqual(calls, ['add', 'id']);
    button('Clear Local Context').props.onClick();
    await perform(button('Confirm clear').props.onClick);
    assert.ok(button('Confirm clear'), 'failed write must retain the recovery path');
    failClear = false;
    await perform(button('Confirm clear').props.onClick);
    assert.equal(button('Clear Local Context'), undefined);
    assert.equal(nodes(render()).some(node => node.props?.role === 'alert'), false);
    assert.deepEqual(calls, ['add', 'id', 'clear', 'clear']);
  }
});
