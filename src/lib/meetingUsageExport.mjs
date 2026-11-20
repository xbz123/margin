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

// The refinements IntelligenceEngine.runFollowUp records as the question of a 'followup' entry
// (its intentMap); each is an i18n key. Expanding, or no stored question, is "Expanded answer".
const EXPANDED = new Set(['', 'Follow-up', 'Expand Answer']);
const REFINEMENTS = new Set(['Rephrase Answer', 'Add Example', 'Make More Confident', 'Make More Casual', 'Make More Formal', 'Simplify Answer']);

/**
 * The label of a 'followup' entry and, for a refinement the user typed, their request as typed
 * (it is shown after the label, not translated).
 */
export function followUpLabel(question) {
  const asked = typeof question === 'string' ? question.trim() : '';
  if (EXPANDED.has(asked)) return { label: 'Expanded answer' };
  if (REFINEMENTS.has(asked)) return { label: asked };
  return { label: 'Requested change', request: asked };
}

/**
 * The question as the user saw it, as MeetingDetails shows it: the stored localized text
 * (displayQuestion, e.g. the Chinese screenshot prompt) when there is one, else the question sent.
 */
export function shownQuestion(entry) {
  const shown = typeof entry?.displayQuestion === 'string' ? entry.displayQuestion.trim() : '';
  return shown || (typeof entry?.question === 'string' ? entry.question : '');
}

/** The usage blocks of a meeting export, in stored order; entries with nothing to show are left out. */
export function usageExportBlocks(usage) {
  const blocks = [];
  for (const entry of usage ?? []) {
    const answer = typeof entry?.answer === 'string' ? entry.answer.trim() : '';
    if (entry?.type === 'chat' && shownQuestion(entry) && answer) {
      blocks.push({ kind: 'chat', question: shownQuestion(entry), answer });
    } else if (entry?.type === 'assist' && answer) {
      blocks.push({ kind: 'assist', label: 'Assist', answer });
    } else if (entry?.type === 'followup' && answer) {
      blocks.push({ kind: 'followup', ...followUpLabel(entry.question), answer });
    } else if (entry?.type === 'followup_questions') {
      const bullets = followUpQuestionList(entry);
      if (bullets.length) blocks.push({ kind: 'followup_questions', label: 'Follow-Up Questions', bullets });
    }
  }
  return blocks;
}
