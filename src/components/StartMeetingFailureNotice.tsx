import React from 'react';
import { useI18n } from '../i18n';
import type { StartFailure } from '../lib/startMeetingFailure';

const MAC_MICROPHONE_PANE = 'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone';

// Why the last Start click did not begin a meeting, shown under the Start button
// until the next attempt.
export const StartMeetingFailureNotice: React.FC<{
    failure: StartFailure;
    isMac: boolean;
    onOpenSettings: (tab?: string) => void;
    /** Fills {name} in the message (the app the user restarts). */
    appName: string;
}> = ({ failure, isMac, onOpenSettings, appName }) => {
    const { t } = useI18n();
    const buttonClass = 'shrink-0 px-3 py-1 rounded-full text-xs font-medium border border-red-400/40 text-red-400 hover:bg-red-500/10 transition-colors';
    return (
        <div role="alert" className="flex items-center justify-end gap-3 text-xs text-red-400">
            <p className="text-right leading-snug">
                {t(failure.message, { name: appName })}
                {failure.reason ? ` ${failure.reason}` : ''}
            </p>
            {failure.kind === 'stt-not-configured' && (
                <button type="button" className={buttonClass} onClick={() => onOpenSettings('audio')}>
                    {t('Open Speech & Audio settings')}
                </button>
            )}
            {failure.kind === 'microphone-denied' && isMac && (
                <button type="button" className={buttonClass} data-external-url={MAC_MICROPHONE_PANE}
                    onClick={() => { void window.electronAPI?.openExternal?.(MAC_MICROPHONE_PANE); }}>
                    {t('Open macOS Microphone privacy settings')}
                </button>
            )}
        </div>
    );
};
