# AG-23 CI evidence

Run https://github.com/xbz123/Assessment-Assistant/actions/runs/37789252078
passed on source `ca7ff6862ab6b62003a149758b04ab1178473281` (2026-10-08).
It used the normal cache strategy, not the uncached S11 phase-1 mode.

Downloaded evidence was independently checked: clean checkout (zero uncommitted
paths), all 15 gate commands exit zero, 108 completed test files, 812 tests /
807 pass / 0 fail / 5 existing skips. Raw TAP totals match the summary. AG-09
6/6, storage 5/5, startup with real main/renderer privacy canaries 1/1, and the
CI-only release identity contract 6/6 passed. `npm ci` succeeded. `job.log`
records compilation of the changed `natively-audio` crate and a successful release
build; this is not evidence of real-device behavior or a Windows compilation.

Gate artifact `11556540126` has SHA-256
`2528351e2f8a8137b1d06dd3efbd95ca7966c6a2e3c6cf2d14bfc403e58c2337`, matching
GitHub metadata in `artifacts.json`. All 25 members were inspected before
extraction: relative regular files, no traversal or links. `run.json`, `job.log`,
`archive-members.txt` and `gates/` preserve metadata and raw results.

The ZIP and native binary were not committed. The new native artifact was not
downloaded or substituted locally; AG-25 owns that verification. No application
package, PR or Release was produced. Real providers/devices/keychain and Claude's
read-only review remain unverified.
