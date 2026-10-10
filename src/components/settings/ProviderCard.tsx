import { LLM_PRESETS, type ProviderConfiguration } from '../../types/llmTarget';
import { imageSupportTarget, knownModelImageSupport } from '../../types/modelImageSupport';
import React, { useState, useEffect, useRef } from 'react';
import type { CredentialSaveResult } from '../../types/credentialSave';
import { Trash2, AlertCircle, CheckCircle, ExternalLink, Loader2, ChevronDown, Check, RefreshCw } from 'lucide-react';

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

export const ProviderCard: React.FC<ProviderCardProps> = ({
    providerId,
    providerName,
    configuration,
    apiKey,
    preferredModel,
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
    const savedConfig = configuration ?? LLM_PRESETS[providerId];
    const [draft, setDraft] = useState<ProviderConfiguration>(savedConfig);
    const unsaved = JSON.stringify(draft) !== JSON.stringify(savedConfig) || !!apiKey.trim();
    useEffect(() => { setDraft(savedConfig); setFetchedModels([]); }, [configuration]);
    const [fetchedModels, setFetchedModels] = useState<FetchedModel[]>([]);
    const [isFetching, setIsFetching] = useState(false);
    const [fetchError, setFetchError] = useState<string | null>(null);
    const [selectedModel, setSelectedModel] = useState<string>(preferredModel || '');
    const [isDropdownOpen, setIsDropdownOpen] = useState(false);
    const dropdownRef = React.useRef<HTMLDivElement>(null);

    // Sync preferredModel prop
    useEffect(() => {
        if (preferredModel) setSelectedModel(preferredModel);
    }, [preferredModel]);

    // Close dropdown on outside click
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                setIsDropdownOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const handleFetchModels = async () => {
        setIsFetching(true);
        setFetchError(null);

        try {
            if (unsaved) { setFetchError('Save the complete configuration before fetching models.'); return; }
            const result = await window.electronAPI?.fetchProviderModels(providerId, '');

            if (result?.success && result.models) {
                setFetchedModels(result.models);
            } else {
                setFetchError(result?.error || 'Failed to fetch models');
            }
        } catch (e: any) {
            setFetchError(e.message || 'Failed to fetch models');
        } finally {
            setIsFetching(false);
        }
    };

    const handleSelectModel = async (modelId: string) => {
        setIsDropdownOpen(false);
        setDraft(prev => ({ ...prev, model: modelId, imageSupportConfirmedFor: undefined }));
        setSelectedModel(modelId);
    };

    const selectedOption = fetchedModels.find(m => m.id === selectedModel);

    return (
        <div className="bg-bg-item-surface rounded-xl p-5 border border-border-subtle">
            <div className="mb-2 flex items-center justify-between">
                <label className="flex items-center text-xs font-medium text-text-primary uppercase tracking-wide">
                    {providerName} API Key
                    {hasStoredKey && <span className="ml-2 text-green-500 normal-case">✓ Saved</span>}
                </label>
                <button
                    data-external-url={keyUrl}
                    onClick={() => {
                        // @ts-ignore
                        window.electronAPI?.openExternal(keyUrl);
                    }}
                    className="text-xs text-text-tertiary hover:text-text-primary flex items-center gap-1 transition-colors"
                    title={`Get ${providerName} API Key`}
                >
                    <span className="text-[10px] uppercase tracking-wide">Get Key</span>
                    <ExternalLink size={12} />
                </button>
            </div>
            <div className="flex gap-2 mb-3">
                <input
                    type="password"
                    value={apiKey}
                    onChange={(e) => onKeyChange(e.target.value)}
                    placeholder={hasStoredKey ? "••••••••••••" : keyPlaceholder}
                    className="flex-1 bg-bg-input border border-border-subtle rounded-lg px-4 py-2.5 text-xs text-text-primary focus:outline-none focus:border-accent-primary transition-colors"
                />
                <button
                    onClick={() => onSaveKey(draft)}
                    disabled={savingStatus || (!apiKey.trim() && !hasStoredKey)}
                    className={`px-5 py-2.5 rounded-lg text-xs font-medium transition-colors ${savedStatus
                        ? 'bg-green-500/20 text-green-400'
                        : 'bg-bg-input hover:bg-bg-secondary border border-border-subtle text-text-primary disabled:opacity-50'
                        }`}
                >
                    {savingStatus ? 'Saving...' : savedStatus ? 'Saved!' : 'Save'}
                </button>
                {hasStoredKey && (
                    <button
                        onClick={onRemoveKey}
                        className="px-2.5 py-2.5 rounded-lg text-xs font-medium text-text-tertiary hover:text-red-500 hover:bg-red-500/10 transition-all"
                        title="Remove API Key"
                    >
                        <Trash2 size={16} strokeWidth={1.5} />
                    </button>
                )}
            </div>

            <div className="space-y-2 mb-3">
                <label className="block text-xs text-text-secondary">API base URL (empty uses the vendor preset)
                    <input aria-label={`${providerName} API base URL`} value={draft.baseUrl ?? ''}
                        onChange={e => setDraft(prev => ({ ...prev, baseUrl: e.target.value, imageSupportConfirmedFor: undefined }))}
                        placeholder={providerId === 'gemini' ? 'https://generativelanguage.googleapis.com' : providerId === 'claude' ? 'https://api.anthropic.com' : 'https://service.example/v1'}
                        className="block w-full mt-1 bg-bg-input border border-border-subtle rounded-lg px-3 py-2 text-xs text-text-primary" />
                </label>
                {providerId === 'openai' && <label className="block text-xs text-text-secondary">Protocol
                    <select aria-label="OpenAI protocol" value={draft.protocol} onChange={e => setDraft(prev => ({ ...prev, protocol: e.target.value as ProviderConfiguration['protocol'], imageSupportConfirmedFor: undefined }))}
                        className="block w-full mt-1 bg-bg-input border border-border-subtle rounded-lg px-3 py-2 text-xs text-text-primary">
                        <option value="chat-completions">Chat Completions</option><option value="responses">Responses</option>
                    </select>
                </label>}
                <label className="block text-xs text-text-secondary">Model ID
                    <input aria-label={`${providerName} model ID`} value={draft.model}
                        onChange={e => setDraft(prev => ({ ...prev, model: e.target.value, imageSupportConfirmedFor: undefined }))}
                        className="block w-full mt-1 bg-bg-input border border-border-subtle rounded-lg px-3 py-2 text-xs text-text-primary" />
                </label>
                <p className="text-[10px] text-text-secondary">Use Save to activate the complete configuration. Test and model discovery use only the saved target. Custom addresses may receive your data and API key.</p>
                {(() => {
                    let known: boolean | undefined;
                    try { known = knownModelImageSupport(draft); } catch { return null; }
                    if (known !== undefined) return <p className="text-[10px] text-text-secondary">Image input: {known ? 'supported' : 'not supported'} by the vendor capability table.</p>;
                    return <label className="block text-xs text-text-secondary"><input type="checkbox" aria-label={`${providerName} model supports images`}
                        checked={draft.imageSupportConfirmedFor === imageSupportTarget(draft)}
                        onChange={e => setDraft(prev => ({ ...prev, imageSupportConfirmedFor: e.target.checked ? imageSupportTarget(prev) : undefined }))} /> This model supports images
                        <span className="block text-[10px] mt-1">Check the provider model documentation yourself before confirming. Applies only to this model, protocol and endpoint; not other or backup models.</span>
                    </label>;
                })()}
                {providerId === 'gemini' && <p className="text-[10px] text-text-secondary">Gemini uses v1alpha for generation and model discovery. Do not include the API version in the base URL.</p>}
            </div>

            {/* Action Row: Test Connection + Conditional Dropdown + Fetch Models */}
            <div className="flex items-center justify-between mb-3 w-full">
                <button
                    onClick={onTestConnection}
                    disabled={unsaved || !hasStoredKey || testStatus === 'testing'}
                    className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors border border-border-subtle flex items-center gap-2 shrink-0 ${testStatus === 'success' ? 'bg-green-500/10 text-green-500 border-green-500/20' :
                        testStatus === 'error' ? 'bg-red-500/10 text-red-500 border-red-500/20' :
                            'bg-bg-input hover:bg-bg-elevated text-text-primary'
                        }`}
                    title={testError || "Test Connection"}
                >
                    {testStatus === 'testing' ? <><Loader2 size={12} className="animate-spin" /> Testing...</> :
                        testStatus === 'success' ? <><CheckCircle size={12} /> Connected</> :
                            testStatus === 'error' ? <><AlertCircle size={12} /> Error</> :
                                <>{/* No Icon */} Test Connection</>}
                </button>

                {/* Inline Model Dropdown */}
                {fetchedModels.length > 0 || preferredModel ? (
                    <div className="relative flex-1 max-w-[200px] mx-4" ref={dropdownRef}>
                        <button
                            onClick={() => fetchedModels.length > 0 && setIsDropdownOpen(!isDropdownOpen)}
                            className={`w-full bg-bg-input border border-border-subtle rounded-md px-3 py-1.5 text-xs text-text-primary focus:outline-none focus:border-accent-primary flex items-center justify-between transition-colors ${fetchedModels.length > 0 ? 'hover:bg-bg-elevated' : 'opacity-80 cursor-default'}`}
                            type="button"
                        >
                            <span className="truncate pr-2">{selectedOption ? selectedOption.label : (preferredModel || 'Select model')}</span>
                            <ChevronDown size={14} className={`text-text-secondary transition-transform ${isDropdownOpen ? 'rotate-180' : ''} ${fetchedModels.length === 0 ? 'opacity-50' : ''}`} />
                        </button>

                        {isDropdownOpen && fetchedModels.length > 0 && (
                            <div className="absolute top-full left-1/2 -translate-x-1/2 mt-1 w-full min-w-[200px] bg-bg-elevated border border-border-subtle rounded-lg shadow-xl z-50 max-h-60 overflow-y-auto animated fadeIn">
                                <div className="p-1 space-y-0.5">
                                    {fetchedModels.map((model) => (
                                        <button
                                            key={model.id}
                                            onClick={() => handleSelectModel(model.id)}
                                            className={`w-full text-left px-3 py-2 text-xs rounded-md flex items-center justify-between group transition-colors ${selectedModel === model.id ? 'bg-bg-input hover:bg-bg-elevated text-text-primary' : 'text-text-secondary hover:bg-bg-input hover:text-text-primary'}`}
                                            type="button"
                                        >
                                            <span className="truncate">{model.label}</span>
                                            {selectedModel === model.id && <Check size={14} className="text-accent-primary shrink-0 ml-2" />}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                ) : (
                    <div className="flex-1 mx-4" />
                )}

                {hasStoredKey ? (
                    <button
                        onClick={handleFetchModels}
                        disabled={isFetching || unsaved}
                        className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors border border-border-subtle flex items-center gap-2 shrink-0 ${isFetching
                            ? 'bg-bg-input text-text-secondary'
                            : 'bg-accent-primary/10 text-accent-primary border-accent-primary/20 hover:bg-accent-primary/20'
                            }`}
                    >
                        {isFetching ? (
                            <><Loader2 size={12} className="animate-spin" /> Fetching...</>
                        ) : (
                            <><RefreshCw size={12} /> Fetch Models</>
                        )}
                    </button>
                ) : (
                    // Placeholder span to perfectly balance flex-between if button isn't shown
                    <span className="w-[110px]" />
                )}
            </div>

            {/* Error from test or fetch */}
            {testError && <p className="text-[10px] text-red-400 mt-1.5 mb-2">{testError}</p>}
            {fetchError && <p className="text-[10px] text-red-400 mt-1.5 mb-2">Model fetch error: {fetchError}</p>}


        </div>
    );
};
