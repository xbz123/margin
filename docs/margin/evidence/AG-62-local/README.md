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

## Installed acceptance finding

`2f989957` packaged successfully (12/12 checks; 861 notices) and passed the guarded
asar smoke (10/10 using the canonical path; an earlier alias-path invocation failed
two provenance assertions). It was installed without an old-app backup as requested.
The native binary hash was unchanged. A real fresh profile opened welcome, launcher
and settings, but settings reported `disguise=none` / `apply_failed`.

A separate packaged launch with synthetic HOME and mock keychain reproduced it:
ICNS existed but `nativeImage.createFromPath` was empty; PNG decoded, Dock PNG and
window-title application succeeded. The icon consumer regression failed before the
fix and passed after selecting the existing PNG for runtime. Bundle ICNS is unchanged.
Source startup and CI packaged launch now check the preference result explicitly.
The first install is not accepted as defect-free; repaired package/installation and
current CI evidence are still pending. No real provider, capture or sharing was used.

The repair's complete local gates passed 16/16 (1162/1162, zero failure/skip;
answer 21/21, storage 2/2, startup 1/1 including the new preference assertion,
outbound-renderer 12/12). Independent review passed six platform/package icon
combinations and confirmed the regression reaches the real preference IPC.
CI 38490881488 was cancelled after detecting an invalid reference input;
38490923452 was cancelled as superseded by this installed-acceptance repair.
Neither run is claimed as current acceptance evidence.
