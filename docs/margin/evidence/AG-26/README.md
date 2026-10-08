# AG-26 partial implementation evidence

Status: local implementation checks passed, but license closure is incomplete.
At this original evidence checkpoint there was no AG-26 commit or fresh CI.
S17 subsequently included these prerequisites in source checkpoint `c49fb86d`;
CI `37826073783` passed their code gates but the normal package license verifier
still rejected 19 candidates. There is no AG-26 or stage-2 exit acceptance.
The working tree is based on `30b9fb24`; `checks/notice-hashes.json` identifies
the frozen scripts, test, package metadata and inventory by SHA-256.

## Implemented and checked

- Application and root lock metadata use `AGPL-3.0-only`; LICENSE is unchanged.
- README, PRIVACY, SECURITY and CONTRIBUTING describe the current implementation.
- NOTICE, original third-party texts, a candidate inventory and package-copy
  byte checks are present. No new dependency or framework was installed.
- Exactly the 21 PLAN-listed files were deleted. Their recoverable Git blobs,
  unchanged LICENSE/CHANGELOG checks and deletion scope are recorded in
  `checks/deletion-scope.json`. The MCP configuration's contents were not read.
- The full local runner has 16 real zero exit codes: 113 test files, 873 tests,
  868 passed, zero failed, five existing skips; AG-09 6/6, storage 5/5,
  startup 1/1 and outbound renderer 1/1. See `summary.json` and the raw logs.
- The nine new synthetic tests also have a separate target log. They cover
  original CRLF/attribution retention, missing candidates, platform constraints,
  version and cache identity, changed locks, absent/changed Chromium notices,
  symlink/path rejection and the missing-repository crate cache regression.
- Independent byte verification found 501 text files, 501 referenced hashes,
  zero hash failures and zero orphan files. Tracked and all 537 then-untracked
  paths passed whitespace checks. Original notice bytes use narrowly scoped Git
  attributes so normalization does not invalidate their hashes.
- The initial provenance failure is retained in `checks/provenance-first/`.
  Twenty exact license/generic lines were individually explained; source pools
  and path exclusions were not broadened. Final provenance passed.

All executable application tests used synthetic HOME, mock keychain/devices,
fake credentials and loopback providers. Local native modules remain the S11
transition binaries; no native rebuild, installed-app change or formal Margin
launch took place. Fresh CI/G7 and actual packages remain unverified for AG-26.

## Blocking license closure

The frozen offline collector intentionally exits 1. Its output is retained in
`checks/collector-offline.log`: 1068 candidates, 501 unique texts, 39 explicit
exclusions, 19 unresolved entries, and two full Electron notices to be copied
from the fixed distribution during packaging. The package hook rejects these
unresolved candidates; it has not been bypassed.

The 19 entries are 15 npm candidates and four Cargo candidates (`realfft`,
`oboe`, `oboe-sys`, `r-efi`). A platform-specific dependency is not declared
absent without target/artifact evidence. `manifest.json` and
`checks/notice-hashes.json` retain the exact names and versions.

Authoritative BlueOak standard terms were obtained. The later official
ansi-tokenize add-missing-LICENSE text is labeled supplemental, not falsely
claimed to have shipped with 0.1.3. The react-remove-scroll-bar 2.3.8 registry
Git reference was unavailable (GitHub 422); no same-version tag/full notice was
confirmed. Generic MIT boilerplate was not substituted for missing grants.

Even closing these 19 entries would not establish complete distribution
compliance: libvips embedded-component notices and corresponding-source/library
replacement duties, Canvas/Skia static vendored coverage, actual shipped icon
sets, and comparison against asar/unpacked/Resources/Frameworks remain open.
AGPL terms do not replace these components' own licenses.

No new commit/push, CI dispatch, application packaging, artifact distribution,
dependency removal or retained-feature change was performed for this ticket.
The proposed next decision is whether to bring forward an AG-25 CI inventory
diagnostic without uploading/distributing application packages, to determine
which candidates are actually shipped. This sequencing change is not yet
approved or executed at this evidence checkpoint. It cannot waive missing notices
or source obligations. The user subsequently approved that diagnostic sequencing
in PLAN S17; its implementation and CI results are separate AG-25 evidence and do
not retrospectively complete AG-26.
