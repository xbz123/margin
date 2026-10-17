# Calendar residue removal and failed meeting save retention

2026-10-17. Base `90b2ec62`. Two local commits; the decisions are recorded in
PLAN §8. All runs used the isolation guard, a synthetic HOME, a fresh
app-created database, mock credentials and a loopback mock. No real user data,
devices, credentials or model services were used. Raw runner logs are kept
outside the repository; this file records only their results.

## Stage 1: calendar database residue

Removed `meetings.calendar_event_id` / `meetings.source` from the v1 schema,
the v1→v2 column additions, the save statement and the list/detail mapping,
plus `Meeting.calendarEventId` / `source` and the fixed `source: 'manual'`.
Migration steps and version 17 are unchanged, as is the `is_processed` addition.
There is no drop-column migration and no handling of old databases.

`tests/margin/meeting-storage.test.mjs` now reads `PRAGMA table_info(meetings)`
from the database the real app creates in the sandbox. It asserts
`is_processed` is present and both retired columns are absent.

Full local gates on the working tree over `90b2ec62`, compared against
`evidence/S45/native-quit/final-gates`: **16/16 passed**.

| Gate | Result |
| --- | --- |
| build-electron, vite-build, tsc-renderer, tsc-electron | pass (no new diagnostics) |
| provenance, retired, preload-contract, ipc-channels, guard-selftest | pass |
| unit tests | 133 files, 1187/1187 passed, 0 failed, 0 skipped |
| answer regression | 21/21 |
| storage | 2/2 |
| startup | 2/2 |
| outbound-renderer | 13/13 |
| diff-check | pass |
