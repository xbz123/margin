# Checks for the second Astra review (PLAN.md section 9)

Raw outputs of the one-off checks behind the second round of review fixes. All were
run under the isolation guard. The mutation checks changed only the build output in
`dist-electron` (never the source), and each was followed by a fresh build.

| File | What it shows |
| --- | --- |
| `scope-codex.log` | `ScopeLocalFallback.test.mjs` with the Codex scope check: 6/6 pass |
| `codex-scope-check-removed.log` | Mutation: both `assertOutboundScopes('codex', …)` lines removed from the built `LLMHelper.js`: the two Codex cases fail |
| `preload-boolean-gate.log` | Mutation: the preload delivers any event while a stream is active, ignoring its id (as the first round's boolean gate did): the cancel case fails on the old stream's `done` (2 delivered) |
| `preload-no-gate.log` | Mutation: the preload delivers every event: the cancel case fails in the gap after the cancel |
| `guard-unwritable-log.log` | The guard with an unwritable isolation log ends the process with exit 70 before any user code runs |
| `guard-log-reader.log` | `readGuardLog()` rejects an empty log and a log without a load record from the expected pid |
| `gates-footer-probe.*` | `run-gates.mjs --only tests` with a temporary probe test (one blocked DNS lookup, then an open handle; deleted afterwards). The file was ended by a process-group kill (here at the 180 s limit; the after-footer grace uses the same kill), so `run-node.mjs` printed no summary, and the step still reported `dns margin-probe.invalid` from the isolation log |
| `launchapp-no-recorder.*` | `launchApp` with the recorder's log path blanked refuses to continue (`main-process error record missing`) and closes the app; the `.txt` file is the temporary test that ran it |
| `incident5-smoke-failed.log` | Incident 5: the guarded startup smoke run in which the main process exited with code 0 inside the observation window |
| `incident5-mutant-interrupted.log` | Incident 5: the mutation run (recorder removed) that was interrupted together with the command |
| `incident5-smoke-rerun.log` | Incident 5: the next guarded startup smoke run, which passed |
