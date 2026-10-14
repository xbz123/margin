import { type AnswerProvider, type ProviderConfiguration } from '../../types/llmTarget';
import { imageSupportTarget, knownModelImageSupport } from '../../types/modelImageSupport';
import { officialModelCapacity, reasoningOptions, validateReasoning } from '../../types/modelReasoning';
import React, { useEffect, useId, useRef, useState } from 'react';
import type { CredentialSaveResult } from '../../types/credentialSave';
import { ChevronDown, ExternalLink, Loader2, RefreshCw, Trash2 } from 'lucide-react';
import { useI18n } from '../../i18n';

interface FetchedModel { id: string; label: string }

interface ProviderCardProps {
    providerId: AnswerProvider;
    providerName: string;
    icon: React.ReactNode;
    configuration: ProviderConfiguration;
    hasStoredKey: boolean;
    /** Set when the provider cannot be used as configured; shown instead of pretending it works. */
    unavailableReason?: string;
    keyPlaceholder: string;
    keyUrl: string;
    /** Persists the complete draft atomically; `clearKey` runs only after success. */
    onSave: (draft: ProviderConfiguration, key: string, clearKey: () => void) => Promise<CredentialSaveResult>;
    onRemoveKey: () => Promise<void>;
}

const TARGET_RESET = { imageSupportConfirmedFor: undefined, reasoning: undefined } as const;
const fingerprint = (config: ProviderConfiguration) => JSON.stringify([config.provider, config.protocol, config.model, config.reasoning ?? null, config.imageSupportConfirmedFor ?? null]);
const field = 'block w-full mt-1 bg-bg-input border border-border-subtle rounded-lg px-3 py-2 text-xs text-text-primary focus:outline-none focus:border-accent-primary';
const action = 'px-3 py-1.5 rounded-lg text-xs font-medium border border-border-subtle bg-bg-input hover:bg-bg-elevated text-text-primary transition-colors disabled:opacity-50 flex items-center gap-1.5';

