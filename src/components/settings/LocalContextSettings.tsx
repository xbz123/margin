import { useEffect, useState } from 'react';
import { useI18n } from '../../i18n';
import type { LocalContextEntry, LocalContextResult } from '../../types/localContext';
import { SettingsCard, SettingsHeading } from './SettingsKit';

export function LocalContextSettings() {
    const { t } = useI18n();
    const [entries, setEntries] = useState<LocalContextEntry[]>([]);
    const [busy, setBusy] = useState(true);
    const [error, setError] = useState('');
    const button = 'px-3 py-1.5 text-xs rounded-lg bg-bg-item-surface border border-border-subtle text-text-primary disabled:opacity-50';
    async function run(action: () => Promise<LocalContextResult>) {
        setBusy(true);
        setError('');
        try {
            const result = await action();
            if (result.ok) setEntries(result.entries);
            else setError(result.error);
        } catch { setError('Local Context is unavailable. Please try again.'); }
        finally { setBusy(false); }
    }
    useEffect(() => { void run(() => window.electronAPI.listLocalContext()); }, []);
    return <SettingsCard>
        <div className="space-y-3">
            <SettingsHeading title={t('Local Context')} description={t('Contents are sent with requests to the selected model provider. Delete them to stop sending.')} />
            <p className="text-xs text-text-secondary">{t('UTF-8 .md, .markdown or .txt only. Up to 8 files, 32 KiB each and 64 KiB total. Imported copies stay unchanged until removed.')}</p>
            <button type="button" className={button} disabled={busy} onClick={() => void run(() => window.electronAPI.addLocalContext())}>{t('Add text files')}</button>
            {error && <p role="alert" className="text-xs text-red-400">{t(error)}</p>}
            {entries.map(entry => <div key={entry.id} className="border-t border-border-subtle pt-3 space-y-2">
                <details>
                    <summary className="cursor-pointer text-sm text-text-primary">{entry.name}</summary>
                    <pre className="whitespace-pre-wrap break-words max-h-64 overflow-auto text-xs text-text-secondary mt-2">{entry.content}</pre>
                </details>
                <button type="button" className={button} disabled={busy} aria-label={`${t('Remove')} ${entry.name}`}
                    onClick={() => void run(() => window.electronAPI.removeLocalContext(entry.id))}>{t('Remove')}</button>
            </div>)}
        </div>
    </SettingsCard>;
}
