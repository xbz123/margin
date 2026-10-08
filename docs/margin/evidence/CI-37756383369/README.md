# AG-20 clean-checkout CI

- Run: https://github.com/xbz123/Assessment-Assistant/actions/runs/37756383369
- Source: `831234342e5059029afed6a0fecec5393ebfeefa`.
- Result: success, 2026-10-08; job duration 3m42s. This push-triggered run used
  the normal Electron/cargo caches, not S11's uncached-build mode.
- `npm ci` and native setup succeeded. The clean-checkout temp gate summary
  reports zero uncommitted paths and 15 actual exit-zero steps. Independently
  summed raw TAP: 105 files, 773 tests, 768 pass, 0 fail, 5 existing skips;
  every file finished with exit zero. AG-09 6/6, storage 5/5, startup 1/1.
- After the temp gates, CI selected `MARGIN_APP_VARIANT=release`, built both
  Electron and renderer output, and passed 6/6 fake-Electron identity contract
  tests. It did not package or launch a formal-identity app.

`run.json` contains GitHub run/step metadata; `job.log` is the gh-rendered raw
job log. `gates/` contains the unmodified gate artifact, including release-build
and release-contract logs. Source hashes, step results, TAP totals and the
release contract were checked after download rather than inferred from the badge.

Gate artifact ID: `11540456665`. Download SHA-256:
`70adf20abefd45ef01bfcf44609c42faf893c12153ed39d574cddaec78df43eb`, matching
GitHub metadata in `artifacts.json`. Before extraction, all 25 members were
inspected: simple relative file names, no traversal, links or special files;
see `archive-members.txt`. The ZIP and native binary are not committed. The
native artifact was not downloaded or substituted into the local worktree.

This closes AG-20's CI/G7 and dual-identity contract checks, not Claude's
read-only review, AG-25 package/Info.plist checks, or real-device/keychain/service
acceptance. No installation, PR or Release was created.
