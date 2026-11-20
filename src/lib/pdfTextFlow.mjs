// Writes wrapped PDF lines down the page and onto new pages as needed. Each line is drawn on
// its own at its baseline; when the next line would pass the bottom margin a page is added and
// writing continues at the top margin, so a block longer than a page is never cut off.

/**
 * @param doc jsPDF-like: text(line, x, y) and addPage()
 * @param lines the wrapped lines (from splitTextToSize)
 * @returns the y below the last line
 */
export function flowLines(doc, lines, { x, y, lineHeight, top, bottom }) {
  for (const line of [].concat(lines)) {
    // A line taller than a whole page is still drawn once, at the top, rather than looping.
    if (y + lineHeight > bottom && y > top) {
      doc.addPage();
      y = top;
    }
    doc.text(line, x, y);
    y += lineHeight;
  }
  return y;
}

// Closing punctuation that Chinese typesetting never starts a line with.
const NO_LINE_START = /^[，。、；：？！）》」』】〕…,.;:?!)\]]+/u;

/**
 * Wrapped lines with closing punctuation moved from the start of a line to the end of the line
 * before it (it then overhangs the right margin by that mark). Text and order are unchanged.
 * The lines must be the soft-wrapped lines of ONE paragraph: across a hard line break the mark
 * would be moved into the previous paragraph. Use wrapParagraphs for text with line breaks.
 */
export function keepPunctuationOffLineStart(lines) {
  const out = [];
  for (const line of [].concat(lines)) {
    const lead = out.length ? line.match(NO_LINE_START)?.[0] : undefined;
    if (lead && lead.length < line.length) {
      out[out.length - 1] += lead;
      out.push(line.slice(lead.length));
    } else {
      out.push(line);
    }
  }
  return out;
}

/**
 * Text wrapped for the page, paragraph by paragraph: the text is split at its own line breaks,
 * each paragraph is wrapped with split (e.g. doc.splitTextToSize) and its closing punctuation is
 * kept off its soft line starts. A paragraph that starts with "." or ")" (".NET", a closing
 * bracket in code) keeps it; every hard line break stays where it was.
 */
export function wrapParagraphs(text, split) {
  return String(text ?? '').split(/\r?\n/).flatMap(paragraph => keepPunctuationOffLineStart(split(paragraph)));
}
