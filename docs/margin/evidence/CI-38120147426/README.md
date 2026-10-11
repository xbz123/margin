# CI 38120147426: stage 3 exit run (W3 rerun), failed

Commit `180a87c0` (S34 sharp removal and the AG-52 trim), dispatched
2026-10-11 in the public `xbz123/margin` on `macos-15` with `package_apps=true`
and `no_cache=false`, at the user's request. `job-proof.json` has the run, every
step's conclusion and every artifact's size and API digest. Since S34 the
workflow has one job, `gates`; the run concluded **failure** after about 13
minutes.

## The failure

The gates step failed: 15 of 16 gates passed; `storage` failed
(`gates/storage.log`, 1 of 2 tests). After a reload, clicking the Usage tab
timed out. This time the test's `clickOrExplain` named the covering element: a
`position: fixed; inset: 0; z-index: 9998` overlay titled "temp · Permissions",
the first-launch permissions card (`src/components/onboarding/PermissionsToaster.tsx`).

`App.tsx` opens the card on every launch until it is dismissed
(`natively_perms_shown_v1`), 1.4 s after load. The test had set only the startup
sequence flag. Locally the clicks happened within 1.4 s; on CI they came later.
With a 2.5 s wait before the click the failure reproduces locally with the same
element. It is the same `<div>` that failed run 38090230126. The card is the
intended first-launch onboarding, not a UI defect; the test is fixed to dismiss
it as a returning user has (PLAN §9 "W3 出口 CI 38120147426").

Because the gates step failed, the release identity contract step was skipped:
this run has no 6/6 result.

## What passed

- **Native module** (`native/`): Electron and cargo caches restored, `cidre
  compiled in this run: 0`; `0f92a0b1…`, `link-set.json` identical to
  `CI-38090230126`.
- **Gates** (`gates/`): the other 15 gates; 111 files, 964 tests, 959 pass,
  0 fail, 5 existing skips; provenance passed.
- **Packaging** (`packaging/temp/`, `packaging/release/`): 12 of 12 package
  checks for both identities (S34: no `libvips-rebuilt`); `forbidden-content`
  scanned 38621 entries with no match, so no sharp, `@img` or libvips is
  packaged. Both binaries launched in a throwaway HOME (7 of 7). `license-files`
  passed (961 notices): `license-bundle.cjs` byte-compares the packaged
  `licenses/manifest.json` with the source one, which lists
  `rust-sysroot:stdarch`.
- **Source** (`source/`): `MANIFEST.json`, 587 files, `cleanTree` true (app 1,
  npm 470, cargo 114, Electron ffmpeg and patch 1 each); no libvips section.

## Download

`scripts/margin/download-ci-artifact.mjs` downloaded the native, temp app and
source artifacts into the session scratchpad and checked each file its
`BUILD-INFO.txt` lists, and the commit: all matched (native module, map and
link-set; `temp-temp-arm64.zip` `5b514d60…`; `MANIFEST.json` `1ab0a9af…`). The
release artifact lists only its zip, which is not uploaded (S25); the script
stops on it, so its reports were downloaded with `gh run download` and copied
unchanged, as was the gates artifact.

The W4 local checks were not run, and stage 3 is not signed off.

## Artifacts

Public workflow artifacts in `xbz123/margin`, about 531 MB; the temp app zip and
the release reports expire on 2026-10-25, the others on 2026-11-10.
