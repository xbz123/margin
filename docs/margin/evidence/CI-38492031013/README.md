# Stage 6 automated and package verification

2026-10-14. [CI 38492031013](https://github.com/xbz123/margin/actions/runs/38492031013)
completed successfully for `f35f7b3ff0244df17f18894367d611301137018a`.
Inputs: `package_apps=true`, `no_cache=false`, `gate_ref=docs/margin/evidence/AG-62`.
All 29 reported job steps succeeded. No new run is needed for this receipt-only update.

- Complete gates **16/16**, **1162/1162 tests**, zero failures or skips.
- Required S42 checks ran and passed; full local retirement check: 309 rules, zero failures.
- Local and release identity contracts: **7/7** each.
- Temp and release packages: **12/12** checks each; actual CI binary launches:
  **8/8** each, including the new window-preference assertion.
- Five artifact archives match GitHub SHA-256 digests. Complete archive inventories
  were checked before extraction. Source manifest **499/499** file hashes and sizes
  match, `cleanTree=true`; the application source archive matches `git archive` for
  the exact tested commit.
- The temp inner ZIP matches BUILD-INFO. All 1068 entries were checked, including
  14 bundle-internal symlinks; only 83 asar/native resource entries were extracted.
  Downloaded package code passed the local guarded asar smoke **10/10**, with
  synthetic data, package-owned native modules and no outbound access.
- Formal Margin ZIP remains unuploaded under S25. Its CI package/launch reports
  were verified; no formal package was installed or launched on the user's machine.

`verification.json`, `run.json` and the small reports retain the checkable receipt.
Machine-specific paths in copied text reports are normalized. Binaries, archives,
credentials and meeting content are not committed.

## Installation and remaining boundary

The locally built Natively Local variant of this same source commit is already
installed. Its executable, Info.plist, asar and native module match the validated
local package; no redundant reinstall was performed after CI completion. It is
not claimed to be byte-identical to the differently named CI temp/release packages.
See [local installation evidence](../AG-62-local/README.md).

Automated/package verification passes; **stage 6 is not fully signed off**.
Real-profile startup stalled once in CoreAudio device enumeration and recovered
after restarting only the app; that intermittent risk remains unresolved. Actual
capture, device switching, provider quality/latency and sharing-receiver behavior
have not been accepted. Black replacement rectangles remain unacceptable.
The user will authorize system permissions and signing work later; no certificate,
TCC reset, system audio restart or release action was performed.
