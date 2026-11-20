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
  assert.match(pdf, /usageExportBlocks\(meeting\.usage\)/);
  assert.match(pdf, /`Q: \$\{block\.question\}`/);
  assert.doesNotMatch(pdf, /item\.question/);
  const details = readFileSync(new URL('../../components/MeetingDetails.tsx', import.meta.url), 'utf8');
  assert.match(details, /interaction\.displayQuestion \|\| interaction\.question/);
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
  const intentMap = engine.match(/const intentMap: Record<string, string> = \{([\s\S]*?)\};/)[1];
  const refinements = [...intentMap.matchAll(/:\s*'([^']+)'/g)].map(match => match[1]);
  assert.ok(refinements.includes('Simplify Answer'));
  for (const question of refinements) {
    const { label, request } = followUpLabel(question);
    assert.equal(request, undefined, `${question} is a known refinement`);
    assert.ok(zh.includes(`'${label}': '`), `${label} has a Chinese translation`);
  }
  assert.ok(zh.includes(`'Requested change': '`));
});

test('closing punctuation never starts a wrapped line and no text is lost or reordered', () => {
  const lines = ['第一行文字', '，第二行', '。」第三行', '第四行', '，'];
  const kept = keepPunctuationOffLineStart(lines);
  assert.deepEqual(kept, ['第一行文字，', '第二行。」', '第三行', '第四行', '，']);
  assert.equal(kept.join(''), lines.join(''));
  assert.deepEqual(keepPunctuationOffLineStart(['，开头']), ['，开头']);
});
