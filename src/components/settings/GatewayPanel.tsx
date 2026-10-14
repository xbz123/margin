import React, { useEffect, useId, useRef, useState } from 'react';
import { Loader2, RefreshCw, Server, Trash2 } from 'lucide-react';
import { LLM_PROTOCOLS, gatewayTarget, type GatewayConfiguration, type GatewaySummary, type LlmProtocol } from '../../types/llmTarget';
import { imageSupportTarget } from '../../types/modelImageSupport';
import { reasoningOptions, validateReasoning } from '../../types/modelReasoning';
import { PROTOCOL_NAMES, gatewayLabel } from '../../utils/answerModelOptions';
import { useI18n } from '../../i18n';

type Draft = Omit<GatewayConfiguration, 'id'>;
const EMPTY: Draft = { protocol: 'chat-completions', baseUrl: '', model: '' };
const field = 'block w-full mt-1 bg-bg-input border border-border-subtle rounded-lg px-3 py-2 text-xs text-text-primary focus:outline-none focus:border-accent-primary';
const action = 'px-3 py-1.5 rounded-lg text-xs font-medium border border-border-subtle bg-bg-input hover:bg-bg-elevated text-text-primary transition-colors disabled:opacity-50 flex items-center gap-1.5';
const base = (url: string) => url.trim().replace(/\/+$/, '');
const draftOf = (gateway?: GatewaySummary): Draft => gateway ? { protocol: gateway.protocol, baseUrl: gateway.baseUrl, model: gateway.model,
    ...(gateway.reasoning ? { reasoning: gateway.reasoning } : {}), ...(gateway.contextWindowTokens !== undefined ? { contextWindowTokens: gateway.contextWindowTokens } : {}),
    ...(gateway.imageSupportConfirmedFor ? { imageSupportConfirmedFor: gateway.imageSupportConfirmedFor } : {}) } : EMPTY;
const fingerprint = (draft: Draft) => JSON.stringify([draft.protocol, base(draft.baseUrl), draft.model.trim(), draft.reasoning ?? null, draft.contextWindowTokens ?? null, draft.imageSupportConfirmedFor ?? null]);
const origin = (url: string) => { try { return new URL(url.trim()).origin; } catch { return undefined; } };

interface GatewayPanelProps {
    /** Undefined for a new gateway; the first successful save creates its own identity. */
    gateway?: GatewaySummary;
    onSaved: (id: string) => Promise<void>;
    onRemoved: (id: string) => Promise<void>;
}

