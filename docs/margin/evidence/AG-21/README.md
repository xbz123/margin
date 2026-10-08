# AG-21 icon implementation

Local implementation and gates passed; CI and Claude's read-only review are
pending. This ticket does not claim packaged-app or real-device acceptance.

The four permitted icon sources from `cbb92b8ae1a310ae1af3323d45b2990757d781d9`
were read in full before import. Original blobs, adaptations, three exact-line
scanner allowances, generated outputs and the 23 removed old icon files are
recorded in PROVENANCE. Only the four exact paths were added as approved sources.
Removed files remain recoverable from Git; disguise and third-party assets were
not removed. No old generated binaries were imported.

`scripts/icons/generated-assets.json` records four source SHA-256 values and
15 regenerated assets. All 19 hashes were independently checked against files.
The application PNG was visually checked against the approved two-line design.
Automated checks cover raster dimensions/alpha, ICNS/ICO structure, inline SVG
pixel equivalence, resource references, tray/restore consumers, two repeat
generations, and native iconutil decoding of all macOS representations.

Local gates: 15 actual exit-zero steps, 106 test files, 777 tests, 772 pass,
0 fail and 5 existing skips. Icon checks 4/4; AG-09 6/6; storage 5/5; startup 1/1.
This is a precommit run over `1537ba36`; the summary records the dirty paths.

The original restricted-tool iconutil failure is preserved in
`checks/iconutil-restricted-red.log`. The identical guarded operation passed
with the outer tool permission elevated; X2 synthetic HOME, network and keychain
guards remained enabled. No custom ICNS encoder or dependency was added.
An early icon test needed esModuleInterop in its test-only TypeScript VM; that
intermediate output was not separately archived. The final raw TAP is retained.

No app was installed or published; formal Margin was not launched locally.
Packaging and signature checks remain in AG-25. The user's continued-phase-2
request does not imply that Claude's outstanding review has passed.
