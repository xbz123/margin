import * as crypto from 'crypto';

export interface PostCallTranscriptSegment {
  speaker: string;
  text: string;
  timestamp: number;
}

export interface StructuredActionItem {
  id: string;
  text: string;
  owner?: string;
  deadline?: string;
  sourceTimestamp?: number;
}

export interface PostCallEnhancements {
  schemaVersion: 2;
  actionItemsStructured: StructuredActionItem[];
  followUpDraft: string;
}

const ACTION_PATTERNS = [
  /\b(?:i|we|you|he|she|they|[A-Z][a-z]+)\s+(?:will|should|need to|needs to|must|can|could)\s+(.+?)(?:\s+(?:by|before|on|after)\s+([^.!?]+))?[.!?]?$/i,
  /\b(?:action|todo|follow up):\s*(.+?)(?:\s+(?:by|before|on|after)\s+([^.!?]+))?[.!?]?$/i,
  /\b(?:send|share|schedule|book|prepare|review|follow up|circle back|introduce|email)\s+(.+?)(?:\s+(?:by|before|on|after)\s+([^.!?]+))?[.!?]?$/i,
];

const OWNER_PATTERN = /\b(I|we|you|he|she|they|[A-Z][a-z]+)\s+(?:will|should|need to|needs to|must|can|could)\b/;
const DEADLINE_PATTERN = /\b(?:by|before|on|after)\s+([^.!?]+)$/i;

export function buildPostCallEnhancements(params: {
  transcript: PostCallTranscriptSegment[];
  summaryData?: { overview?: string; actionItems?: string[]; keyPoints?: string[]; sections?: Array<{ title: string; bullets: string[] }> };
}): PostCallEnhancements {
  const actionItemsStructured = extractStructuredActionItems(params.transcript, params.summaryData?.actionItems ?? []);

  return {
    schemaVersion: 2,
    actionItemsStructured,
    followUpDraft: buildFollowUpDraft(actionItemsStructured, params.summaryData),
  };
}

export function extractStructuredActionItems(
  transcript: PostCallTranscriptSegment[],
  summaryActionItems: string[] = []
): StructuredActionItem[] {
  const items: StructuredActionItem[] = [];
  const seen = new Set<string>();

  const addItem = (text: string, sourceTimestamp?: number, owner?: string, deadline?: string) => {
    const cleaned = normalizeActionText(text);
    if (!cleaned) return;
    const key = cleaned.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    items.push({
      id: `action_${crypto.randomUUID()}`,
      text: cleaned,
      ...(owner ? { owner } : {}),
      ...(deadline ? { deadline: deadline.trim() } : {}),
      ...(typeof sourceTimestamp === 'number' ? { sourceTimestamp } : {}),
    });
  };

  for (const segment of transcript) {
    const text = segment.text.trim();
    if (!text) continue;

    for (const pattern of ACTION_PATTERNS) {
      const match = text.match(pattern);
      if (!match) continue;
      const owner = text.match(OWNER_PATTERN)?.[1];
      const deadline = match[2] ?? text.match(DEADLINE_PATTERN)?.[1];
      addItem(match[1] ?? text, segment.timestamp, normalizeOwner(owner), deadline);
      break;
    }
  }

  for (const item of summaryActionItems) {
    addItem(item);
  }

  return items.slice(0, 8);
}

export function buildFollowUpDraft(
  actionItems: StructuredActionItem[],
  summaryData?: { overview?: string; keyPoints?: string[]; sections?: Array<{ title: string; bullets: string[] }> }
): string {
  const lines = ['Hi team,', '', 'Thanks for the conversation today.'];

  if (summaryData?.overview) {
    lines.push('', summaryData.overview.trim());
  }

  const nextSteps = actionItems.map(item => {
    const owner = item.owner ? `${item.owner}: ` : '';
    const deadline = item.deadline ? ` by ${item.deadline}` : '';
    return `- ${owner}${item.text}${deadline}`;
  });

  if (nextSteps.length > 0) {
    lines.push('', 'Next steps:', ...nextSteps);
  }

  if (nextSteps.length === 0) {
    lines.push('', 'I will follow up if anything else is needed.');
  }

  lines.push('', 'Best,');
  return lines.join('\n');
}

function normalizeActionText(value: string): string {
  return value
    .replace(/^\s*(?:action|todo|follow up):\s*/i, '')
    .replace(/\s+/g, ' ')
    .replace(/[.!?]+$/, '')
    .trim();
}

function normalizeOwner(owner?: string): string | undefined {
  if (!owner) return undefined;
  const normalized = owner.trim();
  if (/^i$/i.test(normalized)) return 'Me';
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}
