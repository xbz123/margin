# CI 38052543358: libvips Rust toolchain pin

Commit `399d2247` (the nightly and build-date pin `2e5f742f` and its records),
dispatched 2026-10-10 in the public `xbz123/margin` on `macos-15` with
`no_cache=true` and `package_apps=true`, at the user's request, to confirm that
the pinned recipe rebuilds the libvips of the earlier runs. `job-proof.json` has
the run, every step's conclusion and every artifact's size and API digest.

| job | result | time |
| --- | --- | --- |
| libvips | success | 22.8 min |
| gates | failure (provenance) | 15.3 min |
| libvips-replace | success | 0.8 min |

## libvips job: the pin reproduces the earlier rebuild

`libvips/BUILD-INFO.txt`: recipe toolchain `rustc 1.101.0-nightly (a30aa9064
2026-10-08)`, the only embedded rustc commit `a30aa9064df6…`, `mozjpeg version
5.0.0 (build 20261009)`, `SOURCE_DATE_EPOCH 1791547200`. libvips-cpp is
`64bcfea7…`, UUID `57E6BFB0-8E4E-3F1F-A3AB-1DD593CAC71C`: byte-identical to the
four rebuilds of 2026-10-09 (the last one in run 38004311007) and not the `832f9fa5…` of run 38042681414. Every check at the end of
`rebuild.sh` passed (toolchain, embedded commits, mozjpeg, sha256 and the
recorded sources), so the job reported no drift.

## gates job

- **Native module** (`native/`): compiled from scratch, `0f92a0b1…`, the same as
  runs 38004311007 and 38042681414; `link-set.json` identical.
- **Gates** (`gates/`): 15 of 16 exit 0 on a clean tree against AG-26; 111
  files, 853 tests, 847 pass, 0 fail, 6 existing skips. `provenance` failed with
  one hit: line 28 of `scripts/margin/libvips/install-rebuilt.mjs`,
  `const sha = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');`.
  That file has not changed since `f142ca23` (2026-10-09) and passed in run
  38042681414. Upstream `ea316087` (pushed 2026-10-10 11:33Z, after that run)
  added the same line, and this run's fresh upstream fetch saw it. The line is a
  generic sha256 helper written for this branch first; it is allowlisted in
  `provenance-config.json` with that record (PROVENANCE.md).
- Because the gates step failed, the release identity contract step was
  skipped. Packaging, the packaged launches and the source bundle ran and
  succeeded, but this run is not used as packaging evidence; the next full run
  replaces run 38042681414's.

## libvips-replace job (`libvips/replace/`, `libvips/replace-check.log`)

The shipped rebuild (`64bcfea7…`, UUID `57E6BFB0…`) replaced by the npm prebuilt
(`ad39fe2d…`, UUID `52C60631…`): 200 imports, 0 missing; signature valid after
re-signing; sharp's output identical; dyld loaded `52C60631…` after the swap.

## Artifacts

Public workflow artifacts in `xbz123/margin`, about 732 MB; the temp app zip and
the release reports expire on 2026-10-24, the others on 2026-11-09. The native
and libvips artifacts were verified against their BUILD-INFO sha256 and commit
before these files were copied.
