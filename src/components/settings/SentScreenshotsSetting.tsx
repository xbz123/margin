import { EyeOff } from 'lucide-react';
import { useI18n } from '../../i18n';
import { useWrittenExam } from '../../hooks/useWrittenExam';
import { SettingsGroup, SettingsRow, SettingsSwitch } from './SettingsKit';

// General setting (user request 2026-11-09): hides the screenshot preview on every sent
// message, in any scene. It is stored with the written-exam settings it came from.
export function SentScreenshotsSetting() {
  const { t } = useI18n();
  const { status, busy, error, save } = useWrittenExam();
  return <SettingsGroup title={t('Screenshots')}>
    <SettingsRow icon={EyeOff} title={t('Hide sent screenshots')} description={<>
      {t('Hides screenshot previews on sent messages. Images are still sent to the model; turn off to show them again.')}
      {(error || status?.error) && <p role="alert" className="text-xs text-red-500 mt-1">{t(error || status!.error)}</p>}
    </>}
      control={<SettingsSwitch label={t('Hide sent screenshots')} checked={status?.hideScreenshots ?? true} disabled={!status || busy} onChange={hideScreenshots => void save({ hideScreenshots })} />} />
  </SettingsGroup>;
}
