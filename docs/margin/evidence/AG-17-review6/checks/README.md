# Checks for the sixth Astra review (PLAN.md section 9)

Raw outputs of the one-off checks behind the sixth round of review fixes (`fa70efc8`).
All were run under the isolation guard. The mutation checks changed only build output
(`dist-electron/electron/LLMHelper.js`, which the unit tests load, `main.js`, which the
app runs, and the renderer bundle `dist/assets/index-HaMPuAvi.js`), never the source.
Each mutated file was copied first, restored from the copy afterwards, and compared
byte for byte with it (`run-mutation.sh.txt` is the script, `mutate.py.txt` the
replacement helper).

| File | What it shows |
| --- | --- |
| `scope.log` | `ScopeLocalFallback.test.mjs` with the new case (a declared `profile_history` scope on meeting summaries): 21/21 pass |
| `storage.log` | The storage harness with the two new cases (a failed edit save; startup recovery under both `profile_history` settings): 5/5 pass |
| `storage-attempt1.log` | The first run of the new recovery case: it failed because the recovered meeting's transcript held 11 entries instead of 4 |
| `storage-attempt2-alone.log` | The recovery case run on its own (with a diagnostic message): it passed, so the extra entries came from the earlier cases |
| `storage-attempt3.log` | The full harness with the diagnostic: the extra entries are the questions and answers of the meeting chat case and one launcher chat question. The gemini-chat-stream handler added every chat turn to the live session, so a chat about a saved meeting entered the next meeting's transcript. Fixed in `fa70efc8` (meeting chat turns are not added to the session); the case now checks it |
| `pre-commit-gates.summary.json` | The type checks, provenance, retired, preload and IPC checks and the full `tests` step run before the commit (737 tests, 732 pass, 0 fail, 5 skipped) |
| `m9-recovery-not-declared-history.storage.log` | Mutation: recovery no longer declares `profile_history` (in `main.js`): the recovery case fails ("no request for a recovered meeting with profile_history off") |
| `m10-summary-extra-scopes-ignored.*` | Mutation: `generateMeetingSummary` ignores the declared scopes (in `LLMHelper.js` and `main.js`): the unit case fails, and the recovery case fails as in m9 |
| `m11-failed-save-ignored.storage.log` | Mutation: the meeting details page treats every save as successful (in the renderer bundle): the failed-save case times out waiting for the notice |
| `m12-meeting-chat-recorded-in-session.storage.log` | Mutation: the meeting chat adds its turns to the live session again (in `main.js`): the recovery case fails ("meeting chat turns must not enter the next meeting") |
