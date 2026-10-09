# S24: native module built from scratch on this machine

Claude, 2026-10-09 (PLAN S24). Xcode 16.4 (16F6, the CI version) at
`/Applications/Xcode-16.4.app`, used through `DEVELOPER_DIR` only; the system
developer directory stays the Command Line Tools. Rust 1.98.1 from rustup
(Homebrew `rustup`, keg-only) as pinned by `native-module/rust-toolchain.toml`.
macOS 26.6.2. Everything ran in a fresh clone of the pushed HEAD in the session
scratchpad (no `native-module/target`), mirroring the CI gates job: upstream refs
fetched read-only from GitHub, `npm ci`, the full `npm run setup:native`, the
collect step, then the 16 gates. The worktree's native module (the verified CI
build `71f9cf8e…`) was not replaced.

## Runs

1. **`attempt1-no-first-launch/`** (`98d1cf0f`): cidre's build script failed.
   `xcodebuild` could not load its simulator plug-in because
   `/Library/Developer/PrivateFrameworks/CoreSimulator.framework` was missing;
   it asks for `xcodebuild -runFirstLaunch`. The gates then failed in guard
   self-test (no native module) and provenance, see below.
2. The user ran `xcodebuild -runFirstLaunch` with admin rights. **`conda-path/`**
   (`06751c95`): `setup:native` passed, `Compiling cidre v0.11.10`, release build
   in 45 s; the gates passed. The module (`ea4673ac…`, 1,156,720 bytes) had been
   re-signed with a "fake signature" by `cctools-port`. The shell PATH puts
   anaconda's `otool`, `install_name_tool` and `ld` before `/usr/bin`, and
   `scripts/build-native.js` runs `install_name_tool -change` on the module's own
   install name, which Apple's tool leaves untouched.
3. **`clean-path/`**: only the native module again from scratch, with PATH limited
   to rustup, Homebrew and the system tools (`tools.txt`). Module `44377f02…`,
   1,150,760 bytes, linker-signed ad hoc as on CI. **`gates/`**: 16/16 exit 0 on a
   clean tree with this module; 111 files, 853 tests, 847 pass, 0 fail, 6 existing
   skips; AG-09 6/6, storage 5/5, startup 1/1, outbound renderer 2/2, guard
   self-test 12/12; provenance 0 hits against the freshly fetched upstream.

## Comparison with CI 37944613051 (`compare/08-compare-normalized.log`)

| | CI (`ba9279fa`, macOS 15 runner) | local, clean PATH |
| --- | --- | --- |
| sha256 | `71f9cf8e…` | `44377f02…` |
| size | 1,150,760 | 1,150,760 |
| signature | ad hoc, linker-signed, sha256 | same |
| exported symbols | 1 | identical |
| strings, build paths replaced by placeholders | | identical |
| linked crates, sysroot and system libraries (`link-set.json` without byte counts) | | identical |

`native-module/` is unchanged between `ba9279fa` and `06751c95`. The bytes still
differ, for two reasons that a build on another machine cannot remove:

- **Build paths are embedded.** 23 cargo registry paths (`/Users/runner/.cargo/…`
  on CI, `/Users/mac/.cargo/…` here; 3 bytes shorter each, so `__cstring` is 69
  bytes smaller) and the module's own install name, which is the absolute
  `target/…/libnatively_audio.dylib` path of the build directory. The build sets
  no `--remap-path-prefix`.
- **The host macOS is recorded.** cidre links `MobileDevice.framework` from
  `/System/Library/PrivateFrameworks` of the running system, not from the SDK, so
  the load command records that system's version: 1818.13.1 on the CI runner,
  1827.120.2 here. Byte-identical output needs the same macOS build as the runner.

The linker map's dead and live byte counts differ by a few bytes per object for
the same reason; the set of inputs is the same.

## Other native modules

better-sqlite3 and keytar were compiled with Xcode 16.4 here
(`steps/06-compare.log`), not with the Command Line Tools workaround of the
earlier local setup.

## Provenance finding

The first fresh fetch found one new hit: upstream main added
`const bytes = fs.readFileSync(file);` in a test on 2026-10-10, a line
`scripts/margin/package-inventory.cjs` has had since `c49fb86d` (2026-10-08). It is
allowlisted in `06751c95`; the next CI run would have failed on it.
