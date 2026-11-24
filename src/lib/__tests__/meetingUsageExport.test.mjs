// The PDF export lists "expand answer" (followup) and "generate follow-up questions"
// (followup_questions) entries instead of skipping them, one bullet per question.

import test from 'node:test';
import assert from 'node:assert/strict';

import { followUpLabel, followUpQuestionList, shownQuestion, usageExportBlocks } from '../meetingUsageExport.mjs';
import { keepPunctuationOffLineStart } from '../pdfTextFlow.mjs';

test('follow-up questions come from the streamed answer text as SQLite returns it', () => {
  const answer = '1. 你们的缓存失效策略是怎样设计的？\n\n2) 如果消息被重复投递，如何保证幂等？\n- 连接池上限如何确定？\n• 灰度发布如何回滚？\n（5）跨机房切换如何避免丢数据？\n**网关限流如何配置？**';
  assert.deepEqual(followUpQuestionList({ answer }), [
    '你们的缓存失效策略是怎样设计的？',
    '如果消息被重复投递，如何保证幂等？',
    '连接池上限如何确定？',
    '灰度发布如何回滚？',
    '跨机房切换如何避免丢数据？',
    '网关限流如何配置？',
  ]);
});

test('a stored list (metadata items, or an in-memory array answer) is used as is', () => {
  assert.deepEqual(followUpQuestionList({ items: ['问题一？', ' 问题二？ ', ''] , answer: null }), ['问题一？', '问题二？']);
  assert.deepEqual(followUpQuestionList({ answer: ['A?', 'B?'] }), ['A?', 'B?']);
  assert.deepEqual(followUpQuestionList({ items: [], answer: '1. C?' }), ['C?']);
  assert.deepEqual(followUpQuestionList({}), []);
});

test('every usage type with content becomes a block, in stored order', () => {
  const blocks = usageExportBlocks([
    { type: 'assist', timestamp: 1, answer: '辅助回答正文' },
    { type: 'followup', timestamp: 2, question: 'Follow-up', answer: '展开回答正文' },
    { type: 'chat', timestamp: 3, question: '问题', answer: '回答' },
    { type: 'followup_questions', timestamp: 4, question: 'Generate Follow-up Questions', answer: '1. 甲？\n2. 乙？' },
    { type: 'followup_questions', timestamp: 5, answer: null, items: ['丙？'] },
    { type: 'followup', timestamp: 6, answer: '   ' },
    { type: 'followup_questions', timestamp: 7, answer: '' },
    { type: 'assist', timestamp: 8 },
  ]);
  assert.deepEqual(blocks, [
    { kind: 'assist', label: 'Assist', answer: '辅助回答正文' },
    { kind: 'followup', label: 'Expanded answer', answer: '展开回答正文' },
    { kind: 'chat', question: '问题', answer: '回答' },
    { kind: 'followup_questions', label: 'Follow-Up Questions', bullets: ['甲？', '乙？'] },
    { kind: 'followup_questions', label: 'Follow-Up Questions', bullets: ['丙？'] },
  ]);
  assert.deepEqual(usageExportBlocks(undefined), []);
});

