# CI 38004311007: all three jobs on the fixed code in the public repository

Commit `9ef2ed4a` (the fixes for the two gate failures of `../CI-38000301350/`),
dispatched 2026-10-09 in the public `xbz123/margin` (PLAN S25) on `macos-15` with
`no_cache=true` and `package_apps=true`. `job-proof.json` has the run, every
step's conclusion and every artifact's size and API digest.

| job | result | time |
| --- | --- | --- |
| libvips | success | 27.4 min |
| gates | success | 10.3 min |
| libvips-replace | success | 1.0 min |

This is the first run in which the code after the stage 2 acceptance fixes also
passed libvips-replace (in run 37996030056 that job was not started, billing).

## libvips job (`libvips/`)

The rebuild is `64bcfea7…`, UUID `57E6BFB0-8E4E-3F1F-A3AB-1DD593CAC71C`, as in
every earlier rebuild; no drift from the recorded sources. `libvips/sources/`
holds the run's `manifest.tsv` (byte-identical to run 37996030056's), librsvg's
`Cargo.lock` and the compiled crate list.

## gates job

- **Native module** (`native/`): compiled from scratch (rustc 1.98.1, Xcode 16.4,
  `cidre compiled in this run: 1`). sha256 `0f92a0b1…`, not the `71f9cf8e…` of the
  runs in the private repository. `compare-with-37996030056.log`: same size,
  identical sections and sizes, the one exported symbol, strings after path
  normalization and `link-set.json`. The difference is the install name, the
  absolute `target/…` path of the build directory, which now contains `margin`
  instead of `Assessment-Assistant` (S24 explains why the path is embedded); the
  UUID and the signature follow from the changed bytes. The worktree keeps the
  verified CI build `71f9cf8e…`; it was not replaced.
- **Gates** (`gates/`): 16/16 exit 0 on a clean tree against AG-26; 111 files,
  853 tests, 847 pass, 0 fail, 6 existing skips; AG-09 regression 6/6, storage 5/5,
  startup 1/1, outbound renderer 2/2, guard self-test 12/12; provenance 0 hits
  with 128,377 approved line keys, the approved icon sources now read from their
  checked-in, blob-verified copies. Release identity contract 6/6.
- **Packaging** (`packaging/temp/`, `packaging/release/`): both identities built,
  every `package-check.cjs` check passes (13 of 13, including `libvips-rebuilt`),
  and both packaged binaries launched in a throwaway HOME (`launch.json`). Compared
  with run 37996030056 only two of the 21 Mach-O files changed: the native module
  (above) and the main executable, whose ad hoc signature binds `Info.plist` and
  with it the ASAR integrity hash of the new `app.asar` (it also changed between
  37944613051 and 37996030056).
- **Release artifact**: per S25 only the reports, launch result and BUILD-INFO
  were uploaded. BUILD-INFO still records the zip's sha256 (`71c911fb…`), but the
  zip itself is not public, so `download-ci-artifact.mjs` stops with ENOENT on it;
  the release package was checked locally on run 37996030056.
- **Source** (`source/`): `MANIFEST.json` of the source bundle, 592 files,
  `cleanTree` true.

## libvips-replace job (`libvips/replace/`, `libvips/replace-check.log`)

In the temp package the shipped rebuild (`64bcfea7…`, UUID `57E6BFB0…`) was
replaced by the npm prebuilt (`ad39fe2d…`, UUID `52C60631…`): all 200 symbols
sharp imports from libvips are exported by the prebuilt, none missing; the
signature is valid after re-signing; sharp's output is identical before and after;
dyld loaded `52C60631…` after the swap.

## Local checks (`../AG-25/local-verify/`)

Every BUILD-INFO sha256 and the commit matched (release: all but the absent zip).
The source bundle matches its manifest and its app archive equals a local
`git archive` of `9ef2ed4a`; the libvips sources match `manifest.tsv` and
`Cargo.lock`. The temp package passes `package-check.cjs` locally with the same
13 checks and 21 Mach-O hashes as on CI; `plutil` and
`codesign --verify --deep --strict` pass; `asar-smoke` and `sharp-smoke-local`
exit 0 with the package's rebuilt libvips loaded.

## Artifacts

Public workflow artifacts in `xbz123/margin`, about 730 MB; the temp app zip
and the release reports expire on 2026-10-24, the others on 2026-11-08/09. Public
repositories run on standard GitHub-hosted runners without billed minutes.
