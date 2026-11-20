// "Copy full transcript" copies what the transcript page shows: the same spoken lines in the
// same order, with the same times and speakers. AI answers are not labelled as the other
// party; they stay in the stored meeting for the usage history.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { formatTranscriptCopy, isSpokenEntry, speakerLabelKey, visibleTranscriptRows } from '../meetingTranscriptView.mjs';

const zh = { Me: '我', Them: '对方' };
const translate = key => zh[key] ?? key;
// A deterministic stand-in for the page's locale clock.
const formatTime = ms => `t${Math.round(ms / 1000)}`;

const meeting = {
  transcript: [
    { speaker: 'interviewer', text: '请介绍一下你的项目。', timestamp: 1000 },
    { speaker: 'user', text: '我做了一个会议助手。', timestamp: 2000 },
    { speaker: 'assistant', text: 'AI 回答：可以从架构讲起。', timestamp: 2500 },
    { speaker: 'interviewer', text: '用了什么存储？', timestamp: 3000 },
    { speaker: 'system', text: '系统提示', timestamp: 3100 },
    { speaker: 'AI', text: 'AI 回答：SQLite。', timestamp: 3200 },
    { speaker: 'user', text: 'SQLite，本地加密。', timestamp: 4000 },
    { speaker: 'interviewer', text: '开场白', timestamp: 0 },
  ],
  usage: [{ type: 'assist', timestamp: 2500, question: 'What to Answer', answer: 'AI 回答：可以从架构讲起。' }],
};

test('the page rows are the spoken lines, in order, with their speaker and time', () => {
  const rows = visibleTranscriptRows(meeting.transcript, formatTime);
  assert.deepEqual(rows.map(row => [translate(row.speakerKey), row.time, row.text]), [
    ['对方', 't1', '请介绍一下你的项目。'],
    ['我', 't2', '我做了一个会议助手。'],
    ['对方', 't3', '用了什么存储？'],
    ['我', 't4', 'SQLite，本地加密。'],
    ['对方', '0:00', '开场白'],
  ]);
});

test('the copied text is the page rows, line for line; no AI answer is copied as the other party', () => {
  const rows = visibleTranscriptRows(meeting.transcript, formatTime);
  const copied = formatTranscriptCopy(rows, translate);
  assert.equal(copied, [
    '[t1] 对方: 请介绍一下你的项目。',
    '[t2] 我: 我做了一个会议助手。',
    '[t3] 对方: 用了什么存储？',
    '[t4] 我: SQLite，本地加密。',
    '[0:00] 对方: 开场白',
  ].join('\n'));
  assert.doesNotMatch(copied, /AI 回答|系统提示/);
  const lines = copied.split('\n');
  assert.equal(lines.length, rows.length);
  rows.forEach((row, i) => assert.equal(lines[i], `[${row.time}] ${translate(row.speakerKey)}: ${row.text}`));
});

test('the stored meeting is not changed; AI answers remain for the usage history', () => {
  const before = JSON.stringify(meeting);
  visibleTranscriptRows(meeting.transcript, formatTime);
  assert.equal(JSON.stringify(meeting), before);
  assert.equal(meeting.usage[0].answer, 'AI 回答：可以从架构讲起。');
});

test('speaker mapping and hidden speakers', () => {
  assert.equal(speakerLabelKey('user'), 'Me');
  assert.equal(speakerLabelKey('interviewer'), 'Them');
  for (const speaker of ['system', 'ai', 'AI', 'assistant', 'Model']) assert.equal(isSpokenEntry({ speaker }), false);
  for (const speaker of ['user', 'interviewer', 'speaker_1']) assert.equal(isSpokenEntry({ speaker }), true);
  assert.deepEqual(visibleTranscriptRows(undefined, formatTime), []);
  assert.equal(formatTranscriptCopy([], translate), '');
});

test('MeetingDetails renders and copies from the same rows', () => {
  const source = readFileSync(fileURLToPath(new URL('../../components/MeetingDetails.tsx', import.meta.url)), 'utf8');
  assert.match(source, /const transcriptRows = visibleTranscriptRows\(meeting\.transcript, formatTime\)/);
  assert.match(source, /formatTranscriptCopy\(transcriptRows, t\)/);
  assert.match(source, /transcriptRows\.map\(/);
  assert.doesNotMatch(source, /meeting\.transcript\.map\(/, 'the copy no longer walks the raw transcript');
});
