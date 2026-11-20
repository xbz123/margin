// The transcript a saved meeting shows: spoken lines only, each with its speaker and time.
// The transcript page and "Copy full transcript" both read these rows, so the copy has the
// same lines, order, times and speakers as the page. AI answers and system lines stay in the
// stored meeting (the usage history lists the answers); they are only left out of this view.

const HIDDEN_SPEAKERS = new Set(['system', 'ai', 'assistant', 'model']);

export function isSpokenEntry(entry) {
  return !HIDDEN_SPEAKERS.has(String(entry?.speaker ?? '').toLowerCase());
}

/** The i18n key of the speaker label. */
export function speakerLabelKey(speaker) {
  return speaker === 'user' ? 'Me' : 'Them';
}

/** Rows of the transcript page, in stored order. */
export function visibleTranscriptRows(transcript, formatTime) {
  return (transcript ?? []).filter(isSpokenEntry).map(entry => ({
    speakerKey: speakerLabelKey(entry.speaker),
    time: entry.timestamp ? formatTime(entry.timestamp) : '0:00',
    text: entry.text,
  }));
}

/** The text "Copy full transcript" writes: one "[time] speaker: text" line per row. */
export function formatTranscriptCopy(rows, translate) {
  return rows.map(row => `[${row.time}] ${translate(row.speakerKey)}: ${row.text}`).join('\n');
}
