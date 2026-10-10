# CI 38090230126: stage 3 exit run (W3), failed

Commit `0610e606` (W2 closed; code identical to `3e779466`), dispatched
2026-10-11 in the public `xbz123/margin` on `macos-15` with `package_apps=true`
and `no_cache=false` (the native module, its toolchain, the dependencies and the
libvips recipe did not change since `2c7f1e42`), at the user's request.
`job-proof.json` has the run, every step's conclusion and every artifact's size
and API digest. The run concluded **failure** after about 37 minutes.

| job | result | time |
| --- | --- | --- |
| libvips | success | 21.9 min |
| gates | **failure** | 14.7 min |
| libvips-replace | success | 0.6 min |

## The failure

The gates step failed: 15 of 16 gates passed; `storage` failed
(`gates/storage.log`, 4 of 5 tests). The failing test is "startup recovery of an
unprocessed meeting follows the profile_history scope", at
`tests/margin/meeting-storage.test.mjs:533`. After the relaunch and a reload,
clicking "Untitled Session" in the history list first found the element
unstable, then for 30 seconds a `<div>` intercepted pointer events, and the
click timed out. Every assertion before the click passed: recovery sent nothing,
the transcript stayed local and the failed generation metadata was kept.

The click was added in `49b44e8c` (AG-33) to check that the history view marks
partial or timed-out output. It runs in CI here for the first time; it passes
locally (`evidence/AG-3x-review/`, storage 5/5). The log does not name the
intercepting element, so the cause is not known: it may be the CI window or
animation timing, or a real overlay over the history list after startup
recovery.

Because the gates step failed, the release identity contract step was
skipped: this run has no 6/6 result.

## What passed

- **Native module** (`native/`): Electron and cargo caches restored, `cidre
  compiled in this run: 0`; `0f92a0b1…`, `link-set.json` identical to
  `CI-38057787157`.
- **Gates** (`gates/`): the other 15 gates; 113 files, 981 tests, 976 pass,
  0 fail, 5 existing skips; provenance passed.
- **libvips** (`libvips/`): `64bcfea7…`, UUID `57E6BFB0…`, only embedded rustc
  commit `a30aa906`.
- **Packaging** (`packaging/temp/`, `packaging/release/`): 13 of 13 package
  checks for both identities, `libvips-rebuilt` with `64bcfea7…` in both;
  both binaries launched in a throwaway HOME (7 of 7). `license-files` passed
  (1348 notices): `license-bundle.cjs` byte-compares the packaged
  `licenses/manifest.json` with the source one, which lists
  `rust-sysroot:stdarch` and both stdarch texts.
- **libvips-replace** (`libvips/replace/`, `libvips/replace-check.log`):
  `57E6BFB0…` before, `52C60631…` after; 200 imports, 0 missing; signature valid
  after re-signing; sharp output identical.
- **Source** (`source/`): `MANIFEST.json`, 592 files, `cleanTree` true.

## Download

`scripts/margin/download-ci-artifact.mjs` downloaded the native, libvips, temp
app and source artifacts into the session scratchpad and checked each file its
`BUILD-INFO.txt` lists, and the commit: all matched (native module, map and
link-set; the libvips tar.gz; `temp-temp-arm64.zip` `13da4979…`;
`MANIFEST.json`). The release artifact lists only its zip, which is not uploaded
(S25), so it has nothing to verify. The gates and libvips-replace artifacts carry
no BUILD-INFO and are copied unchanged. The libvips sources artifact was not
downloaded (S26).

At the user's request the W4 local checks (source bundle, `asar-smoke`) were not
run, and stage 3 is not signed off.

## Artifacts

Public workflow artifacts in `xbz123/margin`, about 732 MB; the temp app zip and
the release reports expire on 2026-10-24, the others on 2026-11-09.
