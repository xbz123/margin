import { LLM_PRESETS, type ProviderConfiguration } from '../../types/llmTarget';
import { imageSupportTarget, knownModelImageSupport } from '../../types/modelImageSupport';
import { isOfficialEndpoint, officialModelCapacity, reasoningOptions, validateReasoning } from '../../types/modelReasoning';
import React, { useState, useEffect, useRef } from 'react';
import type { CredentialSaveResult } from '../../types/credentialSave';
import { Trash2, AlertCircle, CheckCircle, ExternalLink, Loader2, RefreshCw } from 'lucide-react';
import { useI18n } from '../../i18n';

interface FetchedModel {
    id: string;
    label: string;
}

interface ProviderCardProps {
    providerId: 'gemini' | 'groq' | 'openai' | 'claude' | 'deepseek';
    providerName: string;
    configuration?: ProviderConfiguration;
    apiKey: string;
    preferredModel?: string;
    hasStoredKey: boolean;
    onKeyChange: (key: string) => void;
    onSaveKey: (configuration?: ProviderConfiguration) => Promise<CredentialSaveResult>;
    onRemoveKey: () => void;
    onTestConnection: () => void;
    testStatus: 'idle' | 'testing' | 'success' | 'error';
    testError?: string;
    savingStatus: boolean;
    savedStatus: boolean;
    keyPlaceholder: string;
    keyUrl: string;
    onPreferredModelChange?: (modelId: string) => void;
}

// Reasoning and the gateway context note belong to one model, protocol and endpoint.
const TARGET_RESET = { imageSupportConfirmedFor: undefined, reasoning: undefined, contextWindowTokens: undefined } as const;
const customEndpoint = (config: ProviderConfiguration): boolean => {
    try { return !!config.baseUrl?.trim() && !isOfficialEndpoint(config); } catch { return true; }
};

