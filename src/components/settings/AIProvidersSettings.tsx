import { ANSWER_PROVIDERS, LLM_PRESETS, gatewayTarget, parseModelSelection, type AnswerProvider, type GatewaySummary, type ProviderConfiguration, type LlmProvider } from '../../types/llmTarget';
import React, { useState, useEffect } from 'react';
import { AlertCircle, CheckCircle, ChevronDown, Check, Loader2, Cloud, Server, Eye, Sparkles, Info } from 'lucide-react';
import { SiAnthropic, SiGooglegemini, SiOpenai } from 'react-icons/si';
import { CODEX_CLI_MODEL_PRESETS, codexCliSelectorId, prettifyModelId } from '../../utils/modelUtils';
import { PROVIDER_NAMES, answerModelLabel, answerModelOptions } from '../../utils/answerModelOptions';
import { ProviderCard } from './ProviderCard';
import { GatewayPanel } from './GatewayPanel';
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
    const savedPolicy = React.useRef<GenerationPolicy>({ ...DEFAULT_GENERATION_POLICY });
    const [generationPolicySaving, setGenerationPolicySaving] = useState(false);
    const [generationPolicyNotice, setGenerationPolicyNotice] = useState('');
    const [providerConfigurations, setProviderConfigurations] = useState<Record<LlmProvider, ProviderConfiguration>>({ ...LLM_PRESETS });
    const [gateways, setGateways] = useState<GatewaySummary[]>([]);
    // Panel keys stay stable when a new gateway receives its identity, so its edits and results are kept.
    const [gatewayPanels, setGatewayPanels] = useState<{ key: string; id?: string }[]>([{ key: 'new-0' }]);
    const [addressOverrides, setAddressOverrides] = useState<Partial<Record<LlmProvider, string>>>({});
    const [savedStatus, setSavedStatus] = useState<Record<string, boolean>>({});
    const [hasStoredKey, setHasStoredKey] = useState<Record<string, boolean>>({});
    const [credentialNotice, setCredentialNotice] = useState('');
    const [activeTab, setActiveTab] = useState<'cloud' | 'gateway' | 'privacy'>('cloud');

    // --- Codex CLI ---
    const [codexCliConfig, setCodexCliConfig] = useState<CodexSourceConfig>({ ...DEFAULT_CODEX_SOURCE_CONFIG });
    const [codexRiskAccepted, setCodexRiskAccepted] = useState(false);
    const [codexCliStatus, setCodexCliStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
    const [codexCliError, setCodexCliError] = useState('');
    const codexOperation = React.useRef(0);

    // --- Default Model ---
    const [defaultModel, setDefaultModel] = useState<string>('');
    const [defaultUnavailable, setDefaultUnavailable] = useState('');
    const [fastResponseMode, setFastResponseMode] = useState(false);
    const [credentialsLoaded, setCredentialsLoaded] = useState(false);
    // Fast mode now only switches the Codex login source to its configured fast model.
    const canUseFastMode = codexSourceAvailable(codexCliConfig);

    const [providerDataScopes, setProviderDataScopes] = useState<{ transcript?: boolean; screenshots?: boolean; profile_history?: boolean }>({});

    // Local reads only: mounting, switching tabs and expanding rows never contact a provider.
    const refreshCredentials = async () => {
        const creds = await window.electronAPI?.getStoredCredentials?.();
        if (!creds) return;
        if (creds.providerConfigurations) setProviderConfigurations(creds.providerConfigurations);
        setHasStoredKey({ gemini: !!creds.hasGeminiKey, openai: !!creds.hasOpenaiKey, claude: !!creds.hasClaudeKey, deepseek: !!creds.hasDeepseekKey });
        setAddressOverrides(creds.providerAddressOverrides ?? {});
        const loaded = creds.gateways ?? [];
        setGateways(loaded);
        setGatewayPanels(prev => {
            const kept = prev.filter(panel => !panel.id || loaded.some(gateway => gateway.id === panel.id));
            const missing = loaded.filter(gateway => !kept.some(panel => panel.id === gateway.id)).map(gateway => ({ key: gateway.id, id: gateway.id }));
            const next = [...kept, ...missing];
            return next.length ? next : [{ key: `new-${Date.now()}` }];
        });
    };

    const refreshDefaultModel = async () => {
        const result = await window.electronAPI?.getDefaultModel();
        if (result?.model) { setDefaultModel(result.model); setDefaultUnavailable(result.unavailable ?? ''); }
    };

    const refreshSavedBackup = async () => {
        const policy = await window.electronAPI.getGenerationPolicy();
        const previous = savedPolicy.current;
        savedPolicy.current = policy;
        // Follow the saved target without overwriting unsaved backup or timeout edits.
        setGenerationPolicy(draft => draft.backupModel === previous.backupModel
            && draft.backupImageSupportConfirmedFor === previous.backupImageSupportConfirmedFor
            ? { ...draft, backupModel: policy.backupModel, backupImageSupportConfirmedFor: policy.backupImageSupportConfirmedFor } : draft);
    };

    useEffect(() => {
        const loadCredentials = async () => {
            try {
                const policy = await window.electronAPI.getGenerationPolicy();
                savedPolicy.current = policy; setGenerationPolicy(policy);
                await refreshCredentials();
                const cliConfig = await window.electronAPI?.getCodexCliConfig?.();
                if (cliConfig) { setCodexCliConfig(cliConfig); setCodexRiskAccepted(codexSourceAvailable(cliConfig)); }
                const fastMode = await window.electronAPI?.getGroqFastTextMode();
                if (fastMode) setFastResponseMode(fastMode.enabled);
                setCredentialsLoaded(true);
                await refreshDefaultModel();
            } catch (e) {
                console.error("Failed to load settings:", e);
                setCredentialsLoaded(true);
            }
        };
        loadCredentials();
        if (window.electronAPI?.onGroqFastTextChanged) {
            const unsubscribe = window.electronAPI.onGroqFastTextChanged((enabled: boolean) => {
                setFastResponseMode(enabled);
                localStorage.setItem('natively_groq_fast_text', String(enabled));
            });
            return () => unsubscribe();
        }
    }, []);

    useEffect(() => {
        if (!credentialsLoaded) return;
        if (!canUseFastMode && fastResponseMode) {
            setFastResponseMode(false);
            localStorage.setItem('natively_groq_fast_text', 'false');
            window.electronAPI?.setGroqFastTextMode(false);
        }
    }, [credentialsLoaded, canUseFastMode, fastResponseMode]);

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

    /** Saves the complete official configuration atomically; the key field is cleared only after success. */
    const handleSaveKey = async (provider: string, key: string, setter: (val: string) => void, draft?: ProviderConfiguration): Promise<CredentialSaveResult> => {
        if (!key.trim() && !hasStoredKey[provider]) return { ok: false, code: 'write_failed', message: 'Enter an API key before saving.' };
        setCredentialNotice('');
        setSavedStatus(prev => ({ ...prev, [provider]: false }));
        try {
            const config = draft ?? providerConfigurations[provider as LlmProvider];
            const result = await window.electronAPI.setProviderConfiguration({ ...config, ...(key.trim() ? { apiKey: key } : {}) });
            if (result?.ok) {
                setProviderConfigurations(prev => ({ ...prev, [provider]: config }));
                let warning = result.warning;
                try { await refreshDefaultModel(); await refreshSavedBackup(); }
                catch {
                    // The save is already committed; a refresh failure must not claim rollback.
                    warning ||= 'Saved; reopen settings to refresh the default model.';
                }
                setSavedStatus(prev => ({ ...prev, [provider]: true }));
                setHasStoredKey(prev => ({ ...prev, [provider]: true }));
                setter('');
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
        }
    };

    const handleRemoveKey = async (provider: string, setter: (val: string) => void) => {
        if (!confirm(t('Are you sure you want to remove the {provider} API key?', { provider: PROVIDER_NAMES[provider as LlmProvider] ?? provider }))) return;
        setCredentialNotice('');
        try {
            const result = await window.electronAPI.removeProviderApiKey(provider as AnswerProvider);
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
            setDefaultUnavailable('');
            setCredentialNotice(result.warning || '');
        } catch {
            setCredentialNotice('The default model could not be saved.');
        }
    };

    const cloudModelOptions: ModelOption[] = answerModelOptions({ providerConfigurations, gateways, providerAddressOverrides: addressOverrides,
        hasGeminiKey: hasStoredKey.gemini, hasOpenaiKey: hasStoredKey.openai, hasClaudeKey: hasStoredKey.claude, hasDeepseekKey: hasStoredKey.deepseek });
    if (codexSourceAvailable(codexCliConfig)) {
        cloudModelOptions.push({ id: 'codex-cli', name: t('Codex login source (configured model)') });
        for (const model of new Set([codexCliConfig.model, codexCliConfig.fastModel, ...CODEX_CLI_MODEL_PRESETS.map(preset => preset.id)])) {
            cloudModelOptions.push({ id: codexCliSelectorId(model), name: t('{model} (Codex login source, unverified availability)', { model }) });
        }
    }
    // A saved choice that is no longer offered stays visible as unavailable; it is never replaced silently.
    const withSaved = (value: string | undefined, options: ModelOption[]) => value && !options.some(option => option.id === value)
        ? [{ id: value, name: `${answerModelLabel(value, gateways)} — ${t('unavailable')}` }, ...options] : options;
    const selectClass = 'block w-full mt-1 bg-bg-input border border-border-subtle rounded-lg px-3 py-2 text-xs text-text-primary focus:outline-none focus:border-accent-primary';
    const backupBinding = (() => {
        const backup = generationPolicy.backupModel;
        if (!backup) return undefined;
        if (backup.startsWith('codex-cli')) return { binding: codexImageTarget(backup.startsWith('codex-cli:') ? backup.slice(10) : codexCliConfig.model), codex: true };
        const parsed = parseModelSelection(backup);
        try {
            if (parsed?.kind === 'official') {
                const config = { ...providerConfigurations[parsed.provider], model: parsed.model };
                return knownModelImageSupport(config) !== undefined ? undefined : { binding: imageSupportTarget(config), codex: false };
            }
            const gateway = parsed && gateways.find(item => item.id === parsed.gatewayId);
            return gateway ? { binding: imageSupportTarget(gatewayTarget(gateway, parsed!.model)), codex: false } : undefined;
        } catch { return undefined; }
    })();

    const icons: Record<AnswerProvider, React.ReactNode> = {
        gemini: <SiGooglegemini size={16} />, openai: <SiOpenai size={16} />, claude: <SiAnthropic size={16} />,
        deepseek: <span className="text-[11px] font-bold">DS</span>,
    };
    const keyMeta: Record<AnswerProvider, { placeholder: string; url: string }> = {
        gemini: { placeholder: 'AIzaSy...', url: 'https://aistudio.google.com/app/apikey' },
        openai: { placeholder: 'sk-...', url: 'https://platform.openai.com/api-keys' },
        claude: { placeholder: 'sk-ant-...', url: 'https://console.anthropic.com/settings/keys' },
        deepseek: { placeholder: 'sk-...', url: 'https://platform.deepseek.com/api_keys' },
    };
    const tabs = [
        { id: 'cloud', label: 'Cloud services', icon: <Cloud size={14} /> },
        { id: 'gateway', label: 'Gateway', icon: <Server size={14} /> },
        { id: 'privacy', label: 'Privacy', icon: <Eye size={14} /> },
    ] as const;
    const onTabKey = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
        const next = event.key === 'ArrowRight' ? (index + 1) % tabs.length : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length
            : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : undefined;
        if (next === undefined) return;
        event.preventDefault();
        setActiveTab(tabs[next].id);
        document.getElementById(`ai-tab-${tabs[next].id}`)?.focus();
    };

    return (
        <div className="space-y-5 animated fadeIn pb-10">
            <div>
                <h3 className="text-[17px] font-semibold text-text-primary mb-1">{t('AI services')}</h3>
                <p className="text-xs text-text-secondary">{t('Choose answer models, connect official providers or your own gateway, and control what data is shared.')}</p>
            </div>
            <section className="space-y-4 rounded-2xl bg-bg-item-surface border border-border-subtle p-5" aria-label={t('Answer models')}>
                <div className="flex items-start gap-3">
                    <span className="w-9 h-9 rounded-xl bg-bg-input border border-border-subtle flex items-center justify-center text-text-primary shrink-0"><Sparkles size={16} /></span>
                    <div>
                        <h4 className="text-sm font-semibold text-text-primary">{t('Answer models')}</h4>
                        <p className="text-[11px] text-text-secondary">{t('The primary model answers every request. The optional backup is tried only after a failed send; it receives the same request data under your privacy settings and may add cost.')}</p>
                    </div>
                </div>
                <div className="grid grid-cols-1 gap-3">
                    <label className="block text-xs text-text-secondary">{t('Primary model')}
                        <select aria-label={t('Primary model')} className={selectClass} value={defaultModel}
                            onChange={event => handleDefaultModelChange(event.target.value)}>
                            {!defaultModel && <option value="">{t('Select model')}</option>}
                            {withSaved(defaultModel, cloudModelOptions).map(option => <option key={option.id} value={option.id}>{option.name}</option>)}
                        </select>
                    </label>
                    {defaultUnavailable && <p role="alert" className="text-[11px] text-amber-500">{t(defaultUnavailable)}</p>}
                    {!cloudModelOptions.length && <p className="text-[11px] text-text-tertiary">{t('Save an official provider key or a gateway below to choose an answer model.')}</p>}
                    <label className="block text-xs text-text-secondary">{t('Backup model')}
                        <select aria-label={t('Backup model')} className={selectClass} value={generationPolicy.backupModel ?? ''}
                            onChange={event => setGenerationPolicy({ ...generationPolicy, backupModel: event.target.value || undefined, backupImageSupportConfirmedFor: undefined })}>
                            <option value="">{t('None — retry the same model only for a transient failure')}</option>
                            {withSaved(generationPolicy.backupModel, cloudModelOptions).filter(option => option.id !== defaultModel).map(option => <option key={option.id} value={option.id}>{option.name}</option>)}
                        </select>
                    </label>
                    {backupBinding && <label className="block text-xs text-text-secondary"><input type="checkbox" aria-label={t('Backup model supports images')}
                        checked={generationPolicy.backupImageSupportConfirmedFor === backupBinding.binding}
                        onChange={event => setGenerationPolicy({ ...generationPolicy, backupImageSupportConfirmedFor: event.target.checked ? backupBinding.binding : undefined })} /> {t(backupBinding.codex ? 'Backup Codex model supports images' : 'Backup model supports images')}
                        <span className="block text-[10px]">{t(backupBinding.codex ? 'Independent backend/model confirmation; not inferred from the OpenAI API. Verify capability yourself.' : "Check this backup model's provider documentation yourself. This confirmation is independent of the primary model and resets for a changed target.")}</span>
                    </label>}
                </div>
                <div className="border-t border-border-subtle pt-4">
                    <h4 className="text-xs font-medium text-text-primary mb-2">{t('Generation limits')}</h4>
                    <div className="grid grid-cols-3 gap-3">
                        {([
                            ['interviewFirstTokenSeconds', 'Interview first visible text (seconds)'],
                            ['interviewTotalSeconds', 'Interview total (seconds)'],
                            ['writtenTotalSeconds', 'Written answer total (seconds)'],
                        ] as const).map(([key, label]) => <label key={key} className="block text-xs text-text-secondary">{t(label)}
                            <input className={selectClass} type="number" min="0" step="any" value={Number.isFinite(generationPolicy[key]) ? generationPolicy[key] : ''} onChange={event => setGenerationPolicy({ ...generationPolicy, [key]: event.target.value ? Number(event.target.value) : NaN })} />
                        </label>)}
                    </div>
                    <p className="text-[10px] text-text-secondary mt-2">{t('At most two sends per request. Switching models manually cancels the current request and keeps its partial output. The first-visible-text timeout ends the request without extra backup time; hidden reasoning may use that time before any visible text.')}</p>
                </div>
                <div className="flex items-center gap-3">
                    <button type="button" disabled={generationPolicySaving} className="px-3 py-1.5 rounded-lg text-xs font-medium border border-border-subtle bg-bg-input hover:bg-bg-elevated text-text-primary disabled:opacity-50" onClick={async () => {
                        setGenerationPolicySaving(true); setGenerationPolicyNotice('');
                        try {
                            const result = await window.electronAPI.setGenerationPolicy(generationPolicy);
                            if (result.ok) savedPolicy.current = generationPolicy;
                            setGenerationPolicyNotice(result.ok ? result.warning ?? 'Saved' : result.message);
                        } catch (error) { setGenerationPolicyNotice(error instanceof Error ? error.message : 'Could not save'); }
                        finally { setGenerationPolicySaving(false); }
                    }}>{t(generationPolicySaving ? 'Saving…' : 'Save backup and time limits')}</button>
                    {generationPolicyNotice && <p role="status" className="text-xs text-text-secondary">{t(generationPolicyNotice)}</p>}
                </div>
            </section>
            {credentialNotice && <p role="alert" className="text-xs text-amber-500">{t(credentialNotice)}</p>}

            <div role="tablist" aria-label={t('AI services')} className="grid grid-cols-3 gap-1 p-1 rounded-xl bg-bg-input border border-border-subtle">
                {tabs.map((tab, index) => <button key={tab.id} id={`ai-tab-${tab.id}`} type="button" role="tab" aria-selected={activeTab === tab.id} aria-controls={`ai-panel-${tab.id}`}
                    tabIndex={activeTab === tab.id ? 0 : -1} onClick={() => setActiveTab(tab.id)} onKeyDown={event => onTabKey(event, index)}
                    className={`flex items-center justify-center gap-2 py-2 rounded-lg text-xs font-medium transition-colors ${activeTab === tab.id ? 'bg-bg-elevated text-text-primary border border-accent-border shadow-sm' : 'text-text-secondary border border-transparent hover:text-text-primary'}`}>
                    {tab.icon}{t(tab.label)}
                </button>)}
            </div>

            {/* Every panel stays mounted while hidden, so switching tabs never discards unsaved edits. */}
            <div id="ai-panel-cloud" role="tabpanel" aria-labelledby="ai-tab-cloud" hidden={activeTab !== 'cloud'} className="space-y-5">
                <div className="rounded-2xl border border-border-subtle bg-bg-item-surface overflow-hidden">
                    {ANSWER_PROVIDERS.map(provider => <ProviderCard key={provider} providerId={provider} providerName={PROVIDER_NAMES[provider]} icon={icons[provider]}
                        configuration={providerConfigurations[provider]} hasStoredKey={!!hasStoredKey[provider]}
                        unavailableReason={addressOverrides[provider] ? t('{variable} is set, so this official provider is paused. Remove the variable or use a gateway.', { variable: addressOverrides[provider]! }) : undefined}
                        keyPlaceholder={keyMeta[provider].placeholder} keyUrl={keyMeta[provider].url}
                        onSave={(draft, key, clearKey) => handleSaveKey(provider, key, clearKey, draft)}
                        onRemoveKey={() => handleRemoveKey(provider, () => {})} />)}
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

                        <div className="flex items-center justify-between gap-4">
                            <div>
                                <label className="block text-xs font-medium text-text-primary uppercase tracking-wide mb-0">{t('Fast Response Mode')}</label>
                                <p className="text-[10px] text-text-secondary">{t('Uses the Codex Fast Model instead of the Normal Model. Other model selections are not affected.')}</p>
                            </div>
                            <button type="button" role="switch" aria-checked={fastResponseMode} aria-label={t('Fast Response Mode')} disabled={!canUseFastMode}
                                onClick={async () => {
                                    const newState = !fastResponseMode;
                                    setFastResponseMode(newState);
                                    localStorage.setItem('natively_groq_fast_text', String(newState));
                                    await window.electronAPI?.setGroqFastTextMode(newState);
                                }}
                                className={`shrink-0 w-11 h-6 rounded-full relative transition-colors disabled:opacity-50 ${fastResponseMode ? 'bg-accent-primary' : 'bg-bg-toggle-switch border border-border-muted'}`}>
                                <span className={`absolute top-1 left-1 w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${fastResponseMode ? 'translate-x-5' : 'translate-x-0'}`} />
                            </button>
                        </div>

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
            </div>

            <div id="ai-panel-gateway" role="tabpanel" aria-labelledby="ai-tab-gateway" hidden={activeTab !== 'gateway'} className="space-y-4">
                <p className="text-xs text-text-secondary">{t('A compatible gateway is configured separately from the official providers, with its own address and key. Select it as an answer model above after saving.')}</p>
                {gatewayPanels.map(panel => <GatewayPanel key={panel.key} gateway={gateways.find(gateway => gateway.id === panel.id)}
                    onSaved={async id => { setGatewayPanels(prev => prev.map(item => item.key === panel.key ? { ...item, id } : item)); await refreshCredentials(); await refreshDefaultModel(); await refreshSavedBackup(); }}
                    onRemoved={async () => { setGatewayPanels(prev => prev.filter(item => item.key !== panel.key)); await refreshCredentials(); }} />)}
            </div>

            <div id="ai-panel-privacy" role="tabpanel" aria-labelledby="ai-tab-privacy" hidden={activeTab !== 'privacy'} className="space-y-3">
                <div>
                    <h4 className="text-sm font-semibold text-text-primary mb-1">{t('Cloud provider data scopes')}</h4>
                    <p className="text-xs text-text-secondary">{t('Control what data cloud AI providers can access. Disabled types are left out of requests.')}</p>
                </div>
                <div className="rounded-2xl border border-border-subtle bg-bg-item-surface divide-y divide-border-subtle">
                    {([
                        { key: 'transcript', label: 'Transcripts', note: 'Conversation transcripts, including answers within the current conversation.' },
                        { key: 'screenshots', label: 'Screenshots', note: 'Original screenshots go directly to the selected model, with only your explicit backup eligible for retry.' },
                        { key: 'profile_history', label: 'Profile history', note: 'Your persona and notes, saved meetings, and the separate list of earlier answers.' },
                    ] as const).map(({ key, label, note }) => {
                        const allowed = providerDataScopes[key] !== false;
                        return (
                            <div key={key} className="flex items-center justify-between gap-4 px-4 py-3">
                                <div>
                                    <span className="block text-xs font-medium text-text-primary">{t(label)}</span>
                                    <span className="block text-[11px] text-text-tertiary">{t(note)}</span>
                                </div>
                                <button type="button"
                                    onClick={() => {
                                        const next = { ...providerDataScopes, [key]: !allowed };
                                        setProviderDataScopes(next);
                                        window.electronAPI?.setProviderDataScopes?.(next);
                                    }}
                                    className={`shrink-0 w-9 h-5 rounded-full relative transition-colors ${allowed ? 'bg-emerald-500' : 'bg-bg-toggle-switch border border-border-muted'}`}
                                    role="switch" aria-checked={allowed} aria-label={t('Allow {scope} to cloud providers', { scope: t(label) })}>
                                    <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${allowed ? 'translate-x-4' : 'translate-x-0'}`} />
                                </button>
                            </div>
                        );
                    })}
                </div>
                <p className="flex items-start gap-2 text-[11px] text-text-tertiary"><Info size={13} className="shrink-0 mt-0.5" />{t('When a data type is disabled, it is left out of every request to a cloud provider. There is no local model to fall back to.')}</p>
            </div>
        </div>
    );
};
