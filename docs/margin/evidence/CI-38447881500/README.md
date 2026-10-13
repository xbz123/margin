# Stage 5 technical exit: passed

2026-10-13. [Public CI run 38447881500](https://github.com/xbz123/margin/actions/runs/38447881500)
completed successfully on `aaf9b0711515fa92032e1698dd42fa8e81fac648`.
Inputs: `gate_ref=docs/margin/evidence/S42-04`, `no_cache=false`, `package_apps=true`.
The reference selects historical comparison evidence, not a substitute for the
current run. The sole job and every step passed (12m37s).

## Evidence

- F1 repair and independent Claude review: [stage-5 acceptance](../stage5-acceptance/README.md).
- Current CI gates: **16/16**; **127 files, 1108 tests: 1107 pass, 0 fail,
  1 existing AG-61 skip**. Actual-button answer regression **21/21**;
  required S42 file/renderer checks passed; release identity contract **6/6**.
- Both identities: package checks **12/12**, isolated CI binary launch **7/7**.
  Forbidden-content scans: 23257 entries each, zero matches; 861 license notices checked.
- Five downloaded artifact ZIPs match their GitHub API SHA-256 digests.
  Every archive inventory was checked before extraction. The inner temp ZIP has
  1068 entries, including 14 bundle-internal symlinks; only 83 asar/unpacked
  resource entries were extracted locally, without executable bundle launch.
- `BUILD-INFO` commit and file hashes match for native, temp and source.
  Native module SHA-256 remains `0f92a0b1093bb901726adda75810a43d35453860e595c63a805dcbd8dbfce782`;
  link-set remains `589f4c63cf9c242b284e4570956a95c1fd29b2c4ead6a5dcabe369c3df8b817a`.
  No native rebuild or installation was performed locally.
- Source MANIFEST: **499/499** file sizes/hashes match, `cleanTree=true`;
  app 1, npm 382, cargo 114, ffmpeg 1, ffmpeg patch 1.
  App archive is byte-equivalent by SHA-256 to local `git archive` of the exact
  tested commit (`06a57862e2215f768b5581d4de9188c4884d3b12492ba24ed0e57950bf194230`).
- Local guarded `asar-smoke`: **10/10**, package-owned code/native modules,
  temporary user data, no main errors and no outbound access.

`run.json` records the job/step outcomes; `artifact-verification.json` records
download digests and source checks; `asar-smoke.json` records local runtime checks.
Small CI reports are retained here with runner-work paths normalized. Large
archives and binaries are not committed. Per S25, the release ZIP was not uploaded;
its packaging and binary-launch reports were checked, not a local release ZIP.
Per S26, package/codesign/Info.plist checks were not repeated locally.

## Boundary

F1 is closed and the **stage-5 technical exit passes**. F2/F3 concurrent
Local Context/Skill editing remain outside the confirmed pre-use configuration
scope; no existing protection was removed. This does not constitute user product
sign-off. No real STT/LLM service, credential, user data or device was used.
No installation, release or phase-6 work occurred. This documentation-only receipt
does not rerun CI or claim its later commit was the tested source commit.
