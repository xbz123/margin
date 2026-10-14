# AG-62 local acceptance package

2026-10-14. In progress, not phase-6 sign-off.

The user approved replacing Natively Local, not Margin, with a locally packaged
test build. Display name and bundle ID remain Natively Local / local.natively.desktop;
new data uses the separate `Natively Local` directory. Old meeting records were
exported outside the repository; neither those records nor credentials are included
here. The installed Margin app and its data remain out of scope.

Native binary SHA-256 `71f9cf8e25767a338e3c8a7bd73273db9b6428afcfd3ae21cb871e4759fb2603`
matches the already verified private CI build described in
[AG-25 local verification](../AG-25/local-verify/README.md). No local native rebuild
or dependency installation is authorized or needed. Local packaging disables both
electron-builder native rebuild paths, keeps package/license/signature checks and
requires committed tracked source without untracked build inputs.

The independent review identified missing isolation coverage for the new data
directory. The storage guard, synthetic sentinel, real-path watcher and owner map
were extended without dropping the legacy directory. The identity regression now
probes the new directory from other identities.

Initial sandboxed gates could not launch Electron and iconutil; they are not a
pass. The complete rerun with the existing application isolation guard passed
16/16 gates: 132 files, 1162/1162 tests, zero failures or skips; answer regression
21/21, storage 2/2, startup 1/1, outbound-renderer 12/12. The full retired-rule
check passed 309 rules, zero failures. Independent gpt-6.1-sol review closed the
isolation finding after 36 synthetic filesystem assertions; its final review
also confirmed the encoded package URL and the CI local identity contract step.
No real service, capture, sharing receiver or release compatibility is claimed.

Package checks, installed launch and CI receipts remain pending. At the user's
latest instruction no separate backup of the old application will be retained.
