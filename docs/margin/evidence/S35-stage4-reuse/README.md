# Old Margin reuse list for stages 4–7 (PLAN S35)

Claude, 2026-10-11; revised the same day after Astra's review (PLAN §9 "S35 复用清单审阅").
Read-only inspection of the earlier Margin branch at `b8ade3f7`
(`codex/ai-assistant-refactor`): every file it adds or changes against the
baseline `a786910e` (1655 files: 1410 added, 245 modified). Nothing was copied
into this branch. The list is PLAN §6 "旧 Margin 复用清单（S35）".

The list is an inventory of review candidates, not a cleared migration list. Its
actions estimate work; they do not say a file's source is clear. Every import is
still reviewed line by line and recorded in PROVENANCE.

## Inputs (`run-manifest.json`)

Baseline `a786910e`, imported snapshot `fcfbb02a`, old Margin `b8ade3f7`, this
branch `0769715e` (full SHAs in the manifest). Everything about this branch is read
from that commit's tree, never from the working tree. The manifest also records
the 125 upstream refs the provenance check pooled (SHA list and hash), the hashes
of the check's script, configuration and output, the scan summary, the hashes of
the inputs and scripts here, and the tool versions.

## Rebuild, from the repository root

    node scripts/margin/provenance-check.mjs --target b8ade3f7 --json --max-hits 0 > /tmp/prov.json
    python3 -I -c 'import json,sys; d=json.load(open(sys.argv[1])); print(json.dumps({f: sorted(x["line"] for x in v) for f, v in sorted(d["hitsByFile"].items())}))' /tmp/prov.json  # = hit-lines.json, modulo layout
    python3 -I docs/margin/evidence/S35-stage4-reuse/analyze_all.py "$PWD" \
      docs/margin/evidence/S35-stage4-reuse/files-all.txt \
      docs/margin/evidence/S35-stage4-reuse/hit-lines.json \
      docs/margin/evidence/S35-stage4-reuse/profile-all.json
    python3 -I docs/margin/evidence/S35-stage4-reuse/build_reuse_list.py \
      docs/margin/evidence/S35-stage4-reuse "$PWD" 0769715e
    python3 -I docs/margin/evidence/S35-stage4-reuse/run_manifest.py "$PWD" /tmp/prov.json 0769715e \
      docs/margin/evidence/S35-stage4-reuse/run-manifest.json
    python3 -I docs/margin/evidence/S35-stage4-reuse/rule_probes.py "$PWD"

`hit-lines.json` keeps the scan's hit line numbers, so the analysis reruns without
rebuilding the upstream pool. `files-all.txt` is
`git diff --name-status --no-renames a786910e b8ade3f7` without the deleted files.
The analysis takes about two and a half minutes; a rerun on these inputs gives
byte-identical files.

## Files

- `analyze_all.py` → `profile-all.json`, one file per line:
  - `coverage`: `text-scanned`, `ext-not-covered` (the upstream pool only holds the
    check's TEXT_EXT extensions, so `.json`, `.svg`, `.txt` and others were never
    compared), `excluded` (the check's excludePaths) or `asset` (binary, or PDF,
    DOCX, image, font and similar). Assets get their blob, size and Margin commits.
  - `total`: substantive lines (more than 12 characters, as in the check).
  - `margin`: lines whose last change `git blame -w -M -C -C fcfbb02a..b8ade3f7`
    attributes to a Margin commit. Blame names the last change, not the author;
    an edited upstream line also counts here.
  - `marginHitLines`: Margin lines identical to restricted upstream.
  - `nearSnapshotLines`: Margin lines with the same masked shape as an upstream line
    of the file's snapshot version and at least half of its identifier and string
    tokens: likely edited upstream lines.
  - `snapshotNotBaselineRanges`: snapshot lines absent from the baseline file.
  - `forkUpstream`: upstream lines in the file's snapshot version (renames
    followed); above zero, read the Margin commit diffs, not only the final lines.
  - `candidateRanges`: scanned Margin lines with no flag; `shortRanges`: Margin
    lines of 12 characters or fewer, never scanned.
- `build_reuse_list.py` → `head-state.json` (each candidate against `0769715e`:
  `identical`, `differs`, `absent`), `reuse-map.json` (one candidate per line:
  ticket, action, counts, ranges, dependencies with status, the files to write that
  planned imports pull in, and the other tickets they need), `reuse-ranges.md` (the
  same for reading) and `plan-tables.md` (the tables in PLAN). Ticket assignment is
  the ordered `RULES` list: it names the main ticket only.
- `run_manifest.py` → `run-manifest.json`.
- `rule_probes.py`: runs `analyze()` and `kind()` unchanged on a synthetic
  repository and checks the review's counterexamples (renamed upstream line,
  binary, short line, uncovered extension, one hit, snapshot lines only). All 8
  pass.
