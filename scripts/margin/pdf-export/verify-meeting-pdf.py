"""Checks the sample meeting PDF from export-sample-meeting.mjs as a reader sees it.

    uv run --isolated --no-project --with pypdfium2==4.30.0 --with fonttools==4.55.3 --with pillow==11.0.0 \
        python -I scripts/margin/pdf-export/verify-meeting-pdf.py <out-dir> <export font .ttf>

Renders every page to <out-dir>/meeting-zh-page-N.png with PDFium (Chromium's PDF engine),
extracts each page's text with PDFium and, when installed, with Poppler's pdftotext, and checks:
- every character of the meeting text has a glyph in the export font (no .notdef boxes);
- the long assist answer spans at least three pages;
- the assist answer, the expanded answer, the transcript lines, the headings and every
  follow-up question appear exactly once, in order, with no line missing or repeated at page
  breaks (the whole assist answer is one unbroken run of text across the pages);
- each follow-up question is its own bullet.
Writes <out-dir>/meeting-zh.check.json and exits non-zero when a check fails.
"""
import json
import os
import re
import shutil
import subprocess
import sys

import pypdfium2 as pdfium
from fontTools.ttLib import TTFont

out_dir, font_file = sys.argv[1], sys.argv[2]
expected = json.load(open(os.path.join(out_dir, 'meeting-zh.expected.json'), encoding='utf-8'))
pdf_path = os.path.join(out_dir, 'meeting-zh.pdf')
failures = []


def check(ok, message):
    print(('PASS ' if ok else 'FAIL ') + message)
    if not ok:
        failures.append(message)


def squash(text):
    return re.sub(r'\s+', '', text)


# --- Render and extract ---------------------------------------------------------------------
pdf = pdfium.PdfDocument(pdf_path)
pngs, pdfium_pages = [], []
for index in range(len(pdf)):
    page = pdf[index]
    png = os.path.join(out_dir, f'meeting-zh-page-{index + 1}.png')
    page.render(scale=150 / 72).to_pil().save(png)
    pngs.append(png)
    pdfium_pages.append(page.get_textpage().get_text_range())
print('pages', len(pdf))
for png in pngs:
    print('png', png)

extractors = {'pdfium': pdfium_pages}
pdftotext = shutil.which('pdftotext')
if pdftotext:
    poppler = []
    for index in range(len(pdf)):
        result = subprocess.run([pdftotext, '-enc', 'UTF-8', '-f', str(index + 1), '-l', str(index + 1), pdf_path, '-'],
                                capture_output=True, check=True)
        poppler.append(result.stdout.decode('utf-8'))
    extractors['poppler'] = poppler

# --- Glyph coverage -------------------------------------------------------------------------
cmap = TTFont(font_file).getBestCmap()
all_text = ''.join(expected['headings'] + expected['speakerLabels'] + expected['transcript']
                   + expected['assistSentences'] + expected['followupSentences'] + expected['questions'])
missing = sorted({ch for ch in all_text if not ch.isspace() and ord(ch) not in cmap})
check(not missing, f'every character of the meeting text has a glyph in the export font (missing: {missing})')

report = {'pdf': pdf_path, 'pages': len(pdf), 'pngs': pngs, 'extractors': {}}
for name, pages in extractors.items():
    print(f'--- {name}')
    flat = [squash(page) for page in pages]
    full = ''.join(flat)

    def once_in_order(items, label):
        position, ok = -1, True
        for item in items:
            needle = squash(item)
            count = full.count(needle)
            found = full.find(needle)
            if count != 1 or found <= position:
                ok = False
                print(f'   {label}: {item[:30]!r} count={count} at={found} after={position}')
            position = max(position, found)
        check(ok, f'[{name}] {label}: all {len(items)} present exactly once, in order')
        return ok

    once_in_order([expected['headings'][0]], 'title')
    once_in_order(expected['transcript'], 'transcript lines')
    once_in_order(expected['assistSentences'], 'assist answer sentences')
    whole = squash(''.join(expected['assistSentences']))
    check(full.count(whole) == 1, f'[{name}] assist answer is one unbroken run across page breaks ({len(whole)} characters)')
    once_in_order(expected['followupSentences'], 'expanded answer sentences')
    once_in_order(expected['questions'], 'follow-up questions')
    bullets = [q for q in expected['questions'] if full.count('•' + squash(q)) == 1]
    check(len(bullets) == len(expected['questions']), f'[{name}] each follow-up question is its own bullet ({len(bullets)}/{len(expected["questions"])})')
    order = [expected['headings'][0]] + expected['headings'][1:3] + [expected['headings'][3], expected['assistSentences'][0],
             expected['headings'][4], expected['followupSentences'][0], expected['headings'][5], expected['questions'][0]]
    once_in_order(order, 'sections in order')

    # Where the assist answer falls, page by page (first and last sentence number on each page).
    numbers = [[int(n) for n in re.findall(r'第(\d{3})句', page)] for page in flat]
    spans = [(i + 1, nums[0], nums[-1]) for i, nums in enumerate(numbers) if nums]
    print('   assist sentences by page (page, first, last):', spans)
    check(len(spans) >= 3, f'[{name}] assist answer spans at least three pages ({len(spans)})')
    sequence = [n for nums in numbers for n in nums]
    check(sequence == list(range(1, len(expected['assistSentences']) + 1)),
          f'[{name}] sentence numbers run 1..{len(expected["assistSentences"])} with no gap or repeat across pages')
    report['extractors'][name] = {'assistPages': spans, 'pageText': pages}

report['failures'] = failures
json.dump(report, open(os.path.join(out_dir, 'meeting-zh.check.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
print('RESULT', 'FAIL' if failures else 'PASS', f'({len(failures)} failures)')
sys.exit(1 if failures else 0)
