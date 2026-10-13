import { useEffect, useRef, useState } from 'react';
import { useI18n } from '../../i18n';
import { SettingsCard, SettingsHeading } from '../settings/SettingsKit';
import { readSetupChecklist, UNCHECKED_SETUP, type SetupState } from './setupChecklistStatus';

interface SetupChecklistProps {
    active: boolean;
    onOpenSettings: (tab?: string) => void;
    onReviewPermissions: () => void;
}

const labels: Record<SetupState, string> = {
    configured: 'Configured (not connection-tested)',
    missing: 'Needs configuration or permission review',
    unknown: 'Needs checking',
    'reported-allowed': 'OS reports permissions allowed (device not tested)',
};

export function SetupChecklist({ active, onOpenSettings, onReviewPermissions }: SetupChecklistProps) {
    const { t } = useI18n();
    const [status, setStatus] = useState(UNCHECKED_SETUP);
    const [hidden, setHidden] = useState(false);
    const refreshRef = useRef<(() => void) | undefined>(undefined);

    useEffect(() => {
        setStatus(UNCHECKED_SETUP);
        if (!active) return;
        let live = true;
        let revision = 0;
        const refresh = async () => {
            const current = ++revision;
            setStatus(UNCHECKED_SETUP);
            const next = await readSetupChecklist(window.electronAPI);
            if (live && current === revision) setStatus(next);
        };
        refreshRef.current = refresh;
        void refresh();
        window.addEventListener('focus', refresh);
        const api = window.electronAPI;
        const unsubscribe = [
            api?.onCredentialsChanged?.(refresh),
            api?.onModelChanged?.(refresh),
            api?.onSttConfigChanged?.(refresh),
        ];
        return () => {
            live = false;
            ++revision;
            refreshRef.current = undefined;
            window.removeEventListener('focus', refresh);
            unsubscribe.forEach(remove => remove?.());
        };
    }, [active]);

    if (!active) return null;
    const buttonClass = 'text-xs text-text-primary underline underline-offset-4 hover:text-text-secondary';
    if (hidden) return <button className={buttonClass} onClick={() => setHidden(false)}>{t('Show setup checklist')}</button>;
    const items = [
        { id: 'answer', title: 'Answer source and model', action: () => onOpenSettings('ai-providers') },
        { id: 'speech', title: 'Speech provider', action: () => onOpenSettings('audio') },
        { id: 'permissions', title: 'System permissions', action: onReviewPermissions },
    ] as const;
    return (
        <section aria-label={t('Setup checklist')}>
            <SettingsCard>
                <div className="flex items-start justify-between gap-4">
                    <SettingsHeading title={t('Setup checklist')} description={t('Local configuration only. Connections, Codex login and actual capture or sharing are not tested. Text use is not blocked.')} />
                    <button className={`${buttonClass} shrink-0`} onClick={() => setHidden(true)}>{t('Hide for now')}</button>
                </div>
                <ul className="mt-4 space-y-3">
                    {items.map(item => (
                        <li key={item.id} className="flex items-center justify-between gap-4">
                            <div>
                                <p className="text-sm text-text-primary">{t(item.title)}</p>
                                <p role="status" aria-label={t(item.title)} className="text-xs text-text-secondary">{t(labels[status[item.id]])}</p>
                            </div>
                            <button className={`${buttonClass} shrink-0`} aria-label={t('Review {item}', { item: t(item.title) })} onClick={item.action}>{t('Review')}</button>
                        </li>
                    ))}
                </ul>
                <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2">
                    <button className={buttonClass} onClick={() => onOpenSettings('context')}>{t('Optional: Local Context and Skills')}</button>
                    <button className={buttonClass} onClick={() => onOpenSettings('privacy')}>{t('Privacy and data scopes')}</button>
                    <button className={buttonClass} onClick={() => refreshRef.current?.()}>{t('Refresh local checks')}</button>
                </div>
            </SettingsCard>
        </section>
    );
}