/** One compact official-provider row; details stay mounted while collapsed so edits are never discarded. */
export const ProviderCard: React.FC<ProviderCardProps> = ({
    providerId, providerName, icon, configuration, hasStoredKey, unavailableReason, keyPlaceholder, keyUrl, onSave, onRemoveKey,
}) => {
    const { t } = useI18n();
    const detailsId = useId();
    const [expanded, setExpanded] = useState(false);
    const [draft, setDraft] = useState<ProviderConfiguration>(configuration);
    const [key, setKey] = useState('');
    const keyRef = useRef(''); keyRef.current = key;
    const draftRef = useRef(draft); draftRef.current = draft;
    const savedRef = useRef(configuration);
    // Any edit, save or removal supersedes older asynchronous results.
    const fetchRevision = useRef(0);
    const operation = useRef(0);
    const saving = useRef(false);
    const [busy, setBusy] = useState<'saving' | 'testing' | 'fetching' | null>(null);
    const [notice, setNotice] = useState<{ tone: 'error' | 'info'; text: string } | null>(null);
    const [testedFor, setTestedFor] = useState<string | undefined>();
    const [fetchedModels, setFetchedModels] = useState<FetchedModel[]>([]);
    const [fetchError, setFetchError] = useState<string | null>(null);

    // A newer saved configuration replaces the draft only when the user has not edited it since.
    useEffect(() => {
        if (fingerprint(draftRef.current) === fingerprint(savedRef.current)) setDraft(configuration);
        savedRef.current = configuration;
    }, [configuration]);
    useEffect(() => () => { fetchRevision.current++; operation.current++; }, []);

    const dirty = fingerprint(draft) !== fingerprint(configuration) || !!key.trim();
    const connected = !dirty && testedFor === fingerprint(configuration);
    const edit = (update: (prev: ProviderConfiguration) => ProviderConfiguration) => {
        fetchRevision.current++; operation.current++; if (!saving.current) setBusy(null); setNotice(null); setDraft(update);
    };
    const target = (() => { try { return { reasoning: reasoningOptions(draft), capacity: officialModelCapacity(draft) }; } catch { return undefined; } })();
    const draftError = (() => { try { validateReasoning(draft, draft.reasoning); return undefined; } catch (e: any) { return e.message as string; } })();

    const save = async (): Promise<{ ok: boolean; revision: number; saved?: ProviderConfiguration }> => {
        if (saving.current) return { ok: false, revision: operation.current };
        const revision = ++operation.current;
        if (draftError) { setNotice({ tone: 'error', text: draftError }); return { ok: false, revision }; }
        if (!key.trim() && !hasStoredKey) { setNotice({ tone: 'error', text: 'Enter an API key before saving.' }); return { ok: false, revision }; }
        const submitted = draft, submittedKey = key;
        saving.current = true; setBusy('saving'); setNotice(null);
        let result: CredentialSaveResult;
        try { result = await onSave(submitted, submittedKey, () => { if (keyRef.current === submittedKey) setKey(''); }); }
        finally { saving.current = false; setBusy(null); }
        if (revision !== operation.current) return { ok: result.ok, revision };
        setBusy(null);
        if (!result.ok) { setNotice({ tone: 'error', text: result.message }); return { ok: false, revision }; }
        setTestedFor(undefined);
        setNotice({ tone: 'info', text: result.warning || 'Saved. The connection has not been tested.' });
        return { ok: true, revision, saved: submitted };
    };

    const handleSaveAndTest = async () => {
        let revision = operation.current, saved = configuration;
        if (dirty) {
            const result = await save();
            if (!result.ok || !result.saved || result.revision !== operation.current) return;
            revision = result.revision; saved = result.saved;
        } else if (!hasStoredKey) { setNotice({ tone: 'error', text: 'Enter an API key before saving.' }); return; }
        setBusy('testing'); setNotice(null);
        try {
            const result = await window.electronAPI.testLlmConnection(providerId, undefined, saved);
            if (revision !== operation.current) return;
            if (result.success) { setTestedFor(fingerprint(saved)); setNotice({ tone: 'info', text: 'Connection test passed for the saved configuration.' }); }
            else setNotice({ tone: 'error', text: result.error || 'Connection failed' });
        } catch { if (revision === operation.current) setNotice({ tone: 'error', text: 'Connection failed' }); }
        finally { if (revision === operation.current) setBusy(null); }
    };

    const handleFetchModels = async () => {
        if (!hasStoredKey) { setFetchError('Save an API key first.'); return; }
        if (dirty) { setFetchError('Save first: model lists use the saved key and configuration.'); return; }
        const revision = ++fetchRevision.current;
        setBusy('fetching'); setFetchError(null);
        try {
            const result = await window.electronAPI?.fetchProviderModels(providerId, '');
            if (revision !== fetchRevision.current) return;
            if (result?.success && result.models) {
                setFetchedModels(result.models);
                if (!result.models.length) setFetchError('No models were returned by this provider.');
            } else setFetchError(result?.error || 'Failed to fetch models');
        } catch { if (revision === fetchRevision.current) setFetchError('Failed to fetch models'); }
        finally { if (revision === fetchRevision.current) setBusy(null); }
    };

    const handleRemove = async () => { operation.current++; fetchRevision.current++; setBusy(null); await onRemoveKey(); setTestedFor(undefined); };

    const models = fetchedModels.map(model => [model.id, model.label] as const);
    const status = unavailableReason ? t('Unavailable') : connected ? t('Connected') : hasStoredKey ? t('Key saved') : t('Not configured');

    return (
        <div className="border-b border-border-subtle last:border-b-0">
            <button type="button" aria-expanded={expanded} aria-controls={detailsId} onClick={() => setExpanded(value => !value)}
                className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-bg-item-active/40 transition-colors">
                <span className="w-8 h-8 rounded-lg bg-bg-input border border-border-subtle flex items-center justify-center text-text-primary shrink-0">{icon}</span>
                <span className="flex-1 min-w-0">
                    <span className="block text-sm font-medium text-text-primary">{providerName}</span>
                    <span className={`block text-[11px] ${unavailableReason ? 'text-amber-500' : connected || hasStoredKey ? 'text-emerald-500' : 'text-text-tertiary'}`}>
                        {status}{dirty ? ` · ${t('Unsaved changes')}` : ''}
                    </span>
                </span>
                <ChevronDown size={16} className={`text-text-tertiary transition-transform ${expanded ? 'rotate-180' : ''}`} />
            </button>
            <div id={detailsId} hidden={!expanded} className="px-4 pb-4 space-y-3">
                {unavailableReason && <p role="alert" className="text-[11px] text-amber-500">{t(unavailableReason)}</p>}
                <div className="flex items-end gap-2">
                    <label className="flex-1 block text-xs text-text-secondary">{t('{provider} API Key', { provider: providerName })}
                        <input type="password" aria-label={t('{provider} API Key', { provider: providerName })} value={key}
                            onChange={e => { operation.current++; fetchRevision.current++; if (!saving.current) setBusy(null); setNotice(null); setKey(e.target.value); }}
                            placeholder={hasStoredKey ? '••••••••••••' : keyPlaceholder} className={field} />
                    </label>
                    <button type="button" data-external-url={keyUrl} onClick={() => window.electronAPI?.openExternal(keyUrl)}
                        className="mb-2 text-[10px] uppercase tracking-wide text-text-tertiary hover:text-text-primary flex items-center gap-1" title={t('Get {provider} API Key', { provider: providerName })}>
                        {t('Get Key')} <ExternalLink size={12} />
                    </button>
                </div>
                <div className={`grid gap-3 ${providerId === 'openai' ? 'grid-cols-1 md:grid-cols-2' : 'grid-cols-1'}`}>
                    <label className="block text-xs text-text-secondary">{t('Select model')}
                        <select aria-label={t('{provider} model', { provider: providerName })} value={draft.model} className={field} disabled={!models.length}
                            onChange={e => edit(prev => ({ ...prev, model: e.target.value, ...TARGET_RESET }))}>
                            {!models.some(([id]) => id === draft.model) && <option value={draft.model}>{draft.model}</option>}
                            {models.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
                        </select>
                    </label>
                    {providerId === 'openai' && <label className="block text-xs text-text-secondary">{t('Protocol')}
                        <select aria-label={t('OpenAI protocol')} value={draft.protocol} className={field}
                            onChange={e => edit(prev => ({ ...prev, protocol: e.target.value as ProviderConfiguration['protocol'], ...TARGET_RESET }))}>
                            <option value="chat-completions">Chat Completions</option><option value="responses">Responses</option>
                        </select>
                    </label>}
                </div>
                {target && (target.reasoning.thinking.length > 0 || target.reasoning.effort.length > 0) && <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {target.reasoning.thinking.length > 0 && <label className="block text-xs text-text-secondary">{t('Thinking')}
                        <select aria-label={t('{provider} thinking', { provider: providerName })} value={draft.reasoning?.thinking ?? ''} className={field}
                            onChange={e => edit(prev => withReasoning(prev, 'thinking', e.target.value))}>
                            <option value="">{t('Provider default (not sent)')}</option>
                            {target.reasoning.thinking.map(mode => <option key={mode} value={mode}>{t(mode)}</option>)}
                        </select>
                    </label>}
                    {target.reasoning.effort.length > 0 && <label className="block text-xs text-text-secondary">{t('Reasoning effort')}
                        <select aria-label={t('{provider} reasoning effort', { provider: providerName })} value={draft.reasoning?.effort ?? ''} className={field}
                            onChange={e => edit(prev => withReasoning(prev, 'effort', e.target.value))}>
                            <option value="">{t('Provider default (not sent)')}</option>
                            {target.reasoning.effort.map(effort => <option key={effort} value={effort}>{t(effort)}</option>)}
                        </select>
                    </label>}
                </div>}
                {target && <p className="text-[10px] text-text-secondary">{t(!target.reasoning.verified
                    ? 'Reasoning values come from the protocol, not from this model or endpoint. They are sent as chosen and may be rejected; nothing is removed or lowered automatically.'
                    : target.reasoning.effort.length || target.reasoning.thinking.length
                        ? 'Reasoning values follow the vendor documentation for this exact model.'
                        : 'The vendor documents no reasoning setting for this model.')}</p>}
                {target?.capacity && <p className="text-[10px] text-text-secondary">{t('Vendor-documented context window: {context} tokens; maximum output: {output} tokens. Reference only; requests are not checked against it.', { context: target.capacity.contextTokens.toLocaleString(), output: target.capacity.outputTokens.toLocaleString() })}</p>}
                {(() => {
                    let known: boolean | undefined;
                    try { known = knownModelImageSupport(draft); } catch { return null; }
                    if (known !== undefined) return <p className="text-[10px] text-text-secondary">{t(known ? 'Image input: supported by the vendor capability table.' : 'Image input: not supported by the vendor capability table.')}</p>;
                    return <label className="block text-xs text-text-secondary"><input type="checkbox" aria-label={t('{provider} model supports images', { provider: providerName })}
                        checked={draft.imageSupportConfirmedFor === imageSupportTarget(draft)}
                        onChange={e => { const checked = e.target.checked; edit(prev => ({ ...prev, imageSupportConfirmedFor: checked ? imageSupportTarget(prev) : undefined })); }} /> {t('This model supports images')}
                        <span className="block text-[10px] mt-1">{t('Check the provider model documentation yourself before confirming. Applies only to this model, protocol and endpoint; not other or backup models.')}</span>
                    </label>;
                })()}
                <div className="flex flex-wrap items-center gap-2">
                    <button type="button" className={action} disabled={busy !== null} onClick={() => { void save(); }}>
                        {busy === 'saving' ? <Loader2 size={12} className="animate-spin" /> : null}{t('Save')}
                    </button>
                    <button type="button" className={action} disabled={busy !== null} onClick={handleSaveAndTest}>
                        {busy === 'testing' ? <Loader2 size={12} className="animate-spin" /> : null}{t('Save and test')}
                    </button>
                    <button type="button" className={action} disabled={busy !== null} onClick={handleFetchModels}>
                        {busy === 'fetching' ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}{t('Fetch Models')}
                    </button>
                    {hasStoredKey && <button type="button" disabled={busy === 'saving'} onClick={handleRemove} title={t('Remove API Key')} aria-label={t('Remove API Key')}
                        className="ml-auto px-2.5 py-1.5 rounded-lg text-text-tertiary hover:text-red-500 hover:bg-red-500/10"><Trash2 size={14} strokeWidth={1.5} /></button>}
                </div>
                {notice && <p role={notice.tone === 'error' ? 'alert' : 'status'} className={`text-[11px] ${notice.tone === 'error' ? 'text-red-400' : 'text-text-secondary'}`}>{t(notice.text)}</p>}
                {fetchError && <p role="status" className="text-[11px] text-amber-500">{t('Model fetch error:')} {t(fetchError)}</p>}
                <p className="text-[10px] text-text-tertiary">{t('Official API only. Save is local; Save and test sends one short test request to the saved target. Model lists use the saved key; fetching never selects or saves a model.')}</p>
            </div>
        </div>
    );
};

function withReasoning(prev: ProviderConfiguration, key: 'effort' | 'thinking', value: string): ProviderConfiguration {
    const next = { ...prev.reasoning, [key]: value || undefined };
    if (!next.effort) delete next.effort;
    if (!next.thinking) delete next.thinking;
    return { ...prev, reasoning: Object.keys(next).length ? next as ProviderConfiguration['reasoning'] : undefined };
}
