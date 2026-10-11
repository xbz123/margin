# CI 38123550800: stage 3 exit run (W3), passed

Commit `d2bd8146` (the storage test dismisses the first-launch permissions
card; code otherwise identical to `180a87c0`), dispatched 2026-10-11 in the
public `xbz123/margin` on `macos-15` with `package_apps=true` and
`no_cache=false`, at the user's request. `job-proof.json` has the run, every
step's conclusion and every artifact's size and API digest. The one job,
`gates`, succeeded in about 11 minutes; every step succeeded.

## Acceptance (PLAN W3, as revised by S34)

- **gates job**: success.
- **Gates** (`gates/`): 16 of 16. 111 files, 964 tests, 959 pass, 0 fail,
  5 existing skips; AG-09 regression 16/16, storage 2/2, startup 1/1,
  renderer 5/5; provenance 0 hits.
- **Release identity contract** (`identity-contract.log`, copied from the job
  log): 6 of 6.
- **Packaging** (`packaging/temp/`, `packaging/release/`): 12 of 12 package
  checks for both identities; `forbidden-content` scanned 38621 entries with no
  match, so no sharp, `@img` or libvips is packaged. Both binaries launched in a
  throwaway HOME (7 of 7).
- **Native module** (`native/`): Electron and cargo caches restored, `cidre
  compiled in this run: 0`; `0f92a0b1…`, `link-set.json` identical to
  `CI-38090230126` and `CI-38120147426`. The linker map differs in every run.
- **Licenses**: `license-files` passed (961 notices); `license-bundle.cjs`
  byte-compares the packaged `licenses/manifest.json` with the source one, which
  lists `rust-sysroot:stdarch`.
- **Source** (`source/`): `MANIFEST.json`, 587 files, `cleanTree` true (app 1,
  npm 470, cargo 114, Electron ffmpeg and patch 1 each), no libvips section.

## Download

`scripts/margin/download-ci-artifact.mjs` downloaded the native, temp app and
source artifacts into the session scratchpad and checked each file its
`BUILD-INFO.txt` lists, and the commit: all matched (native module, map and
link-set; `temp-temp-arm64.zip` `1b18bfd7…`; `MANIFEST.json` `f0cdedfd…`). The
release artifact lists only its zip, which is not uploaded (S25); its reports
were downloaded with `gh run download` and copied unchanged, as was the gates
artifact.

The W4 local checks were not run, and stage 3 is not signed off.

## Artifacts

Public workflow artifacts in `xbz123/margin`, about 532 MB; the temp app zip and
the release reports expire on 2026-10-25, the others on 2026-11-10.
