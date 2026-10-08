# S18 no-cache CI and non-distributing package verification

Source `44377a0129844d48349c26316a6c2b4971ab3380`, run `37838491368`.
Inputs: no_cache=true, package_inventory=true,
gate_ref=docs/margin/evidence/AG-26. The run succeeded in 6m24s.
This verifies the S18 dependency-reduction scope; it does not accept AG-26,
complete AG-25 packaging, or the stage-2 exit.

## Clean installation and gates

Both Electron and Cargo cache restore steps were skipped. npm ci and native
setup succeeded. The original workflow log records `Compiling cidre v0.11.10`
and `cidre compiled in this run: 1`; the workflow's from-scratch assertion passed.
The native SHA-256 printed in BUILD-INFO matches the binary observed in the app:
`71f9cf8e25767a338e3c8a7bd73273db9b6428afcfd3ae21cb871e4759fb2603`.
No binary was downloaded to the local machine for this check.

`gates/summary.json` confirms the exact source SHA, zero uncommitted paths and
16 actual zero exit codes. There are 884 tests: 878 pass, zero fail and six
unchanged skips. AG-09 6/6, storage 5/5, startup 1/1, renderer 1/1 and the
CI-only release-identity contract 6/6 pass. Five skips are inherited; the sixth
is the separately validated real otool unit case under the default no-exec
guard. All 23 real Mach-O files in this run were inspected successfully.

## Actual package observations

The formed temp app contains 40482 filesystem/asar entries and 609 package
metadata records, not 609 distinct packages. All 23 Mach-O files are arm64;
lipo and otool return zero for each. Compared with CI 37829181248, the only
removed native paths are sqlite3's node_sqlite3.node and tap's transitive
@typescript/native-preview tsgo executable; no new native path appears.

The full inventory was independently checked for path entries, package metadata
and observed source-map references to tap, sqlite3, screenshot-desktop,
ansi-tokenize, npmcli/agent, err-code and once. Every count is zero. The last
query covers all once versions, including the removed 1.1.2 instance. Actual
metadata confirms retained better-sqlite3 12.11.1, keytar 7.9.0 and eastasianwidth
0.2.0. These observations supplement the source/lock reachability checks and
fresh installation; they are not a general proof about arbitrary external module
overrides, obfuscated content or native static constituents.

The manifest hash equals the checked-in generated inventory. Seven remaining
npm gaps are still positively included; oboe, oboe-sys and realfft remain unknown,
not absent. The 1412 maps whose mapped output was not observed remain explicit
gaps. Native dynamic-link checks do not resolve static vendor or source duties.

The diagnostic receipt is complete and its unique stop marker is in the builder
log. Builder exit 1 is the expected pre-signing diagnostic stop, not a successful
package build. `acceptance` is false and status is blocked/not-accepted. The
unchanged normal verifier refuses exactly ten unresolved notice candidates.

## Artifact integrity and retention

The API lists exactly two text workflow artifacts; project-native artifact upload
was skipped. No app/native workflow artifact or Release was published/downloaded.

| Artifact | ID | ZIP bytes | ZIP SHA-256 |
| --- | --- | --- | --- |
| gates | 11577400707 | 57527 | a187f9d980266a5a4cff17b32e5678e0c19653098a329b0559dbe36390be53e4 |
| inventory | 11577255966 | 3152489 | ac2be769c64ba7ccb5ceff8877fbd9957858f3c5b407c2e8d10042c0e62acdef |

Both downloaded ZIP digests match the API. All 26/5 ZIP entries were inspected
as regular, relative files without traversal or symlinks before extraction.
The unmodified 26 gate reports and four small inventory reports are retained
here. The 44616041-byte full inventory, ZIP files and full workflow log remain
in the local verified download, outside Git. `inventory/excerpt.json` is labeled
as a derivative and retains their source hashes plus the verification results.
The workflow-log excerpt likewise identifies its source hash. Workflow artifacts
have 30-day retention and can expire; the committed excerpts are not full copies.

The first CLI log read failed only because its local cache directory was outside
the sandbox; after approved cache access, the complete original log was read and
verified. This was not a CI failure. No local native rebuild, app installation,
formal Margin launch or real user-data/keychain operation took place.
