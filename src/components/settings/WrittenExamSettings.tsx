import { useEffect, useState } from 'react';
import { Camera, EyeOff, Timer, Play, Code } from 'lucide-react';
import { useI18n } from '../../i18n';
import { useWrittenExam } from '../../hooks/useWrittenExam';
import { SettingsHeading, SettingsGroup, SettingsRow, SettingsSwitch, settingsButtonClass } from './SettingsKit';

export function WrittenExamSettings() {
  const { t } = useI18n();
  const { status, busy, error, save, setRunning } = useWrittenExam();
  const [interval, setInterval] = useState('20');
  useEffect(() => { if (status) setInterval(String(status.intervalSeconds)); }, [status?.intervalSeconds]);
  const valid = /^\d+$/.test(interval) && Number(interval) >= 5 && Number(interval) <= 300;
  return <div className="space-y-6">
    <SettingsHeading title={t('Written exam mode')} description={t('Practice with screenshots: choices first, or complete readable code following ACM input/output or LeetCode signatures.')} />
    <SettingsGroup>
      <SettingsRow icon={Camera} title={t('Enable written exam mode')} description={t('Use manual screenshots or explicitly start timed capture and answers.')}
        control={<SettingsSwitch label={t('Enable written exam mode')} checked={status?.enabled ?? false} disabled={!status || busy} onChange={enabled => void save({ enabled })} />} />
      <SettingsRow icon={EyeOff} title={t('Hide sent screenshots')} description={t('Only hides sent written-question previews. Images are still sent to the model; turn off to show them again.')}
        control={<SettingsSwitch label={t('Hide sent screenshots')} checked={status?.hideScreenshots ?? true} disabled={!status || busy} onChange={hideScreenshots => void save({ hideScreenshots })} />} />
    </SettingsGroup>
    <SettingsGroup title={t('Automatic capture')}>
      <SettingsRow icon={Timer} title={t('Capture interval')} description={t('Default 20 seconds, from 5 to 300. Saving pauses capture. The first capture waits one full interval.')}
        control={<><input aria-label={t('Automatic capture interval (seconds)')} inputMode="numeric" value={interval} onChange={event => setInterval(event.target.value)} disabled={!status || busy} className="w-20 rounded-lg border border-border-subtle bg-bg-input p-2 text-text-primary text-center" /><span>{t('seconds')}</span><button className={settingsButtonClass} disabled={!status || busy || !valid || Number(interval) === status.intervalSeconds} onClick={() => void save({ intervalSeconds: Number(interval) })}>{t('Save')}</button></>} />
      <SettingsRow icon={Play} title={t(status?.running ? 'Automatic capture running' : 'Automatic capture paused')} description={t('Skips while answering or when the image is identical. Clocks and animation count as changes. Restarting stays paused.')}
        control={<button className={settingsButtonClass} disabled={!status?.enabled || busy} onClick={() => void setRunning(!status?.running)}>{t(status?.running ? 'Pause automatic capture' : 'Start automatic capture')}</button>} />
      <p className="p-4 text-xs text-text-secondary">{t('Automatic capture sends the selected display to your model and may incur API costs. Pause also cancels this automatic answer. Written screenshots exclude Local Context; ordinary questions keep it.')}</p>
    </SettingsGroup>
    <SettingsGroup title={t('Code output')}>
      <SettingsRow icon={Code} title={t('Code output format')} description={t('Plain text preserves indentation and newlines. Markdown uses fenced code. Explicit question instructions win. Applies to the next answer.')}
        control={<div role="radiogroup" aria-label={t('Code output format')} className="flex gap-1">{(['plain', 'markdown'] as const).map(format => <button key={format} role="radio" aria-checked={status?.codeOutputFormat === format} className={`px-3 py-1.5 rounded-lg border text-xs disabled:opacity-50 ${status?.codeOutputFormat === format ? 'bg-accent-primary text-on-accent border-accent-border' : 'bg-bg-component text-text-secondary border-border-subtle'}`} disabled={!status || busy} onClick={() => void save({ codeOutputFormat: format })}>{t(format === 'plain' ? 'Plain text' : 'Markdown')}</button>)}</div>} />
      <p className="p-4 text-xs text-text-secondary">{t('Select complete-code in Context & Skills to enable its screenshot and coding guidance. Other questions answer normally.')}</p>
    </SettingsGroup>
    {(error || status?.error) && <p role="alert" className="text-sm text-red-500">{t(error || status!.error)}</p>}
  </div>;
}
