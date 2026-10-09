# Local CI equivalent on `9af26551`

Claude, 2026-10-09, at the user's request ("在本地跑 CI，说明缺失什么内容"). The
steps of `.github/workflows/margin-gates.yml` that this machine may run were run
on a clean clone of the pushed HEAD in the session scratchpad. The worktree, the
original repository and the installed Margin were not touched. No CI run was
started.

## What ran

| CI step | Local | Result |
| --- | --- | --- |
| checkout (fetch-depth 0) | `git clone --no-local` of the worktree; HEAD `9af26551` | ok |
| upstream refs, extra restricted commits | same `git fetch` from GitHub, read-only, no token; 123 upstream refs | ok |
| toolchain versions | node 26.0.0 and npm 11.12.1 as on CI; `xcodebuild` fails (Command Line Tools only); no rustup; Homebrew rustc/cargo 1.98.1 | see below |
| `npm ci` | same, with the repository `.npmrc` (`ignore-scripts=true`); 1,128 packages | ok |
| `npm run setup:native` | steps 1, 2, 3 and 5 of `scripts/margin/setup-native.mjs` (Electron 43.1.0 binary from the local Electron cache, sharp check, better-sqlite3 and keytar rebuilt for Electron, dev Info.plist). Step 4 replaced, see below | ok |
| run-gates against the newest `AG-NN` evidence | same command and reference (`AG-26`) | 16/16 exit 0, 0 uncommitted paths |

Gate results (`gates/`): 111 files, 853 unit tests, 847 pass, 0 fail, 6 existing
skips; AG-09 regression 6/6, storage 5/5, startup 1/1, outbound renderer 2/2,
guard self-test 12/12. Step logs are in `steps/`.

The first gate run (`gates-first-failed/`) failed every step that launches
Electron (`node_modules/electron/path.txt` missing): `npm ci` runs no install
scripts, and on CI the Electron binary comes from `setup:native`, which had not
been run yet. After the setup steps above, the gates were run again.

## What is missing compared with CI

The last full CI run is 37944613051 on `ba9279fa`. Since then `electron/preload.ts`
and `electron/services/navigationPolicy.ts` changed (stage 2 acceptance fixes),
so the packaged app differs; `native-module/` and the libvips recipe and records
did not change.

1. **Native module from scratch.** Step 4 of `setup:native` (cargo build,
   `Compiling cidre`), the linker map, `link-set.json` and the native BUILD-INFO
   are not produced here: the machine has no Xcode and no rustup, and S11 item 5
   keeps local work on the CI-built module. The clone uses the module of run
   37944613051 (sha256 `71f9cf8e…`, matching that run's BUILD-INFO);
   `native-module/` is unchanged between `ba9279fa` and `9af26551`. The pinned
   toolchain (`rust-toolchain.toml` via rustup) is not installed.
2. **better-sqlite3 and keytar** were compiled with the Command Line Tools and the
   libc++ header workaround in `setup-native.mjs`, not with Xcode 16.4 as on CI.
   The Electron binary came from the local Electron download cache.
3. **Release identity contract** (`MARGIN_APP_VARIANT=release` build and
   `appIdentity.test.mjs`): not run. The release identity runs only on CI (S15).
4. **Packaging** of the temp and release apps (`scripts/build-local.cjs`, which
   refuses to run outside GitHub Actions), the package checks (Info.plist, no
   update config, forbidden content, Mach-O architectures, signature, notices,
   `libvips-rebuilt`) and the zips: not run (S11).
5. **Packaged launch** of both apps in a throwaway HOME: not run. The packaged
   binary is not launched on this machine (S9: its first launch asks for Screen
   Recording permission; S15 for the release identity).
6. **Rebuilt libvips installed before packaging** (`install-rebuilt.mjs`, CI only):
   not run; the clone's `node_modules` has the npm prebuilt. The gates do not
   depend on it.
7. **Corresponding source bundle** (`scripts/margin/source-bundle.mjs`, GitHub
   Actions only): not produced.
8. **libvips job** (`rebuild.sh`, GitHub Actions only; needs Xcode, meson, automake
   and nasm) with its drift checks and the libvips sources: not run.
9. **libvips-replace job** (`replace-check.sh`, GitHub Actions only; needs the
   packaged temp app): not run.
10. **Workflow artifacts** and the package inventory diagnostic: not applicable.

Items 3–9 are the evidence a CI run with `package_apps=true` would add for
`9af26551`; item 1 is what `no_cache=true` would add.
