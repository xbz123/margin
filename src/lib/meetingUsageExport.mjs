// The AI usage entries a meeting export lists, in stored order. Each block has an i18n label
// key, an optional question, an optional answer body and, for "generate follow-up questions",
// one bullet per question. "Expand answer" entries are stored as type 'followup' and the
// follow-up question lists as 'followup_questions'; both are exported, not skipped.

const LIST_MARKER = /^(?:[-*+•·●▪]|\d{1,3}\s*[.)、．]|[（(]\d{1,3}[)）])\s*/;
const unbold = text => text.replace(/^\*\*(.*)\*\*$/, '$1');

/**
 * The questions of a 'followup_questions' entry. A stored list (items, or an answer kept as an
 * array) is used as is; otherwise the streamed answer text is split into lines and list markers
 * ("1.", "-", "•", "（1）") are removed. Blank lines are dropped.
 */
export function followUpQuestionList(entry) {
  const source = Array.isArray(entry?.items) && entry.items.length ? entry.items
    : Array.isArray(entry?.answer) ? entry.answer
    : String(entry?.answer ?? '').split(/\r?\n/);
  return source
    .map(item => unbold(unbold(String(item ?? '').trim()).replace(LIST_MARKER, '')).trim())
    .filter(Boolean);
}

/** The usage blocks of a meeting export, in stored order; entries with nothing to show are left out. */
export function usageExportBlocks(usage) {
  const blocks = [];
  for (const entry of usage ?? []) {
    const answer = typeof entry?.answer === 'string' ? entry.answer.trim() : '';
    if (entry?.type === 'chat' && entry.question && answer) {
      blocks.push({ kind: 'chat', question: entry.question, answer });
    } else if (entry?.type === 'assist' && answer) {
      blocks.push({ kind: 'assist', label: 'Assist', answer });
    } else if (entry?.type === 'followup' && answer) {
      blocks.push({ kind: 'followup', label: 'Expanded answer', answer });
    } else if (entry?.type === 'followup_questions') {
      const bullets = followUpQuestionList(entry);
      if (bullets.length) blocks.push({ kind: 'followup_questions', label: 'Follow-Up Questions', bullets });
    }
  }
  return blocks;
}
