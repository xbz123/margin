# S19-B: two explicitly approved metadata-MIT exceptions

Baseline: `3cdb2b05`. This implements the approved evidence-policy adjustment
only for react-remove-scroll-bar 2.3.8 and realfft 3.5.0. Neither dependency,
runtime behavior, package lock nor Cargo lock changes. This is not a finding
that the missing original full license/copyright notices were recovered.

The collector binds the published metadata bytes to exact package identity,
version and approved archive integrity/checksum, then attaches fixed SPDX MIT
text. It checks current installed metadata bytes as well as the stored input.
It rejects unapproved versions, changed declarations/pins/text, symlink metadata,
missing metadata attachments and removal of the evidence-category discriminator.
Attachments resolve independently of their input order. Daily offline collection
does not claim to reverify every installed code byte against the original archive.

Both packages also have brief MIT statements in their README; neither supplies
the original full notice in its published archive. Author metadata is not a
copyright line. The standard text and its placeholders are preserved, not filled
with invented owners or years. The later 2025 repository LICENSE is not used to
close this gap. Generated NOTICE/README/manifest label the weaker evidence class.

## Source and validation

`checks/main-integrity.json` records independent main-thread refetches of both
official archives, their SRI/checksum and safe relative regular member checks,
metadata byte equality, and the fixed SPDX text SHA-256/Git blob. It also verifies
all 411 prior texts, 724 unrelated components and 45 prior attachments remain
unchanged. There are 726 candidates, 413 stored texts, 33 excluded entries,
zero unresolved candidates and two deferred Electron notices; no orphan text.

The frozen 52 target tests pass through X2. Replaying the same tests against the
pre-change collector fails 36 cases (16 pass), not a timeout. Negative cases
exercise the finite approval boundary. Two earlier failed attempts are retained:
an overly strict realpath comparison rejected the macOS temporary-path alias;
an isolated fixture regenerated away its cached standard text. Those causes
were corrected before the frozen run. Their logs are not acceptance evidence.

`gates/summary.json` records all 16 gate commands actually exiting zero:
925 tests, 919 pass, zero fail and six existing skips; AG-09 6/6, storage 5/5,
startup 1/1. The raw logs remain privately retained; path-only transformations
and before/after hashes are in `checks/gates-redactions.json`. The gate started
from the recorded dirty implementation tree, not a clean committed checkpoint.

Post-build offline regeneration is byte-idempotent. The synthetic Resources
normal verifier checks 989 notice references and returns
`candidateInventoryOnly: true`; changing one metadata output is rejected.
See `checks/post-build-verification.log`. This normal candidate check now passes
under S19-B, but cannot establish complete native-license/source coverage.

Fresh no-cache CI, clean native build and S17 actual-package checks remain due
for this checkpoint. S17 must still stop before signing, report acceptance=false
and upload text only. Native nested notices, corresponding sources and usable
replacement/re-signing instructions remain S19-C work; AG-25 and Claude read-only
review remain open. No application/native binary or Release is distributed here.
