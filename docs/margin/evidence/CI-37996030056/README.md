# CI 37996030056: packaging after the stage 2 acceptance fixes

Commit `cd71f14b` (the Astra fixes `cdb16ef9` and later records), dispatched
2026-10-09 in the private `xbz123/Assessment-Assistant` on `macos-15` with
`no_cache=true` and `package_apps=true`, after the 8 artifacts of run 37944613051
were deleted at the user's request. `job-proof.json` has the run, every step's
conclusion and every artifact's size and API digest.

- **libvips**: success, 9.7 min. The rebuild is `64bcfea7…`, UUID
  `57E6BFB0-8E4E-3F1F-A3AB-1DD593CAC71C`, as in the earlier rebuilds; no drift
  from the recorded sources.
- **gates**: success, 8.4 min.
- **libvips-replace**: not started. GitHub: "The job was not started because
  recent account payments have failed or your spending limit needs to be
  increased." No step ran. The replacement check for the fixed code ran in the
  public repository instead (`../CI-38000301350/`, `../CI-38004311007/`, PLAN S25).

## gates job

- Native module compiled from scratch (`native/BUILD-INFO.txt`: rustc 1.98.1,
  Xcode 16.4, `cidre compiled in this run: 1`). `.node` sha256 `71f9cf8e…`, the
  same as the earlier cache-free runs; `native/link-set.json` is byte-identical to
  run 37944613051's.
- `gates/`: 16/16 exit 0 on a clean tree against AG-26; 111 files, 853 tests,
  847 pass, 0 fail, 6 existing skips; AG-09 6/6, storage 5/5, startup 1/1,
  outbound renderer 2/2, guard self-test 12/12. Release identity contract 6/6.
- `packaging/temp/`, `packaging/release/`: both identities built, every
  `package-check.cjs` check passes (13 of 13, including `libvips-rebuilt`; 38,798
  entries scanned, 21 Mach-O files, 1,316 notice references), and both packaged
  binaries launched in a throwaway HOME (`launch.json`).
- `source/`: `MANIFEST.json` of the source bundle, 592 files, `cleanTree` true.

## Local checks

Downloaded and checked on this machine (`../AG-25/local-verify/`, where the
temp package and source reports have since been replaced by those of run
38004311007; the release reports are still this run's): every
BUILD-INFO sha256 and commit; the source bundle (592 files, app archive equal to
`git archive` of `cd71f14b`); the libvips sources (37 downloads, 184 crates); both
packages with `package-check.cjs`, `plutil` and `codesign` (same result as CI);
`asar-smoke` and `sharp-smoke-local` (exit 0, the package's rebuilt libvips
loaded). The packaged `navigationPolicy.js` is byte-identical to a local build of
the same source: the window-open and navigation handlers only refuse, and the
preload carries the trusted-click listener and the user-activation check. The
release identity was only inspected, never launched; its zip and unzipped copy
were deleted after the check.

## Artifacts

Private workflow artifacts in `xbz123/Assessment-Assistant`, about 1.05 GB; the
app zips expire on 2026-10-23, the others on 2026-11-08.
