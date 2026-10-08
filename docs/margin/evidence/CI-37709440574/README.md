# Uncached CI 37709440574

S11 evidence for source commit `c43b10e9e60e8e4bf634e4304289d2b4af36484c`.
The workflow_dispatch run completed successfully with `no_cache=true`: the two
Electron/cargo cache steps were skipped, `npm ci` and native setup succeeded,
and `Compiling cidre v0.11.10` appears in the raw log. This does not claim that
every cache in the runner or package registry was disabled.

- `run.json`, `run-view.json`, `job-steps.json`: GitHub run/step metadata.
- `job.log`, `raw-job.log`: gh-rendered and raw job logs respectively.
- `gates/`: original gate artifact, 15 exit-zero steps on a clean checkout;
  104 files, 767 tests / 762 pass / 0 fail / 5 existing skips; UI checks 6/5/1.
- `native/`: BUILD-INFO, setup log and recomputed hash receipts. The downloaded
  arm64 binary hashes to `33e827897d1c2a633c2ee885b17a598ec9b259aba7305e528528f25cb4ed4e4e`.
  Neither the binary nor the ZIP archives are committed.
- `artifacts.json`, archive member lists/attributes, `archive-safety.json`:
  both ZIP digests match GitHub metadata; all entries were checked before
  extraction for unsafe paths, duplicates, links and special file types.
- `verification.json`: the gpt-6.1-sol test operator's derived receipt; raw
  logs and TAP are the primary evidence, independently rechecked at closeout.

Downloaded and verified on 2026-10-08. Subsequent documentation-only commits
do not change the source accepted here. No PR, Release, installation or real
provider/permission test was performed.
