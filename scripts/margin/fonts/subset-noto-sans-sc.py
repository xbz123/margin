"""Instance Noto Sans SC (variable) at a fixed weight and subset it for jsPDF export.

Usage: python -I make_subset.py <NotoSansSC[wght].ttf> <out.ttf> <weight>
"""
import sys
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer
from fontTools import subset

src, out, weight = sys.argv[1], sys.argv[2], float(sys.argv[3])

codepoints = set()
# GB2312 (all 7445 characters: 6763 hanzi plus symbols, kana, Greek, Cyrillic, box drawing).
for hi in range(0xA1, 0xF8):
    for lo in range(0xA1, 0xFF):
        try:
            codepoints.add(ord(bytes([hi, lo]).decode('gb2312')))
        except UnicodeDecodeError:
            pass
ranges = [
    (0x0020, 0x007E),  # ASCII
    (0x00A0, 0x017F),  # Latin-1 Supplement, Latin Extended-A
    (0x2000, 0x206F),  # General Punctuation
    (0x20A0, 0x20CF),  # Currency
    (0x2100, 0x214F),  # Letterlike
    (0x2190, 0x21FF),  # Arrows
    (0x2200, 0x22FF),  # Math operators
    (0x2460, 0x24FF),  # Enclosed alphanumerics
    (0x2500, 0x25FF),  # Box drawing, block elements, geometric shapes
    (0x2600, 0x26FF),  # Misc symbols
    (0x3000, 0x303F),  # CJK Symbols and Punctuation
    (0xFE30, 0xFE4F),  # CJK compatibility forms
    (0xFF00, 0xFFEF),  # Halfwidth and Fullwidth Forms
]
for a, b in ranges:
    codepoints.update(range(a, b + 1))

font = TTFont(src)
font = instancer.instantiateVariableFont(font, {'wght': weight}, updateFontNames=True)

options = subset.Options()
options.layout_features = []          # jsPDF does no shaping
options.drop_tables += ['GSUB', 'GPOS', 'GDEF', 'BASE', 'STAT', 'vhea', 'vmtx', 'gasp', 'prep', 'DSIG']
options.hinting = False
options.name_IDs = ['*']
options.name_languages = ['*']
options.notdef_outline = True
options.recalc_bounds = True
sub = subset.Subsetter(options)
sub.populate(unicodes=codepoints)
sub.subset(font)
font.save(out)

f = TTFont(out)
print(out, 'glyphs', f['maxp'].numGlyphs, 'cmap', len(f.getBestCmap()), 'tables', sorted(f.keys()))
for rec in f['name'].names:
    if rec.nameID in (1, 2, 4, 6) and rec.platformID == 3:
        print(' name', rec.nameID, rec.toUnicode())