test('a chat question is exported as the user saw it (displayQuestion), as MeetingDetails shows it', async () => {
  const blocks = usageExportBlocks([
    // A screenshot sent with no typed text in the Chinese UI, as SQLite returns it.
    { type: 'chat', timestamp: 1, question: 'Solve the question in this screenshot directly', displayQuestion: '直接解答截图中的题目', answer: '答案' },
    { type: 'chat', timestamp: 2, question: '我自己输入的问题', answer: '回答' },
    { type: 'chat', timestamp: 3, question: 'typed', displayQuestion: '   ', answer: 'x' },
    // Only displayQuestion survives (no stored question): still exported.
    { type: 'chat', timestamp: 4, displayQuestion: '只有显示文本', answer: 'y' },
    // A followup keeps its label from the stored question key; displayQuestion does not rename it.
    { type: 'followup', timestamp: 5, question: 'Simplify Answer', displayQuestion: '简化回答', answer: 'z' },
  ]);
  assert.deepEqual(blocks, [
    { kind: 'chat', question: '直接解答截图中的题目', answer: '答案' },
    { kind: 'chat', question: '我自己输入的问题', answer: '回答' },
    { kind: 'chat', question: 'typed', answer: 'x' },
    { kind: 'chat', question: '只有显示文本', answer: 'y' },
    { kind: 'followup', label: 'Simplify Answer', answer: 'z' },
  ]);
  assert.equal(shownQuestion({ question: 'q' }), 'q');
  assert.equal(shownQuestion(undefined), '');

  // The PDF prints block.question, and MeetingDetails shows the same `displayQuestion || question`.
  const { readFileSync } = await import('node:fs');
  const pdf = readFileSync(new URL('../../utils/pdfGenerator.ts', import.meta.url), 'utf8');
  assert.match(pdf, /usageExportBlocks\(meeting\.usage, hasCjkFont \? t : undefined\)/);
  assert.match(pdf, /`Q: \$\{block\.question\}`/);
  assert.doesNotMatch(pdf, /item\.question/);
  const details = readFileSync(new URL('../../components/MeetingDetails.tsx', import.meta.url), 'utf8');
  assert.match(details, /shownQuestion\(interaction, t\)/);
  assert.match(details, /`Q: \$\{shownQuestion\(u, t\)\}/);
});

test('a row saved with the old generation outcome placeholder shows the localized label', async () => {
  const legacy = { type: 'assist', timestamp: 1, question: 'generation outcome', answer: '' };
  assert.equal(shownQuestion(legacy), 'Question not recorded');
  assert.equal(shownQuestion(legacy, key => (key === 'Question not recorded' ? '未记录问题' : key)), '未记录问题');
  // The stored localized text still wins, and other questions are unchanged.
  assert.equal(shownQuestion({ ...legacy, displayQuestion: '直接解答截图中的题目' }), '直接解答截图中的题目');
  assert.equal(shownQuestion({ question: 'Recap Meeting' }), 'Recap Meeting');
  // A chat message the user typed as 'generation outcome' keeps its text, on screen and in the export.
  const typed = { type: 'chat', timestamp: 3, question: 'generation outcome', answer: 'x' };
  assert.equal(shownQuestion(typed, key => (key === 'Question not recorded' ? '未记录问题' : key)), 'generation outcome');
  assert.deepEqual(usageExportBlocks([typed]), [{ kind: 'chat', question: 'generation outcome', answer: 'x' }]);
  // The export lists a legacy row (type 'assist') under its Assist label, never the placeholder.
  const blocks = usageExportBlocks([legacy, { ...legacy, timestamp: 2, answer: '部分回答' }]);
  assert.deepEqual(blocks, [{ kind: 'assist', label: 'Assist', answer: '部分回答' }]);
  assert.doesNotMatch(JSON.stringify(blocks), /generation outcome/);
  // The label key is in the Chinese dictionary.
  const { readFileSync } = await import('node:fs');
  const zh = readFileSync(new URL('../../i18n.zh.ts', import.meta.url), 'utf8');
  assert.match(zh, /'Question not recorded': '未记录问题'/);
});

test('a followup entry is labelled by what was asked: expand, a named refinement, or the request as typed', () => {
  const blocks = usageExportBlocks([
    { type: 'followup', timestamp: 1, question: 'Follow-up', answer: 'a' },
    { type: 'followup', timestamp: 2, question: 'Expand Answer', answer: 'b' },
    { type: 'followup', timestamp: 3, answer: 'c' },
    { type: 'followup', timestamp: 4, question: 'Simplify Answer', answer: 'd' },
    { type: 'followup', timestamp: 5, question: 'Make More Casual', answer: 'e' },
    { type: 'followup', timestamp: 6, question: ' Make it more casual please ', answer: 'f' },
    { type: 'followup', timestamp: 7, question: '请改成口语一点', answer: 'g' },
  ]);
  assert.deepEqual(blocks, [
    { kind: 'followup', label: 'Expanded answer', answer: 'a' },
    { kind: 'followup', label: 'Expanded answer', answer: 'b' },
    { kind: 'followup', label: 'Expanded answer', answer: 'c' },
    { kind: 'followup', label: 'Simplify Answer', answer: 'd' },
    { kind: 'followup', label: 'Make More Casual', answer: 'e' },
    { kind: 'followup', label: 'Requested change', request: 'Make it more casual please', answer: 'f' },
    { kind: 'followup', label: 'Requested change', request: '请改成口语一点', answer: 'g' },
  ]);
});

test('every followup label the export can show has a Chinese translation, and so do the engine refinements', async () => {
  const { readFileSync } = await import('node:fs');
  const zh = readFileSync(new URL('../../i18n.zh.ts', import.meta.url), 'utf8');
  const engine = readFileSync(new URL('../../../electron/IntelligenceEngine.ts', import.meta.url), 'utf8');
  const intentMap = engine.match(/FOLLOW_UP_INTENT_LABELS: Record<string, string> = \{([\s\S]*?)\};/)[1];
  const refinements = [...intentMap.matchAll(/:\s*'([^']+)'/g)].map(match => match[1]);
  assert.ok(refinements.includes('Simplify Answer'));
  for (const question of refinements) {
    const { label, request } = followUpLabel(question);
    assert.equal(request, undefined, `${question} is a known refinement`);
    assert.ok(zh.includes(`'${label}': '`), `${label} has a Chinese translation`);
  }
  assert.ok(zh.includes(`'Requested change': '`));
});

// The Chinese dictionary, as the renderer's translate() reads it.
async function chineseTranslate() {
  const { readFileSync } = await import('node:fs');
  const zh = readFileSync(new URL('../../i18n.zh.ts', import.meta.url), 'utf8');
  const entries = new Map([...zh.matchAll(/^\s*'([^']*)':\s*'([^']*)',?$/gm)].map(match => [match[1], match[2]]));
  return key => entries.get(key) ?? key;
}

