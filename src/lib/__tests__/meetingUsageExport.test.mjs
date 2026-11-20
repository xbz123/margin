// The PDF export lists "expand answer" (followup) and "generate follow-up questions"
// (followup_questions) entries instead of skipping them, one bullet per question.

import test from 'node:test';
import assert from 'node:assert/strict';

import { followUpQuestionList, usageExportBlocks } from '../meetingUsageExport.mjs';
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

test('closing punctuation never starts a wrapped line and no text is lost or reordered', () => {
  const lines = ['第一行文字', '，第二行', '。」第三行', '第四行', '，'];
  const kept = keepPunctuationOffLineStart(lines);
  assert.deepEqual(kept, ['第一行文字，', '第二行。」', '第三行', '第四行', '，']);
  assert.equal(kept.join(''), lines.join(''));
  assert.deepEqual(keepPunctuationOffLineStart(['，开头']), ['，开头']);
});
