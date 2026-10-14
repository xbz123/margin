import { LLM_PRESETS, modelTargetId, type ProviderConfiguration, type LlmProvider } from '../../types/llmTarget';
import { APP_NAME } from '../../appIdentity';
import React, { useState, useEffect } from 'react';
import { AlertCircle, CheckCircle, ChevronDown, Check, RefreshCw, ExternalLink, Loader2 } from 'lucide-react';
import { CODEX_CLI_MODEL, CODEX_CLI_MODEL_PRESETS, codexCliSelectorId, STANDARD_CLOUD_MODELS, prettifyModelId } from '../../utils/modelUtils';
import { ProviderCard } from './ProviderCard';
import { useI18n } from '../../i18n';
import type { CredentialSaveResult } from '../../types/credentialSave';
import { DEFAULT_GENERATION_POLICY, type GenerationPolicy } from '../../types/generationPolicy';
import { imageSupportTarget, knownModelImageSupport } from '../../types/modelImageSupport';
import { CODEX_RISK_VERSION, DEFAULT_CODEX_SOURCE_CONFIG, codexImageTarget, codexSourceAvailable, type CodexSourceConfig, type CodexSourceUpdate } from '../../types/codexSource';

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
    const { t } = useI18n();
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
                <span className="truncate pr-2">{selectedOption ? selectedOption.name : t(placeholder)}</span>
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
                            <div className="px-3 py-2 text-xs text-gray-500 italic">{t('No models available')}</div>
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
    const { t } = useI18n();
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
    const [codexCliConfig, setCodexCliConfig] = useState<CodexSourceConfig>({ ...DEFAULT_CODEX_SOURCE_CONFIG });
    const [codexRiskAccepted, setCodexRiskAccepted] = useState(false);
    const [codexCliStatus, setCodexCliStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
    const [codexCliError, setCodexCliError] = useState('');
    const codexOperation = React.useRef(0);

    // --- Default Model ---
    const [defaultModel, setDefaultModel] = useState<string>('gemini-3.1-flash-lite-preview');
    const [fastResponseMode, setFastResponseMode] = useState(false);
    const [credentialsLoaded, setCredentialsLoaded] = useState(false);
    const canUseFastMode = !!(hasStoredKey.groq || codexSourceAvailable(codexCliConfig));

    // --- Dynamic Model Discovery ---
    const [preferredModels, setPreferredModels] = useState<Record<string, string>>({});

    // --- Cloud Provider Data Scopes (fail-closed cloud share controls) ---
    const [providerDataScopes, setProviderDataScopes] = useState<{ transcript?: boolean; screenshots?: boolean; profile_history?: boolean }>({});

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
                if (cliConfig) { setCodexCliConfig(cliConfig); setCodexRiskAccepted(codexSourceAvailable(cliConfig)); }

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

    const saveCodexCliConfig = async (next: CodexSourceUpdate = codexCliConfig) => {
        const operation = ++codexOperation.current;
        const { riskConfirmedVersion: _ignored, ...update } = next as CodexSourceConfig & CodexSourceUpdate;
        const result = await window.electronAPI?.setCodexCliConfig?.(update);
        if (operation !== codexOperation.current) return result;
        if (result?.config) setCodexCliConfig(result.config as typeof codexCliConfig);
        if (result?.config) setCodexRiskAccepted(codexSourceAvailable(result.config));
        setCodexCliStatus(result?.success ? 'idle' : 'error');
        setCodexCliError(result?.error ?? '');
        if (!result?.success && !result?.config) { const saved = await window.electronAPI?.getCodexCliConfig?.(); if (saved) setCodexCliConfig(saved); }
        return result;
    };

    const handleTestCodexCli = async () => {
        const operation = ++codexOperation.current;
        setCodexCliStatus('testing');
        setCodexCliError('');
        try {
            const result = await window.electronAPI?.testCodexCli?.();
            if (operation !== codexOperation.current) return;
            if (result?.success) {
                setCodexCliStatus('success');
            } else {
                setCodexCliStatus('error');
                setCodexCliError(result?.message || 'Local file check failed');
            }
        } catch (e: any) {
            if (operation !== codexOperation.current) return;
            setCodexCliStatus('error');
            setCodexCliError('Local file check failed. Service connectivity is unverified.');
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
        if (!confirm(t('Are you sure you want to remove the {provider} API key?', { provider }))) return;
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
    if (codexSourceAvailable(codexCliConfig)) {
        cloudModelOptions.push({ id: 'codex-cli', name: t('Codex login source (configured model)') });
        for (const model of new Set([codexCliConfig.model, codexCliConfig.fastModel])) cloudModelOptions.push({ id: codexCliSelectorId(model), name: t('{model} (Codex login source, unverified availability)', { model }) });
    }
    for (const [provider, config] of Object.entries(STANDARD_CLOUD_MODELS)) {
        if (!hasStoredKey[provider]) continue;
        const target = providerConfigurations[provider as LlmProvider];
        if (!target.baseUrl) config.ids.forEach((model, index) => cloudModelOptions.push({ id: modelTargetId({ ...target, model }), name: config.names[index] }));
        const preferred = preferredModels[provider] ?? target.model;
        if (target.baseUrl || !config.ids.includes(preferred)) cloudModelOptions.push({ id: modelTargetId({ ...target, model: preferred }), name: `${prettifyModelId(preferred)} (${provider})` });
    }

    return (
        <div className="space-y-5 animated fadeIn pb-10">
            <section className="space-y-4 rounded-xl border border-border-subtle p-5">
                <div>
                    <h3 className="text-sm font-bold text-text-primary mb-1">{t('Answer models')}</h3>
                    <p className="text-xs text-text-secondary">{t('The primary model answers every request. The optional backup is tried only after a failed send; it receives the same request data under your privacy settings and may add cost. Reasoning set in a provider below applies only to that provider\'s configured model; other listed models use provider defaults.')}</p>
                </div>
                <div className="flex items-center justify-between gap-4">
                    <label className="block text-xs font-medium text-text-primary uppercase tracking-wide">{t('Primary model')}</label>
                    <ModelSelect
                        value={defaultModel}
                        options={(() => {
                            const opts: { id: string; name: string }[] = [];

                            opts.push(...cloudModelOptions);
                            if (codexSourceAvailable(codexCliConfig)) {
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
                <label className="flex items-center justify-between gap-4 text-xs font-medium text-text-primary uppercase tracking-wide">{t('Backup model')}
                    <select className="w-40 bg-bg-input border border-border-subtle rounded-lg px-3 py-1.5 text-xs text-text-primary normal-case font-normal" value={generationPolicy.backupModel ?? ''} onChange={event => setGenerationPolicy({ ...generationPolicy, backupModel: event.target.value || undefined, backupImageSupportConfirmedFor: undefined })}>
                        <option value="">{t('None — retry the same model only for a transient failure')}</option>
                        {cloudModelOptions.filter(option => option.id !== defaultModel).map(option => <option key={option.id} value={option.id}>{option.name}</option>)}
                    </select>
                </label>
                {(() => {
                    if (generationPolicy.backupModel?.startsWith('codex-cli')) {
                        const model = generationPolicy.backupModel.startsWith('codex-cli:') ? generationPolicy.backupModel.slice(10) : codexCliConfig.model;
                        const binding = codexImageTarget(model);
                        return <label className="block text-xs text-text-secondary"><input type="checkbox" aria-label={t('Backup model supports images')}
                            checked={generationPolicy.backupImageSupportConfirmedFor === binding}
                            onChange={event => setGenerationPolicy({ ...generationPolicy, backupImageSupportConfirmedFor: event.target.checked ? binding : undefined })} /> {t('Backup Codex model supports images')}
                            <span className="block text-[10px]">{t('Independent backend/model confirmation; not inferred from the OpenAI API. Verify capability yourself.')}</span></label>;
                    }
                    const match = /^llm-target:(gemini|groq|openai|claude|deepseek):(gemini|chat-completions|responses|messages):(.+)$/.exec(generationPolicy.backupModel ?? '');
                    if (!match) return null;
                    const config = { ...providerConfigurations[match[1] as LlmProvider], model: decodeURIComponent(match[3]) };
                    let binding: string;
                    try { if (knownModelImageSupport(config) !== undefined) return null; binding = imageSupportTarget(config); } catch { return null; }
                    return <label className="block text-xs text-text-secondary"><input type="checkbox" aria-label={t('Backup model supports images')}
                        checked={generationPolicy.backupImageSupportConfirmedFor === binding}
                        onChange={event => setGenerationPolicy({ ...generationPolicy, backupImageSupportConfirmedFor: event.target.checked ? binding : undefined })} /> {t('Backup model supports images')}
                        <span className="block text-[10px]">{t("Check this backup model's provider documentation yourself. This confirmation is independent of the primary model and resets for a changed target.")}</span>
                    </label>;
                })()}
                <div>
                    <h4 className="text-xs font-medium text-text-primary uppercase tracking-wide mb-2">{t('Generation limits')}</h4>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                        {([
                            ['interviewFirstTokenSeconds', 'Interview first visible text (seconds)'],
                            ['interviewTotalSeconds', 'Interview total (seconds)'],
                            ['writtenTotalSeconds', 'Written answer total (seconds)'],
                        ] as const).map(([key, label]) => <label key={key} className="block text-xs text-text-secondary">{t(label)}
                            <input className="block w-full mt-1 bg-bg-input border border-border-subtle rounded-lg p-2 text-text-primary" type="number" min="0" step="any" value={Number.isFinite(generationPolicy[key]) ? generationPolicy[key] : ''} onChange={event => setGenerationPolicy({ ...generationPolicy, [key]: event.target.value ? Number(event.target.value) : NaN })} />
                        </label>)}
                    </div>
                    <p className="text-[10px] text-text-secondary mt-2">{t('At most two sends per request. Switching models manually cancels the current request and keeps its partial output. The first-visible-text timeout ends the request without extra backup time; hidden reasoning may use that time before any visible text.')}</p>
                </div>
                <button type="button" disabled={generationPolicySaving} className="text-xs text-accent-primary disabled:opacity-50" onClick={async () => {
                    setGenerationPolicySaving(true); setGenerationPolicyNotice('');
                    try {
                        const result = await window.electronAPI.setGenerationPolicy(generationPolicy);
                        setGenerationPolicyNotice(result.ok ? result.warning ?? 'Saved' : result.message);
                    } catch (error) { setGenerationPolicyNotice(error instanceof Error ? error.message : 'Could not save'); }
                    finally { setGenerationPolicySaving(false); }
                }}>{t(generationPolicySaving ? 'Saving…' : 'Save backup and time limits')}</button>
                {generationPolicyNotice && <p role="status" className="text-xs text-text-secondary">{t(generationPolicyNotice)}</p>}
            </section>
            {credentialNotice && <p role="alert" className="text-xs text-amber-500">{t(credentialNotice)}</p>}
            <div className="space-y-5">
                {/* Fast Response Mode */}
                <div
                    className={`bg-bg-item-surface rounded-xl p-5 border border-border-subtle flex items-center justify-between gap-4 ${!canUseFastMode ? 'opacity-50 grayscale' : ''}`}
                    title={!canUseFastMode ? t("Requires Groq or Codex CLI to be configured") : ""}
                >
                    <div className="flex-1">
                        <div className="flex items-center gap-2">
                            <label className="block text-xs font-medium text-text-primary uppercase tracking-wide mb-0">{t('Fast Response Mode')}</label>
                            <span className="bg-orange-500/10 text-orange-500 text-[9px] font-bold px-1.5 py-0.5 rounded border border-orange-500/20">{t('NEW')}</span>
                        </div>
                        <p className="text-[10px] text-text-secondary mt-0.5">{t('Applies to selected Groq and Codex CLI models. Groq keeps your selected model; Codex CLI uses its configured Fast Model. Other model selections are not overridden.')}</p>
                        {!canUseFastMode && (
                            <p className="text-[10px] text-orange-500 mt-0.5 font-medium">{t('Requires Groq or Codex CLI to be configured.')}</p>
                        )}
                    </div>
                    <div
                        onClick={async () => {
                            if (!canUseFastMode) {
                                alert(t("Please configure Groq or Codex CLI first to enable Fast Response Mode."));
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
                    <h3 className="text-sm font-bold text-text-primary mb-1">{t('Cloud Providers')}</h3>
                    <p className="text-xs text-text-secondary mb-2">{t('Add API keys to unlock cloud AI models.')}</p>
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

            {/* Existing CLI login file only; generation never invokes the CLI. */}
            <div className="space-y-5">
                <div>
                    <h3 className="text-sm font-bold text-text-primary mb-1">{t('Codex login source (file only)')}</h3>
                    <p className="text-xs text-text-secondary">{t('Reads an existing CLI login file without executing the CLI, refreshing or writing tokens. Keyring and ephemeral storage are unsupported; do not downgrade storage. Requests use a fixed third-party-unpromised ChatGPT backend, not the public API. No real-service verification has been performed.')}</p>
                </div>

                <div className="bg-bg-item-surface rounded-xl p-5 border border-border-subtle space-y-4">
                    <div className="flex items-center justify-between">
                        <div>
                            <label className="block text-xs font-medium text-text-primary uppercase tracking-wide mb-0">{t('Enable Codex login source')}</label>
                            <p className="text-[10px] text-text-secondary">{t('Selecting a model does not check or read the login file.')}</p>
                        </div>
                        <button
                            type="button"
                            onClick={async () => {
                                const next = { ...codexCliConfig, enabled: !codexCliConfig.enabled, ...(!codexCliConfig.enabled ? { acceptRisk: codexRiskAccepted } : {}) };
                                await saveCodexCliConfig(next);
                            }}
                            aria-label={t('Enable Codex login source')}
                            disabled={!codexCliConfig.enabled && !codexRiskAccepted}
                            className={`w-11 h-6 rounded-full relative transition-colors ${codexCliConfig.enabled ? 'bg-accent-primary' : 'bg-bg-toggle-switch border border-border-muted'}`}
                        >
                            <span className={`absolute top-1 left-1 w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${codexCliConfig.enabled ? 'translate-x-5' : 'translate-x-0'}`} />
                        </button>
                    </div>

                    <label className="block text-xs text-text-secondary"><input type="checkbox" aria-label={t('Accept Codex login-source risks')} checked={codexRiskAccepted}
                        onChange={async event => { setCodexRiskAccepted(event.target.checked); if (!event.target.checked && codexCliConfig.enabled) await saveCodexCliConfig({ enabled: false }); }} /> {t('I explicitly accept risk version {version}.', { version: CODEX_RISK_VERSION })} {codexCliConfig.riskConfirmedVersion === CODEX_RISK_VERSION ? t('Current version is saved; disabling withdraws consent.') : ''}</label>
                    <ul className="list-disc pl-5 space-y-1 text-[10px] text-text-secondary">
                        <li>{t('OpenAI has not explicitly authorized this third-party use. The interface may change or fail; the account may be rate-limited, restricted or suspended. Your consent is not provider authorization.')}</li>
                        <li>{t('Requests consume plan quota and remain subject to your plan terms. Prompts, transcripts, screenshots and reference context go to the cloud under current data scopes; an invisible window does not prevent uploads.')}</li>
                        <li>{t('Credentials never enter ordinary settings or logs. Margin does not refresh or write them. Expired login requires external sign-in; a supported API-key source is the alternative.')}</li>
                    </ul>
                    <p className="text-[10px] text-text-secondary">{t('Uses the shared Generation limits above. No server output-token cap is claimed. Model availability, service tier and reasoning settings are unverified; the backend may reject them. Rejected settings are never silently removed or rerouted.')}</p>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <CodexCliModelField
                            label={t('Normal Model')}
                            value={codexCliConfig.model}
                            placeholder="gpt-5.5"
                            onChange={(model) => setCodexCliConfig(prev => ({ ...prev, model }))}
                            onSelect={(model) => saveCodexCliConfig({ ...codexCliConfig, model })}
                            onSave={() => saveCodexCliConfig()}
                        />
                        <CodexCliModelField
                            label={t('Fast Model')}
                            value={codexCliConfig.fastModel}
                            placeholder="gpt-5.3-codex-spark"
                            onChange={(fastModel) => setCodexCliConfig(prev => ({ ...prev, fastModel }))}
                            onSelect={(fastModel) => saveCodexCliConfig({ ...codexCliConfig, fastModel })}
                            onSave={() => saveCodexCliConfig()}
                        />
                    </div>
                    {(['model', 'fastModel'] as const).map((key, index) => {
                        const confirmationKey = index ? 'fastImageSupportConfirmedFor' : 'imageSupportConfirmedFor';
                        const binding = codexImageTarget(codexCliConfig[key]);
                        return <label key={key} className="block text-xs text-text-secondary"><input type="checkbox" aria-label={t(index ? 'Fast Codex model supports images' : 'Normal Codex model supports images')}
                            checked={codexCliConfig[confirmationKey] === binding}
                            onChange={event => saveCodexCliConfig({ ...codexCliConfig, [confirmationKey]: event.target.checked ? binding : undefined })} /> {t(index ? 'Fast Codex model supports images' : 'Normal Codex model supports images')}
                            <span className="block text-[10px]">{t('Verify this exact backend/model yourself. API image support does not confirm Codex backend support.')}</span></label>;
                    })}

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <label className="space-y-1">
                            <span className="text-[10px] font-medium text-text-secondary uppercase tracking-wide">{t('Service Tier')}</span>
                            <ModelSelect
                                value={codexCliConfig.serviceTier ?? 'default'}
                                options={CODEX_SERVICE_TIERS.map(tier => ({ id: tier, name: tier.charAt(0).toUpperCase() + tier.slice(1) }))}
                                onChange={(serviceTier) => saveCodexCliConfig({ ...codexCliConfig, serviceTier: serviceTier as typeof CODEX_SERVICE_TIERS[number] })}
                                placeholder="default"
                            />
                            <p className="text-[9px] text-text-tertiary">{t('Unverified backend parameter; it may be rejected without silent removal.')}</p>
                        </label>
                        <label className="space-y-1">
                            <span className="text-[10px] font-medium text-text-secondary uppercase tracking-wide">{t('Reasoning Effort')}</span>
                            <ModelSelect
                                value={codexCliConfig.modelReasoningEffort ?? ''}
                                options={[
                                    { id: '', name: t('Default / Unspecified') },
                                    ...CODEX_MODEL_REASONING_EFFORTS.map(e => ({ id: e, name: e.charAt(0).toUpperCase() + e.slice(1) })),
                                ]}
                                onChange={(effort) => saveCodexCliConfig({ ...codexCliConfig, modelReasoningEffort: effort as CodexSourceConfig['modelReasoningEffort'] || undefined })}
                                placeholder="Default / Unspecified"
                            />
                            <p className="text-[9px] text-text-tertiary">{t('How much reasoning effort the model uses. Model-dependent.')}</p>
                        </label>
                    </div>

                    <div className="flex items-center justify-between gap-3">
                        <div className="min-h-5">
                            {codexCliStatus === 'success' && (
                                <div className="flex items-center gap-2 text-xs text-green-400">
                                    <CheckCircle size={14} />
                                    <span>{t('Local file checks passed; service, models and entitlement unverified.')}</span>
                                </div>
                            )}
                            {codexCliStatus === 'error' && (
                                <div className="flex items-center gap-2 text-xs text-red-400">
                                    <AlertCircle size={14} />
                                    <span>{t(codexCliError)}</span>
                                </div>
                            )}
                        </div>
                        <button
                            type="button"
                            onClick={handleTestCodexCli}
                            disabled={codexCliStatus === 'testing' || !codexSourceAvailable(codexCliConfig)}
                            className="flex items-center gap-2 px-3 py-1.5 bg-bg-input hover:bg-bg-elevated border border-border-subtle rounded-lg text-xs font-medium text-text-primary transition-colors disabled:opacity-60"
                        >
                            {codexCliStatus === 'testing' ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle size={14} />}
                            {t('Check saved local login file')}
                        </button>
                    </div>
                    {codexCliStatus === 'error' && <button type="button" className="text-xs text-accent-primary" onClick={() => saveCodexCliConfig()}>{t('Retry saving source settings')}</button>}
                </div>
            </div>

            {/* Cloud Provider Data Scopes — fail-closed cloud share controls */}
            <div className="space-y-5">
                <div>
                    <h3 className="text-sm font-bold text-text-primary mb-1">{t('Cloud provider data scopes')}</h3>
                    <p className="text-xs text-text-secondary mb-2">{t('Control what data cloud AI providers can access. Disabled types are left out of requests.')}</p>
                    <p className="text-[10px] text-text-secondary mb-2">{t('Profile history covers your persona and notes, saved meetings, and the separate list of earlier answers. Answers within the current conversation are part of its transcript.')}</p>
                    <p className="text-[10px] text-text-secondary mb-2">{t('Original screenshots go directly to the selected model, with only your explicit backup eligible for retry. Enable Screenshots below to share them; no separate generative screen analysis is run.')}</p>
                </div>
                <div className="bg-bg-item-surface rounded-xl p-4 border border-border-subtle flex flex-col gap-2">
                    {([
                        { key: 'transcript', label: 'Transcripts' },
                        { key: 'screenshots', label: 'Screenshots' },
                        { key: 'profile_history', label: 'Profile history' },
                    ] as const).map(({ key, label }) => {
                        const allowed = providerDataScopes[key] !== false;
                        return (
                            <div key={key} className="flex items-center justify-between">
                                <span className="text-xs text-text-secondary">{t(label)}</span>
                                <div
                                    onClick={() => {
                                        const next = { ...providerDataScopes, [key]: !allowed };
                                        setProviderDataScopes(next);
                                        window.electronAPI?.setProviderDataScopes?.(next);
                                    }}
                                    className={`w-9 h-5 rounded-full relative transition-colors cursor-pointer ${allowed ? 'bg-emerald-500' : 'bg-bg-toggle-switch border border-border-muted'}`}
                                    role="switch"
                                    aria-checked={allowed}
                                    aria-label={t('Allow {scope} to cloud providers', { scope: t(label) })}
                                >
                                    <div className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${allowed ? 'translate-x-4' : 'translate-x-0'}`} />
                                </div>
                            </div>
                        );
                    })}
                    <div className="flex items-start gap-2 mt-1 pt-3 border-t border-border-subtle">
                        <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-text-tertiary shrink-0 mt-0.5"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>
                        <p className="text-[11px] text-text-tertiary leading-relaxed">{t('When a data type is disabled, it is left out of every request to a cloud provider. There is no local model to fall back to.')}</p>
                    </div>
                </div>
            </div>
        </div>
    );
};
