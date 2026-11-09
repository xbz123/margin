import { useEffect, useState } from 'react';
import { useI18n } from '../../i18n';
import { ADDITIONAL_INSTRUCTIONS_LIMIT, type PromptScene, type PromptSettings as Settings, type PromptSettingsResult } from '../../types/promptSettings';
import { SettingsCard, SettingsHeading } from './SettingsKit';

export function PromptSettings() {
    const { t } = useI18n();
    const [settings, setSettings] = useState<Settings>();
    const [scene, setScene] = useState<PromptScene>('interview');
    const [additional, setAdditional] = useState('');
    const [skillId, setSkillId] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [recovery, setRecovery] = useState(false);
    const [confirm, setConfirm] = useState(false);
    const button = 'px-3 py-1.5 text-xs rounded-lg bg-bg-item-surface border border-border-subtle text-text-primary disabled:opacity-50';
    async function run(action: () => Promise<PromptSettingsResult>) {
        setBusy(true);
        try {
            const result = await action();
            if (result.ok) {
                setSettings(result.settings);
                setRecovery(false);
                setConfirm(false);
                setError('');
            } else {
                setError(result.error);
                if (result.recovery) setRecovery(true);
            }
        } catch { setError('Prompt settings are unavailable. Please try again.'); }
        finally { setBusy(false); }
    }
    useEffect(() => { void run(() => window.electronAPI.getPromptSettings()); }, []);
    useEffect(() => {
        setAdditional(settings?.scenes[scene].additional ?? '');
        setSkillId(settings?.scenes[scene].skillId ?? null);
    }, [scene, settings]);
    return <SettingsCard>
        <div className="space-y-3">
            <SettingsHeading title={t('Prompt Skills and additional instructions')} description={t('Advanced: local prompt text is sent to the selected model provider. It supplements defaults, never replaces system rules or data-scope checks. No tools or code are executed.')} />
            <p className="text-xs text-text-secondary">{t('Import a UTF-8 .md file (32 KiB maximum): name: lower-case-id, then description: one line, between --- lines, followed by instructions. Up to 16 installed Skills. Other metadata is rejected.')}</p>
            <button type="button" className={button} disabled={busy || recovery} onClick={() => void run(() => window.electronAPI.importPromptSkill())}>{t('Import and install Skill')}</button>
            <button type="button" className={button} disabled={busy} onClick={() => void run(() => window.electronAPI.getPromptSettings())}>{t('Reload prompt settings')}</button>
            {error && <p role="alert" className="text-xs text-red-400">{t(error)}</p>}
            {recovery && <div className="space-y-2">
                {confirm ? <>
                    <p>{t('Clear installed prompt Skills, selections and additional instructions? Original files are not changed. This cannot be undone.')}</p>
                    <button type="button" className={button} disabled={busy} onClick={() => void run(() => window.electronAPI.clearPromptSettings())}>{t('Confirm clear')}</button>
                    <button type="button" className={button} disabled={busy} onClick={() => setConfirm(false)}>{t('Cancel')}</button>
                </> : <button type="button" className={button} disabled={busy} onClick={() => setConfirm(true)}>{t('Clear prompt settings')}</button>}
            </div>}
            {settings && !recovery && <>
                <label className="block text-sm">{t('Scenario')}
                    <select aria-label={t('Scenario')} disabled={busy} value={scene} onChange={event => setScene(event.target.value as PromptScene)} className="bg-bg-input rounded border p-2 ml-2">
                        <option value="interview">{t('Interview')}</option><option value="written">{t('Written')}</option>
                    </select>
                </label>
                <label className="block text-sm">{t('Selected prompt Skill')}
                    <select aria-label={t('Selected prompt Skill')} disabled={busy} value={skillId ?? ''} onChange={event => setSkillId(event.target.value || null)} className="bg-bg-input rounded border p-2 ml-2">
                        <option value="">{t('None')}</option>
                        {!settings.skills.some(skill => skill.id === 'complete-code') && <option value="complete-code">complete-code</option>}
                        {settings.skills.map(skill => <option key={skill.id} value={skill.id}>{skill.name}</option>)}
                    </select>
                </label>
                <label className="block text-sm">{t('Additional instructions (up to 4000 characters)')}
                    <textarea value={additional} disabled={busy} maxLength={ADDITIONAL_INSTRUCTIONS_LIMIT} onChange={event => setAdditional(event.target.value)} className="block w-full bg-bg-input border rounded p-2 mt-2" rows={4} />
                </label>
                <button type="button" className={button} disabled={busy} onClick={() => void run(() => window.electronAPI.savePromptSettings({ scene, skillId, additional }))}>{t('Save')}</button>
                <button type="button" className={button} disabled={busy} onClick={() => void run(() => window.electronAPI.savePromptSettings({ scene, skillId: null, additional: '' }))}>{t('Restore scenario defaults')}</button>
                {settings.skills.map(skill => <div key={skill.id} className="text-sm flex justify-between gap-2">
                    <span>{skill.name}: {skill.description}</span>
                    <button type="button" className={button} disabled={busy} onClick={() => void run(() => window.electronAPI.removePromptSkill(skill.id))}>{t('Remove')} {skill.name}</button>
                </div>)}
            </>}
        </div>
    </SettingsCard>;
}
