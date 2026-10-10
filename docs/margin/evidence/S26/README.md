# S26 local gates

Claude, 2026-10-10, on `a9b50edd` (CI 38052543358 records, the provenance
allowlist entry for upstream `ea316087`, and the S26 trimming) against AG-26,
under the X2 guard: 16/16 exit 0; 110 files, 843 tests, 838 pass, 0 fail, 5
skips; provenance 0 hits. Against the 853 tests of runs 38042681414 and
38052543358, the 10 removed are the 9 cases of `packageInventory.test.mjs` (one
of them the skipped otool case) and the sharp smoke verdict case of
`packagingTools.test.mjs`.

The local upstream refs were not refetched (they live in the original
repository's `.git`), so this run's provenance pool does not contain
`ea316087`; CI fetches it, and the allowlist entry covers that line.
