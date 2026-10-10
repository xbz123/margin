import { LLM_PRESETS, modelTargetId, type ProviderConfiguration, type LlmProvider } from '../../types/llmTarget';
import { APP_NAME } from '../../appIdentity';
import React, { useState, useEffect } from 'react';
import { AlertCircle, CheckCircle, ChevronDown, Check, RefreshCw, ExternalLink, Loader2 } from 'lucide-react';
import { CODEX_CLI_MODEL, CODEX_CLI_MODEL_PRESETS, codexCliSelectorId, STANDARD_CLOUD_MODELS, prettifyModelId } from '../../utils/modelUtils';
import { ProviderCard } from './ProviderCard';
import type { CredentialSaveResult } from '../../types/credentialSave';
import { DEFAULT_GENERATION_POLICY, type GenerationPolicy } from '../../types/generationPolicy';

const CODEX_SERVICE_TIERS = ['default', 'fast', 'flex'] as const;
const CODEX_MODEL_REASONING_EFFORTS = ['low', 'medium', 'high', 'xhigh'] as const;

interface ModelOption {
    id: string;
    name: string;
}

interface ModelSelectProps {
    value: string;
    options: ModelOption[];
    onChange: (value: string) => void;
    placeholder?: string;
    className?: string;
}

const ModelSelect: React.FC<ModelSelectProps> = ({ value, options, onChange, placeholder = "Select model", className = "" }) => {
    const [isOpen, setIsOpen] = useState(false);
    const containerRef = React.useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const selectedOption = options.find(o => o.id === value);

    const paddingClass = className.includes('py-') ? '' : 'py-1.5';

    return (
        <div className="relative" ref={containerRef}>
            <button
                onClick={() => setIsOpen(!isOpen)}
                className={`w-40 bg-bg-input border border-border-subtle rounded-lg px-3 ${paddingClass} ${className} text-xs text-text-primary focus:outline-none focus:border-accent-primary flex items-center justify-between hover:bg-bg-elevated transition-colors`}
                type="button"
            >
                <span className="truncate pr-2">{selectedOption ? selectedOption.name : placeholder}</span>
                <ChevronDown size={14} className={`text-text-secondary transition-transform ${isOpen ? 'rotate-180' : ''}`} />
            </button>

            {isOpen && (
                <div className="absolute top-full right-0 mt-1 w-full bg-bg-elevated border border-border-subtle rounded-lg shadow-xl z-50 max-h-60 overflow-y-auto animated fadeIn">
                    <div className="p-1 space-y-0.5">
                        {options.map((option) => (
                            <button
                                key={option.id}
                                onClick={() => {
                                    onChange(option.id);
                                    setIsOpen(false);
                                }}
                                className={`w-full text-left px-3 py-2 text-xs rounded-md flex items-center justify-between group transition-colors ${value === option.id ? 'bg-bg-input hover:bg-bg-elevated text-text-primary' : 'text-text-secondary hover:bg-bg-input hover:text-text-primary'}`}
                                type="button"
                            >
                                <span className="truncate">{option.name}</span>
                                {value === option.id && <Check size={14} className="text-accent-primary shrink-0 ml-2" />}
                            </button>
                        ))}
                        {options.length === 0 && (
                            <div className="px-3 py-2 text-xs text-gray-500 italic">No models available</div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};

const CodexCliModelField: React.FC<{
    label: string;
    value: string;
    placeholder: string;
    onChange: (value: string) => void;
    onSelect: (value: string) => void;
    onSave: () => void;
}> = ({ label, value, placeholder, onChange, onSelect, onSave }) => (
    <label className="space-y-1">
        <span className="text-[10px] font-medium text-text-secondary uppercase tracking-wide">{label}</span>
        <div className="flex gap-2">
            <input
                value={value}
                onChange={e => onChange(e.target.value)}
                onBlur={onSave}
                className="min-w-0 flex-1 bg-bg-input border border-border-subtle rounded-lg px-3 py-2 text-xs text-text-primary font-mono focus:outline-none focus:border-accent-primary"
                placeholder={placeholder}
            />
            <ModelSelect
                value={value}
                options={value && !CODEX_CLI_MODEL_PRESETS.some(option => option.id === value)
                    ? [{ id: value, name: prettifyModelId(value) }, ...CODEX_CLI_MODEL_PRESETS]
                    : CODEX_CLI_MODEL_PRESETS}
                onChange={(modelId) => {
                    onChange(modelId);
                    onSelect(modelId);
                }}
                placeholder="Preset"
                className="py-2"
            />
        </div>
    </label>
);

export const AIProvidersSettings: React.FC = () => {
    const [generationPolicy, setGenerationPolicy] = useState<GenerationPolicy>({ ...DEFAULT_GENERATION_POLICY });
    const [generationPolicySaving, setGenerationPolicySaving] = useState(false);
    const [generationPolicyNotice, setGenerationPolicyNotice] = useState('');
    const [providerConfigurations, setProviderConfigurations] = useState<Record<LlmProvider, ProviderConfiguration>>({ ...LLM_PRESETS });
    // --- Standard Providers ---
    const [apiKey, setApiKey] = useState('');
    const [groqApiKey, setGroqApiKey] = useState('');
    const [openaiApiKey, setOpenaiApiKey] = useState('');
    const [claudeApiKey, setClaudeApiKey] = useState('');
    const [deepseekApiKey, setDeepseekApiKey] = useState('');

    // Status
    const [savedStatus, setSavedStatus] = useState<Record<string, boolean>>({});
    const [savingStatus, setSavingStatus] = useState<Record<string, boolean>>({});
    const [hasStoredKey, setHasStoredKey] = useState<Record<string, boolean>>({});
    const [testStatus, setTestStatus] = useState<Record<string, 'idle' | 'testing' | 'success' | 'error'>>({});
    const [testError, setTestError] = useState<Record<string, string>>({});
    const [credentialNotice, setCredentialNotice] = useState('');

    // --- Codex CLI ---
    const [codexCliConfig, setCodexCliConfig] = useState({ enabled: false, path: 'codex', model: 'gpt-5.4', fastModel: 'gpt-5.3-codex-spark', timeoutMs: 60000, sandboxMode: 'read-only' as string, serviceTier: 'default' as string | undefined, modelReasoningEffort: undefined as string | undefined });
    const [codexCliStatus, setCodexCliStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
    const [codexCliError, setCodexCliError] = useState('');

    // --- Default Model ---
    const [defaultModel, setDefaultModel] = useState<string>('gemini-3.1-flash-lite-preview');
    const [fastResponseMode, setFastResponseMode] = useState(false);
    const [credentialsLoaded, setCredentialsLoaded] = useState(false);
    const canUseFastMode = !!(hasStoredKey.groq || codexCliConfig.enabled);

    // --- Dynamic Model Discovery ---
    const [preferredModels, setPreferredModels] = useState<Record<string, string>>({});

    // --- Cloud Provider Data Scopes (fail-closed cloud share controls) ---
    const [providerDataScopes, setProviderDataScopes] = useState<{ transcript?: boolean; screenshots?: boolean; profile_history?: boolean; post_call_summary?: boolean }>({});

    // Load Initial Data
    useEffect(() => {
        const loadCredentials = async () => {
            try {
                setGenerationPolicy(await window.electronAPI.getGenerationPolicy());
                // Load credentials FIRST so canUseFastMode is correct before we set fastResponseMode.
                // If we set fastResponseMode before hasStoredKey is populated, the enforcement
                // effect below fires with canUseFastMode=false and immediately resets fast mode
                // to false — writing that reset back to SettingsManager on every startup.
                // @ts-ignore
                const creds = await window.electronAPI?.getStoredCredentials?.();
                if (creds) {
                    if (creds.providerConfigurations) setProviderConfigurations(creds.providerConfigurations);
                    setHasStoredKey({
                        gemini: creds.hasGeminiKey,
                        groq: creds.hasGroqKey,
                        openai: creds.hasOpenaiKey,
                        claude: creds.hasClaudeKey,
                        deepseek: creds.hasDeepseekKey || false
                    });
                    // Load preferred models
                    const pm: Record<string, string> = {};
                    if (creds.geminiPreferredModel) pm.gemini = creds.geminiPreferredModel;
                    if (creds.groqPreferredModel) pm.groq = creds.groqPreferredModel;
                    if (creds.openaiPreferredModel) pm.openai = creds.openaiPreferredModel;
                    if (creds.claudePreferredModel) pm.claude = creds.claudePreferredModel;
                    if (creds.deepseekPreferredModel) pm.deepseek = creds.deepseekPreferredModel;
                    setPreferredModels(pm);
                }

                // Now it's safe to read fast mode — hasStoredKey is already set so
                // canUseFastMode will be correct when the enforcement effect runs.
                // @ts-ignore
                const cliConfig = await window.electronAPI?.getCodexCliConfig?.();
                if (cliConfig) setCodexCliConfig(cliConfig as typeof codexCliConfig);

                const fastMode = await window.electronAPI?.getGroqFastTextMode();
                if (fastMode) setFastResponseMode(fastMode.enabled);

                // Mark credentials as fully loaded so the enforcement effect can fire
                setCredentialsLoaded(true);

                // Load persisted default model
                // @ts-ignore
                const result = await window.electronAPI?.getDefaultModel();
                if (result && result.model) {
                    setDefaultModel(result.model);
                }

            } catch (e) {
                console.error("Failed to load settings:", e);
                setCredentialsLoaded(true); // Unblock even on error
            }
        };
        loadCredentials();

        // Listen for changes from other windows (2-way sync)
        if (window.electronAPI?.onGroqFastTextChanged) {
            // @ts-ignore
            const unsubscribe = window.electronAPI.onGroqFastTextChanged((enabled: boolean) => {
                setFastResponseMode(enabled);
                localStorage.setItem('natively_groq_fast_text', String(enabled));
            });
            return () => unsubscribe();
        }
    }, []);

    // Effect to enforce fast mode disabled if neither a Groq key nor Codex CLI is configured.
    // Guard with credentialsLoaded so this never fires during the initial async load phase
    // (when hasStoredKey is still empty and canUseFastMode is incorrectly false).
    useEffect(() => {
        if (!credentialsLoaded) return;
        if (!canUseFastMode && fastResponseMode) {
            setFastResponseMode(false);
            localStorage.setItem('natively_groq_fast_text', 'false');
            // @ts-ignore
            window.electronAPI?.setGroqFastTextMode(false);
        }
    }, [credentialsLoaded, canUseFastMode, fastResponseMode]);

    // Load Cloud Provider Data Scopes and subscribe to cross-window changes
    useEffect(() => {
        window.electronAPI?.getProviderDataScopes?.().then(setProviderDataScopes).catch(() => { });
    }, []);

    useEffect(() => {
        if (window.electronAPI?.onProviderDataScopesChanged) {
            const unsubscribe = window.electronAPI.onProviderDataScopesChanged(setProviderDataScopes);
            return () => unsubscribe();
        }
    }, []);

    const saveCodexCliConfig = async (next = codexCliConfig) => {
        const normalized = { ...next, timeoutMs: Number(next.timeoutMs) || 60000 };
        setCodexCliConfig(normalized);
        const result = await window.electronAPI?.setCodexCliConfig?.(normalized);
        if (result?.config) setCodexCliConfig(result.config as typeof codexCliConfig);
        return result;
    };

    const handleTestCodexCli = async () => {
        setCodexCliStatus('testing');
        setCodexCliError('');
        try {
            const saveResult = await saveCodexCliConfig();
            const configToTest = saveResult?.config || codexCliConfig;
            const result = await window.electronAPI?.testCodexCli?.(configToTest);
            if (result?.success) {
                // If the main process auto-detected an install, reflect the
                // resolved path in the form so the user sees what got picked.
                if (result.config) setCodexCliConfig(result.config as typeof codexCliConfig);
                setCodexCliStatus('success');
                setTimeout(() => setCodexCliStatus('idle'), 3000);
            } else {
                setCodexCliStatus('error');
                setCodexCliError(result?.error || 'Codex CLI test failed');
            }
        } catch (e: any) {
            setCodexCliStatus('error');
            setCodexCliError(e.message || 'Codex CLI test failed');
        }
    };

    const handleSaveKey = async (provider: string, key: string, setter: (val: string) => void, draft?: ProviderConfiguration): Promise<CredentialSaveResult> => {
        if (!key.trim() && !hasStoredKey[provider]) return { ok: false, code: 'write_failed', message: 'Enter an API key before saving.' };
        setCredentialNotice('');
        setSavingStatus(prev => ({ ...prev, [provider]: true }));
        setSavedStatus(prev => ({ ...prev, [provider]: false }));
        try {
            const config = draft ?? providerConfigurations[provider as LlmProvider];
            const result = await window.electronAPI.setProviderConfiguration({ ...config, ...(key.trim() ? { apiKey: key } : {}) });

            if (result?.ok) {
                setProviderConfigurations(prev => ({ ...prev, [provider]: config }));
                let warning = result.warning;
                try {
                    const defaultSelection = await window.electronAPI.getDefaultModel();
                    if (defaultSelection?.model) setDefaultModel(defaultSelection.model);
                } catch {
                    // The save is already committed; a refresh failure must not claim rollback.
                    warning ||= 'Saved; reopen settings to refresh the default model.';
                }
                setPreferredModels(prev => ({ ...prev, [provider]: config.model }));
                setSavedStatus(prev => ({ ...prev, [provider]: true }));
                setHasStoredKey(prev => ({ ...prev, [provider]: true }));
                setter('');
                setTimeout(() => setSavedStatus(prev => ({ ...prev, [provider]: false })), 2000);
                setCredentialNotice(warning || '');
                return result;
            }
            const failed: CredentialSaveResult = result || { ok: false, code: 'write_failed', message: 'No save result was received.' };
            if (!failed.ok) setCredentialNotice(failed.message);
            return failed;
        } catch {
            const failed: CredentialSaveResult = { ok: false, code: 'write_failed', message: 'The API key could not be saved. The previous key was kept.' };
            setCredentialNotice(failed.message);
            return failed;
        } finally {
            setSavingStatus(prev => ({ ...prev, [provider]: false }));
        }
    };

    const handleRemoveKey = async (provider: string, setter: (val: string) => void) => {
        if (!confirm(`Are you sure you want to remove the ${provider} API key?`)) return;
        setCredentialNotice('');
        try {
            let result;
            // @ts-ignore
            if (provider === 'gemini') result = await window.electronAPI.setGeminiApiKey('');
            // @ts-ignore
            if (provider === 'groq') result = await window.electronAPI.setGroqApiKey('');
            // @ts-ignore
            if (provider === 'openai') result = await window.electronAPI.setOpenaiApiKey('');
            // @ts-ignore
            if (provider === 'claude') result = await window.electronAPI.setClaudeApiKey('');
            // @ts-ignore
            if (provider === 'deepseek') result = await window.electronAPI.setDeepseekApiKey('');

            if (result?.ok) {
                setHasStoredKey(prev => ({ ...prev, [provider]: false }));
                setter('');
                setCredentialNotice(result.warning || '');
            } else {
                setCredentialNotice(result?.message || 'The API key could not be removed.');
            }
        } catch {
            setCredentialNotice('The API key could not be removed. The previous key was kept.');
        }
    };

    const handleDefaultModelChange = async (model: string) => {
        setCredentialNotice('');
        try {
            const result = await window.electronAPI?.setDefaultModel(model);
            if (!result?.ok) {
                setCredentialNotice(result?.message || 'The default model could not be saved.');
                return;
            }
            setDefaultModel(model);
            setCredentialNotice(result.warning || '');
        } catch {
            setCredentialNotice('The default model could not be saved.');
        }
    };

    const handleTestConnection = async (provider: string, key: string) => {
        // Allow testing if key is provided OR if we have a stored key
        if (!key.trim() && !hasStoredKey[provider]) {
            return;
        }
        setTestStatus(prev => ({ ...prev, [provider]: 'testing' }));
        setTestError(prev => ({ ...prev, [provider]: '' }));

        try {
            // @ts-ignore
            const result = await window.electronAPI.testLlmConnection(provider);
            if (result.success) {
                setTestStatus(prev => ({ ...prev, [provider]: 'success' }));
                setTimeout(() => setTestStatus(prev => ({ ...prev, [provider]: 'idle' })), 3000);
            } else {
                setTestStatus(prev => ({ ...prev, [provider]: 'error' }));
                setTestError(prev => ({ ...prev, [provider]: result.error || 'Connection failed' }));
            }
        } catch (e: any) {
            setTestStatus(prev => ({ ...prev, [provider]: 'error' }));
            setTestError(prev => ({ ...prev, [provider]: e.message || 'Connection failed' }));
        }
    };


    const cloudModelOptions: ModelOption[] = [];
    for (const [provider, config] of Object.entries(STANDARD_CLOUD_MODELS)) {
        if (!hasStoredKey[provider]) continue;
        const target = providerConfigurations[provider as LlmProvider];
        if (!target.baseUrl) config.ids.forEach((model, index) => cloudModelOptions.push({ id: modelTargetId({ ...target, model }), name: config.names[index] }));
        const preferred = preferredModels[provider] ?? target.model;
        if (target.baseUrl || !config.ids.includes(preferred)) cloudModelOptions.push({ id: modelTargetId({ ...target, model: preferred }), name: `${prettifyModelId(preferred)} (${provider})` });
    }

    return (
        <div className="space-y-5 animated fadeIn pb-10">
            <section className="space-y-3 rounded-xl border border-border-subtle p-5">
                <h3 className="text-sm font-bold text-text-primary">Generation limits</h3>
                <p className="text-xs text-text-secondary">At most two sends per request. Switching manually cancels the current request and keeps its partial output. A backup can receive the same request data and incur additional costs, subject to current privacy settings. First-token timeout ends the request without extra backup time; hidden reasoning may consume that budget before any visible text.</p>
                <label className="block text-xs text-text-secondary">Backup model
                    <select className="block bg-bg-input border border-border-subtle rounded-lg p-2 text-text-primary" value={generationPolicy.backupModel ?? ''} onChange={event => setGenerationPolicy({ ...generationPolicy, backupModel: event.target.value || undefined })}>
                        <option value="">None — retry the same model only for a transient failure</option>
                        {cloudModelOptions.filter(option => option.id !== defaultModel).map(option => <option key={option.id} value={option.id}>{option.name}</option>)}
                    </select>
                </label>
                {([
                    ['interviewFirstTokenSeconds', 'Interview first visible text (seconds)'],
                    ['interviewTotalSeconds', 'Interview total (seconds)'],
                    ['writtenTotalSeconds', 'Written answer total (seconds)'],
                ] as const).map(([key, label]) => <label key={key} className="block text-xs text-text-secondary">{label}
                    <input className="block bg-bg-input border border-border-subtle rounded-lg p-2 text-text-primary" type="number" min="0" step="any" value={Number.isFinite(generationPolicy[key]) ? generationPolicy[key] : ''} onChange={event => setGenerationPolicy({ ...generationPolicy, [key]: event.target.value ? Number(event.target.value) : NaN })} />
                </label>)}
                <p className="text-xs text-text-secondary">Background summaries and transcript compression: 180 seconds, with no first-token deadline.</p>
                <button type="button" disabled={generationPolicySaving} className="text-xs text-accent-primary disabled:opacity-50" onClick={async () => {
                    setGenerationPolicySaving(true); setGenerationPolicyNotice('');
                    try {
                        const result = await window.electronAPI.setGenerationPolicy(generationPolicy);
                        setGenerationPolicyNotice(result.ok ? result.warning ?? 'Saved' : result.message);
                    } catch (error) { setGenerationPolicyNotice(error instanceof Error ? error.message : 'Could not save'); }
                    finally { setGenerationPolicySaving(false); }
                }}>{generationPolicySaving ? 'Saving…' : 'Save generation limits'}</button>
                {generationPolicyNotice && <p role="status" className="text-xs text-text-secondary">{generationPolicyNotice}</p>}
            </section>
            {credentialNotice && <p role="alert" className="text-xs text-amber-500">{credentialNotice}</p>}
            {/* Default Model for Chat */}
            <div className="space-y-5">
                <div>
                    <h3 className="text-sm font-bold text-text-primary mb-1">Default Model for Chat</h3>
                    <p className="text-xs text-text-secondary mb-2">Primary model for new requests. Only an explicitly selected backup may replace it.</p>
                </div>

                <div className="bg-bg-item-surface rounded-xl p-5 border border-border-subtle flex items-center justify-between">
                    <div>
                        <label className="block text-xs font-medium text-text-primary uppercase tracking-wide mb-0">Active Model</label>
                        <p className="text-[10px] text-text-secondary">Applies to new chats instantly.</p>
                    </div>
                    <ModelSelect
                        value={defaultModel}
                        options={(() => {
                            const opts: { id: string; name: string }[] = [];

                            opts.push(...cloudModelOptions);
                            if (codexCliConfig.enabled) {
                                opts.push({ id: CODEX_CLI_MODEL.id, name: `${CODEX_CLI_MODEL.name} (${prettifyModelId(codexCliConfig.model)})` });
                                CODEX_CLI_MODEL_PRESETS.forEach(model => {
                                    const id = codexCliSelectorId(model.id);
                                    if (!opts.find(o => o.id === id)) {
                                        opts.push({ id, name: `${CODEX_CLI_MODEL.name}: ${model.name}` });
                                    }
                                });
                            }

                            if (defaultModel && !opts.find(o => o.id === defaultModel)) {
                                opts.unshift({ id: defaultModel, name: prettifyModelId(defaultModel) });
                            }
                            return opts;
                        })()}
                        onChange={handleDefaultModelChange}
                    />
                </div>

                {/* Fast Response Mode */}
                <div
                    className={`bg-bg-item-surface rounded-xl p-5 border border-border-subtle flex items-center justify-between gap-4 ${!canUseFastMode ? 'opacity-50 grayscale' : ''}`}
                    title={!canUseFastMode ? "Requires Groq or Codex CLI to be configured" : ""}
                >
                    <div className="flex-1">
                        <div className="flex items-center gap-2">
                            <label className="block text-xs font-medium text-text-primary uppercase tracking-wide mb-0">Fast Response Mode</label>
                            <span className="bg-orange-500/10 text-orange-500 text-[9px] font-bold px-1.5 py-0.5 rounded border border-orange-500/20">NEW</span>
                        </div>
                        <p className="text-[10px] text-text-secondary mt-0.5">Applies to selected Groq and Codex CLI models. Groq keeps your selected model; Codex CLI uses its configured Fast Model. Other model selections are not overridden.</p>
                        {!canUseFastMode && (
                            <p className="text-[10px] text-orange-500 mt-0.5 font-medium">Requires Groq or Codex CLI to be configured.</p>
                        )}
                    </div>
                    <div
                        onClick={async () => {
                            if (!canUseFastMode) {
                                alert("Please configure Groq or Codex CLI first to enable Fast Response Mode.");
                                return;
                            }
                            const newState = !fastResponseMode;
                            setFastResponseMode(newState);
                            localStorage.setItem('natively_groq_fast_text', String(newState));
                            // @ts-ignore
                            await window.electronAPI?.setGroqFastTextMode(newState);
                        }}
                        className={`shrink-0 w-11 h-6 rounded-full relative cursor-pointer transition-colors ${!canUseFastMode ? 'cursor-not-allowed bg-bg-toggle-switch' : fastResponseMode ? 'bg-orange-500' : 'bg-bg-toggle-switch border border-border-muted'}`}
                    >
                        <div className={`absolute top-1 left-1 w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${fastResponseMode ? 'translate-x-5' : 'translate-x-0'}`} />
                    </div>
                </div>
            </div>

            {/* Cloud Providers */}
            <div className="space-y-5">
                <div>
                    <h3 className="text-sm font-bold text-text-primary mb-1">Cloud Providers</h3>
                    <p className="text-xs text-text-secondary mb-2">Add API keys to unlock cloud AI models.</p>
                </div>

                <div className="space-y-4">

                    {/* Gemini */}
                    <ProviderCard
                        providerId="gemini"
                        configuration={providerConfigurations.gemini}
                        providerName="Gemini"
                        apiKey={apiKey}
                        preferredModel={preferredModels.gemini}
                        hasStoredKey={!!hasStoredKey.gemini}
                        onKeyChange={setApiKey}
                        onSaveKey={(draft) => handleSaveKey('gemini', apiKey, setApiKey, draft)}
                        onRemoveKey={() => handleRemoveKey('gemini', setApiKey)}
                        onTestConnection={() => handleTestConnection('gemini', apiKey)}
                        testStatus={testStatus.gemini || 'idle'}
                        testError={testError.gemini}
                        savingStatus={!!savingStatus.gemini}
                        savedStatus={!!savedStatus.gemini}
                        keyPlaceholder="AIzaSy..."
                        keyUrl="https://aistudio.google.com/app/apikey"
                        onPreferredModelChange={(model) => setPreferredModels(prev => ({ ...prev, gemini: model }))}
                    />

                    {/* Groq */}
                    <ProviderCard
                        providerId="groq"
                        configuration={providerConfigurations.groq}
                        providerName="Groq"
                        apiKey={groqApiKey}
                        preferredModel={preferredModels.groq}
                        hasStoredKey={!!hasStoredKey.groq}
                        onKeyChange={setGroqApiKey}
                        onSaveKey={(draft) => handleSaveKey('groq', groqApiKey, setGroqApiKey, draft)}
                        onRemoveKey={() => handleRemoveKey('groq', setGroqApiKey)}
                        onTestConnection={() => handleTestConnection('groq', groqApiKey)}
                        testStatus={testStatus.groq || 'idle'}
                        testError={testError.groq}
                        savingStatus={!!savingStatus.groq}
                        savedStatus={!!savedStatus.groq}
                        keyPlaceholder="gsk_..."
                        keyUrl="https://console.groq.com/keys"
                        onPreferredModelChange={(model) => setPreferredModels(prev => ({ ...prev, groq: model }))}
                    />

                    {/* OpenAI */}
                    <ProviderCard
                        providerId="openai"
                        configuration={providerConfigurations.openai}
                        providerName="OpenAI"
                        apiKey={openaiApiKey}
                        preferredModel={preferredModels.openai}
                        hasStoredKey={!!hasStoredKey.openai}
                        onKeyChange={setOpenaiApiKey}
                        onSaveKey={(draft) => handleSaveKey('openai', openaiApiKey, setOpenaiApiKey, draft)}
                        onRemoveKey={() => handleRemoveKey('openai', setOpenaiApiKey)}
                        onTestConnection={() => handleTestConnection('openai', openaiApiKey)}
                        testStatus={testStatus.openai || 'idle'}
                        testError={testError.openai}
                        savingStatus={!!savingStatus.openai}
                        savedStatus={!!savedStatus.openai}
                        keyPlaceholder="sk-..."
                        keyUrl="https://platform.openai.com/api-keys"
                        onPreferredModelChange={(model) => setPreferredModels(prev => ({ ...prev, openai: model }))}
                    />

                    {/* Claude */}
                    <ProviderCard
                        providerId="claude"
                        configuration={providerConfigurations.claude}
                        providerName="Claude"
                        apiKey={claudeApiKey}
                        preferredModel={preferredModels.claude}
                        hasStoredKey={!!hasStoredKey.claude}
                        onKeyChange={setClaudeApiKey}
                        onSaveKey={(draft) => handleSaveKey('claude', claudeApiKey, setClaudeApiKey, draft)}
                        onRemoveKey={() => handleRemoveKey('claude', setClaudeApiKey)}
                        onTestConnection={() => handleTestConnection('claude', claudeApiKey)}
                        testStatus={testStatus.claude || 'idle'}
                        testError={testError.claude}
                        savingStatus={!!savingStatus.claude}
                        savedStatus={!!savedStatus.claude}
                        keyPlaceholder="sk-ant-..."
                        keyUrl="https://console.anthropic.com/settings/keys"
                        onPreferredModelChange={(model) => setPreferredModels(prev => ({ ...prev, claude: model }))}
                    />

                    {/* DeepSeek — text-only; intentionally not part of the screenshot/vision fallback chain. */}
                    <ProviderCard
                        providerId="deepseek"
                        configuration={providerConfigurations.deepseek}
                        providerName="DeepSeek"
                        apiKey={deepseekApiKey}
                        preferredModel={preferredModels.deepseek}
                        hasStoredKey={!!hasStoredKey.deepseek}
                        onKeyChange={setDeepseekApiKey}
                        onSaveKey={(draft) => handleSaveKey('deepseek', deepseekApiKey, setDeepseekApiKey, draft)}
                        onRemoveKey={() => handleRemoveKey('deepseek', setDeepseekApiKey)}
                        onTestConnection={() => handleTestConnection('deepseek', deepseekApiKey)}
                        testStatus={testStatus.deepseek || 'idle'}
                        testError={testError.deepseek}
                        savingStatus={!!savingStatus.deepseek}
                        savedStatus={!!savedStatus.deepseek}
                        keyPlaceholder="sk-..."
                        keyUrl="https://platform.deepseek.com/api_keys"
                        onPreferredModelChange={(model) => setPreferredModels(prev => ({ ...prev, deepseek: model }))}
                    />

                </div>
            </div>

            {/* Codex CLI Provider: the CLI runs on this Mac, the model runs at OpenAI */}
            <div className="space-y-5">
                <div>
                    <h3 className="text-sm font-bold text-text-primary mb-1">Codex CLI</h3>
                    <p className="text-xs text-text-secondary">Route text and screenshot responses through the Codex CLI signed in on this Mac. The CLI sends your prompts, transcript context and screenshots to OpenAI for processing.</p>
                </div>

                <div className="bg-bg-item-surface rounded-xl p-5 border border-border-subtle space-y-4">
                    <div className="flex items-center justify-between">
                        <div>
                            <label className="block text-xs font-medium text-text-primary uppercase tracking-wide mb-0">Enable Codex CLI</label>
                            <p className="text-[10px] text-text-secondary">Adds Codex CLI as a selectable cloud backend and fallback.</p>
                        </div>
                        <button
                            type="button"
                            onClick={async () => {
                                const next = { ...codexCliConfig, enabled: !codexCliConfig.enabled };
                                await saveCodexCliConfig(next);
                            }}
                            className={`w-11 h-6 rounded-full relative transition-colors ${codexCliConfig.enabled ? 'bg-accent-primary' : 'bg-bg-toggle-switch border border-border-muted'}`}
                        >
                            <span className={`absolute top-1 left-1 w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${codexCliConfig.enabled ? 'translate-x-5' : 'translate-x-0'}`} />
                        </button>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <label className="space-y-1">
                            <span className="text-[10px] font-medium text-text-secondary uppercase tracking-wide">Executable</span>
                            <input
                                value={codexCliConfig.path}
                                onChange={e => setCodexCliConfig(prev => ({ ...prev, path: e.target.value }))}
                                onBlur={() => saveCodexCliConfig()}
                                className="w-full bg-bg-input border border-border-subtle rounded-lg px-3 py-2 text-xs text-text-primary font-mono focus:outline-none focus:border-accent-primary"
                                placeholder="codex"
                            />
                        </label>
                        <label className="space-y-1">
                            <span className="text-[10px] font-medium text-text-secondary uppercase tracking-wide">Timeout (ms)</span>
                            <input
                                type="number"
                                value={codexCliConfig.timeoutMs}
                                onChange={e => setCodexCliConfig(prev => ({ ...prev, timeoutMs: Number(e.target.value) }))}
                                onBlur={() => saveCodexCliConfig()}
                                className="w-full bg-bg-input border border-border-subtle rounded-lg px-3 py-2 text-xs text-text-primary font-mono focus:outline-none focus:border-accent-primary"
                                min={1000}
                            />
                        </label>
                        <CodexCliModelField
                            label="Normal Model"
                            value={codexCliConfig.model}
                            placeholder="gpt-5.5"
                            onChange={(model) => setCodexCliConfig(prev => ({ ...prev, model }))}
                            onSelect={(model) => saveCodexCliConfig({ ...codexCliConfig, model })}
                            onSave={() => saveCodexCliConfig()}
                        />
                        <CodexCliModelField
                            label="Fast Model"
                            value={codexCliConfig.fastModel}
                            placeholder="gpt-5.3-codex-spark"
                            onChange={(fastModel) => setCodexCliConfig(prev => ({ ...prev, fastModel }))}
                            onSelect={(fastModel) => saveCodexCliConfig({ ...codexCliConfig, fastModel })}
                            onSave={() => saveCodexCliConfig()}
                        />
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <label className="space-y-1">
                            <span className="text-[10px] font-medium text-text-secondary uppercase tracking-wide">Service Tier</span>
                            <ModelSelect
                                value={codexCliConfig.serviceTier ?? 'default'}
                                options={CODEX_SERVICE_TIERS.map(t => ({ id: t, name: t.charAt(0).toUpperCase() + t.slice(1) }))}
                                onChange={(serviceTier) => saveCodexCliConfig({ ...codexCliConfig, serviceTier: serviceTier as typeof CODEX_SERVICE_TIERS[number] })}
                                placeholder="default"
                            />
                            <p className="text-[9px] text-text-tertiary">Use faster service tier if available. Codex Cloud only.</p>
                        </label>
                        <label className="space-y-1">
                            <span className="text-[10px] font-medium text-text-secondary uppercase tracking-wide">Reasoning Effort</span>
                            <ModelSelect
                                value={codexCliConfig.modelReasoningEffort ?? ''}
                                options={[
                                    { id: '', name: 'None' },
                                    ...CODEX_MODEL_REASONING_EFFORTS.map(e => ({ id: e, name: e.charAt(0).toUpperCase() + e.slice(1) })),
                                ]}
                                onChange={(effort) => saveCodexCliConfig({ ...codexCliConfig, modelReasoningEffort: effort || undefined })}
                                placeholder="None"
                            />
                            <p className="text-[9px] text-text-tertiary">How much reasoning effort the model uses. Model-dependent.</p>
                        </label>
                    </div>

                    <div className="flex items-center justify-between gap-3">
                        <div className="min-h-5">
                            {codexCliStatus === 'success' && (
                                <div className="flex items-center gap-2 text-xs text-green-400">
                                    <CheckCircle size={14} />
                                    <span>Codex CLI detected</span>
                                </div>
                            )}
                            {codexCliStatus === 'error' && (
                                <div className="flex items-center gap-2 text-xs text-red-400">
                                    <AlertCircle size={14} />
                                    <span>{codexCliError}</span>
                                </div>
                            )}
                        </div>
                        <button
                            type="button"
                            onClick={handleTestCodexCli}
                            disabled={codexCliStatus === 'testing'}
                            className="flex items-center gap-2 px-3 py-1.5 bg-bg-input hover:bg-bg-elevated border border-border-subtle rounded-lg text-xs font-medium text-text-primary transition-colors disabled:opacity-60"
                        >
                            {codexCliStatus === 'testing' ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle size={14} />}
                            Test CLI
                        </button>
                    </div>
                </div>
            </div>

            <div className="space-y-2">
                <h3 className="text-sm font-bold text-text-primary">Screen input</h3>
                <p className="text-xs text-text-secondary">Original screenshots go directly to the selected model, with only your explicit backup eligible for retry. Enable Screenshots below to share them; no separate generative screen analysis is run.</p>
            </div>

            {/* Cloud Provider Data Scopes — fail-closed cloud share controls */}
            <div className="space-y-5">
                <div>
                    <h3 className="text-sm font-bold text-text-primary mb-1">Cloud provider data scopes</h3>
                    <p className="text-xs text-text-secondary mb-2">Control what data cloud AI providers can access. Disabled types are left out of requests.</p>
                    <p className="text-[10px] text-text-secondary mb-2">Profile history covers your persona and notes, saved meetings (including asking about a past meeting), and the separate list of earlier answers. Answers within the current conversation are part of its transcript.</p>
                </div>
                <div className="bg-bg-item-surface rounded-xl p-4 border border-border-subtle flex flex-col gap-2">
                    {([
                        { key: 'transcript', label: 'Transcripts' },
                        { key: 'screenshots', label: 'Screenshots' },
                        { key: 'profile_history', label: 'Profile history' },
                        { key: 'post_call_summary', label: 'Post-call summaries' },
                    ] as const).map(({ key, label }) => {
                        const allowed = providerDataScopes[key] !== false;
                        return (
                            <div key={key} className="flex items-center justify-between">
                                <span className="text-xs text-text-secondary">{label}</span>
                                <div
                                    onClick={() => {
                                        const next = { ...providerDataScopes, [key]: !allowed };
                                        setProviderDataScopes(next);
                                        window.electronAPI?.setProviderDataScopes?.(next);
                                    }}
                                    className={`w-9 h-5 rounded-full relative transition-colors cursor-pointer ${allowed ? 'bg-emerald-500' : 'bg-bg-toggle-switch border border-border-muted'}`}
                                    role="switch"
                                    aria-checked={allowed}
                                    aria-label={`Allow ${label} to cloud providers`}
                                >
                                    <div className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${allowed ? 'translate-x-4' : 'translate-x-0'}`} />
                                </div>
                            </div>
                        );
                    })}
                    <div className="flex items-start gap-2 mt-1 pt-3 border-t border-border-subtle">
                        <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-text-tertiary shrink-0 mt-0.5"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>
                        <p className="text-[11px] text-text-tertiary leading-relaxed">When a data type is disabled, it is left out of every request to a cloud provider. There is no local model to fall back to.</p>
                    </div>
                </div>
            </div>
        </div>
    );
};
