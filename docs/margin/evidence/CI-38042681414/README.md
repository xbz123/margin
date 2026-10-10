# CI 38042681414: packaging after the navigation fix

Commit `7153aa07` (the openExternal fix `a0090760`, `85eb3d02` and its records),
dispatched 2026-10-10 in the public `xbz123/margin` on `macos-15` with
`no_cache=true` and `package_apps=true`, at the user's request, to refresh the
packaging and source evidence for the code Astra accepted. `job-proof.json` has
the run, every step's conclusion and every artifact's size and API digest.

| job | result | time |
| --- | --- | --- |
| libvips | success | 26.6 min |
| gates | success | 11.5 min |
| libvips-replace | success | 1.1 min |

## Finding: the Rust part of the rebuilt libvips is built with a moving nightly

The rebuild is `832f9fa5…`, UUID `A6DD906E-F1CF-3C97-8A68-915443B7B649`, not the
`64bcfea7…` of the four earlier rebuilds; same size. `libvips/rustc-in-dylib.txt`
has the comparison with run 38004311007's library:

- The recipe (`build/posix.sh` of `20b5e899`) installs rustup with
  `--default-toolchain nightly` and uses nightly-only `-Z` flags, so librsvg and
  the Rust standard library linked into libvips-cpp are built with that day's
  nightly. Each library embeds 58 `rustc/<commit>` paths: `a30aa9064` (nightly of
  2026-10-08) in the earlier one, `32dba69d6` (2026-10-09) in this one, and the
  1.98.1 commit `48a229cea` in neither.
- mozjpeg embeds its build date: `mozjpeg version 5.0.0 (build 20261009)` before,
  `(build 20261010)` now.
- All four earlier rebuilds ran on 2026-10-09 UTC with nightly `a30aa9064`, which
  is why they were byte-identical.
- `BUILD-INFO.txt` says `rustc 1.98.1`, and the drift check in `rebuild.sh`
  compares the same value. Both run the rustup proxy `deps/cargo/bin/rustc`
  without the recipe's `RUSTUP_HOME`, so they do not see the nightly that built
  librsvg (presumably they see the runner's own toolchain; no 1.98.1 install
  appears in the build log). The S22 safeguard "CI fails when the build differs
  from rustc 1.98.1" therefore never worked, and the S22 records that treat the
  standard library in libvips as Rust 1.98.1's (`rebuild.sh`: "notices are for
  1.98.1") are wrong.

The recorded downloads, librsvg's `Cargo.lock` and the compiled crate list did not
change (`libvips/sources/manifest.tsv` is byte-identical to run 38004311007's), so
the job reported no drift. The fix is not part of this run; see PLAN.

## gates job

- **Native module** (`native/`): compiled from scratch (rustc 1.98.1, Xcode 16.4,
  `cidre compiled in this run: 1`), `0f92a0b1…`, byte-identical to run
  38004311007's in the same repository; `link-set.json` identical.
- **Gates** (`gates/`): 16/16 exit 0 on a clean tree against AG-26; 111 files,
  853 tests, 847 pass, 0 fail, 6 existing skips; AG-09 6/6, storage 5/5, startup
  1/1, outbound renderer 2/2 (with the timer and undeclared-URL cases), guard
  self-test 12/12; provenance 0 hits. Release identity contract 6/6.
- **Packaging** (`packaging/temp/`, `packaging/release/`): both identities built,
  13 of 13 package checks pass (`libvips-rebuilt` against this run's rebuild),
  both binaries launched in a throwaway HOME. Against run 38004311007 two Mach-O
  files changed in each package: the main executable (its signature binds
  `Info.plist` with the new ASAR hash) and libvips-cpp (`832f9fa5…`). Per S25
  only the release identity's reports and BUILD-INFO were uploaded.
- **Source** (`source/`): `MANIFEST.json`, 592 files, `cleanTree` true.

## libvips-replace job (`libvips/replace/`, `libvips/replace-check.log`)

The shipped rebuild (`832f9fa5…`, UUID `A6DD906E…`) replaced by the npm prebuilt
(`ad39fe2d…`, UUID `52C60631…`): 200 imports, 0 missing; signature valid after
re-signing; sharp's output identical; dyld loaded `52C60631…` after the swap.

## Local checks (`../AG-25/local-verify/`)

Every BUILD-INFO sha256 and the commit matched (release: all but the absent zip).
The source bundle matches its manifest (592 files) and its app archive equals a
local `git archive` of `7153aa07`; the libvips sources match `manifest.tsv` (37
downloads) and `Cargo.lock` (184 crates, all 169 compiled ones kept). The temp
package passes `package-check.cjs` with `MARGIN_LIBVIPS_SHA256` set to
`832f9fa5…`, with the same 13 checks and 21 Mach-O hashes as on CI; `plutil` and
`codesign --verify --deep --strict` pass; `asar-smoke` and `sharp-smoke-local`
exit 0, dyld loading the package's rebuild (UUID `A6DD906E…`).

## Artifacts

Public workflow artifacts in `xbz123/margin`, about 731 MB; the temp app zip and
the release reports expire on 2026-10-24, the others on 2026-11-09.
