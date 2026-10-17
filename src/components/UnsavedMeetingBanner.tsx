import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { UnsavedMeeting, UnsavedMeetingCommandResult } from '../types/meetingSave';
import { useI18n } from '../i18n';

const SAVE_FAILED = 'The meeting could not be saved. It is still kept in memory.';
const START_REFUSED = 'Save or discard this meeting before starting a new one.';

const formatDuration = (ms: number) => {
    const seconds = Math.max(0, Math.round(ms / 1000));
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
};

// A meeting whose database write failed is kept in main-process memory only
// (PLAN §8, failed meeting save). This banner stays until a retry saves it or the user
// confirms discarding it; there is no close control. `startRefusals` counts Start
// clicks refused because of it, which highlight the banner.
export const UnsavedMeetingBanner: React.FC<{ startRefusals: number }> = ({ startRefusals }) => {
    const { t, language } = useI18n();
    const [meeting, setMeeting] = useState<UnsavedMeeting | null>(null);
    const [busy, setBusy] = useState(false);
    const [confirming, setConfirming] = useState(false);
    const [notice, setNotice] = useState('');
    const [highlighted, setHighlighted] = useState(false);
    const events = useRef(0);
    const mounted = useRef(true);
    const region = useRef<HTMLDivElement>(null);
    const cancelButton = useRef<HTMLButtonElement>(null);

    // A reply only applies when no state event arrived after the request was sent.
    const refresh = useCallback(() => {
        const before = events.current;
        window.electronAPI?.getUnsavedMeeting?.().then(current => {
            if (mounted.current && before === events.current) setMeeting(current ?? null);
        }).catch(() => { /* Keep the current state. */ });
    }, []);

    useEffect(() => {
        mounted.current = true;
        // Listen first, so an event sent while the query is in flight is not missed.
        const unsubscribe = window.electronAPI?.onUnsavedMeetingChanged?.(next => {
            if (!mounted.current) return;
            events.current++;
            setMeeting(next ?? null);
        });
        refresh();
        return () => { mounted.current = false; unsubscribe?.(); };
    }, [refresh]);

    // Local state belongs to one meeting; it is cleared once that meeting is resolved.
    const id = meeting?.id;
    const shownId = useRef<string | undefined>(undefined);
    useEffect(() => {
        if (shownId.current !== undefined && shownId.current !== id) {
            setConfirming(false);
            setNotice('');
            setHighlighted(false);
        }
        shownId.current = id;
    }, [id]);

    useEffect(() => {
        if (!startRefusals) return;
        setNotice(START_REFUSED);
        setHighlighted(true);
        refresh();
        region.current?.scrollIntoView?.({ block: 'nearest' });
        region.current?.focus();
    }, [startRefusals, refresh]);

    useEffect(() => {
        if (confirming) cancelButton.current?.focus();
    }, [confirming]);

    const run = async (command: (id: string) => Promise<UnsavedMeetingCommandResult>) => {
        if (!meeting || busy) return;
        const target = meeting.id;
        setBusy(true);
        setNotice('');
        try {
            const result = await command(target);
            if (!mounted.current) return;
            if (result?.ok) {
                setMeeting(current => current?.id === target ? null : current);
            } else if (result?.code === 'not-found') {
                refresh();
            } else {
                setNotice(result?.code === 'busy' ? 'Another action on this meeting is still running.' : SAVE_FAILED);
            }
        } catch {
            if (mounted.current) setNotice(SAVE_FAILED);
        } finally {
            if (mounted.current) setBusy(false);
        }
    };

    if (!meeting) return null;
    const startedAt = new Date(meeting.startedAt).toLocaleString(language);
    return (
        <div ref={region} tabIndex={-1} role="region" aria-label={t('Unsaved meeting')} data-testid="unsaved-meeting-banner"
            data-highlighted={highlighted ? 'true' : undefined}
            className={`rounded-lg border bg-amber-500/10 p-3 text-xs text-amber-500 space-y-2 outline-none ${highlighted ? 'border-amber-400 ring-2 ring-amber-400' : 'border-amber-500/40'}`}>
            <p className="text-sm font-medium">{t('This meeting was not saved')}</p>
            <p>{t('Started {time} · {duration} · {count} transcript lines', { time: startedAt, duration: formatDuration(meeting.durationMs), count: meeting.transcriptCount })}</p>
            <p>{t(meeting.reason === 'database-unavailable'
                ? 'The meeting database is unavailable, so retrying may not work.'
                : 'Writing to the meeting database failed.')}</p>
            <p>{t('It is kept only in memory and will be lost if the app quits or crashes.')}</p>
            {notice && <p role="alert">{t(notice)}</p>}
            {confirming ? (
                <div role="alertdialog" aria-labelledby="unsaved-meeting-discard-title" className="space-y-2"
                    onKeyDown={event => { if (event.key === 'Escape' && !busy) { event.preventDefault(); setConfirming(false); } }}>
                    <p id="unsaved-meeting-discard-title">{t('Discard this meeting? Its transcript will be permanently lost.')}</p>
                    <div className="flex gap-2">
                        <button ref={cancelButton} type="button" disabled={busy} onClick={() => setConfirming(false)}
                            className="rounded-md border border-amber-500/50 px-2 py-1 font-medium hover:bg-amber-500/20 disabled:opacity-50">
                            {t('Cancel')}
                        </button>
                        <button type="button" disabled={busy} onClick={() => run(id => window.electronAPI.discardUnsavedMeeting(id))}
                            className="rounded-md border border-red-500/60 px-2 py-1 font-medium text-red-400 hover:bg-red-500/10 disabled:opacity-50">
                            {t('Discard permanently')}
                        </button>
                    </div>
                </div>
            ) : (
                <div className="flex gap-2">
                    <button type="button" disabled={busy} onClick={() => run(id => window.electronAPI.retryUnsavedMeeting(id))}
                        className="rounded-md border border-amber-500/50 px-2 py-1 font-medium hover:bg-amber-500/20 disabled:opacity-50">
                        {t(busy ? 'Saving…' : 'Retry save')}
                    </button>
                    <button type="button" disabled={busy} onClick={() => setConfirming(true)}
                        className="rounded-md border border-red-500/60 px-2 py-1 font-medium text-red-400 hover:bg-red-500/10 disabled:opacity-50">
                        {t('Discard')}
                    </button>
                </div>
            )}
        </div>
    );
};
