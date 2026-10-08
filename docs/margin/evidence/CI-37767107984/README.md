# AG-22 CI evidence

Run https://github.com/xbz123/Assessment-Assistant/actions/runs/37767107984
passed on source `2db88817d77d7d2c28d9693952e4b466e8b60762` (2026-10-08).
It used the normal cache strategy, not the uncached S11 phase-1 mode.

The downloaded raw evidence was checked independently: clean checkout (zero
uncommitted paths), all 15 gate commands exit zero, 107 completed test files,
799 tests / 794 pass / 0 fail / 5 existing skips. Raw TAP totals match the
summary. AG-09 6/6, storage 5/5, startup 1/1 and the CI-only release identity
contract 6/6 passed. `npm ci` and native setup succeeded.

`run.json`, `job.log` and `gates/` retain GitHub metadata and raw output.
Gate artifact `11546535174` has SHA-256
`fd25af0feeae7559262ec41b6c06c46e0e56751d4850a7360ebca555905e4bab`, matching
`artifacts.json`. All 25 archive members were inspected before extraction: plain
relative regular-file entries, no path traversal or links (`archive-members.txt`).
The ZIP and native binary were not committed; the native artifact was not used
to replace the local module. No package, PR or Release was produced. Real
keychain/provider/device acceptance and Claude's read-only review remain pending.
