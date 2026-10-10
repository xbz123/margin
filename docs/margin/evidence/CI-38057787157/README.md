# CI 38057787157: full run after S26

Commit `2c7f1e42` (the libvips pin, the provenance allowlist entry for upstream
`ea316087` and the S26 trimming), dispatched 2026-10-10 in the public
`xbz123/margin` on `macos-15` with `package_apps=true` and `no_cache=false` (S26:
the native module, its Rust toolchain and Xcode did not change), at the user's
request. `job-proof.json` has the run, every step's conclusion and every
artifact's size and API digest. Every step succeeded; the run took about 33
minutes.

| job | result | time |
| --- | --- | --- |
| libvips | success | 21.4 min |
| gates | success | 10.1 min |
| libvips-replace | success | 0.9 min |

## libvips job

`libvips/BUILD-INFO.txt`: recipe toolchain `rustc 1.101.0-nightly (a30aa9064
2026-10-08)`, the only embedded rustc commit `a30aa9064df6…`, `mozjpeg version
5.0.0 (build 20261009)`. libvips-cpp is `64bcfea7…`, UUID `57E6BFB0…`, the second
pinned rebuild to match the recorded build (after run 38052543358). The
artifact's tar.gz differs from that run's (`3c0a9303…` against `dd138017…`); the
library inside is the same. The four drift checks of `rebuild.sh` that fail the
job all passed.

## gates job

- **Native module** (`native/`): `no_cache: false`, but the public repository
  had no cache yet (every earlier run there skipped it), so cargo compiled from
  scratch ("Cache not found" for both keys; `cidre compiled in this run: 1`). This run
  saved the Electron and cargo caches (about 444 MB) for later runs. The module is `0f92a0b1…`, the same as runs
  38004311007, 38042681414 and 38052543358; `link-set.json` identical.
- **Gates** (`gates/`): 16/16 exit 0 on a clean tree against AG-26; 110 files,
  843 tests, 838 pass, 0 fail, 5 existing skips (10 fewer tests than before S26,
  all from the removed files); provenance 0 hits. Release identity contract 6/6.
- **Packaging** (`packaging/temp/`, `packaging/release/`): both identities built,
  13 of 13 package checks pass, `libvips-rebuilt` with `64bcfea7…` in both
  packages (not the prebuilt `ad39fe2d…`); both binaries launched in a throwaway
  HOME. Per S25 only the release identity's reports and BUILD-INFO were uploaded.
- **Source** (`source/`): `MANIFEST.json`, 592 files, `cleanTree` true.

## libvips-replace job (`libvips/replace/`, `libvips/replace-check.log`)

The shipped rebuild (`64bcfea7…`, UUID `57E6BFB0…`) replaced by the npm prebuilt
(`ad39fe2d…`, UUID `52C60631…`): 200 imports, 0 missing; signature valid after
re-signing; sharp's output identical; dyld loaded `57E6BFB0…` before and
`52C60631…` after the swap.

## Download

`scripts/margin/download-ci-artifact.mjs` downloaded the native, libvips, temp
app and source artifacts into the session scratchpad and checked each file its
`BUILD-INFO.txt` lists, and the commit: all matched (native module, map and
link-set; the libvips tar.gz; `temp-temp-arm64.zip`; `MANIFEST.json`). The
release artifact lists only its zip, which is not uploaded (S25), so it has
nothing to verify. The gates and libvips-replace artifacts carry no BUILD-INFO
and are copied unchanged. The libvips sources artifact was not downloaded (S26:
the recipe and records did not change).

At the user's request the local checks (source bundle against its manifest and
`git archive`, `asar-smoke` of the temp package) have not been run yet; the
downloads stay in the scratchpad for them.

## Artifacts

Public workflow artifacts in `xbz123/margin`, about 732 MB; the temp app zip and
the release reports expire on 2026-10-24, the others on 2026-11-09.
