// Context for the meeting chat, built in the main process from the saved meeting
// (PLAN.md AG-17 fifth review). The window sends only the meeting id; the data scopes
// are applied here to what is actually sent, so they do not depend on what the window
// declares.
//
// A saved meeting is history: its title and transcript are profile_history data, and
// its summary, key points and action items are post_call_summary data too.

import type { ProviderDataScope } from '../llm/ProviderRouter';

export interface SavedMeetingForChat {
  title: string;
  detailedSummary?: { overview?: string; keyPoints?: string[]; actionItems?: string[] };
  transcript?: Array<{ speaker: string; text: string }>;
}

const INSTRUCTIONS = 'You are recalling a specific meeting. Answer questions ONLY about this meeting. Be concise (2-4 sentences). Sound natural, like a human recalling. If information is not present, say so briefly. Never guess.';

// Returns the context to send and the scopes it contains. With `includeSummary` false
// the summary, key points and action items are left out.
export function buildMeetingChatContext(meeting: SavedMeetingForChat, includeSummary: boolean): { context: string; scopes: ProviderDataScope[] } {
  const parts: string[] = [`MEETING: ${meeting.title}`];
  let hasSummary = false;
  const summary = meeting.detailedSummary;

  if (includeSummary && summary?.overview) {
    parts.push(`\nSUMMARY:\n${summary.overview}`);
    hasSummary = true;
  }
  if (includeSummary && summary?.keyPoints?.length) {
    parts.push(`\nKEY POINTS:\n${summary.keyPoints.map((p) => `- ${p}`).join('\n')}`);
    hasSummary = true;
  }
  if (includeSummary && summary?.actionItems?.length) {
    parts.push(`\nACTION ITEMS:\n${summary.actionItems.map((a) => `- ${a}`).join('\n')}`);
    hasSummary = true;
  }
  if (meeting.transcript?.length) {
    const recent = meeting.transcript.slice(-20)
      .map((t) => `[${t.speaker === 'user' ? 'Me' : 'Them'}]: ${t.text}`)
      .join('\n');
    parts.push(`\nRECENT TRANSCRIPT:\n${recent}`);
  }

  const scopes: ProviderDataScope[] = hasSummary ? ['profile_history', 'post_call_summary'] : ['profile_history'];
  return { context: `${INSTRUCTIONS}\n\n${parts.join('\n')}`, scopes };
}
