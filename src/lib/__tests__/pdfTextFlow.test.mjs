// A single answer longer than a page is written across pages in the exported PDF: every line
// appears exactly once, in order, between the top and bottom margins (real jsPDF, in node).

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { jsPDF } from 'jspdf';

import { flowLines, wrapParagraphs } from '../pdfTextFlow.mjs';

const MM_TO_PT = 72 / 25.4;

/** Every drawn line, by page, read back from jsPDF's page content streams. */
function drawnLines(doc) {
  const height = doc.internal.pageSize.getHeight();
  return doc.internal.pages.slice(1).map((ops, index) => [...ops.join('\n').matchAll(/([\d.]+) ([\d.]+) Td\n\((.*)\) Tj/g)]
    .map(match => ({ page: index + 1, x: Number(match[1]) / MM_TO_PT, y: height - Number(match[2]) / MM_TO_PT, text: match[3] })));
}

test('an answer spanning three pages keeps its first, middle and last lines and every line in between', () => {
  // The layout pdfGenerator's addText uses for answer text: 10pt, 20 mm margins, lines spaced
  // as a single doc.text(lines) call spaces them (10pt x line height factor, in mm).
  const fresh = new jsPDF();
  fresh.setFontSize(10);
  fresh.setFont('helvetica', 'normal');
  const width = fresh.internal.pageSize.getWidth() - 40;
  const lineHeight = 10 * fresh.getLineHeightFactor() / fresh.internal.scaleFactor;
  // Markers go into the text before it is wrapped, so they cannot push a line past the margin.
  const words = Array.from({ length: 2400 }, (_, i) => `w${i}`);
  words[0] = `FIRSTMARK ${words[0]}`;
  words[1200] = `MIDDLEMARK ${words[1200]}`;
  words[words.length - 1] = `${words[words.length - 1]} LASTMARK`;
  const lines = fresh.splitTextToSize('A: ' + words.join(' '), width);
  // Start part-way down the first page, after a header, as an answer in the usage section does.
  const end = flowLines(fresh, lines, { x: 20, y: 120, lineHeight, top: 20, bottom: fresh.internal.pageSize.getHeight() - 20 });
  const pages = drawnLines(fresh);
  assert.ok(pages.length >= 3, `the answer spans at least three pages (got ${pages.length})`);
  const drawn = pages.flat();
  assert.deepEqual(drawn.map(line => line.text), lines, 'every line once, in order: none missing or repeated');
  assert.match(drawn[0].text, /FIRSTMARK/);
  const middle = drawn.find(line => line.text.includes('MIDDLEMARK'));
  assert.ok(middle);
  assert.match(drawn.at(-1).text, /LASTMARK/);
  assert.equal(drawn[0].page, 1);
  assert.equal(drawn.at(-1).page, pages.length);
  assert.ok(middle.page > 1);

  const height = fresh.internal.pageSize.getHeight();
  for (const line of drawn) {
    assert.ok(line.y >= 20 - 1e-6, `line on page ${line.page} at ${line.y} is below the top margin`);
    assert.ok(line.y + lineHeight <= height - 20 + 1e-6, `line on page ${line.page} at ${line.y} stays above the bottom margin`);
    // Horizontal margins: every line starts at the left margin and ends inside the right one.
    assert.ok(Math.abs(line.x - 20) < 1e-3, `line on page ${line.page} starts at ${line.x}`);
    assert.ok(fresh.getTextWidth(line.text) <= width + 1e-6, `"${line.text}" passes the right margin`);
  }
  // Each page after the first is filled from the top margin, at the original line spacing.
  for (const page of pages.slice(1)) {
    assert.ok(Math.abs(page[0].y - 20) < 1e-6);
    for (let i = 1; i < page.length; i++) assert.ok(Math.abs(page[i].y - page[i - 1].y - lineHeight) < 1e-3);
  }
  // The first page is used down to its remaining space, not skipped.
  assert.ok(pages[0].length > 1);
  assert.ok(end > 20 && end <= height - 20 + lineHeight);
});

