import React, { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { useI18n } from '../i18n';
import { meetingEndNotice } from '../lib/meetingEndNotice';

// What the launcher says about the meeting that just ended (its transcript tail was not
// completed). It stays until the user closes it or the next meeting starts.
export const MeetingEndNotice: React.FC = () => {
    const { t } = useI18n();
    const [notice, setNotice] = useState<string | null>(null);
    useEffect(() => {
        const offFailure = window.electronAPI?.onAudioCaptureFailed?.(payload => {
            const next = meetingEndNotice(payload);
            if (next) setNotice(next);
        });
        const offState = window.electronAPI?.onMeetingStateChanged?.(({ isActive }) => {
            if (isActive) setNotice(null);
        });
        return () => { offFailure?.(); offState?.(); };
    }, []);
    if (!notice) return null;
    return (
        <div role="status" className="flex items-center gap-3 rounded-xl border border-yellow-500/30 bg-yellow-500/10 px-4 py-2 text-xs text-yellow-500">
            <p className="flex-1 leading-snug">{t(notice)}</p>
            <button type="button" aria-label={t('Close')} title={t('Close')} onClick={() => setNotice(null)}
                className="shrink-0 rounded-full p-1 hover:bg-yellow-500/15 transition-colors">
                <X size={14} />
            </button>
        </div>
    );
};
