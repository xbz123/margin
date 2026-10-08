# First S17 CI diagnostic attempt: source gate rejected

- Run: 37824733686, attempt 1, workflow_dispatch.
- Source checkpoint: c49fb86d3de16d004ec5f27ee877ddd026200127; clean checkout.
- Inputs: package_inventory=true, gate_ref=docs/margin/evidence/AG-25,
  no_cache=false. This is not a no-cache native-rebuild claim.
- npm ci and native setup succeeded. Of the 16 gates, 15 exited zero; only
  provenance exited 1. Tests: 880 total, 875 passed, zero failed, five existing
  skips. AG-09 6/6, storage 5/5, startup 1/1 and renderer 1/1 passed.
- The source scan found six matches for two exact generic/standard strings:
  the Blue Oak heading and Node ESM direct-entry test. New upstream references
  under the same configured prefixes enlarged the restricted line-key pool from
  the previous local 587141 to 606678. A local refresh reproduced all six before
  the exact matches were documented. No application logic changed for this fix.
- Release identity contract and package inventory were skipped after the failed
  gate. No app was formed, signed or distributed by the diagnostic step.
- The native upload was skipped. The artifact API returned exactly one artifact,
  the gate-text evidence below; the diagnostic upload had no files and created
  no artifact. A green upload step label is not proof of artifact creation.

Downloaded artifact 11570853276, `margin-gates-c49fb86d3de16d004ec5f27ee877ddd026200127`:
54,630 bytes; ZIP SHA-256
`6d80aa53528326d7bf7828e17d9f235341da8b606a2a14f028df5393d0779275`, matching
the API digest. All 23 entries were checked before extraction: regular relative
text/JSON/TAP files, no links or traversal. Only those unmodified files are
archived here; the ZIP and native/application binaries are not committed.

Status: failed source gate, no actual-package inventory, no AG-26/AG-25 or
stage-2 exit acceptance. The corrected run must be checked independently.