test('flowed lines keep the spacing of a single doc.text(lines) call', () => {
  // One doc.text(lines) call steps by its text leading (TL, in pt): font size x line height factor.
  const single = new jsPDF();
  single.setFontSize(10);
  single.text(['one', 'two', 'three'], 20, 40);
  const leading = Number(single.internal.pages[1].join('\n').match(/([\d.]+) TL/)[1]) / MM_TO_PT;

  const flowed = new jsPDF();
  flowed.setFontSize(10);
  flowLines(flowed, ['one', 'two', 'three'], { x: 20, y: 40, lineHeight: 10 * flowed.getLineHeightFactor() / flowed.internal.scaleFactor, top: 20, bottom: 277 });
  const ys = drawnLines(flowed)[0].map(line => line.y);
  assert.equal(ys.length, 3);
  for (let i = 1; i < ys.length; i++) assert.ok(Math.abs(ys[i] - ys[i - 1] - leading) < 1e-3, `gap ${ys[i] - ys[i - 1]} mm, single call ${leading} mm`);
});

test('a short block that fits stays on its page; one that does not continues on the next', () => {
  const calls = [];
  const doc = { text: (line, x, y) => calls.push(['text', line, y]), addPage: () => calls.push(['page']) };
  let y = flowLines(doc, ['a', 'b'], { x: 20, y: 20, lineHeight: 5, top: 20, bottom: 40 });
  assert.equal(y, 30);
  y = flowLines(doc, ['c', 'd', 'e'], { x: 20, y, lineHeight: 5, top: 20, bottom: 40 });
  assert.deepEqual(calls, [['text', 'a', 20], ['text', 'b', 25], ['text', 'c', 30], ['text', 'd', 35], ['page'], ['text', 'e', 20]]);
  assert.equal(y, 25);
});

