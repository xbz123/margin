# Original-notice checkpoint: no-cache CI verification

Run `37846880697`, source `17bfc6568d578d88511923039ec580b21a10a951`, succeeded
in 6m1s. It includes the separate storage-query harness fix `f759094c`.
Inputs were no_cache=true, package_inventory=true and
gate_ref=docs/margin/evidence/AG-26. This is a verified diagnostic checkpoint,
not AG-26, full AG-25 or stage-2 acceptance.

## Clean installation and regression

Both dependency-cache restore steps were skipped. npm ci and native setup
passed. The original workflow log contains `Compiling cidre v0.11.10` and
`cidre compiled in this run: 1`. The built project's native hash matches its
observed packaged binary:
`71f9cf8e25767a338e3c8a7bd73273db9b6428afcfd3ae21cb871e4759fb2603`.

`gates/summary.json` identifies the exact source, zero uncommitted paths and
16 actual zero exit codes. Results: 884 unit tests, 878 pass, zero fail and
six unchanged skips; AG-09 6/6, storage 5/5, startup 1/1 and renderer 1/1.
The separate CI-only release-identity contract passes 6/6. These are not two
packaged identities or a formal-identity local startup. The existing skip and
real-device/provider boundaries remain unchanged.

## Package and notice bytes

The temp diagnostic app has 40,510 entries and 609 package metadata records.
Compared with S18 CI 37838491368, exactly 28 paths were added, all original
license text files under Resources/licenses/texts; no path was removed. The
checked-in manifest hash matches the artifact manifest hash. All 410 distinct
stored texts and both deferred Electron/Chromium notices match the actual
package entries; LICENSE and NOTICE match their checked-in bytes as well.

All 23 Mach-O files are arm64 and all architecture/dynamic-link tools returned
zero. The S18 removed dependencies and five removed gaps remain unobserved in
paths, package metadata and mapped sources. The two remaining npm candidates
(eastasianwidth 0.2.0 and react-remove-scroll-bar 2.3.8) are still included;
realfft 3.5.0 is unknown to the file inventory, not excluded. Source independently
shows its use through rubato's retained FFT resampler. The 1,412 unobserved
mapped-output records remain explicit coverage limits. Static native vendor
composition and corresponding-source/relinking duties are not inferred from
Mach-O architecture or dynamic-link output.

The normal verifier checks original bytes and then refuses exactly three
unresolved notices. `acceptance` is false. The diagnostic receipt is complete
and its unique stop marker occurs in the builder log; builder exit 1 is the
intended pre-signing stop, not a successful distributable build. Existing npm
collector warnings about extraneous WASM helpers and malformed react-query
aliases remain in the raw builder log; they are not silently repaired here.

## Download integrity and limits

The API exposed exactly two text-only workflow artifacts. Both downloaded ZIP
digests match the API. Their 26 and five entries were checked as regular,
relative files without traversal or symlinks before extraction.

| Artifact | ID | Bytes | ZIP SHA-256 |
| --- | --- | --- | --- |
| gates | 11580033807 | 57412 | e904690b942044038f2c591cf052063c0564e712cf9b75a944751e16cd3bafe7 |
| inventory | 11580905015 | 3154019 | 71081ff7dbe1a7eb6a84a451ca853e0a516633d00e47de8bd44065d1b424f964 |

The 26 gate reports and four small diagnostic reports are retained unchanged.
`inventory/excerpt.json` is explicitly derived, with independent verification
results and SHA-256 of the 44,623,922-byte full inventory and original workflow
log. Those originals and ZIPs remain in the private local download, outside Git.
The workflow excerpt preserves actual from-scratch build lines. Artifact
retention is 30 days; excerpts are not substitutes for the complete inventory.

No app/native artifact was uploaded or downloaded, no Release was created, and
no signature, dual-package verification, native replacement or local packaged
smoke test is claimed. No installed Margin or real keychain/data was accessed.
The remaining license authority/dependency decisions are documented in
`../AG-26/original-notices/checks/remaining-decisions.md`. The independent
read-only review and complete stage-2 exit remain pending.