/** One compatible gateway with its own address, protocol, model and key. It never uses an official provider's settings. */
export const GatewayPanel: React.FC<GatewayPanelProps> = ({ gateway, onSaved, onRemoved }) => {
    const { t } = useI18n();
    const listId = useId();
    const saved = draftOf(gateway);
    const [draft, setDraft] = useState<Draft>(saved);
    const [key, setKey] = useState('');
    const keyRef = useRef(''); keyRef.current = key;
    const draftRef = useRef(draft); draftRef.current = draft;
    const savedRef = useRef(saved);
    const operation = useRef(0);
    const saving = useRef(false);
    const [busy, setBusy] = useState<'saving' | 'testing' | 'fetching' | 'removing' | null>(null);
    const [notice, setNotice] = useState<{ tone: 'error' | 'info'; text: string } | null>(null);
    const [testedFor, setTestedFor] = useState<string | undefined>();
    const [models, setModels] = useState<{ id: string; label: string }[]>([]);

    useEffect(() => {
        if (fingerprint(draftRef.current) === fingerprint(savedRef.current)) setDraft(saved);
        savedRef.current = saved;
    }, [JSON.stringify(gateway ?? null)]);
    useEffect(() => () => { operation.current++; }, []);

    const dirty = !gateway || fingerprint(draft) !== fingerprint(saved) || !!key.trim();
    const connected = !!gateway && !dirty && testedFor === fingerprint(saved);
    const edit = (update: (prev: Draft) => Draft) => { operation.current++; if (!saving.current) setBusy(null); setNotice(null); setDraft(update); };
    const reasoning = (() => { try { return reasoningOptions({ provider: 'gateway', protocol: draft.protocol, model: draft.model || 'model' }); } catch { return undefined; } })();
    const imageBinding = (() => {
        if (!gateway || !origin(draft.baseUrl) || !draft.model.trim()) return undefined;
        try { return imageSupportTarget(gatewayTarget({ ...draft, id: gateway.id, baseUrl: base(draft.baseUrl), model: draft.model.trim() })); } catch { return undefined; }
    })();

    const validate = (): string | undefined => {
        const url = origin(draft.baseUrl);
        if (!url || !/^https?:/.test(url)) return 'Enter a valid gateway URL starting with https:// or http://.';
        if (!draft.model.trim()) return 'Enter or select a model ID.';
        try { validateReasoning({ provider: 'gateway', protocol: draft.protocol, model: draft.model }, draft.reasoning); } catch (e: any) { return e.message; }
        const tokens = draft.contextWindowTokens;
        if (tokens !== undefined && (!Number.isSafeInteger(tokens) || tokens <= 0)) return 'Context window must be a positive whole number of tokens.';
        if (!gateway && !key.trim()) return 'Enter the gateway API key before saving.';
        if (gateway && origin(gateway.baseUrl) !== url && !key.trim()) return 'Re-enter the API key after changing the gateway address. The previous configuration was kept.';
        return undefined;
    };

    const save = async (): Promise<{ ok: boolean; revision: number; id?: string; saved?: Draft }> => {
        if (saving.current) return { ok: false, revision: operation.current };
        const revision = ++operation.current;
        const invalid = validate();
        if (invalid) { setNotice({ tone: 'error', text: invalid }); return { ok: false, revision }; }
        const submitted = { ...draft, baseUrl: draft.baseUrl.trim(), model: draft.model.trim() }, submittedKey = key;
        saving.current = true; setBusy('saving'); setNotice(null);
        try {
            const result = await window.electronAPI.setGatewayConfiguration({ ...(gateway ? { id: gateway.id } : {}), ...submitted, ...(submittedKey.trim() ? { apiKey: submittedKey } : {}) });
            if (!result?.ok || !result.gatewayId) {
                if (revision === operation.current) setNotice({ tone: 'error', text: (result && !result.ok && result.message) || 'The gateway could not be saved. The previous configuration was kept.' });
                return { ok: false, revision };
            }
            if (keyRef.current === submittedKey) setKey('');
            await onSaved(result.gatewayId);
            if (revision === operation.current) { setTestedFor(undefined); setNotice({ tone: 'info', text: result.warning || 'Saved. The connection has not been tested.' }); }
            return { ok: true, revision, id: result.gatewayId, saved: submitted };
        } catch {
            if (revision === operation.current) setNotice({ tone: 'error', text: 'The gateway could not be saved. The previous configuration was kept.' });
            return { ok: false, revision };
        } finally { saving.current = false; setBusy(null); }
    };

    const handleSaveAndTest = async () => {
        let revision = operation.current, id = gateway?.id, tested = saved;
        if (dirty) {
            const result = await save();
            if (!result.ok || result.revision !== operation.current) return;
            revision = result.revision; id = result.id; tested = result.saved!;
        }
        if (!id) return;
        setBusy('testing'); setNotice(null);
        try {
            // The main process refuses unless the saved gateway is exactly what was just saved.
            const result = await window.electronAPI.testGatewayConnection(id, { ...tested, id });
            if (revision !== operation.current) return;
            if (result.success) { setTestedFor(fingerprint(tested)); setNotice({ tone: 'info', text: 'Connection test passed for the saved configuration.' }); }
            else setNotice({ tone: 'error', text: result.error || 'Connection failed' });
        } catch { if (revision === operation.current) setNotice({ tone: 'error', text: 'Connection failed' }); }
        finally { if (revision === operation.current) setBusy(null); }
    };

    const handleFetchModels = async () => {
        if (!gateway) { setNotice({ tone: 'info', text: 'Save the gateway first: model lists use its saved address and key.' }); return; }
        if (dirty) { setNotice({ tone: 'info', text: 'Save first: model lists use the saved key and configuration.' }); return; }
        const revision = ++operation.current;
        setBusy('fetching'); setNotice(null);
        try {
            const result = await window.electronAPI.fetchGatewayModels(gateway.id);
            if (revision !== operation.current) return;
            if (result?.success && result.models) {
                setModels(result.models);
                setNotice({ tone: 'info', text: result.models.length ? 'Models fetched. Choose one and save; nothing was selected automatically.' : 'No models were returned by this provider.' });
            } else setNotice({ tone: 'error', text: result?.error || 'Failed to fetch models' });
        } catch { if (revision === operation.current) setNotice({ tone: 'error', text: 'Failed to fetch models' }); }
        finally { if (revision === operation.current) setBusy(null); }
    };

    const handleRemove = async () => {
        if (!gateway || !confirm(t('Remove this gateway and its saved key? Official providers are not affected.'))) return;
        const revision = ++operation.current;
        setBusy('removing');
        try {
            const result = await window.electronAPI.removeGateway(gateway.id);
            if (!result?.ok) { if (revision === operation.current) setNotice({ tone: 'error', text: (result && !result.ok && result.message) || 'The gateway could not be removed.' }); return; }
            await onRemoved(gateway.id);
        } catch { if (revision === operation.current) setNotice({ tone: 'error', text: 'The gateway could not be removed.' }); }
        finally { if (revision === operation.current) setBusy(null); }
    };

    const status = !gateway ? t('Not saved') : connected ? t('Connected') : gateway.hasKey ? t('Key saved') : t('No key');
    return (
        <section className="rounded-2xl border border-border-subtle bg-bg-item-surface p-5 space-y-4" aria-label={t('Compatible gateway')}>
            <div className="flex items-center gap-3">
                <span className="w-9 h-9 rounded-xl bg-bg-input border border-border-subtle flex items-center justify-center text-text-primary"><Server size={16} /></span>
                <div className="flex-1 min-w-0">
                    <h4 className="text-sm font-semibold text-text-primary">{t('Compatible gateway')}</h4>
                    <p className="text-[11px] text-text-tertiary truncate">{gateway ? gatewayLabel(gateway) : t('Independent of the official providers. Uses its own address and key.')}</p>
                </div>
                <span className={`text-[11px] ${connected || gateway?.hasKey ? 'text-emerald-500' : 'text-text-tertiary'}`}>{status}{gateway && dirty ? ` · ${t('Unsaved changes')}` : ''}</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <label className="block text-xs text-text-secondary">{t('Gateway URL')}
                    <input aria-label={t('Gateway URL')} value={draft.baseUrl} placeholder="https://gateway.example/v1" className={field}
                        onChange={e => { const value = e.target.value; edit(prev => ({ ...prev, baseUrl: value, imageSupportConfirmedFor: undefined })); }} />
                </label>
                <label className="block text-xs text-text-secondary">{t('Gateway API key')}
                    <input type="password" aria-label={t('Gateway API key')} value={key} placeholder={gateway?.hasKey ? '••••••••••••' : 'sk-...'} className={field}
                        onChange={e => { operation.current++; if (!saving.current) setBusy(null); setNotice(null); setKey(e.target.value); }} />
                </label>
                <label className="block text-xs text-text-secondary">{t('Protocol')}
                    <select aria-label={t('Gateway protocol')} value={draft.protocol} className={field}
                        onChange={e => { const protocol = e.target.value as LlmProtocol; setModels([]); edit(prev => ({ ...prev, protocol, reasoning: undefined, imageSupportConfirmedFor: undefined })); }}>
                        {LLM_PROTOCOLS.map(protocol => <option key={protocol} value={protocol}>{PROTOCOL_NAMES[protocol]}</option>)}
                    </select>
                </label>
                <label className="block text-xs text-text-secondary">{t('Model')}
                    <input aria-label={t('Gateway model')} list={listId} value={draft.model} placeholder={t('Model ID')} className={field}
                        onChange={e => { const model = e.target.value; edit(prev => ({ ...prev, model, reasoning: undefined, imageSupportConfirmedFor: undefined })); }} />
                    <datalist id={listId}>{models.map(model => <option key={model.id} value={model.id}>{model.label}</option>)}</datalist>
                </label>
            </div>
            {reasoning && (reasoning.thinking.length > 0 || reasoning.effort.length > 0) && <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {reasoning.thinking.length > 0 && <label className="block text-xs text-text-secondary">{t('Thinking')}
                    <select aria-label={t('Gateway thinking')} value={draft.reasoning?.thinking ?? ''} className={field}
                        onChange={e => { const value = e.target.value; edit(prev => withReasoning(prev, 'thinking', value)); }}>
                        <option value="">{t('Provider default (not sent)')}</option>
                        {reasoning.thinking.map(mode => <option key={mode} value={mode}>{t(mode)}</option>)}
                    </select>
                </label>}
                {reasoning.effort.length > 0 && <label className="block text-xs text-text-secondary">{t('Reasoning effort')}
                    <select aria-label={t('Gateway reasoning effort')} value={draft.reasoning?.effort ?? ''} className={field}
                        onChange={e => { const value = e.target.value; edit(prev => withReasoning(prev, 'effort', value)); }}>
                        <option value="">{t('Provider default (not sent)')}</option>
                        {reasoning.effort.map(effort => <option key={effort} value={effort}>{t(effort)}</option>)}
                    </select>
                </label>}
            </div>}
            <p className="text-[10px] text-text-secondary">{t('Reasoning values come from the protocol, not from this model or endpoint. They are sent as chosen and may be rejected; nothing is removed or lowered automatically.')}</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <label className="block text-xs text-text-secondary">{t('Context window in tokens (optional note for this endpoint)')}
                    <input aria-label={t('Gateway context window')} type="number" min="1" step="1" value={draft.contextWindowTokens ?? ''} className={field}
                        onChange={e => { const value = e.target.value; edit(prev => ({ ...prev, contextWindowTokens: value ? Number(value) : undefined })); }} />
                    <span className="block text-[10px] mt-1">{t('Informational only. Requests are never refused or shortened because of it.')}</span>
                </label>
                {imageBinding ? <label className="block text-xs text-text-secondary self-center"><input type="checkbox" aria-label={t('Gateway model supports images')}
                    checked={draft.imageSupportConfirmedFor === imageBinding}
                    onChange={e => { const checked = e.target.checked; edit(prev => ({ ...prev, imageSupportConfirmedFor: checked ? imageBinding : undefined })); }} /> {t('This model supports images')}
                    <span className="block text-[10px] mt-1">{t('Image support is unknown for gateways until you confirm it for this exact gateway, protocol and model.')}</span>
                </label> : <p className="text-[10px] text-text-secondary self-center">{t('Image support is unknown for gateways until you confirm it for this exact gateway, protocol and model.')}</p>}
            </div>
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
                {gateway && <button type="button" className={`${action} ml-auto hover:text-red-500`} disabled={busy !== null} onClick={handleRemove}>
                    <Trash2 size={12} />{t('Remove gateway')}
                </button>}
            </div>
            {notice && <p role={notice.tone === 'error' ? 'alert' : 'status'} className={`text-[11px] ${notice.tone === 'error' ? 'text-red-400' : 'text-text-secondary'}`}>{t(notice.text)}</p>}
            <p className="text-[10px] text-text-tertiary">{t('The gateway receives your requests and its own key. Save is local; Save and test sends one short test request to the saved gateway. Changing the address origin requires entering the key again.')}</p>
        </section>
    );
};

function withReasoning(prev: Draft, key: 'effort' | 'thinking', value: string): Draft {
    const next = { ...prev.reasoning, [key]: value || undefined };
    if (!next.effort) delete next.effort;
    if (!next.thinking) delete next.thinking;
    return { ...prev, reasoning: Object.keys(next).length ? next as Draft['reasoning'] : undefined };
}
