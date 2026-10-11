import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const compile = file => ts.transpileModule(fs.readFileSync(new URL(`../../../${file}`, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
}).outputText;
const dictionary = {};
new Function('exports', compile('src/i18n.zh.ts'))(dictionary);
const nodes = tree => !tree || typeof tree !== 'object' ? [] : [tree, ...[tree.props?.children].flat(Infinity).flatMap(nodes)];

test('AG51 preload exposes only bounded settings operations, never import paths', async () => {
    const ipc = new EventEmitter();
    const calls = [];
    ipc.invoke = async (...args) => { calls.push(args); return { ok: true }; };
    ipc.send = () => {};
    let api;
    vm.runInNewContext(fs.readFileSync(new URL('../../../dist-electron/electron/preload.js', import.meta.url), 'utf8'), {
        module: { exports: {} }, exports: {}, URL,
        require: () => ({ ipcRenderer: ipc, contextBridge: { exposeInMainWorld: (_key, value) => { api = value; } } }),
        window: { addEventListener() {} }, process: { platform: 'darwin' }, console,
    });
    calls.length = 0;
    await api.getPromptSettings(); await api.importPromptSkill('/untrusted/ignored');
    await api.savePromptSettings({ scene: 'written', skillId: null, additional: 'TEXT' });
    await api.removePromptSkill('id'); await api.clearPromptSettings();
    assert.deepEqual(calls.map(call => call[0]), ['prompt-settings:get', 'prompt-settings:import', 'prompt-settings:save', 'prompt-settings:remove', 'prompt-settings:clear']);
    assert.equal(calls[1].length, 1);
    assert.equal(calls[2][1].additional, 'TEXT');
});

for (const language of ['en', 'zh-CN']) test(`AG51 ${language} settings saves selections, clears defaults and confirms corrupt-store recovery`, async () => {
    const t = text => language === 'en' ? text : dictionary.chinese[text] ?? text;
    const settings = { skills: [{ id: 'one', name: 'one', description: 'Synthetic', instructions: 'PROMPT' }],
        scenes: { interview: { skillId: 'one', additional: 'INTERVIEW' }, written: { skillId: null, additional: 'WRITTEN' } } };
    const calls = [];
    const api = {
        getPromptSettings: async () => ({ ok: true, settings: structuredClone(settings) }),
        savePromptSettings: async input => { calls.push(input); settings.scenes[input.scene] = { skillId: input.skillId, additional: input.additional }; return api.getPromptSettings(); },
    };
    let cursor = 0, pendingEffects = [];
    const state = [], dependencies = [];
    const module = { exports: {} };
    vm.runInNewContext(compile('src/components/settings/PromptSettings.tsx'), {
        module, exports: module.exports, window: { electronAPI: api },
        require: id => id === 'react' ? {
            useState: initial => { const slot = cursor++; if (!(slot in state)) state[slot] = initial; return [state[slot], value => { state[slot] = value; }]; },
            useEffect: (effect, deps) => { const slot = cursor++; if (!dependencies[slot] || deps.some((value, i) => value !== dependencies[slot][i])) { pendingEffects.push(effect); dependencies[slot] = deps; } },
        } : id === '../../i18n' ? { useI18n: () => ({ t }) }
            : id === '../../types/promptSettings' ? { ADDITIONAL_INSTRUCTIONS_LIMIT: 4000 }
                : id === './SettingsKit' ? { SettingsCard: 'section', SettingsHeading: 'header' } : require(id),
    });
    let tree;
    async function render() {
        for (let pass = 0; pass < 3; pass++) {
            cursor = 0; tree = module.exports.PromptSettings();
            const effects = pendingEffects; pendingEffects = []; effects.forEach(effect => effect());
            await new Promise(setImmediate);
        }
    }
    const button = name => nodes(tree).find(node => node.type === 'button' && node.props.children === t(name));
    const click = async name => { button(name).props.onClick(); await render(); };
    await render();
    assert.equal(nodes(tree).find(node => node.type === 'textarea').props.value, 'INTERVIEW');
    nodes(tree).find(node => node.props?.['aria-label'] === t('Scenario')).props.onChange({ target: { value: 'written' } });
    await render();
    assert.equal(nodes(tree).find(node => node.type === 'textarea').props.value, 'WRITTEN');
    nodes(tree).find(node => node.type === 'textarea').props.onChange({ target: { value: 'NEW' } });
    await render(); await click('Save');
    assert.equal(calls.at(-1).additional, 'NEW');
    assert.equal(calls.at(-1).scene, 'written');
    await click('Restore scenario defaults');
    assert.equal(calls.at(-1).additional, '');
    assert.equal(calls.at(-1).skillId, null);
    const readError = 'Prompt settings could not be read. Clear them in Settings to recover.';
    api.getPromptSettings = async () => ({ ok: false, error: readError, recovery: true });
    let clears = 0;
    api.clearPromptSettings = async () => { clears++; return { ok: false, error: 'Prompt settings could not be saved. Previous settings were kept.' }; };
    await click('Reload prompt settings');
    assert.equal(nodes(tree).find(node => node.props?.role === 'alert').props.children, t(readError));
    await click('Clear prompt settings'); await click('Cancel');
    assert.equal(clears, 0);
    await click('Clear prompt settings'); await click('Confirm clear');
    assert.equal(clears, 1);
    assert.ok(button('Confirm clear'));
    api.clearPromptSettings = async () => ({ ok: true, settings: structuredClone(settings) });
    await click('Confirm clear');
    assert.equal(button('Clear prompt settings'), undefined);
});
