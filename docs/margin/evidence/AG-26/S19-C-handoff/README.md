# S19-C read-only handoff, not acceptance

On 2026-10-09 the user instructed that this native-source follow-up remain
unchanged and be handed to Claude after the current S19-B verification. No
canvas rebuild, replacement, upstream contact, inventory change or native build
was performed. The reports here preserve read-only findings, not an implemented
source bundle or a legal compliance verdict. S19-B's verified code is `eaf759da`
with CI `37856630750`; the handoff adds documentation only.

## Established inputs and limits

- **canvas 0.1.80:** installed arm64 binary matches the official release digest
  `b6b2f5cc20d4d536c1b5768ba41ef6c83fcd289f4cc435d9aac5e2185e0b655c`.
  Its fixed wrapper commit is `dda1b258dac667b4c66b94bbd4d70aa79ea4503a`.
  The complete source tree and Cargo.lock history contain no historical lock;
  the release has only native assets and the build artifacts have expired.
  Logs return HTTP 410. Decoded npm provenance identifies only the Git source,
  not the Rust dependency closure; its signature has not been independently
  verified. Thirteen positive crate/version strings are not a complete SBOM.
  Historical lock/SBOM or equivalent producer evidence remains missing.
- **Independent Skia:** Electron notices do not cover canvas's bundled Skia.
  The Skia gitlink is `1fdbea293a53b270e3f5e74c92cc6670d68412ff`.
  The `skia-1fdbea29` release tag points at a tree with an older gitlink, so
  it must not be used as the actual producer recipe. Producer run 17296030504
  attempt 2 uses commit `89a12f3f41ebdc1449aeb712003ef562255cb03c` and the
  correct gitlink. Asset timestamps/digests support that association, but do
  not independently prove every final static constituent. GN/DEPS and secondary
  source/notices coverage still need work.
- **sharp-libvips 1.2.4:** fixed recipe
  `20b5e899954907a3039d6e3d4c200aaa0ec52c4c` and the installed versions list
  identify 28 components. The outer libvips-cpp dylib contains static dependencies;
  the outer dynamic-library boundary does not remove their obligations. Collect
  exact sources, five fetched patches, inline edits, platform config and notices.
  The librsvg 2.61.2 official tarball hash and its 356-package Cargo.lock have
  been verified against GNOME's checksum and fixed source. The original lock is
  available; producer metadata edits and `cargo update --workspace` have NOT
  been replayed. This command does not imply all non-workspace versions changed.
  The final closure, complete source archive and usable replacement/re-signing
  path are not accepted yet.
- **Project Rust native module:** the offline locked macOS target metadata
  graph contains 115 reachable non-dev candidates including build/proc-macro
  dependencies. oboe/oboe-sys are absent from that target graph; realfft and
  webrtc-vad are present. This is not a final linker map and is not grounds to
  label every candidate as embedded in the binary.
- **libfvad:** webrtc-vad 0.4.0's exact crate, fixed gitlink
  `aa3c662c9c1291128eb1756b7566c2594d317813` and local cache agree on 21
  production C/H files plus AUTHORS/LICENSE/PATENTS. Its build.rs lists 12 C
  inputs; the files contain five distinct original headers. The report and
  coverage table identify all hashes/ranges. Six proposed supplemental inputs
  (AUTHORS plus those headers) were prepared privately but NOT added to the
  collector or generated inventory. Do not count these as shipped notices.

`main-source-verification.json` contains fresh independent API/source checks.
`preflight-findings.json` is the earlier exploratory snapshot; its open questions
must be read alongside the later librsvg lock result, not as contrary current
claims. `target-cargo-graph.json`, `libfvad-report.json` and
`libfvad-coverage.json` preserve the target graph and detailed source observations.
Original archives and draft inputs remain private and are not committed as code.

## Remaining work and authority

Finish native notice/source coverage, produce commit-matched source artifacts
with appropriate recipient access, and verify replacement/re-signing obligations.
Thirty-day private CI artifacts are not a promise of permanent public source
availability. Missing historical canvas records do not alone prove legal
noncompliance or make bit-for-bit reproduction a universal requirement.

If recovering producer records cannot close the canvas evidence gap, contacting
upstream or rebuilding/re-resolving and replacing its native artifact remains a
separate user decision. No such action is authorized by this handoff. Public
repository/release visibility also remains a separate decision.

AG-25 still needs dual-identity CI packaging, ad hoc signing and package checks,
verified artifact download/native-module switchover, and isolated temp-only
package startup. Formal Margin remains CI-built/read-only locally, never started.
AG-20–24 and all relevant checkpoints still await Claude read-only review; no
review or stage-exit result is signed off on Claude's behalf.
