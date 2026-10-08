# S17 diagnostic evidence collection succeeded; package not accepted

Run `37829181248`, source `f8c2dec04942044d61ea8849e585975f682657e2`,
workflow_dispatch, package_inventory=true, gate_ref=docs/margin/evidence/AG-25,
no_cache=false. The checkout was clean; npm ci/native setup succeeded. Normal
CI caches were used, so this is not a no-cache-from-scratch build assertion.

All 16 code-gate steps have real exit code zero: 882 tests, 876 passed, zero
failed and six skipped. Five skips are inherited; the sixth is the real otool
unit case requiring explicit executable permission, separately passed locally
in the nine-case X2 target run. The corrected tool is also exercised here on
every actual Mach-O file. AG-09 6/6, storage 5/5, startup 1/1, renderer 1/1 and
the release-identity contract 6/6 passed.

## Receipt and actual content

`diagnostic-run.json` reports `diagnosticSucceeded: true`, while both it and the
inventory retain `acceptance: false` and `blocked/not-accepted`. The builder's
exit code is intentionally 1: its unique expected-stop receipt is present in
the build log and matches the completed inventory, proving it stopped at the
diagnostic hook before signing/publishing. This is not a signed package.

The inventory contains 49,322 filesystem/asar entries and 1,080 package-metadata
records (including nested scope metadata, not distinct-package counts). All 25
Mach-O files have successful lipo/otool results and report arm64. The three
parenthesized Helpers now have successful dynamic-link results. No package
files were copied/renamed to work around the tool syntax.

The normal license verifier still rejects 19 unresolved candidates. All 15 npm
candidates have positive included-file/matching-metadata observations; the four
Cargo candidates remain unknown, not absent. Across all 1,068 candidates:
846 included-files, one bundle-source-map-only (dotenv), 221 unknown. The 2,388
source maps without observed mapped outputs remain explicit evidence gaps.
Native dynamic links do not establish static vendored composition. Raw content,
license/source obligations, signatures and runtime acceptance are separate.

## Verified artifacts

The artifact API lists exactly two workflow artifacts. Both contain only the
inspected JSON/log/TAP/text reports. Native-module artifact upload was skipped;
no app, native-module artifact or Release was published or downloaded locally.
Every ZIP entry was verified as regular and relative, without traversal or
links, before extraction; both ZIP SHA-256 digests match the API.

- Gate artifact 11571789939: 57,504 bytes, 26 files. ZIP SHA-256
  `e0faf221e9153c16a00974231d6b1d0fced86b360f55ee98a29949455028c647`.
  The unmodified files are archived here.
- Inventory artifact 11573315669: 3,790,662 bytes, five JSON/log files. ZIP SHA-256
  `22adfb170979fcfea6832df8e9c26ae2785b6bb0ea874fa0c1ef90c2868bc1e3`.
  The four small raw files are under `inventory/`. The 50,487,277-byte original
  inventory JSON remains in the verified local download and the 30-day workflow
  artifact, outside Git. `inventory/excerpt.json` is a labeled derivative with
  its source hash, positive unresolved-component evidence and all native results.

S17's non-distributing diagnostic is complete. AG-26 license closure, full AG-25
dual-identity packaging/signature/download/startup checks and independent Claude
stage-2 review are not complete. This run does not waive any of those gates.
