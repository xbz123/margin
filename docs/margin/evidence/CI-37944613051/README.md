# CI 37944613051: S22 packaging with the rebuilt libvips

Commit `ba9279fa`, dispatched 2026-10-09 on `macos-15` with `no_cache=true` and
`package_apps=true` (the API reports no inputs for dispatch runs; the cache-free
native build, the libvips jobs and the packaging steps only run with those
inputs). All three jobs succeeded: libvips 9.7 min, gates 8.2 min,
libvips-replace 0.3 min. `job-proof.json` has the run, every step's conclusion and
every artifact's size and API digest. This run supersedes `../CI-37871598165/` as
the packaging evidence: the package now ships the rebuilt libvips (PLAN S22).

## The run before it

Run 37942077338 on `40ba1b7b` (the S22 commit, same inputs) passed the libvips
job (9.5 min) and the gates job (8.6 min, both packages built, checked and
launched) and failed in libvips-replace after 0.3 min:
`fetch-prebuilt.mjs` reads the prebuilt's sha256 from `package-check.cjs`, which
loaded `@electron/asar` at the top, and that job installs no `node_modules`.
`ba9279fa` loads it inside `checkPackage` only; nothing else changed. Its
artifacts were not downloaded.

## libvips job

- `libvips/BUILD-INFO.txt`, `build.log`: `scripts/margin/libvips/rebuild.sh` built
  the sharp-libvips recipe `20b5e899` unchanged from a clean clone. Toolchains:
  rustc 1.98.1, cargo-c 0.10.25, meson 1.12.1, Apple clang 17, Xcode 16.4.
  librsvg: 353 locked crates, 184 kept, 169 compiled from the registry, all kept.
- The new drift checks ran and the job log prints `no drift from the recorded
  build`: the downloads equal `scripts/margin/libvips/expected-sources.tsv`, and
  librsvg's `Cargo.lock` and compiled crate list equal the recorded ones.
- The built `libvips-cpp.8.17.3.dylib` has sha256 `64bcfea7…` and UUID
  `57E6BFB0-8E4E-3F1F-A3AB-1DD593CAC71C`, byte-identical to runs 37870671533 and
  37871598165.
- `libvips/sources/`: `manifest.tsv` (37 downloads), `librsvg-Cargo.lock` and
  `librsvg-compiled.txt`; the files themselves are in the
  `margin-libvips-sources-<commit>` artifact.

## gates job

- Clean `npm ci`; native module compiled from scratch with the pinned toolchain
  (`native/BUILD-INFO.txt`: rustc 1.98.1, `cidre compiled in this run: 1`). The
  `.node` sha256 `71f9cf8e…` is the same as in the three earlier cache-free runs,
  and `native/link-set.json` is byte-identical to run 37871598165's.
- `scripts/margin/libvips/install-rebuilt.mjs` checked the libvips artifact's
  BUILD-INFO and commit, that its `versions.json` equals the npm package's, arm64
  only, the same install name `@rpath/libvips-cpp.8.17.3.dylib`, and that it
  exports all 200 symbols sharp imports from the prebuilt, then put it in
  `node_modules` in place of the prebuilt (`ad39fe2d…`). The record is in
  `packaging/*/package-checks.json` under `libvips`.
- `gates/`: 16/16 steps exit 0 on a clean tree; unit tests 848, 842 pass, 0 fail,
  6 existing skips, 111 files; AG-09 6/6, storage 5/5, startup 1/1, outbound
  renderer 2/2. Release identity contract 6/6.
- `packaging/temp/`, `packaging/release/`: both identities built from a clean
  output directory, arm64, ad hoc signed. `package-check.cjs` passes every check,
  including the new `libvips-rebuilt` (the packaged library is `64bcfea7…`, the
  installed rebuild, not the prebuilt): Info.plist, executable name, no
  `app-update.yml`, no publish field, built identity, no forbidden content in
  38,798 entries, 21 Mach-O files all arm64, codesign verification, ad hoc
  signature and 1,316 packaged notice references matching the source inventory
  (968 before S22; the difference is the libvips notices). Zip sha256 in each
  BUILD-INFO.
- `packaging/*/launch.json`: each packaged binary launched in a throwaway HOME;
  both pass (launcher window, preload API, `isPackaged`, name, userData and logs
  in the only directory created).
- `source/`: `MANIFEST.json` of `margin-source-<commit>`: `git archive` of the
  commit, 475 npm tarballs, 114 crates, Electron's ffmpeg and its patch, 592 files.
  `cleanTree` is true (the 7 untracked paths are the gate evidence). Its `libvips`
  entry now names the libvips sources and binary artifacts of the same run as the
  corresponding source of the shipped library.

## libvips-replace job

`libvips/replace/`, `replace-check.log`: the user-side replacement, now in the
direction S22 needs. `fetch-prebuilt.mjs` fetched the npm prebuilt from the URL in
`package-lock.json` and checked its integrity (sha512) and sha256 `ad39fe2d…`. In
the unzipped temp app the shipped rebuild (UUID `57E6BFB0…`) was replaced by it;
the signature failed verification until `codesign --force --deep --sign -`, then
passed. The prebuilt exports all 200 symbols sharp needs, sharp's PNG, WebP and
SVG output is identical before and after, and dyld loaded `57E6BFB0…` before and
the prebuilt's `52C60631…` after.

## Artifacts

Private workflow artifacts, about 1.05 GB in total; the two app zips expire on
2026-10-23 (14 days), the others on 2026-11-08 (30 days). They were
downloaded and checked locally (`../AG-25/local-verify/`).