export const ProviderCard: React.FC<ProviderCardProps> = ({
    providerId,
    providerName,
    configuration,
    apiKey,
    hasStoredKey,
    onKeyChange,
    onSaveKey,
    onRemoveKey,
    onTestConnection,
    testStatus,
    testError,
    savingStatus,
    savedStatus,
    keyPlaceholder,
    keyUrl,
}) => {
    const { t } = useI18n();
    const savedConfig = configuration ?? LLM_PRESETS[providerId];
    const [draft, setDraft] = useState<ProviderConfiguration>(savedConfig);
    const unsaved = JSON.stringify(draft) !== JSON.stringify(savedConfig) || !!apiKey.trim();
    const [gatewayMode, setGatewayMode] = useState(() => customEndpoint(savedConfig));
    const fetchRevision = useRef(0);
    const resetModels = () => { fetchRevision.current++; setFetchedModels([]); setFetchError(null); setIsFetching(false); };
    useEffect(() => { setDraft(savedConfig); setGatewayMode(customEndpoint(savedConfig)); resetModels(); }, [configuration, hasStoredKey]);
    useEffect(() => () => { fetchRevision.current++; }, []);
    const [fetchedModels, setFetchedModels] = useState<FetchedModel[]>([]);
    const [isFetching, setIsFetching] = useState(false);
    const [fetchError, setFetchError] = useState<string | null>(null);
    const handleFetchModels = async () => {
        if (unsaved) { setFetchError('Save the complete configuration before fetching models.'); return; }
        const revision = ++fetchRevision.current;
        setIsFetching(true);
        setFetchError(null);

        try {
            const result = await window.electronAPI?.fetchProviderModels(providerId, '');
            if (revision !== fetchRevision.current) return;
            if (result?.success && result.models) {
                setFetchedModels(result.models);
                if (!result.models.length) setFetchError('No models were returned by this provider.');
            } else {
                setFetchError(result?.error || 'Failed to fetch models');
            }
        } catch (e: any) {
            if (revision === fetchRevision.current) setFetchError('Failed to fetch models');
        } finally {
            if (revision === fetchRevision.current) setIsFetching(false);
        }
    };

    const handleSelectModel = async (modelId: string) => {
        setDraft(prev => ({ ...prev, model: modelId, ...TARGET_RESET }));
    };
    const target = (() => {
        try {
            return { reasoning: reasoningOptions(draft), capacity: officialModelCapacity(draft), custom: !isOfficialEndpoint(draft) };
        } catch { return undefined; }
    })();
    const draftError = (() => {
        if (gatewayMode && !customEndpoint(draft)) return 'Enter a custom gateway URL, or select the official API.';
        try { validateReasoning(draft, draft.reasoning); } catch (e: any) { return e.message as string; }
        const tokens = draft.contextWindowTokens;
        return tokens !== undefined && (!Number.isSafeInteger(tokens) || tokens <= 0) ? 'Context window must be a positive whole number of tokens.' : undefined;
    })();
    const setReasoning = (field: 'effort' | 'thinking', value: string) => setDraft(prev => {
        const next = { ...prev.reasoning, [field]: value || undefined };
        if (!next.effort) delete next.effort;
        if (!next.thinking) delete next.thinking;
        return { ...prev, reasoning: Object.keys(next).length ? next as ProviderConfiguration['reasoning'] : undefined };
    });

    return (
        <div className="bg-bg-item-surface rounded-xl p-5 border border-border-subtle">
            <div className="mb-2 flex items-center justify-between">
                <label className="flex items-center text-xs font-medium text-text-primary uppercase tracking-wide">
                    {t('{provider} API Key', { provider: providerName })}
                    {hasStoredKey && <span className="ml-2 text-green-500 normal-case">✓ {t('Saved')}</span>}
                </label>
                <button
                    data-external-url={keyUrl}
                    onClick={() => {
                        // @ts-ignore
                        window.electronAPI?.openExternal(keyUrl);
                    }}
                    className="text-xs text-text-tertiary hover:text-text-primary flex items-center gap-1 transition-colors"
                    title={t('Get {provider} API Key', { provider: providerName })}
                >
                    <span className="text-[10px] uppercase tracking-wide">{t('Get Key')}</span>
                    <ExternalLink size={12} />
                </button>
            </div>
            <div className="flex gap-2 mb-3">
                <input
                    type="password"
                    value={apiKey}
                    onChange={(e) => { resetModels(); onKeyChange(e.target.value); }}
                    placeholder={hasStoredKey ? "••••••••••••" : keyPlaceholder}
                    className="flex-1 bg-bg-input border border-border-subtle rounded-lg px-4 py-2.5 text-xs text-text-primary focus:outline-none focus:border-accent-primary transition-colors"
                />
                <button
                    onClick={() => onSaveKey(draft)}
                    disabled={savingStatus || !!draftError || (!apiKey.trim() && !hasStoredKey)}
                    className={`px-5 py-2.5 rounded-lg text-xs font-medium transition-colors ${savedStatus
                        ? 'bg-green-500/20 text-green-400'
                        : 'bg-bg-input hover:bg-bg-secondary border border-border-subtle text-text-primary disabled:opacity-50'
                        }`}
                >
                    {t(savingStatus ? 'Saving...' : savedStatus ? 'Saved!' : 'Save')}
                </button>
                {hasStoredKey && (
                    <button
                        onClick={onRemoveKey}
                        className="px-2.5 py-2.5 rounded-lg text-xs font-medium text-text-tertiary hover:text-red-500 hover:bg-red-500/10 transition-all"
                        title={t('Remove API Key')} aria-label={t('Remove API Key')}
                    >
                        <Trash2 size={16} strokeWidth={1.5} />
                    </button>
                )}
            </div>

            <div className="space-y-2 mb-3">
                <label className="block text-xs text-text-secondary">{t('Connection')}
                    <select aria-label={t('{provider} connection', { provider: providerName })} value={gatewayMode ? 'gateway' : 'official'}
                        onChange={e => { const gateway = e.target.value === 'gateway'; setGatewayMode(gateway); resetModels(); setDraft(prev => ({ ...prev, baseUrl: undefined, ...TARGET_RESET })); }}
                        className="block w-full mt-1 bg-bg-input border border-border-subtle rounded-lg px-3 py-2 text-xs text-text-primary">
                        <option value="official">{t('Official API')}</option><option value="gateway">{t('Custom gateway')}</option>
                    </select>
                </label>
                {gatewayMode && <>
                <label className="block text-xs text-text-secondary">{t('Gateway API base URL')}
                    <input aria-label={t('{provider} API base URL', { provider: providerName })} value={draft.baseUrl ?? ''}
                        onChange={e => { resetModels(); setDraft(prev => {
                            const next = { ...prev, baseUrl: e.target.value, imageSupportConfirmedFor: undefined, reasoning: undefined };
                            return customEndpoint(next) ? next : { ...next, contextWindowTokens: undefined };
                        }); }}
                        placeholder="https://gateway.example/v1"
                        className="block w-full mt-1 bg-bg-input border border-border-subtle rounded-lg px-3 py-2 text-xs text-text-primary" />
                </label>
                <p className="text-xs text-text-secondary">{t('Re-enter your API key when changing the provider address.')}</p>
                </>}
                {providerId === 'openai' && <label className="block text-xs text-text-secondary">{t('Protocol')}
                    <select aria-label={t('OpenAI protocol')} value={draft.protocol} onChange={e => { resetModels(); setDraft(prev => ({ ...prev, protocol: e.target.value as ProviderConfiguration['protocol'], ...TARGET_RESET })); }}
                        className="block w-full mt-1 bg-bg-input border border-border-subtle rounded-lg px-3 py-2 text-xs text-text-primary">
                        <option value="chat-completions">Chat Completions</option><option value="responses">Responses</option>
                    </select>
                </label>}
                <label className="block text-xs text-text-secondary">{t('Select model')}
                    <select aria-label={t('{provider} model', { provider: providerName })} value={draft.model}
                        onChange={e => handleSelectModel(e.target.value)} disabled={!fetchedModels.length}
                        className="block w-full mt-1 bg-bg-input border border-border-subtle rounded-lg px-3 py-2 text-xs text-text-primary">
                        {!fetchedModels.some(model => model.id === draft.model) && <option value={draft.model}>{draft.model} — {t('Current configuration (not fetched)')}</option>}
                        {fetchedModels.map(model => <option key={model.id} value={model.id}>{model.label}</option>)}
                    </select>
                </label>
                {gatewayMode && <label className="block text-xs text-text-secondary">{t('Gateway model ID (if model listing is unavailable)')}
                    <input aria-label={t('{provider} model ID', { provider: providerName })} value={draft.model}
                        onChange={e => setDraft(prev => ({ ...prev, model: e.target.value, ...TARGET_RESET }))}
                        className="block w-full mt-1 bg-bg-input border border-border-subtle rounded-lg px-3 py-2 text-xs text-text-primary" />
                </label>}
                {target && <>
                    {target.reasoning.thinking.length > 0 && <label className="block text-xs text-text-secondary">{t('Thinking')}
                        <select aria-label={t('{provider} thinking', { provider: providerName })} value={draft.reasoning?.thinking ?? ''} onChange={e => setReasoning('thinking', e.target.value)}
                            className="block w-full mt-1 bg-bg-input border border-border-subtle rounded-lg px-3 py-2 text-xs text-text-primary">
                            <option value="">{t('Provider default (not sent)')}</option>
                            {target.reasoning.thinking.map(mode => <option key={mode} value={mode}>{t(mode)}</option>)}
                        </select>
                    </label>}
                    {target.reasoning.effort.length > 0 && <label className="block text-xs text-text-secondary">{t('Reasoning effort')}
                        <select aria-label={t('{provider} reasoning effort', { provider: providerName })} value={draft.reasoning?.effort ?? ''} onChange={e => setReasoning('effort', e.target.value)}
                            className="block w-full mt-1 bg-bg-input border border-border-subtle rounded-lg px-3 py-2 text-xs text-text-primary">
                            <option value="">{t('Provider default (not sent)')}</option>
                            {target.reasoning.effort.map(effort => <option key={effort} value={effort}>{t(effort)}</option>)}
                        </select>
                    </label>}
                    <p className="text-[10px] text-text-secondary">{t(!target.reasoning.verified
                        ? 'Reasoning values come from the protocol, not from this model or endpoint. They are sent as chosen and may be rejected; nothing is removed or lowered automatically.'
                        : target.reasoning.effort.length || target.reasoning.thinking.length
                            ? 'Reasoning values follow the vendor documentation for this exact model.'
                            : 'The vendor documents no reasoning setting for this model.')}</p>
                    {target.capacity && <p className="text-[10px] text-text-secondary">{t('Vendor-documented context window: {context} tokens; maximum output: {output} tokens. Reference only; requests are not checked against it.', { context: target.capacity.contextTokens.toLocaleString(), output: target.capacity.outputTokens.toLocaleString() })}</p>}
                    {target.custom && <label className="block text-xs text-text-secondary">{t('Context window in tokens (optional note for this endpoint)')}
                        <input aria-label={t('{provider} context window', { provider: providerName })} type="number" min="1" step="1" value={draft.contextWindowTokens ?? ''}
                            onChange={e => setDraft(prev => ({ ...prev, contextWindowTokens: e.target.value ? Number(e.target.value) : undefined }))}
                            className="block w-full mt-1 bg-bg-input border border-border-subtle rounded-lg px-3 py-2 text-xs text-text-primary" />
                        <span className="block text-[10px] mt-1">{t('Informational only. Requests are never refused or shortened because of it.')}</span>
                    </label>}
                </>}
                {draftError && <p role="alert" className="text-[10px] text-red-400">{t(draftError)}</p>}
                <p className="text-[10px] text-text-secondary">{t('Use Save to activate the complete configuration. Test and model discovery use only the saved target. Custom addresses may receive your data and API key.')}</p>
                {(() => {
                    let known: boolean | undefined;
                    try { known = knownModelImageSupport(draft); } catch { return null; }
                    if (known !== undefined) return <p className="text-[10px] text-text-secondary">{t(known ? 'Image input: supported by the vendor capability table.' : 'Image input: not supported by the vendor capability table.')}</p>;
                    return <label className="block text-xs text-text-secondary"><input type="checkbox" aria-label={t('{provider} model supports images', { provider: providerName })}
                        checked={draft.imageSupportConfirmedFor === imageSupportTarget(draft)}
                        onChange={e => setDraft(prev => ({ ...prev, imageSupportConfirmedFor: e.target.checked ? imageSupportTarget(prev) : undefined }))} /> {t('This model supports images')}
                        <span className="block text-[10px] mt-1">{t('Check the provider model documentation yourself before confirming. Applies only to this model, protocol and endpoint; not other or backup models.')}</span>
                    </label>;
                })()}
                {providerId === 'gemini' && gatewayMode && <p className="text-[10px] text-text-secondary">{t('Do not include an API version in the Gemini gateway URL.')}</p>}
            </div>

            {/* Action Row: Test Connection + Conditional Dropdown + Fetch Models */}
            <div className="flex items-center justify-between mb-3 w-full">
                <button
                    onClick={onTestConnection}
                    disabled={unsaved || !!draftError || !hasStoredKey || testStatus === 'testing'}
                    className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors border border-border-subtle flex items-center gap-2 shrink-0 ${testStatus === 'success' ? 'bg-green-500/10 text-green-500 border-green-500/20' :
                        testStatus === 'error' ? 'bg-red-500/10 text-red-500 border-red-500/20' :
                            'bg-bg-input hover:bg-bg-elevated text-text-primary'
                        }`}
                    title={testError ? t(testError) : t('Test Connection')}
                >
                    {testStatus === 'testing' ? <><Loader2 size={12} className="animate-spin" /> {t('Testing...')}</> :
                        testStatus === 'success' ? <><CheckCircle size={12} /> {t('Connected')}</> :
                            testStatus === 'error' ? <><AlertCircle size={12} /> {t('Error')}</> :
                                <>{/* No Icon */} {t('Test Connection')}</>}
                </button>

                {hasStoredKey ? (
                    <button
                        onClick={handleFetchModels}
                        disabled={isFetching || unsaved || !!draftError}
                        className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors border border-border-subtle flex items-center gap-2 shrink-0 ${isFetching
                            ? 'bg-bg-input text-text-secondary'
                            : 'bg-accent-primary/10 text-accent-primary border-accent-primary/20 hover:bg-accent-primary/20'
                            }`}
                    >
                        {isFetching ? (
                            <><Loader2 size={12} className="animate-spin" /> {t('Fetching...')}</>
                        ) : (
                            <><RefreshCw size={12} /> {t('Fetch Models')}</>
                        )}
                    </button>
                ) : (
                    // Placeholder span to perfectly balance flex-between if button isn't shown
                    <span className="w-[110px]" />
                )}
            </div>

            {/* Error from test or fetch */}
            {testError && <p className="text-[10px] text-red-400 mt-1.5 mb-2">{t(testError)}</p>}
            {fetchError && <p className="text-[10px] text-red-400 mt-1.5 mb-2">{t('Model fetch error:')} {t(fetchError)}</p>}


        </div>
    );
};
