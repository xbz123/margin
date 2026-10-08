# Review 8 checks

`mutations.mjs` runs from the checkout root after `node scripts/build-electron.js`.
Only generated build outputs are changed, then restored byte-for-byte in `finally`.
Every recorded mutation exits 1 with a TAP assertion failure, not a timeout.

| Mutation | Fault | Expected failing behavior check |
| --- | --- | --- |
| m20 | Restore SDK maxRetries=2 at all eight sites | Real SDK transport sends three requests after revocation instead of one |
| m21 | Drop the vision chain refusal guard | Retry/fallback replaces the original refusal |
| m22 | Drop LLMHelper refusal propagation | A later Gemini model becomes an answer after refusal |
| m23 | Drop WhatToAnswer wrapper propagation | A fabricated answer replaces the refusal |
| m24 | Drop propagation in the bundled IntelligenceEngine | WhatToSay returns a fabricated answer after its error event |

Bundling duplicates imported helpers: m22/m24 each change several generated call
sites, not independent source mutations. The asserted test names and replacement
counts are in each log. These checks establish sensitivity to these faults only.

The initial pre-fix SDK test run failed all eight transport cases (3 requests vs 1).
That initial interactive output was not archived. The repeatable m20 experiment
is the retained red-capability evidence. Earlier development logs are retained
as attempts, not acceptance: first had bundled-class identity and syntax-shape
failures; second had a wrongly named test stub; fourth targeted a rate limiter
that the collector does not use (corrected to its actual cache wait). Precommit
attempts also retain source-scanner generic-line findings before allowlisting.

`precommit-pass/` records the complete 104-file unit-test run after the old
source-string test was updated to the sanitized payload contract: 767 tests,
762 pass, 0 fail, 5 existing skips. Earlier attempt2 has that stale assertion
failure. The two precommit attempts are not clean-tree acceptance receipts.
`ui-sandbox-failed/` records Electron being unable to launch inside the execution
sandbox (SIGABRT/EPERM); the authorized rerun still uses the project's X2 guard.
