# Checks for the fifth Astra review (PLAN.md section 9)

Raw outputs of the one-off checks behind the fifth round of review fixes (`d26a9937`).
All were run under the isolation guard. The mutation checks changed only
`dist-electron/electron/main.js` (the bundle the app runs), never the source; it was
copied first, restored from the copy after each mutation, and compared byte for byte
(`mutate.py.txt` is the replacement helper).

| File | What it shows |
| --- | --- |
| `scope.log` | `ScopeLocalFallback.test.mjs` with the meeting context and heading fallback cases: 20/20 pass |
| `storage-meeting-chat.log` | The storage harness with the reworked meeting chat case: 3/3 pass |
| `pre-commit-tests.summary.json` | The full `tests` gate step run before the commit (736 tests, 731 pass, 0 fail, 5 skipped) |
| `m6-summary-always-built.storage.log` | Mutation: the main process always builds the summary into the meeting context. With `post_call_summary` off it is then declared and the request is refused ("Provider chat blocked by data scope policy: post_call_summary"); the case fails waiting for the request |
| `m7-meeting-not-declared-history.storage.log` | Mutation: the meeting context no longer declares `profile_history`: with that scope off the request is not refused, and the case fails waiting for the refusal |
| `m8-heading-fallback-removed.storage.log` | Mutation: the keyword fallback no longer recognizes the meeting headings: a window-built context with a summary goes out with `post_call_summary` off, and the case fails ("a summary in a window-built context must be left out") |
