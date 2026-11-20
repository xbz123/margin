# Noto Sans SC 2.004 (subset) — PDF export font

`NotoSansSC-Regular-subset.ttf` is the only font the meeting PDF export uses for its text, so
Chinese (and Latin) body text, speaker labels and headings render with real glyphs. It is
loaded lazily, only when a PDF is exported (`src/utils/pdfCjkFont.ts`), and jsPDF embeds just
the glyphs a document uses.

## Origin

- Source file: `ofl/notosanssc/NotoSansSC[wght].ttf` in the official Google Fonts repository,
  https://github.com/google/fonts, commit `a85815a42757630ce188fdad368c2dfc444d4773`
  (raw URL: https://raw.githubusercontent.com/google/fonts/a85815a42757630ce188fdad368c2dfc444d4773/ofl/notosanssc/NotoSansSC%5Bwght%5D.ttf).
  - Git blob `fb0637bafbcd804fe32152370a1225990745b4bc` (matches the GitHub contents API), SHA-256
    `a3041811a78c361b1de50f953c805e0244951c21c5bd412f7232ef0d899af0da`, 17,772,300 bytes.
  - Upstream: notofonts/noto-cjk `Sans2.004` (commit `523d033d6cb47f4a80c58a35753646f5c3608a78`),
    itself derived from Adobe Source Han Sans.
- `OFL.txt`: `ofl/notosanssc/OFL.txt` from the same commit, unmodified (Git blob
  `1c9f43281b8f216c5461fe9ac729afbade7724e4`, SHA-256
  `1c05c68c34f9708415aada51f17e1b0092d2cea709bf4a94cd38114f9e73d7d9`).

## License

SIL Open Font License 1.1 (see `OFL.txt`). Copyright 2014-2021 Adobe, with Reserved Font Name
'Source'. The subset keeps the Noto Sans SC family name, which is not a Reserved Font Name.

## How the subset was made

`scripts/margin/fonts/subset-noto-sans-sc.py`, with fontTools 4.55.3:

    python -I scripts/margin/fonts/subset-noto-sans-sc.py "NotoSansSC[wght].ttf" NotoSansSC-Regular-subset.ttf 400 Unihan_OtherMappings.txt

1. The variable font is instanced at `wght=400` (its default instance is Thin).
2. Glyphs are kept for every GB2312 character (6,763 hanzi plus GB2312 symbols, kana, Greek and
   Cyrillic), every character of the Table of General Standard Chinese Characters
   (通用规范汉字表, 2013; 8,105 characters, all present in the font), ASCII, Latin-1 and Latin
   Extended-A, general punctuation, arrows, maths, enclosed numerals, box drawing and shapes,
   miscellaneous symbols, Dingbats, CJK symbols and punctuation, and full-width forms.
3. Layout (GSUB/GPOS/GDEF/BASE/STAT), vertical metrics and hinting are dropped: jsPDF does no
   shaping.

The general-standard list is the `kTGH` field of `Unihan_OtherMappings.txt` in the Unicode 16.0.0
Unihan database, https://www.unicode.org/Public/16.0.0/ucd/Unihan.zip (SHA-256
`b8f000df69de7828d21326a2ffea462b04bc7560022989f7cc704f10521ef3e0`, 8,382,485 bytes). It is
used only to choose glyphs and is not shipped.

Result: 9,693 glyphs, 2,845,832 bytes, SHA-256
`d922ffef339c23e36aaf7ee6451fa03ed36f65d831780c2a60b35fbcf8ae57d2`.

## Known gaps

Characters the subset has no glyph for are drawn as the .notdef box:

- Hanzi outside both GB2312 and the general-standard table, for example 碁 (a variant of 棋).
  Common names and words such as 啰 喆 堃 玥 镕 赟 昇 犇 祎 旸 偲 are covered.
- Check marks and crosses that Noto Sans SC itself does not have: ✔ (U+2714), ✗ (U+2717),
  ✘ (U+2718), and the emoji ✅ (U+2705) and ❌ (U+274C). ✓ (U+2713) is covered. Of the
  Dingbats block the font has 38 glyphs, all kept.
- Other emoji.

There is a single weight: headings and labels are drawn bolder with a thin text outline.
