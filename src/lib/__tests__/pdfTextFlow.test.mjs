// A single answer longer than a page is written across pages in the exported PDF: every line
// appears exactly once, in order, between the top and bottom margins (real jsPDF, in node).

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { jsPDF } from 'jspdf';

import { flowLines } from '../pdfTextFlow.mjs';

const MM_TO_PT = 72 / 25.4;

/** Every drawn line, by page, read back from jsPDF's page content streams. */
function drawnLines(doc) {
  const height = doc.internal.pageSize.getHeight();
  return doc.internal.pages.slice(1).map((ops, index) => [...ops.join('\n').matchAll(/([\d.]+) ([\d.]+) Td\n\((.*)\) Tj/g)]
    .map(match => ({ page: index + 1, y: height - Number(match[2]) / MM_TO_PT, text: match[3] })));
}

test('an answer spanning three pages keeps its first, middle and last lines and every line in between', () => {
  // The layout pdfGenerator's addText uses for answer text: 10pt, 20 mm margins, 5 mm lines.
  const fresh = new jsPDF();
  fresh.setFontSize(10);
  fresh.setFont('helvetica', 'normal');
  const width = fresh.internal.pageSize.getWidth() - 40;
  const answer = 'A: ' + Array.from({ length: 2400 }, (_, i) => `w${i}`).join(' ');
  const lines = fresh.splitTextToSize(answer, width);
  // Markers on the first, middle and last wrapped lines.
  const middle = Math.floor(lines.length / 2);
  lines[0] = `FIRSTMARK ${lines[0]}`;
  lines[middle] = `MIDDLEMARK ${lines[middle]}`;
  lines[lines.length - 1] = `${lines[lines.length - 1]} LASTMARK`;
  // Start part-way down the first page, after a header, as an answer in the usage section does.
  const end = flowLines(fresh, lines, { x: 20, y: 120, lineHeight: 5, top: 20, bottom: fresh.internal.pageSize.getHeight() - 20 });
  const pages = drawnLines(fresh);
  assert.ok(pages.length >= 3, `the answer spans at least three pages (got ${pages.length})`);
  const drawn = pages.flat();
  assert.deepEqual(drawn.map(line => line.text), lines, 'every line once, in order: none missing or repeated');
  assert.match(drawn[0].text, /FIRSTMARK/);
  assert.match(drawn.find(line => line.text.startsWith('MIDDLEMARK')).text, /MIDDLEMARK/);
  assert.match(drawn.at(-1).text, /LASTMARK/);
  assert.equal(drawn[0].page, 1);
  assert.equal(drawn.at(-1).page, pages.length);
  assert.ok(drawn.find(line => line.text.startsWith('MIDDLEMARK')).page > 1);

  const height = fresh.internal.pageSize.getHeight();
  for (const line of drawn) {
    assert.ok(line.y >= 20 - 1e-6, `line on page ${line.page} at ${line.y} is below the top margin`);
    assert.ok(line.y + 5 <= height - 20 + 1e-6, `line on page ${line.page} at ${line.y} stays above the bottom margin`);
  }
  // Each page after the first is filled from the top margin.
  for (const page of pages.slice(1)) assert.ok(Math.abs(page[0].y - 20) < 1e-6);
  // The first page is used down to its remaining space, not skipped.
  assert.ok(pages[0].length > 1);
  assert.ok(end > 20 && end <= height - 20 + 5);
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
  assert.match(source, /import \{ flowLines \} from '\.\.\/lib\/pdfTextFlow\.mjs'/);
  assert.match(source, /y = flowLines\(doc, lines, \{/);
  assert.doesNotMatch(source, /doc\.text\(lines, margin, y\)/, 'no single draw of a whole block');
});
