export const CODEX_CLI_MODEL = {
    id: 'codex-cli',
    name: 'Codex login source',
    desc: 'Read-only login file; third-party backend availability unverified',
};

export const CODEX_CLI_MODEL_PRESETS = [
    { id: 'gpt-6.1-sol', name: 'ChatGPT 6.1 Sol' },
    { id: 'gpt-5.5', name: 'ChatGPT 5.5' },
    { id: 'gpt-5.3-codex', name: 'Codex 5.3' },
    { id: 'gpt-5.3-codex-spark', name: 'Codex Spark 5.3' },
    { id: 'gpt-5.4', name: 'ChatGPT 5.4' },
];

export const codexCliSelectorId = (modelId: string): string => `codex-cli:${modelId}`;

export const getCodexCliModelDisplayName = (id: string): string | null => {
    if (id === CODEX_CLI_MODEL.id) return CODEX_CLI_MODEL.name;
    if (!id.startsWith('codex-cli:')) return null;

    const modelId = id.slice('codex-cli:'.length);
    const preset = CODEX_CLI_MODEL_PRESETS.find(model => model.id === modelId);
    return preset?.name || prettifyModelId(modelId);
};

export const getModelTargetDisplayName = (id: string): string | null => {
    const match = /^llm-(?:target|gateway):([^:]+):[^:]+:(.+)$/.exec(id);
    if (!match) return null;
    try { return `${decodeURIComponent(match[2])} (${match[1]})`; }
    catch { return id; }
};

export const prettifyModelId = (id: string): string => {
    if (!id) return '';
    return id.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
};
