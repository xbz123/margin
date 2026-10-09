# CI 37871598165: AG-25 packaging and S19-C, final code commit

Commit `46e5c0cc`, dispatched 2026-10-09 on `macos-15` with `no_cache=true`,
`package_apps=true` and `libvips_rebuild=true` (the API reports no inputs for
dispatch runs; the cache-free native build, the packaging steps and the libvips
jobs only run with those inputs). All three jobs succeeded: gates 7.5 min, libvips
9.3 min, libvips-replace 0.3 min. `job-proof.json` has the run, every step's
conclusion and every artifact's size and API digest. The two runs before it are
described in `../CI-37868935310/`.

The workflow artifacts were private and were deleted on 2026-10-09 at the
user's request to stay within the storage quota, together with those of runs
37868935310 and 37870671533. This directory keeps the small records; the
binaries were downloaded and checked locally before that
(`../AG-25/local-verify/`). Under S22 the package now ships the rebuilt libvips;
that build's run supersedes this one as the packaging evidence.

## gates job

- Clean `npm ci`; the native module compiled from scratch with the pinned
  toolchain (`rustup` installed `1.98.1` from `native-module/rust-toolchain.toml`;
  `Compiling cidre` in `native/setup-native.log`).
- `gates/`: 16/16 steps exit 0 on a clean tree (0 uncommitted paths); unit tests
  846, 840 pass, 0 fail, 6 existing skips, 111 files; AG-09 6/6, storage 5/5,
  startup 1/1, outbound renderer 2/2. Release identity contract 6/6
  (`gates/identity-release-contract.log`).
- `native/`: BUILD-INFO with the `.node` sha256 `71f9cf8e…`, identical in all three
  cache-free runs of the day, and `link-set.json` read from the ld64 map of the
  link (map sha256 in BUILD-INFO; the map itself stays in the artifact).
- `packaging/temp/` and `packaging/release/`: `scripts/build-local.cjs` built each
  identity from a clean output directory, packaged arm64 with
  `electron-builder --dir --publish never`, signed ad hoc and ran
  `package-check.cjs`. Both pass every check: Info.plist name, display name and
  identifier (`temp`/`io.github.xbz123.temp`, `Margin`/`io.github.xbz123.margin`),
  executable name, no `app-update.yml`, no `build`/`publish` field in the packaged
  `package.json` (the builder config `scripts/margin/package.config.cjs` sets
  `publish: null` and the CLI passes `--publish never`), built identity in the
  asar, no forbidden content in 38,688 entries, all 21 Mach-O files arm64,
  `codesign --verify --deep --strict` and an ad hoc signature, and the 968 packaged
  notice references matching the source inventory (candidate inventory, see
  `licenses/README.md`). Zip sha256 in each BUILD-INFO.
- `packaging/*/launch.json`: each packaged binary launched in a throwaway HOME
  (`HOME`/`CFFIXED_USER_HOME`/`TMPDIR` under the runner temp, mock keychain, the
  guard's resolver block). Both pass: launcher window, preload API,
  `isPackaged`, app name, userData and logs at `<home>/Library/Application
  Support/<name>`, and that directory is the only one created there.
- `source/`: the S19-C corresponding-source artifact `margin-source-<commit>`:
  `git archive` of the commit, 475 npm tarballs checked against
  `package-lock.json` integrity, 114 crates of the macOS arm64 build checked
  against `Cargo.lock`, Electron's ffmpeg at the Chromium 150.0.7871.47 revision
  `ad41607c` and Electron's one ffmpeg patch; `MANIFEST.json` lists every file
  with sha256. `cleanTree` is true; the 7 untracked paths are the gate evidence
  written under `ci-evidence/`.

## Native link set

The map has 208 inputs. Live code comes from 13 crates (anyhow, cidre,
coreaudio, cpal, libloading, napi, napi_sys, natively_audio, objc2,
signal_hook_registry, socket2, tokio, webrtc_vad), 9 standard library crates
(std, core, alloc, panic_unwind, hashbrown, gimli, addr2line, object,
rustc_demangle) and 17 macOS system libraries. bitflags, bytes, errno, mio,
objc2_encode, parking_lot, parking_lot_core and compiler_builtins were linked but
fully dead-stripped. No separate C archive is linked: the 11 libfvad C objects are
inside the webrtc-vad rlib, and cidre's 19 Objective-C objects inside its own.
Every linked crate has license text in `licenses/manifest.json`; the standard
library notices are new in this commit. Generic code is compiled into the calling
crate's objects (realfft, for example, has none of its own), so the map is a lower
bound and notices stay on the full compiled set.

## libvips jobs

- `libvips/BUILD-INFO.txt`, `build.log`: `scripts/margin/libvips/rebuild.sh` ran
  the sharp-libvips recipe `20b5e899` unchanged from a clean clone with the curl
  wrapper first on PATH. Toolchains: rustc 1.98.1, cargo-c 0.10.25, meson
  1.12.1, Apple clang 17, Xcode 16.4. librsvg: 353 locked crates, 184 kept, 169
  compiled from the registry and all kept (`sources/librsvg-compiled.txt`).
- `libvips/sources/manifest.tsv`: the 37 downloads the recipe made, each with
  sha256, size and URL; the files are in the `margin-libvips-sources-<commit>`
  artifact. One URL is a moving branch (`THIRD-PARTY-NOTICES.md` from `main`);
  its fetched bytes are kept.
- `libvips/replace/`, `replace-check.log`: the rebuilt `libvips-cpp.8.17.3.dylib`
  (arm64, install name `@rpath/libvips-cpp.8.17.3.dylib`) exports all 200 symbols
  sharp imports from the shipped one. Copied into the temp app, the signature fails
  verification until `codesign --force --deep --sign -`, then passes. sharp's PNG,
  WebP and SVG output is identical before and after, and dyld loaded the shipped
  library's UUID `52C60631…` before and the rebuilt one's `57E6BFB0…` after. The
  rebuilt dylib's sha256 `64bcfea7…` is the same as in run 37870671533; the
  tarballs differ only in archive metadata.

The package still ships the upstream prebuilt libvips (sha256 `ad39fe2d…`).
Shipping the rebuild instead is a decision left to the user.
