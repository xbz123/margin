"""Instance Noto Sans SC (variable) at a fixed weight and subset it for jsPDF export.

Usage: python -I subset-noto-sans-sc.py <NotoSansSC[wght].ttf> <out.ttf> <weight> <Unihan_OtherMappings.txt>

The last file is from the Unicode Character Database (Unihan.zip); its kTGH field lists the
8,105 characters of the Table of General Standard Chinese Characters (通用规范汉字表, 2013).
"""
import sys
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer
from fontTools import subset

src, out, weight, unihan = sys.argv[1], sys.argv[2], float(sys.argv[3]), sys.argv[4]

codepoints = set()
# GB2312 (all 7445 characters: 6763 hanzi plus symbols, kana, Greek, Cyrillic, box drawing).
for hi in range(0xA1, 0xF8):
    for lo in range(0xA1, 0xFF):
        try:
            codepoints.add(ord(bytes([hi, lo]).decode('gb2312')))
        except UnicodeDecodeError:
            pass
# Table of General Standard Chinese Characters (通用规范汉字表): adds common characters outside
# GB2312 such as 啰 喆 堃 玥 镕 赟 昇 犇 祎 旸 偲.
general_standard = set()
with open(unihan, encoding='utf-8') as lines:
    for line in lines:
        fields = line.rstrip('\n').split('\t')
        if len(fields) == 3 and fields[1] == 'kTGH':
            general_standard.add(int(fields[0][2:], 16))
assert len(general_standard) == 8105, len(general_standard)
codepoints |= general_standard
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
    (0x2700, 0x27BF),  # Dingbats (the font has 38 of them, among them ✓ but not ✔ ✅ ❌)
    (0x3000, 0x303F),  # CJK Symbols and Punctuation
    (0xFE30, 0xFE4F),  # CJK compatibility forms
    (0xFF00, 0xFFEF),  # Halfwidth and Fullwidth Forms
]
for a, b in ranges:
    codepoints.update(range(a, b + 1))

font = TTFont(src)
source_cmap = font.getBestCmap()
print('general standard characters the font lacks:', sorted(hex(c) for c in general_standard - source_cmap.keys()))
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
