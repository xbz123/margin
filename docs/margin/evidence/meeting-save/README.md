# Calendar residue removal and failed meeting save retention

2026-10-17. Base `90b2ec62`. Stage 1 (`7cccf381`), Stage 2 (`506bf492`) and an
acceptance fix that moves the banner; the decisions are recorded in PLAN §8. All runs used the isolation guard, a synthetic HOME, a fresh
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

## Stage 2: failed meeting save retention

Behaviour and boundaries are in PLAN §8 ("会议保存失败处理") and the product spec.

**Red first.** Before the fix, the new `MeetingPersistence.test.mjs` failed 8 of 9
cases. Two show the defects themselves rather than missing APIs:

- A committed save whose window notification throws returned `null`, so the
  saved meeting was reported as a failure.
- A failed write returned `null`, and the reset session kept nothing.

**Tests added or changed**

| File | Covers |
| --- | --- |
| `electron/services/__tests__/MeetingPersistence.test.mjs` | saved / skipped (too short, retention `never`, do-not-persist, unreadable settings) / failed (write error, unavailable, open failure); full transcript and usage kept, session reset, metadata-only query; retry success and failure with same id and data; discard; stale, duplicate and interleaved commands; saved despite notification failure (no retry entry, one row); no overwrite of a pending meeting |
| `electron/services/__tests__/DatabaseUnavailable.test.mjs` (new) | the actual `DatabaseManager.saveMeeting` with no open database throws `DatabaseUnavailableError`; demo seeding still skips; persistence classifies it as `database-unavailable` |
| `electron/audio/__tests__/MeetingStartAudioGate.test.mjs` | the real `startMeeting` refuses with `pending-unsaved-meeting` before STT, permission, audio-test, window or audio steps, then starts once resolved; the quit log carries metadata only |
| `tests/margin/outbound-renderer.test.mjs` | mounted Launcher banner: listener registered before the query, older reply ignored after an event, Start refusal highlight, both commands disabled while one runs, failed retry keeps the banner, Escape/Cancel/confirm discard, no close control, listener removed on unmount |
| `tests/margin/meeting-storage.test.mjs` | real isolated Electron: a test-held SQLite write lock makes the app's own save fail → banner; Start refused with no overlay and no permission/device calls (the same count rises on an accepted start); reload restores the banner; retry under lock fails and keeps it; lock released → retry stores the same id, a new meeting starts and saves; a second failure: cancel keeps it, confirmed discard leaves no row; no mock request |

The race guard's test was checked by mutation: with the event counter disabled,
the mounted banner test fails.

Existing test changes are limited to return-type expectations: the
`RetentionAndHybridRag` source check now expects a reported skip instead of
`null`, and the old failed-save case now expects retention. Two fixture
additions were needed: `getUnsavedMeeting` and an optional `console` in
`mainMeetingFixture`.

**Final local gates** on the working tree over `7cccf381`, compared with the
Stage 1 run: **16/16 passed**.

| Gate | Result |
| --- | --- |
| build-electron, vite-build, tsc-renderer, tsc-electron | pass |
| provenance | pass, 0 hits against the refreshed 664426-key pool (registrations in PROVENANCE) |
| retired, preload-contract, ipc-channels, guard-selftest | pass |
| unit tests | 134 files, 1197/1197 passed, 0 failed, 0 skipped |
| answer regression | 21/21 |
| storage | 3/3 |
| startup | 2/2 |
| outbound-renderer | 14/14 |
| diff-check | pass |

The first Stage 2 full run failed only on provenance (21 new-code hits). A
recheck then showed 17 more on unchanged older lines after the shared upstream
refs were refreshed. Both sets are explained in PROVENANCE.

**Limits.** macOS only. Windows was reviewed statically under S33 (no
platform-specific code was added) but not compiled or tested. The Electron E2E
injects a write error; database-unavailable is covered by unit and mounted UI
tests, because each esbuild entry bundles its own `DatabaseManager`. These are
local results.

## Acceptance fix: banner shared by list and details

Review found the banner inside the list view, so opening a saved meeting
unmounted it and removed retry and discard. It now sits in the launcher area
shared by the list and a meeting's details, outside that conditional. There is
no new state, and the wrapper collapses when nothing is pending. In the storage
failure scenario, while a meeting is pending, the test opens the saved `TITLE`
meeting and checks that the banner is visible with Retry/Discard enabled and the
same pending id. It then goes Back and checks again. Against the previous
placement this step fails (banner not found on the details page); with the fix,
storage passes 3/3. Final local gates on the final content are listed in the
fix commit message.

## Publication state

Stage 1 was pushed to the private repository. Its code was also published as a
code-only projection, without private history or evidence, to the public
branch. Public CI failed only on provenance against the refreshed upstream pool,
which the Stage 2 registrations address. Stage 2 and this fix are local, pending
code-only projection and public CI.
