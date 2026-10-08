# AG-26 two further original notice bindings

Status: data-only checkpoint after `45b11c5b`; AG-26 is not accepted.
The preceding checkpoint closed two SPDX-package notices. This one closes only
highlightjs-vue 1.0.0 and r-efi 5.3.0, reducing unresolved candidates from 17 to 15.
No dependency, collector/checker, runtime, diagnostic or workflow logic changed.

## Evidence and selection

- highlightjs-vue 1.0.0's installed and exact registry metadata declare CC0-1.0.
  Its original full README is from npm gitHead
  `2a0d197ec24ba70e019e12a13bd42f006124506a`; SHA-256 and Git blob are pinned in
  the source configuration. Its 1072 bytes, including CRLF, match the installed
  original. Official CC0 terms share storage with identical existing bytes;
  this does not borrow another package's grant. No copyright is invented.
- r-efi 5.3.0's original AUTHORS contains the complete MIT grant and disclaimer,
  all three copyright statements, author list and Apache/LGPL alternative
  notices. Its 3693 bytes match both the immutable crate commit
  `97b55bed1c2c91dcbf787674849f05337ff80b33` and cached crate. MIT is selected;
  the source/manifest retain the full original OR expression. No template replaces
  its original grant, and no linked-binary claim is made.
- The main thread independently fetched and hash-checked all three new source
  attachments, checked original bytes, compared all unaffected components and
  unresolved entries against HEAD, and verified every text reference with no
  orphans. See `checks/main-integrity.log`. The worker's separate hash report is
  retained too. Both find 1068 candidates, 506 unique texts, 39 unchanged
  exclusions, 15 unresolved and two deferred Electron notices.
- The four highlightjs-vue JS files observed in the complete S17 inventory match
  current installed bytes. This is not a new packaged-license-copy acceptance.

## Gate results

All 16 steps in `gates/summary.json` have actual exit code zero. The 114 unit-test
files report 882 tests: 876 pass, zero failures and six unchanged skips. AG-09 is
6/6, storage 5/5, startup 1/1 and outbound renderer 1/1. Five skips are inherited;
the sixth is the real otool case requiring explicit executable permission,
already passed in AG-25's separately authorized 9/9 target run. There are no new
isolation violations. The guard self-test's expected blocks are deliberate.

The existing nine license tests passed 9/9 twice (both logs retained); the second
run was redundant, not additional coverage. Both fetch and offline collection
still exit 1 with the same 15 unresolved candidates; neither failure is relabeled
as acceptance. G2 passed without new allowlist entries; both type checks and
whitespace checks passed. G7's lockfiles are unchanged; this is not a new npm-ci
or native-build claim. No local packaging, native rebuild, installation, formal
identity launch, release or new CI package diagnostic was performed.

Unsanitized gate logs are retained locally. The committed copies replace only
the checkout root and host temporary-root prefix with `<repo>`/`<tmp>`;
`checks/gate-log-hashes.json` records both hashes. License original bytes remain
unchanged. Tests used X2, synthetic HOME and mocked credentials/providers/devices.

## Blockers and next authority boundary

Twelve npm candidates remain positively observed in the diagnostic app; the
other three missing texts are oboe, oboe-sys and realfft. Oboe wrapper metadata
does not discharge vendored C++ notice obligations. realfft still has only the
MIT declaration without a verified original full notice. Neither target labels
nor another project's copyright/grant close these gaps. Native static vendor
composition, libvips/Skia notices and corresponding-source/relinking duties
remain open even if every current missing-text entry were closed.

`checks/dependency-followup.md` records read-only dependency routes and limited
source-map/specifier observations for a possible follow-up. S17 does not permit
deleting or reclassifying tap/sqlite3/screenshot-desktop, changing dependency
versions, excluding still-present packages, or changing retained functionality.
Such a route requires a separate user decision plus reachability, clean-install,
regression and actual-package checks. No upstream maintainer was contacted.

The prior CI's 19-gap result remains historical and unchanged. Full AG-25 dual-
identity packaging/signature/download/startup checks and Claude's independent
stage-exit review are still pending.