test('pdfGenerator writes text through flowLines', () => {
  const source = readFileSync(fileURLToPath(new URL('../../utils/pdfGenerator.ts', import.meta.url)), 'utf8');
  assert.match(source, /import \{ flowLines, wrapParagraphs, type TextFlowTarget \} from '\.\.\/lib\/pdfTextFlow\.mjs'/);
  // Every block (text and list items) is wrapped paragraph by paragraph and goes through one
  // flowLines call.
  assert.match(source, /const lines = wrapParagraphs\(text, paragraph => doc\.splitTextToSize\(paragraph, width\)\);\n\s*y = flowLines\(target\(isBold, bulletX\), lines, \{/);
  assert.equal(source.match(/splitTextToSize\(/g).length, 1, 'no block is wrapped as a whole');
  assert.equal(source.match(/flowLines\(/g).length, 1);
  assert.doesNotMatch(source, /doc\.text\(lines, margin, y\)/, 'no single draw of a whole block');
});

// pdfGenerator compiled from source; the PDF is built in memory and never saved.
async function loadPdfGenerator() {
  const ts = (await import('typescript')).default;
  const vm = await import('node:vm');
  const { createRequire } = await import('node:module');
  const require = createRequire(import.meta.url);
  const modules = {
    '../lib/pdfTextFlow.mjs': await import('../pdfTextFlow.mjs'),
    '../lib/meetingTranscriptView.mjs': await import('../meetingTranscriptView.mjs'),
    '../lib/meetingUsageExport.mjs': await import('../meetingUsageExport.mjs'),
  };
  const source = readFileSync(fileURLToPath(new URL('../../utils/pdfGenerator.ts', import.meta.url)), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(compiled, { module, exports: module.exports, require: id => modules[id] ?? require(id) });
  return module.exports;
}

test('the PDF transcript lists the rows the transcript page and copy show, at the original line spacing', async () => {
  const { buildMeetingPDF } = await loadPdfGenerator();
  const { visibleTranscriptRows, formatTranscriptTime, formatTranscriptCopy } = await import('../meetingTranscriptView.mjs');
  const at = Date.UTC(2026, 10, 20, 9, 30, 0);
  const transcript = [
    { speaker: 'interviewer', text: 'Tell me about your last project', timestamp: at },
    { speaker: 'assistant', text: 'ASSISTANT ANSWER TEXT', timestamp: at + 1000 },
    { speaker: 'user', text: 'I built a rate limiter', timestamp: at + 2000 },
    { speaker: 'system', text: 'SYSTEM NOTE TEXT', timestamp: at + 3000 },
  ];
  const doc = buildMeetingPDF({ id: 'm1', title: 'Weekly sync', date: 'Nov 20', duration: '5 min', transcript });
  const drawn = drawnLines(doc).flat().map(line => line.text);
  const rows = visibleTranscriptRows(transcript, formatTranscriptTime);
  const body = drawn.slice(drawn.indexOf('Transcript') + 1);
  assert.deepEqual(body, rows.flatMap(row => [`${row.speakerKey} [${row.time}]`, row.text]));
  assert.deepEqual(body.filter((_, i) => i % 2 === 0), ['Them', 'Me'].map((speaker, i) => `${speaker} [${rows[i].time}]`));
  for (const hidden of ['ASSISTANT ANSWER TEXT', 'SYSTEM NOTE TEXT', 'assistant', 'system', 'interviewer', 'user']) {
    assert.ok(!drawn.some(line => line.includes(hidden)), `${hidden} is not in the PDF transcript`);
  }
  // The copy has the same speakers, times and lines (English labels, as in the PDF).
  assert.equal(formatTranscriptCopy(rows, key => key), rows.map((row, i) => `[${row.time}] ${body[2 * i].split(' [')[0]}: ${body[2 * i + 1]}`).join('\n'));

  // A long answer in the usage section is spaced as one doc.text(lines) call would space it.
  const long = buildMeetingPDF({ id: 'm2', title: 'T', date: 'D', duration: '1 min', usage: [
    { type: 'chat', timestamp: at, question: 'Q1', answer: Array.from({ length: 300 }, (_, i) => `word${i}`).join(' ') },
  ] });
  const answer = drawnLines(long)[0].filter(line => /word\d/.test(line.text));
  assert.ok(answer.length > 3);
  const expected = 10 * long.getLineHeightFactor() / long.internal.scaleFactor;
  for (let i = 1; i < answer.length; i++) assert.ok(Math.abs(answer[i].y - answer[i - 1].y - expected) < 1e-3);
  assert.ok(Math.abs(expected - 11.5 / MM_TO_PT) < 1e-9, 'jsPDF default: 10pt x 1.15, in mm');
});

test('expanded answers and follow-up question lists are exported, through the same page flow', async () => {
  const { buildMeetingPDF } = await loadPdfGenerator();
  const at = Date.UTC(2026, 10, 20, 9, 30, 0);
  const expanded = Array.from({ length: 1500 }, (_, i) => `exp${i}`).join(' ');
  const questions = ['How is the cache invalidated?', 'What if a message is delivered twice?', 'How was the pool size chosen?'];
  const doc = buildMeetingPDF({ id: 'm3', title: 'T', date: 'D', duration: '1 min', usage: [
    { type: 'followup', timestamp: at, question: 'Follow-up', answer: expanded },
    { type: 'followup_questions', timestamp: at + 1, question: 'Generate Follow-up Questions', answer: questions.map((q, i) => `${i + 1}. ${q}`).join('\n') },
    { type: 'followup_questions', timestamp: at + 2, answer: null, items: ['Stored item question?'] },
  ] });
  const drawn = drawnLines(doc).flat();
  const texts = drawn.map(line => line.text);
  assert.ok(texts.includes('Expanded answer:'));
  const words = drawn.filter(line => /exp\d/.test(line.text));
  assert.ok(new Set(words.map(line => line.page)).size >= 2, 'the expanded answer continues on the next page');
  assert.deepEqual(words.map(line => line.text).join(' ').split(' '), expanded.split(' '), 'every word once, in order');
  assert.ok(texts.lastIndexOf('Follow-Up Questions:') > texts.indexOf('Expanded answer:'));
  // Each question is its own line, indented past its bullet.
  for (const question of [...questions, 'Stored item question?']) {
    const line = drawn.find(item => item.text === question);
    assert.ok(line, `${question} is drawn as its own line`);
    assert.ok(line.x > 20 + 1, 'list items are indented');
  }
});

test('a refined answer is labelled with its refinement, and a typed request is shown as typed', async () => {
  const { buildMeetingPDF } = await loadPdfGenerator();
  const doc = buildMeetingPDF({ id: 'm5', title: 'T', date: 'D', duration: '1 min', usage: [
    { type: 'followup', timestamp: 1, question: 'Simplify Answer', answer: 'simple text' },
    { type: 'followup', timestamp: 2, question: 'Make it more casual please', answer: 'casual text' },
  ] });
  const texts = drawnLines(doc).flat().map(line => line.text);
  assert.deepEqual(texts.slice(texts.indexOf('AI Usage & Interactions') + 1),
    ['Simplify Answer:', 'simple text', 'Requested change: Make it more casual please', 'casual text']);
  assert.ok(!texts.includes('Expanded answer:'));
});

/** The drawn text of a PDF line: jsPDF escapes "\", "(" and ")" in its Tj strings. */
const unescapePdf = text => text.replace(/\\([\\()])/g, '$1');

test('hard line breaks stay where they are: a paragraph starting with "." or ")" is not joined to the one before', async () => {
  const { buildMeetingPDF } = await loadPdfGenerator();
  const paragraphs = [
    'Install the runtime first',
    '.NET 8 is required for this service',
    'result = compute(',
    '    a,',
    '), cache',
    'First part done',
    ': trailing colon line',
    '',
    'last line',
  ];
  const doc = buildMeetingPDF({ id: 'm4', title: 'T', date: 'D', duration: '1 min', usage: [
    { type: 'assist', timestamp: 1, answer: paragraphs.join('\n') },
    { type: 'followup_questions', timestamp: 2, answer: '1. Why .NET?\n2. ), then what?' },
  ] });
  const drawn = drawnLines(doc).flat().map(line => unescapePdf(line.text));
  const start = drawn.indexOf('Install the runtime first');
  assert.ok(start > 0, 'the answer is drawn');
  // jsPDF writes no text operator for the blank line, so it is not read back.
  const visible = paragraphs.filter(Boolean);
  assert.deepEqual(drawn.slice(start, start + visible.length), visible, 'each paragraph unchanged, on its own line');
  // List items are wrapped the same way.
  assert.ok(drawn.includes('Why .NET?'));
  assert.ok(drawn.includes('), then what?'));
});

test('wrapParagraphs wraps like jsPDF does, keeping closing punctuation off soft line starts only', () => {
  const doc = new jsPDF();
  doc.setFontSize(10);
  const text = 'Install the runtime first\n.NET 8 is required\n\n\nresult = compute(\r\n    a,\n), cache ' + 'word '.repeat(80) + '\nend';
  const split = paragraph => doc.splitTextToSize(paragraph, 170);
  // Same lines as one splitTextToSize of the whole text, which splits at line breaks itself.
  assert.deepEqual(wrapParagraphs(text, split), doc.splitTextToSize(text.replace(/\r\n/g, '\n'), 170));
  // Within a paragraph a soft wrap still moves the mark; across a hard break it does not.
  const fake = paragraph => paragraph === '第一行文字，第二行' ? ['第一行文字', '，第二行'] : [paragraph];
  assert.deepEqual(wrapParagraphs('第一行文字，第二行\n。开头的段落\n）补充说明', fake), ['第一行文字，', '第二行', '。开头的段落', '）补充说明']);
  assert.deepEqual(wrapParagraphs('', split), ['']);
});
