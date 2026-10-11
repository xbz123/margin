# Stage 4 reuse of old Margin files (PLAN S35)

Claude, 2026-10-11. Read-only inspection of the earlier Margin branch at
`b8ade3f7` (`codex/ai-assistant-refactor`) for stage 4 (AG-40, AG-41, AG-42).
Nothing was copied into this branch; this is the basis on which files may be
imported later, each one still reviewed line by line and recorded in PROVENANCE.

- `files.txt`: the 204 audio, STT, session and answer files considered.
- `analyze.py`: blames each line from `fcfbb02a` (the imported snapshot, no
  shared history with the baseline) to `b8ade3f7` with move and copy detection.
- `profile.json`: per file, substantive lines (`total`), lines written in
  Margin's own commits (`margin`), snapshot lines not in the baseline file
  (`snapshotNotBaseline`, treated as upstream content), restricted-line hits of
  the provenance check (`hits`) and those on Margin-written lines (`marginHits`).

The provenance check over the whole of `b8ade3f7` found 157,271 hits in 1,472
files (205,353 added substantive lines), as in the X1 calibration. Its full JSON
is not kept; it is regenerated with the command in `analyze.py`.

The resulting list is PLAN §6 "阶段 4 复用清单（S35）".