test('history labels are shown translated by row type; text the user asked is kept as typed', async () => {
  const zh = await chineseTranslate();
  const cases = [
    // assist: the action names and the Retry label, never a real question.
    [{ type: 'assist', question: 'What to Answer' }, '该怎么回答'],
    [{ type: 'assist', question: 'Code Hint' }, '代码提示'],
    [{ type: 'assist', question: 'Retry' }, '重试'],
    [{ type: 'assist', question: 'How would you shard this table?' }, 'How would you shard this table?'],
    [{ type: 'assist', question: 'generation outcome' }, '未记录问题'],
    // followup: intent labels as followUpLabel names them; a typed request as typed.
    [{ type: 'followup', question: '' }, '展开回答'],
    [{ type: 'followup', question: 'Follow-up' }, '展开回答'],
    [{ type: 'followup', question: 'Expand Answer' }, '展开回答'],
    [{ type: 'followup', question: 'Rephrase Answer' }, '换个说法'],
    [{ type: 'followup', question: 'Add Example' }, '补充示例'],
    [{ type: 'followup', question: 'Make More Confident' }, '更自信'],
    [{ type: 'followup', question: 'Make More Casual' }, '更口语'],
    [{ type: 'followup', question: 'Make More Formal' }, '更正式'],
    [{ type: 'followup', question: 'Simplify Answer' }, '简化回答'],
    [{ type: 'followup', question: 'make it shorter' }, 'make it shorter'],
    [{ type: 'followup_questions', question: 'Generate Follow-up Questions' }, '生成追问建议'],
    // chat: action rows translated, by entry point (new rows) or by text (older rows).
    [{ type: 'chat', question: 'Recap Meeting', generation: { entryPoint: 'recap' } }, '会议回顾'],
    [{ type: 'chat', question: 'Clarify Question', entryPoint: 'clarify' }, '澄清问题'],
    [{ type: 'chat', question: 'Recap Meeting' }, '会议回顾'],
    [{ type: 'chat', question: 'Clarify Question', generation: { requestId: 'r0' } }, '澄清问题'],
    // A message the user typed or spoke keeps its text, even when it reads like an action name.
    [{ type: 'chat', question: 'Recap Meeting', generation: { entryPoint: 'text' } }, 'Recap Meeting'],
    [{ type: 'chat', question: 'Clarify Question', entryPoint: 'answer' }, 'Clarify Question'],
    [{ type: 'chat', question: 'generation outcome' }, 'generation outcome'],
    [{ type: 'chat', question: '我自己输入的问题' }, '我自己输入的问题'],
    // displayQuestion still wins.
    [{ type: 'chat', question: 'Recap Meeting', displayQuestion: '直接解答截图中的题目' }, '直接解答截图中的题目'],
    [{ type: 'assist', question: 'Code Hint', displayQuestion: '自定义' }, '自定义'],
  ];
  for (const [entry, expected] of cases) {
    assert.equal(shownQuestion(entry, zh), expected, JSON.stringify(entry));
    // The English UI shows the English key unchanged.
    if (!entry.displayQuestion && expected !== entry.question && entry.question !== 'generation outcome') {
      assert.equal(shownQuestion(entry), ['', 'Follow-up', 'Expand Answer'].includes(entry.question) ? 'Expanded answer' : entry.question);
    }
  }
});

test('the export lists a chat action under the same translated label as the bubble', async () => {
  const zh = await chineseTranslate();
  const usage = [
    { type: 'chat', timestamp: 1, question: 'Recap Meeting', answer: '回顾正文', generation: { entryPoint: 'recap' } },
    { type: 'chat', timestamp: 2, question: 'Clarify Question', answer: '澄清正文' },
    { type: 'chat', timestamp: 3, question: 'Recap Meeting', answer: '用户自己输入', generation: { entryPoint: 'text' } },
  ];
  assert.deepEqual(usageExportBlocks(usage, zh).map(block => block.question), ['会议回顾', '澄清问题', 'Recap Meeting']);
  assert.deepEqual(usageExportBlocks(usage, zh).map(block => block.question), usage.map(entry => shownQuestion(entry, zh)));
  // Without a translation (English UI, or the PDF without its Chinese font) the keys stay English.
  assert.deepEqual(usageExportBlocks(usage).map(block => block.question), ['Recap Meeting', 'Clarify Question', 'Recap Meeting']);
});

test('closing punctuation never starts a wrapped line and no text is lost or reordered', () => {
  const lines = ['第一行文字', '，第二行', '。」第三行', '第四行', '，'];
  const kept = keepPunctuationOffLineStart(lines);
  assert.deepEqual(kept, ['第一行文字，', '第二行。」', '第三行', '第四行', '，']);
  assert.equal(kept.join(''), lines.join(''));
  assert.deepEqual(keepPunctuationOffLineStart(['，开头']), ['，开头']);
});
