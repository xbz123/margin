import { providerCandidates, withCandidates, type AnswerProvider, type ModelSettings, type ProviderConfiguration } from '../../types/llmTarget';
import { officialCapability } from '../../types/modelCapabilities';
import React, { useEffect, useId, useRef, useState } from 'react';
import type { CredentialSaveResult } from '../../types/credentialSave';
import { ChevronDown, ExternalLink, Loader2, Plus, RefreshCw, Trash2 } from 'lucide-react';
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

// One saved candidate as a comparable value: its full target and its own settings.
const candidatePrint = (config: ProviderConfiguration, candidate: ModelSettings) => JSON.stringify([config.provider, config.protocol, candidate.model,
    candidate.reasoning?.effort ?? null, candidate.reasoning?.thinking ?? null, candidate.imageSupportConfirmedFor ?? null]);
const fingerprint = (config: ProviderConfiguration) => JSON.stringify(providerCandidates(config).map(candidate => candidatePrint(config, candidate)));
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
    // Which saved candidate the settings below edit and Save and test checks; never the running answer model.
    const [editing, setEditing] = useState(configuration.model);
    const [adding, setAdding] = useState('');

    // A newer saved configuration replaces the draft only when the user has not edited it since.
    useEffect(() => {
        if (fingerprint(draftRef.current) === fingerprint(savedRef.current)) setDraft(configuration);
        savedRef.current = configuration;
    }, [configuration]);
    useEffect(() => () => { fetchRevision.current++; operation.current++; }, []);
    useEffect(() => {
        fetchRevision.current++;
        setFetchedModels([]);
        setBusy(current => current === 'fetching' ? null : current);
    }, [draft.protocol]);

    const candidates = providerCandidates(draft);
    const current = candidates.find(candidate => candidate.model === editing) ?? candidates[0];
    // The edited candidate as a single target, so capability checks see only its own model and settings.
    const selected: ProviderConfiguration = { provider: draft.provider, protocol: draft.protocol, ...current };
    const savedCandidate = providerCandidates(configuration).find(candidate => candidate.model === current.model);
    const dirty = fingerprint(draft) !== fingerprint(configuration) || !!key.trim();
    const connected = !dirty && !!savedCandidate && testedFor === candidatePrint(configuration, savedCandidate);
    const edit = (update: (prev: ProviderConfiguration) => ProviderConfiguration) => {
        fetchRevision.current++; operation.current++; if (!saving.current) setBusy(null); setNotice(null); setDraft(update);
    };
    // Read-only facts of the edited candidate; reasoning is chosen with the answer model (S48).
    const capability = (() => { try { return officialCapability(selected); } catch { return undefined; } })();

    const save = async (): Promise<{ ok: boolean; revision: number; saved?: ProviderConfiguration }> => {
        if (saving.current) return { ok: false, revision: operation.current };
        const revision = ++operation.current;
        if (!key.trim() && !hasStoredKey) { setNotice({ tone: 'error', text: 'Enter an API key before saving.' }); return { ok: false, revision }; }
        const submitted = draft, submittedKey = key;
        saving.current = true; setBusy('saving'); setNotice(null);
        let result: CredentialSaveResult;
        try { result = await onSave(submitted, submittedKey, () => { if (keyRef.current === submittedKey) setKey(''); }); }
        finally { saving.current = false; setBusy(null); }
        if (revision !== operation.current) return { ok: result.ok, revision };
        setBusy(null);
        if (!result.ok) { setNotice({ tone: 'error', text: result.message }); return { ok: false, revision }; }
        setAdding('');
        setTestedFor(undefined);
        setNotice({ tone: 'info', text: result.warning || 'Saved. The connection has not been tested.' });
        return { ok: true, revision, saved: submitted };
    };

    const handleSaveAndTest = async () => {
        let revision = operation.current, saved = configuration;
        const model = current.model;
        if (dirty) {
            const result = await save();
            if (!result.ok || !result.saved || result.revision !== operation.current) return;
            revision = result.revision; saved = result.saved;
        } else if (!hasStoredKey) { setNotice({ tone: 'error', text: 'Enter an API key before saving.' }); return; }
        setBusy('testing'); setNotice(null);
        try {
            // Exactly the edited candidate of what was just saved; other candidates and the backup are not tried.
            const result = await window.electronAPI.testLlmConnection(providerId, undefined, saved, model);
            if (revision !== operation.current) return;
            const tested = providerCandidates(saved).find(candidate => candidate.model === model);
            if (result.success && tested) { setTestedFor(candidatePrint(saved, tested)); setNotice({ tone: 'info', text: 'Connection test passed for the saved configuration of this model.' }); }
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
                if (!result.models.length) setFetchError('No supported answer models were returned for this provider and protocol.');
            } else setFetchError(result?.error || 'Failed to fetch models');
        } catch { if (revision === fetchRevision.current) setFetchError('Failed to fetch models'); }
        finally { if (revision === fetchRevision.current) setBusy(null); }
    };

    const handleRemove = async () => { operation.current++; fetchRevision.current++; setBusy(null); await onRemoveKey(); setTestedFor(undefined); };

    // Fetched models and saved candidates removed in this draft can be added; listing proves no access.
    const addable = [...fetchedModels.map(model => [model.id, model.label] as const),
        ...providerCandidates(configuration).map(candidate => [candidate.model, candidate.model] as const)]
        .filter(([id], index, list) => !candidates.some(candidate => candidate.model === id) && list.findIndex(([other]) => other === id) === index);
    const addModel = () => {
        const model = addable.find(([id]) => id === adding)?.[0];
        if (!model) return;
        const restored = providerCandidates(configuration).find(candidate => candidate.model === model);
        edit(prev => withCandidates(prev, [...providerCandidates(prev), restored ?? { model }]));
        setEditing(model); setAdding('');
    };
    const removeModel = () => {
        if (candidates.length < 2) return;
        edit(prev => withCandidates(prev, providerCandidates(prev).filter(candidate => candidate.model !== current.model)));
        setEditing(candidates.find(candidate => candidate.model !== current.model)!.model);
    };
    const status = unavailableReason ? t('Unavailable') : connected ? t('Test passed: {model}', { model: current.model }) : hasStoredKey ? t('Key saved') : t('Not configured');

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
                    <label className="block text-xs text-text-secondary">{t('Edit saved model')}
                        <select aria-label={t('{provider} model', { provider: providerName })} value={current.model} className={field}
                            onChange={e => { operation.current++; if (!saving.current) setBusy(null); setNotice(null); setEditing(e.target.value); }}>
                            {candidates.map(candidate => <option key={candidate.model} value={candidate.model}>{candidate.model}</option>)}
                        </select>
                    </label>
                    {providerId === 'openai' && <label className="block text-xs text-text-secondary">{t('Protocol')}
                        <select aria-label={t('OpenAI protocol')} value={draft.protocol} className={field}
                            onChange={e => { const protocol = e.target.value as ProviderConfiguration['protocol']; edit(prev => ({ ...prev, protocol })); }}>
                            <option value="chat-completions">Chat Completions</option><option value="responses">Responses</option>
                        </select>
                    </label>}
                </div>
                <div className="flex items-end gap-2">
                    <label className="flex-1 block text-xs text-text-secondary">{t('Add a fetched model')}
                        <select aria-label={t('{provider} model to add', { provider: providerName })} value={adding} className={field} disabled={!addable.length}
                            onChange={e => setAdding(e.target.value)}>
                            <option value="">{t(addable.length ? 'Choose a model to add' : 'Fetch models to add more')}</option>
                            {addable.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
                        </select>
                    </label>
                    <button type="button" className={`${action} mb-0.5`} disabled={!adding || busy === 'saving'} onClick={addModel}><Plus size={12} />{t('Add model')}</button>
                    <button type="button" className={`${action} mb-0.5`} disabled={candidates.length < 2 || busy === 'saving'} onClick={removeModel}
                        title={t('Remove {model} from this provider', { model: current.model })}>{t('Remove model')}</button>
                </div>
                {capability?.retired && <p role="note" className="text-[11px] text-amber-500">{t(capability.retired)}</p>}
                {capability?.answerUnavailable && <p role="note" className="text-[11px] text-amber-500">{t(capability.answerUnavailable)}</p>}
                <p className="text-[10px] text-text-secondary">{t(capability?.images === true ? 'Image input: supported according to the official model record.'
                    : capability?.images === false ? 'Image input: not supported according to the official model record. Image questions are refused before sending; text works.'
                        : 'Image input has not been verified for this model yet. Image questions are refused before sending; text works.')}</p>
                {capability?.capacity && <p className="text-[10px] text-text-secondary">{t('Vendor-documented context window: {context} tokens; maximum output: {output} tokens. Reference only; requests are not checked against it.', { context: capability.capacity.contextTokens.toLocaleString(), output: capability.capacity.outputTokens.toLocaleString() })}</p>}
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
                <p className="text-[10px] text-text-tertiary">{t('Official API only. Save is local; Save and test sends one short test request to the edited saved model. Model lists use the saved key; fetching never selects or saves a model, and a listed model is not proof of access. Added models appear in the answer model lists after saving.')}</p>
            </div>
        </div>
    );
};
