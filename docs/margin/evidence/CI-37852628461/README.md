# S19-A verified no-cache CI

Run `37852628461` succeeded in 6m18s on source
`d23c4015829303c7f6f68955a5255a57757692f8`. Inputs: no_cache=true,
package_inventory=true, gate_ref=docs/margin/evidence/AG-26.

Both caches were skipped. npm ci and native setup passed; raw logs record
Compiling cidre v0.11.10 and cidre compiled in this run: 1. The project-native
hash matches the binary observed in the diagnostic package. No native binary
was uploaded or downloaded in this text-only mode.

The exact clean source has zero uncommitted paths and 16 real zero-exit gates:
884 tests / 878 pass / 0 fail / 6 unchanged skips, AG-09 6/6, storage 5/5,
startup 1/1 and renderer 1/1. CI-only release identity contracts pass 6/6.
This is not a signed dual-identity package or stage-exit acceptance.

The actual temp app contains eastasianwidth 0.3.0, with JavaScript matching the
approved original SHA-256. Its 1043-byte original MIT notice is present and
unchanged under Resources/licenses/texts. All 411 distinct stored originals
and both Electron/Chromium notices match their expected hashes. The app has
40,511 entries, 609 package metadata records and 23 arm64 Mach-O files, with
successful architecture/link inspections. Compared with CI 37846880697,
the only added path is the new license text; no path is removed.

The first independent assertion incorrectly expected the original package.json
bytes and all four source members to survive packaging. Its failure is retained.
Inspection of the pinned builder's actual source explains the exact difference:
scripts are removed and JSON is reserialized (418 to 377 bytes); README.md and
*.d.ts are filtered. Reproducing that defined transformation matches the actual
packaged metadata hash. This is distinct from the pre-package four-file match
to the same-version upstream commit, and no arbitrary mismatch is waived.

The normal verifier still rejects two missing candidates; react-remove-scroll-bar
is included and realfft is unknown to this inventory, not excluded. All 1412
map-output coverage gaps remain explicit. The diagnostic nonce stop matches the
builder log and receipt; its exit 1 is the intended pre-signing stop. Acceptance
is false and native vendor/source/relinking obligations remain open.

Only two workflow artifacts exist. Both ZIP SHA-256 values match the API;
26 and five relative regular entries were inspected before extraction:

| Artifact | ID | Bytes | SHA-256 |
| --- | --- | --- | --- |
| gates | 11583361134 | 57534 | e56dad2c6d1f92b10c29a74986c9e69d7e1a84c0b08981f035aa2feed59d5de3 |
| inventory | 11583470392 | 3154092 | 53af73c25a8753d8ea30e462a589baf0a49087a3ba0e15a6d7ef109a3b18743d |

The 26 gate reports and four small diagnostic reports are copied unchanged.
The 44,624,205-byte complete inventory, ZIPs and full workflow log are retained
privately outside Git. Their hashes and independent results are in the explicitly
derived inventory/excerpt.json. Workflow retention remains 30 days.

This completes S19-A's required implementation/verification checkpoint, pending
independent read-only review. S19-B, S19-C, complete AG-26/AG-25 and stage-2
acceptance are not implied. No installed app, real keychain or user data was used.
