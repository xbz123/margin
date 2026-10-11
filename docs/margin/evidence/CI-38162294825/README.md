# CI 38162294825: stage 4 exit run, passed

This is the third stage 4 exit run, dispatched 2026-10-11 at the user's request.

- Commit: `fb66acce`.
- Repository: the public `xbz123/margin`.
- Runner: `macos-15`.
- Inputs: `package_apps=true`, `no_cache=false`.
- Result: the one job, `gates`, succeeded in about 8 minutes, and every step succeeded.
- `job-proof.json` records the run, every step's conclusion, and every artifact's size and API digest.

## Earlier runs

Two earlier runs failed: 38159055916 on `cc554522` and 38160933671 on `46abfe1c`. PLAN §9 has the details.

## Acceptance (HANDOFF §5, as at stage 3)

- **gates job**: success.
- **Gates** (`gates/`): 16 of 16.
  - Tests: 121 files, 970 tests, 969 pass, 0 fail, 1 existing skip.
  - AG-09 regression 16/16, storage 2/2, startup 1/1, renderer 6/6.
  - Provenance: 0 hits, restricted pool 621107 line keys.
- **Release identity contract** (`identity-contract.log`, copied from the job log): 6 of 6.
- **Packaging** (`packaging/temp/`, `packaging/release/`): 12 of 12 package checks for both identities.
  - `forbidden-content` scanned 23241 entries with no match. That is fewer than the 38621 entries at stage 3, because AG-41a removed six dependencies.
  - Both binaries launched in a throwaway HOME, 7 of 7. No `CrashReporter` directory appeared.
- **Native module** (`native/`):
  - The Electron and cargo caches were restored, and `cidre compiled in this run: 0`.
  - The module hash is `0f92a0b1…`, unchanged.
  - `link-set.json` is byte-identical to `CI-38123550800`.
- **Licenses**: `license-files` passed with 861 notices. The inventory was regenerated after AG-41a's dependency removal.
- **Source** (`source/`): `MANIFEST.json` lists 499 files and `cleanTree` is true.
  - Counts: app 1, npm 382, cargo 114, and Electron ffmpeg and its patch 1 each.
  - There is no libvips section.

## Download

`scripts/margin/download-ci-artifact.mjs` downloaded three artifacts into the session scratchpad:

- the native module;
- the temp app;
- the source.

It checked each file that the artifact's `BUILD-INFO.txt` lists, and the commit. All matched:

- native module `0f92a0b1…`;
- `temp-temp-arm64.zip` `187ae9d9…`;
- `MANIFEST.json` `7d1417f4…`.

The release artifact holds reports only (S25). Its reports and the gates artifact were downloaded with `gh run download` and copied unchanged.

## Artifacts

The artifacts are public workflow artifacts in `xbz123/margin`, about 499 MB in all. The temp app zip and the release reports expire on 2026-10-25; the others expire on 2026-11-10.
