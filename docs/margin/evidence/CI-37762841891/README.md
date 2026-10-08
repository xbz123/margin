# AG-21 CI evidence

Run https://github.com/xbz123/Assessment-Assistant/actions/runs/37762841891
passed on source `0f28931414bc2e5f570c0862d76200f753347567` (2026-10-08).
It used the normal cache strategy, not the uncached S11 phase-1 mode.

The downloaded raw evidence was checked independently: clean checkout (zero
uncommitted paths), all 15 gate commands exit zero, 106 completed test files,
777 tests / 772 pass / 0 fail / 5 existing skips. Icon tests 4/4, AG-09 6/6,
storage 5/5, startup 1/1 and the CI-only release identity contract 6/6 passed.
`npm ci` and native setup succeeded. No package, PR or Release was produced.

`run.json`, `job.log` and `gates/` retain GitHub metadata and raw output.
Gate artifact `11542873752` has SHA-256
`f2109503a4f8d4cefa0ba3b33893928f2099a6251c8f0f71b5ab5e238ddb3abf`, matching
`artifacts.json`. All 25 archive members were inspected before extraction: plain
relative regular-file entries, no path traversal or links (`archive-members.txt`).
The ZIP and native binary were not committed; the native artifact was not used
to replace the local module. Actual packaged-icon/signature checks remain AG-25,
and Claude's read-only review remains pending.
