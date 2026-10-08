# Storage startup-query diagnostic evidence

This is test-harness evidence, not application, license or distribution
acceptance. The baseline is `ec1385c0`; local versions are Node v26.0.0,
Playwright 1.60.0 and Electron 43.1.0. Raw-artifact and sanitized-copy SHA-256
values, final test-file hashes and outcomes are recorded in `summary.json`.
Local workspace and temporary sandbox paths are replaced by placeholders in
the public copies. Original raw artifacts remain separately retained.

## Observed failure and decision

The unmodified first storage test passed 18 times, then failed on run 19 at its
actual second main-process query for dbPath. A minimized launch / launcher DOM /
same read-only query loop failed on run 9. Main remained alive, the renderer was
`complete`, the recorder had no main errors, and a read-only recovery query in
the same PID succeeded. No original sandbox, recorder or guard assertion was
removed.

Five falsifiable hypotheses were considered before the targeted protocol probe:

| Hypothesis | Prediction | Observation |
| --- | --- | --- |
| Startup main context changes | New default-context event near failure, same PID | No lifecycle event in the observed post-launch window |
| Main exits or crashes | Exit/signal or recorder exception before failure | Main alive; recorder empty; recovery succeeds |
| Renderer navigation causes it | Launcher main-frame navigation near failure | No such event; renderer remains responsive |
| Concurrent or stale processes interfere | Fresh, serial sandboxes eliminate it | Both natural and minimized serial loops reproduce |
| Another protocol error is rewritten | Raw protocol error differs from context-destroyed text | Confirmed: `Promise was collected` |

The targeted observation captured
`Protocol error (Runtime.callFunctionOn): Promise was collected`. Playwright's
`rewriteError` replaced it with `Execution context was destroyed, most likely
because of a navigation.` The failed query and successful recovery used the
same utility object ID. This identifies the inspector transport failure and
misleading error mapping; it does not explain why inspector/V8 collected that
promise. Private protocol APIs were used only for diagnosis and fault injection.

The minimum fix keeps guard status and actual main userData in the existing
bounded, read-only startup query. Storage joins the returned userData with
`natively.db` locally and retains its original sandbox-prefix assertion. The
guard's preconfigured identity path agrees with the existing bootstrap identity
contract; this early snapshot is not a replacement for bootstrap identity tests.
Failure closes only the app owned by this launch.

The existing limit remains ten attempts, with 500 ms between context-error
attempts and a live-process check. No arbitrary evaluate helper is added and
state-changing IPC is not retried. Playwright erases the original details of
other non-JavaScript, non-session-closed protocol errors too, so public evaluate
cannot distinguish all such underlying errors from the observed collected
promise. The fix reuses that existing boundary for pure startup reads only;
it does not claim a precise classifier for every underlying protocol error.

## Validation

- Natural pre-fix first-test loop: 18 green / 1 target red.
- Same real call site with one injected collected promise: pre-fix red, post-fix
  green. Each of the three post-fix launches made two reads with one injection.
- Exhaustion: ten query attempts, then rejection and owned-process cleanup.
- Other visible JavaScript error: one query, then rejection and cleanup.
- Main terminated before query completion: one query, then rejection. Electron
  handled SIGTERM as exit code 0, not a retained SIGTERM signal field.
- Natural post-fix first-test loop: 20/20 exit 0. This finite sample does not prove
  zero residual flakiness on every platform or version.
- The complete five-test storage suite and full gates remain separate acceptance
  checks; they are not claimed from the first-test loop.

The first temporary boundary driver incorrectly required SIGTERM in the signal
field and therefore exited 1 although the owned main had exited and no retry
occurred. Its captured failure excerpt is retained; the corrected driver checks
actual exit. The old injected-red run also retained an early-cleanup recorder
failure (`Object has been destroyed`); no recorder assertion was suppressed.
That additional injected-run cleanup symptom was absent from the natural red.

## Reproduction commands

Run from the repository root after the existing Electron and Vite build
prerequisites. These commands do not build native modules or use real accounts.

```sh
node scripts/margin/isolation/run-node.mjs --allow-exec Electron --test --test-name-pattern '^a meeting is saved with a mock summary, survives a restart, and stays deleted$' --test-timeout=240000 tests/margin/meeting-storage.test.mjs

node scripts/margin/isolation/run-node.mjs --allow-exec Electron --import './docs/margin/evidence/AG-26/storage-query/inject-main-read.mjs?mode=once' --test --test-name-pattern '^a meeting is saved with a mock summary, survives a restart, and stays deleted$' --test-timeout=240000 tests/margin/meeting-storage.test.mjs
```

The second command was red before the two-file fix and green afterward. To
recreate the old red, use a separately prepared baseline checkout; do not reset
an active worktree. `mode=exhaust`, `mode=other` and `mode=dead` deliberately
reject the startup run (expected test exit 1); they are diagnostic controls, not
passing gate invocations. The injector saves counts and exit records in a fresh
temporary directory and uses private Playwright 1.60.0 APIs. It is explicitly
debug evidence and is not imported by normal tests, runtime or gates.

## Test-source provenance

Only `tests/margin/launch-app.mjs` and `tests/margin/meeting-storage.test.mjs`
change. The former extends its existing pure guard query with a userData snapshot
and owned-app cleanup on rejection; the latter uses that value without changing
meeting IPC, storage assertions, schema checks, guard or error-recorder checks.
The additions were written for this branch using the existing test contract and
Node standard-library APIs. No external application implementation is copied.
The separate injector is a diagnostic control written against the installed
Playwright protocol seam, not a production dependency or broad retry mechanism.
