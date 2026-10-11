# Old Margin reuse list for stages 4–7 (PLAN S35)

Claude, 2026-10-11. Read-only inspection of the earlier Margin branch at
`b8ade3f7` (`codex/ai-assistant-refactor`): every file it adds or changes
against the baseline `a786910e` (1655 files: 1410 added, 245 modified). Nothing
was copied into this branch. The list is PLAN §6 "旧 Margin 复用清单（S35）";
each import is still reviewed line by line and recorded in PROVENANCE.

Rebuild, from the repository root:

    node scripts/margin/provenance-check.mjs --target b8ade3f7 --json --max-hits 0 > /tmp/prov.json
    python3 -I docs/margin/evidence/S35-stage4-reuse/analyze_all.py "$PWD" \
      docs/margin/evidence/S35-stage4-reuse/files-all.txt /tmp/prov.json \
      docs/margin/evidence/S35-stage4-reuse/profile-all.json
    python3 -I docs/margin/evidence/S35-stage4-reuse/build_reuse_list.py \
      docs/margin/evidence/S35-stage4-reuse "$PWD"

`files-all.txt` is `git diff --name-status --no-renames a786910e b8ade3f7` without
the deleted files. `head-state.json` records, for each candidate, whether this
branch has the same blob (`identical`), another version (`differs`) or no file
(`absent`); it was taken at `a6446d02`.

- `analyze_all.py` → `profile-all.json`: per file, substantive lines (`total`,
  more than 12 characters as in the provenance check), lines written in Margin's
  own commits (`margin`, by `git blame -w -M -C -C fcfbb02a..b8ade3f7`), snapshot
  lines absent from the same baseline file (`snapshotNotBaseline`, treated as
  upstream content), restricted-line hits (`hits`), those on Margin lines
  (`marginHits`, `marginHitLines`) and the runs of clean Margin lines
  (`cleanRanges`).
- `build_reuse_list.py` → `reuse-map.json` (ticket, action, counts, line ranges
  and missing dependencies per candidate), `reuse-ranges.md` (the same for
  reading) and `plan-tables.md` (the per-ticket tables in PLAN). Ticket
  assignment is the ordered `RULES` list in the script.

The whole-branch provenance check found 157,271 hits in 1,472 files (205,353
added substantive lines), as in the X1 calibration; its JSON is not kept.
