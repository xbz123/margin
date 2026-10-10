# CI 38000301350: first run in the public repository

Commit `02f6dd81` (S25: CI moves to the public `xbz123/margin`, which holds only
this branch; the release zip is no longer uploaded), dispatched 2026-10-09 on
`macos-15` with `no_cache=true` and `package_apps=true`. `job-proof.json` has the
run, every step's conclusion and every artifact's size.

| job | result | time |
| --- | --- | --- |
| libvips | success | 23.2 min |
| gates | failure | 14.1 min |
| libvips-replace | success | 0.9 min |

The gates step failed; the release identity contract and the gates upload were
skipped. Packaging ran, but its result is not used: the fixed commit was run again
as `../CI-38004311007/`. `gates-failed/` has the gate summary and the two failing
logs.

## Gate failures and fixes (`9ef2ed4a`)

1. **provenance** (`provenance.log`): the four approved icon sources were read
   with `git show cbb92b8a:<path>`. That commit is in the private repository but
   not in the public one, so the read failed. The exact files (by git blob id) are
   now checked in under `docs/margin/approved-sources/cbb92b8a/`;
   `provenance-check.mjs` verifies each copy's blob id against
   `provenance-config.json`, and against `cbb92b8a` too when that commit is
   present. The approved pool is unchanged (128,377 line keys).
2. **regression** (`regression.log`): "after a chat request fails before
   streaming, the next answer is shown once and kept" timed out on
   `locator.click`. Once the search pill is not idle its full-screen backdrop
   (`z-90`) lies over the input container (`z-40`), so a second click on the
   already focused input is intercepted. The test now calls `focus()`. This cause
   is read from the code and the timeout; it was not reproduced locally, where the
   test passed.

libvips-replace passed in this run on the unchanged libvips and app code.

## Artifacts

Public workflow artifacts in `xbz123/margin`; the app zip and release reports
expire on 2026-10-23, the others on 2026-11-08.
