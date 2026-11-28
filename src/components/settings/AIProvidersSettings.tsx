import { ANSWER_PROVIDERS, LLM_PRESETS, gatewayTarget, parseModelSelection, type AnswerProvider, type GatewaySummary, type ProviderConfiguration, type LlmProvider } from '../../types/llmTarget';
import React, { useState, useEffect } from 'react';
import { Cloud, Server, Eye, Sparkles, Info } from 'lucide-react';
import { SiAnthropic, SiGooglegemini, SiOpenai } from 'react-icons/si';
import { PROVIDER_NAMES, answerModelLabel, answerModelOptions } from '../../utils/answerModelOptions';
import { ProviderCard } from './ProviderCard';
import { ReasoningSelect } from '../ReasoningSelect';
import type { AnswerReasoningState, ReasoningChoice } from '../../types/answerReasoning';
import { GatewayPanel } from './GatewayPanel';
import { useI18n } from '../../i18n';
import type { CredentialSaveResult } from '../../types/credentialSave';
import { DEFAULT_GENERATION_POLICY, type GenerationPolicy } from '../../types/generationPolicy';
import { imageSupportTarget } from '../../types/modelImageSupport';
import { officialCapability } from '../../types/modelCapabilities';

interface ModelOption {
    id: string;
    name: string;
}

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
    const [, setSavedStatus] = useState<Record<string, boolean>>({});
    const [hasStoredKey, setHasStoredKey] = useState<Record<string, boolean>>({});
    const [credentialNotice, setCredentialNotice] = useState('');
    const [activeTab, setActiveTab] = useState<'cloud' | 'gateway' | 'privacy'>('cloud');

    // --- Default Model ---
    const [defaultModel, setDefaultModel] = useState<string>('');
    const [defaultUnavailable, setDefaultUnavailable] = useState('');
    const [answerReasoning, setAnswerReasoning] = useState<AnswerReasoningState | undefined>();
    const refreshAnswerReasoning = async () => { const state = await window.electronAPI?.getAnswerReasoning?.(); if (state) setAnswerReasoning(state); };

    const [providerDataScopes, setProviderDataScopes] = useState<{ transcript?: boolean; screenshots?: boolean; profile_history?: boolean }>({});
    const [dataScopeError, setDataScopeError] = useState('');

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
                await refreshDefaultModel();
            } catch (e) {
                console.error("Failed to load settings:", e);
            }
        };
        loadCredentials();
    }, []);

    useEffect(() => {
        window.electronAPI?.getProviderDataScopes?.().then(setProviderDataScopes).catch(() => { });
    }, []);

    // The main process owns the saved and session reasoning; this view only shows and requests changes.
    useEffect(() => {
        refreshAnswerReasoning().catch(() => { });
        return window.electronAPI?.onAnswerReasoningChanged?.(setAnswerReasoning);
    }, []);

    useEffect(() => {
        if (window.electronAPI?.onProviderDataScopesChanged) {
            const unsubscribe = window.electronAPI.onProviderDataScopesChanged(setProviderDataScopes);
            return () => unsubscribe();
        }
    }, []);

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
            await refreshAnswerReasoning().catch(() => { });
        } catch {
            setCredentialNotice('The default model could not be saved.');
        }
    };

    const handleDefaultReasoningChange = async (value: ReasoningChoice) => {
        const target = answerReasoning?.saved.target;
        if (!target) return;
        setCredentialNotice('');
        try {
            const result = await window.electronAPI.setDefaultReasoning(target, value);
            setCredentialNotice(result.ok ? result.warning || '' : result.message);
        } catch { setCredentialNotice('The reasoning level could not be saved.'); }
        await refreshAnswerReasoning().catch(() => { });
    };

    const cloudModelOptions: ModelOption[] = answerModelOptions({ providerConfigurations, gateways, providerAddressOverrides: addressOverrides,
        hasGeminiKey: hasStoredKey.gemini, hasOpenaiKey: hasStoredKey.openai, hasClaudeKey: hasStoredKey.claude, hasDeepseekKey: hasStoredKey.deepseek });
    // A saved choice that is no longer offered stays visible as unavailable; it is never replaced silently.
    const withSaved = (value: string | undefined, options: ModelOption[]) => value && !options.some(option => option.id === value)
        ? [{ id: value, name: `${answerModelLabel(value, gateways)} — ${t('unavailable')}` }, ...options] : options;
    const selectClass = 'block w-full mt-1 bg-bg-input border border-border-subtle rounded-lg px-3 py-2 text-xs text-text-primary focus:outline-none focus:border-accent-primary';
    const backupBinding = (() => {
        const backup = generationPolicy.backupModel;
        if (!backup) return undefined;
        const parsed = parseModelSelection(backup);
        try {
            // Official backups follow the capability record; there is no manual confirmation for them.
            if (parsed?.kind === 'official') return undefined;
            const gateway = parsed && gateways.find(item => item.id === parsed.gatewayId);
            return gateway ? { binding: imageSupportTarget(gatewayTarget(gateway, parsed!.model)) } : undefined;
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
                    <ReasoningSelect state={answerReasoning?.saved} label={t('Default reasoning')} onChange={handleDefaultReasoningChange} className={selectClass} />
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
                        onChange={event => setGenerationPolicy({ ...generationPolicy, backupImageSupportConfirmedFor: event.target.checked ? backupBinding.binding : undefined })} /> {t('Backup model supports images')}
                        <span className="block text-[10px]">{t("Check this backup model's provider documentation yourself. This confirmation is independent of the primary model and resets for a changed target.")}</span>
                    </label>}
                    {(() => {
                        const parsed = generationPolicy.backupModel ? parseModelSelection(generationPolicy.backupModel) : undefined;
                        if (parsed?.kind !== 'official') return null;
                        const images = officialCapability({ provider: parsed.provider, protocol: parsed.protocol, model: parsed.model })?.images;
                        return <p className="text-[10px] text-text-secondary">{t(images === true ? 'Backup image input: supported according to the official model record.'
                            : images === false ? 'Backup image input: not supported according to the official model record.' : 'Backup image input has not been verified for this model yet; image questions are not sent to it.')}</p>;
                    })()}
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
                                    onClick={async () => {
                                        const next = { ...providerDataScopes, [key]: !allowed };
                                        setProviderDataScopes(next);
                                        setDataScopeError('');
                                        // Main saves before it confirms; a failed save puts this switch back.
                                        const result = await window.electronAPI?.setProviderDataScopes?.(next).catch(() => undefined);
                                        if (!result?.success) {
                                            setProviderDataScopes(current => ({ ...current, [key]: allowed }));
                                            setDataScopeError(result?.error || 'The privacy setting could not be saved. The previous setting was kept.');
                                        }
                                    }}
                                    className={`shrink-0 w-9 h-5 rounded-full relative transition-colors ${allowed ? 'bg-emerald-500' : 'bg-bg-toggle-switch border border-border-muted'}`}
                                    role="switch" aria-checked={allowed} aria-label={t('Allow {scope} to cloud providers', { scope: t(label) })}>
                                    <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${allowed ? 'translate-x-4' : 'translate-x-0'}`} />
                                </button>
                            </div>
                        );
                    })}
                </div>
                {dataScopeError && <p role="alert" className="text-xs text-amber-500">{t(dataScopeError)}</p>}
                <p className="flex items-start gap-2 text-[11px] text-text-tertiary"><Info size={13} className="shrink-0 mt-0.5" />{t('When a data type is disabled, it is left out of every request to a cloud provider. There is no local model to fall back to.')}</p>
            </div>
        </div>
    );
};
