# S19-B verified no-cache CI

Run `37856630750` succeeded in 6m40s on exact source
`eaf759dad50bbe25f4c2c4a78dcdf7261b37e465`. Inputs: no_cache=true,
package_inventory=true, gate_ref=docs/margin/evidence/AG-26.

Both caches and the native-binary upload were skipped. npm ci and native setup
passed; raw logs record Compiling cidre v0.11.10 and a compiled count of one.
The project-native hash matches the binary observed in the diagnostic package.
No native binary was uploaded or downloaded in this text-only mode.

The clean source has zero uncommitted paths and 16 actual zero-exit gates:
925 tests / 919 pass / 0 fail / 6 existing skips; AG-09 6/6, storage 5/5,
startup 1/1. CI-only release identity contracts pass 6/6. This does not verify
a signed release-identity package or complete stage-2 acceptance.

Independent post-download verification checks the actual temp app's 40,513
entries, 609 package metadata records and all 23 arm64 Mach-O files, including
successful architecture/dynamic-link inspections. All 413 stored notice texts
and both Electron/Chromium files match expected hashes. LICENSE, NOTICE and the
generated inventory match the source. The only paths added since S19-A are the
two original metadata texts; no path is removed.

Normal notice verification now passes 989 references under S19-B's approved
category, and explicitly returns `candidateInventoryOnly: true`. realfft remains
unknown to the package's static-constituent observation, not excluded. The 1,412
source-map coverage gaps remain explicit; none is silently treated as coverage.
Native vendor notices, corresponding sources and replacement/re-signing work
are still unaccepted.

The diagnostic still reports acceptance=false, diagnosticSucceeded=true and an
intentional builder exit 1. Its nonce stop marker matches the builder log. It
stopped before signing and cannot be treated as an accepted distributable app.

Only two workflow artifacts exist. Their ZIP hashes match the API. All 26 and
five relative regular members were inspected before separate extraction:

| Artifact | ID | Bytes | SHA-256 |
| --- | --- | --- | --- |
| gates | 11584811708 | 58700 | 84d637d5f09f428f35d5e12b91fed6e09f6300a9488d7587669c4081dc2f0c58 |
| inventory | 11584861277 | 3154149 | 68f8f82ca5280c9578b784997924a5a28851a4e597acd422f1a52f2bf9973c48 |

`stored-copy-hashes.json` records exact bytes or terminal-whitespace-only
normalization for each stored gate/small diagnostic report. The complete
44,624,761-byte inventory, original ZIPs and full workflow log remain privately
retained; their hashes are in the derived `inventory/excerpt.json`. Reading the
workflow log first hit the local gh cache permission boundary; the authorized
retry succeeded. That access failure was not a CI or gate failure.

This completes S19-B implementation and technical verification, pending Claude
read-only review. Per the subsequent user instruction, native-source follow-up
is handed off without code, dependency or inventory changes; see
`../AG-26/S19-C-handoff/`. Complete AG-26, AG-25 and stage 2 remain unfinished.
