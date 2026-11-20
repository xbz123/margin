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
