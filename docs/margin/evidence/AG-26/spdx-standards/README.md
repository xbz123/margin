# AG-26 SPDX notice-binding checkpoint

Status: two exact-version notice gaps closed; AG-26 and stage 2 remain blocked.
This follow-up is based on `2408135f`, after S17 diagnostic CI `37829181248`.
It changes only notice sources, original texts, attribution and documentation.
No dependency, collector, runtime, package hook or workflow logic changed.

## Source and byte checks

- `spdx-exceptions@2.5.0` declares CC-BY-3.0. The official full terms and the
  immutable original README preserve the Linux Foundation/Contributors
  attribution and Kyle Mitchell's mechanical-extraction statement.
- `spdx-license-ids@3.0.23` declares CC0-1.0. Its immutable original README and
  official full terms are retained; no copyright is invented from author metadata.
- The main thread independently fetched all four configured URLs and checked
  SHA-256; both immutable README Git blob hashes also matched. The README bytes
  matched their installed exact versions. Standard bindings use package versions,
  not the Creative Commons standard versions; README-only attachments cannot
  close a full-text gap.
- All 504 stored texts and 504 unique references match their hashes, with no
  orphan files. All other component objects, exclusions and the remaining 17
  unresolved objects match the preceding manifest. Four attachments add only
  three unique files because the official CC0 bytes already existed.
- The full S17 inventory hash was independently verified. Both packages'
  `index.json` and `deprecated.json` match installed bytes (four exact matches).
  This does not assert package.json byte identity: an initial overly broad check
  also compared package.json and failed. For spdx-exceptions its installed hash
  was `0af9bd4b68c9e3d1bc7a9208881cbde84da140d564a3bb42cf53184c6e83f2e3`,
  versus CI `24241b83f206787e3bdfacb2e19712cc256f09b336186201b4145bde4c52482b`.
  No package metadata was changed to make that check pass. The accepted assertion
  is limited to identifier data; CI metadata separately confirms names/versions.

## Verification

The complete local gate run in `summary.json` has 16 actual exit codes of zero:
114 files, 882 tests, 876 pass, no failures, six skips. Five skips predate the
package diagnostic; the sixth is the real otool case under the default no-exec
guard (its separately authorized 9/9 run remains in AG-25 evidence). AG-09 is
6/6, storage 5/5, startup 1/1 and outbound renderer 1/1. Tests used synthetic
HOME and mocks under X2; no native rebuild or installed-app operation took place.
G2 passed without new allowlist entries. Dependencies/lockfiles are unchanged;
the prior S17 CI npm-ci evidence is not relabeled as a new clean installation.

`checks/collector-fetch.log` and `checks/collector-offline.log` both came from
exit 1: 1068 candidates, 504 texts, 39 exclusions, 17 unresolved and two deferred
Electron notices. Normal license refusal remains. The separate target tests
passed 9/9. Main-thread assertions independently confirmed the worker's integrity
report rather than relying solely on its summary.

Gate logs replace only the local checkout prefix with `<repo>` and the host
temporary-root prefix with `<tmp>`. Unsanitized originals are retained locally;
`checks/gate-log-hashes.json` records raw/stored hashes. Synthetic test paths are
not private paths and are retained. Original license text bytes are not sanitized.

No new CI packaging run was needed for this data-only checkpoint. The previous
CI's 19-gap observation is historical and is not rewritten to claim 17 there.
Actual package-copy verification with these new bindings remains pending.

## Remaining boundary

Thirteen npm gaps were positively observed in the diagnostic app. The four Cargo
gaps are not treated as absent. A read-only offline Cargo tree for
`aarch64-apple-darwin` includes `rubato -> realfft -> rustfft` and does not show
oboe/oboe-sys/r-efi; this is target-graph evidence only, not a verified match to
the CI binary's full build inputs or static-vendor composition. No exclusion was
added on that basis. libvips/Skia notices, source/relinking duties, full AG-25
dual-identity packaging and Claude's stage-exit review remain open.
