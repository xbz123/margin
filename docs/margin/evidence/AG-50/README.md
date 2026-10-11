# AG-50 local verification

Implementation on `codex/margin-agpl-migration`, based on `0116c6c2`, 2026-10-11.
Final policy: PLAN S40 (no Local Context data-scope switch). This is local execution
evidence, not Claude review, full Electron gates, CI, release or stage-5 acceptance.

## Behavior and source

- Text snapshots: 8 entries, 32 KiB each, 64 KiB combined UTF-8 body; bounded
  regular-file reads, fatal decoding, binary/extension rejection, atomic local save.
  Import does not store source paths or follow later source edits.
- First user turn is reference-only Local Context, then unchanged request content.
  All selected-generation entries, including manual answer and text chat, share it;
  connection probes are excluded. Add/remove invalidates in-flight generations.
- Budget checks complete text plus framing and output reserve against this branch's
  model classification, before sends. It is an estimate, not exact tokenization;
  custom/unknown capacity and real Codex limits are not verified. No LC truncation.
- Existing scope policy is unchanged. Local Context adds no scope. A scope refusal
  of the original request still prevents the entire send; tests explicitly preserve
  transcript denial and separately prove LC is unaffected by each scope switch.
- No old code fragments imported. PROVENANCE's AG-50 section records all inspected
  old files, excluded S35 ranges and seven generic G2 occurrences (six exact lines).
  No dependencies/licenses, prewarm, document parsers or Skills were introduced.

## Checks

`checks/commands.json` records each command and exit code. `checks/unit/` contains
the existing isolated per-file runner's TAP, file inventory and summary.

- Electron and Vite builds, both tsc checks, preload contract, IPC channels,
  retirement scan, G2 and whitespace: exit 0.
- Unit suite: 123 files / 978 tests; 976 pass, 1 fail, 1 existing skip. Only failure:
  `electron/margin/__tests__/icons.test.mjs`, system iconutil under the sandbox
  (known exception in the task). No timeout, unfinished file or isolation violation.
- New AG-50 tests: 8/8. Mock transport and actual production store, helper,
  WhatToAnswer, IPC, preload and card actions are exercised. No real account,
  provider, user-data directory, keychain or device is used.
- Initial fixture registration failure was fixed without weakening assertions.
  Only final logs are retained. Absolute workspace paths in reports are normalized
  to `<worktree>`; the temporary helper and isolated sandboxes are removed.

No `tests/margin/` test was changed: fresh empty Local Context leaves the prior
startup/storage/regression requests unchanged. Full Electron gates and native
file-picker/real-service behavior remain for Claude/out-of-sandbox acceptance.
No push or CI was performed.
