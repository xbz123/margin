// The notice the launcher shows after a meeting ends with the last part of its transcript
// missing. Main sends it on 'audio-capture-failed' with kind 'transcript-tail-incomplete'
// (electron/main.ts endMeeting) once the overlay is already hidden, so the launcher shows it;
// the overlay ignores it, or it would reappear in the next meeting's overlay.
import type { AudioCaptureFailedPayload } from '../types/audioCaptureFailed';

export const TRANSCRIPT_TAIL_INCOMPLETE = 'The last part of the transcript was not completed.';

export function isMeetingEndNotice(payload: Partial<AudioCaptureFailedPayload> | null | undefined): boolean {
    return payload?.kind === 'transcript-tail-incomplete';
}

/** The English source text (shown through t()) of the launcher notice, or null when the payload is not one. */
export function meetingEndNotice(payload: Partial<AudioCaptureFailedPayload> | null | undefined): string | null {
    return isMeetingEndNotice(payload) ? TRANSCRIPT_TAIL_INCOMPLETE : null;
}
