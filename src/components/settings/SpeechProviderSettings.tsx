import { useEffect, useState } from 'react';
import { useI18n } from '../../i18n';
import type { DomesticSttProvider, DoubaoResourceId } from '../../types/domesticStt';
import { SettingsCard, SettingsHeading } from './SettingsKit';

const DOUBAO_RESOURCES: { id: DoubaoResourceId; label: string }[] = [
    { id: 'volc.seedasr.sauc.duration', label: 'Hourly (volc.seedasr.sauc.duration)' },
    { id: 'volc.seedasr.sauc.concurrent', label: 'Concurrent (volc.seedasr.sauc.concurrent)' },
];

export function SpeechProviderSettings({ provider }: { provider: DomesticSttProvider }) {
    const { t } = useI18n();
    const [key, setKey] = useState('');
    const [workspaceId, setWorkspaceId] = useState('');
    const [appId, setAppId] = useState('');
    const [resourceId, setResourceId] = useState<DoubaoResourceId>('volc.seedasr.sauc.duration');
    const [hasKey, setHasKey] = useState(false);
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState('');
    useEffect(() => {
        let current = true;
        window.electronAPI.getDomesticStt(provider).then(config => {
            if (!current) return;
            setHasKey(config.hasKey);
            setWorkspaceId(config.workspaceId);
            setAppId(config.appId);
            setResourceId(config.resourceId);
        }).catch(() => { if (current) setMessage(t('STT settings could not be loaded.')); });
        return () => { current = false; };
    }, [provider]);
    const save = async (remove: boolean) => {
        setBusy(true);
        try {
            const result = await window.electronAPI.saveDomesticStt(provider,
                { key: remove ? '' : key, workspaceId, appId, ...(provider === 'doubao' ? { resourceId } : {}) });
            if (result.ok) { setKey(''); setHasKey(!remove); setMessage(result.warning ?? t('Saved')); }
            else setMessage(result.message);
        } catch { setMessage(t('STT settings could not be saved.')); }
        finally { setBusy(false); }
    };
    const test = async () => {
        setBusy(true);
        try {
            const result = await window.electronAPI.testDomesticStt(provider);
            setMessage(result.success ? t('Connected') : t(result.error ?? 'STT connection failed. Check credentials and network.'));
        } catch { setMessage(t('STT connection failed. Check credentials and network.')); }
        finally { setBusy(false); }
    };
    return <SettingsCard>
        <SettingsHeading title={t(provider === 'aliyun' ? 'Alibaba Cloud Bailian' : 'Doubao')}
            description={t('Save credentials before testing. Tests send synthetic silence.')} />
        <div className="space-y-3 mt-3">
            <label className="block text-sm">{t('API key / Access Key')}
                <input type="password" autoComplete="off" value={key} disabled={busy}
                    onChange={event => setKey(event.target.value)} placeholder={hasKey ? t('Saved') : ''}
                    className="block w-full bg-bg-input rounded px-3 py-2" />
            </label>
            <label className="block text-sm">{t(provider === 'aliyun' ? 'Workspace ID (optional, Beijing)' : 'App ID (legacy Access Key only; leave blank for API key)')}
                <input value={provider === 'aliyun' ? workspaceId : appId} disabled={busy}
                    onChange={event => provider === 'aliyun' ? setWorkspaceId(event.target.value) : setAppId(event.target.value)}
                    className="block w-full bg-bg-input rounded px-3 py-2" />
            </label>
            {provider === 'aliyun' && <p className="text-xs text-text-secondary">
                {t('Leave blank to use the Beijing general endpoint; a workspace ID uses its dedicated Beijing domain.')}</p>}
            {provider === 'doubao' && <label className="block text-sm">{t('Resource type (must match the resource you purchased)')}
                <select value={resourceId} disabled={busy}
                    onChange={event => setResourceId(event.target.value as DoubaoResourceId)}
                    className="block w-full bg-bg-input rounded px-3 py-2">
                    {DOUBAO_RESOURCES.map(resource => <option key={resource.id} value={resource.id}>{t(resource.label)}</option>)}
                </select>
            </label>}
            <div className="flex gap-3">
                <button className="px-5 py-2.5 rounded-lg text-xs font-medium transition-colors bg-bg-input hover:bg-bg-input/80 border border-border-subtle text-text-primary disabled:opacity-50"
                    disabled={busy || !key.trim()} onClick={() => void save(false)}>{t('Save')}</button>
                <button className="px-5 py-2.5 rounded-lg text-xs font-medium transition-colors bg-bg-input hover:bg-bg-input/80 border border-border-subtle text-text-primary disabled:opacity-50"
                    disabled={busy || !hasKey} onClick={() => void save(true)}>{t('Delete credentials')}</button>
                <button className="text-xs bg-bg-input hover:bg-bg-elevated text-text-primary px-3 py-1.5 rounded-md transition-colors flex items-center gap-2 disabled:opacity-50"
                    disabled={busy || !hasKey} onClick={() => void test()}>{t('Test connection')}</button>
            </div>
            <p role="status">{message}</p>
        </div>
    </SettingsCard>;
}
