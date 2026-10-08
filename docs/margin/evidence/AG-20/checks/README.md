# AG-20 precommit checks

These are development checks, not fixed-commit or CI acceptance.

- `precommit-1/`: non-GUI gates. Five exact-line provenance matches required
  individual explanation. Of 772 tests, one still read permission descriptions
  from `package.json` after they moved to the identity-aware builder config.
  The test was updated to inspect that config; its three field assertions remain.
- `precommit-2/`: complete local gates under X2. Unit tests passed (772 total,
  767 pass, 0 fail, 5 existing skips), answer regression and meeting storage passed.
  Startup failed at the log-path prefix assertion: Electron canonicalized the
  synthetic `/var` path to `/private/var`. A guarded comparison confirmed the
  actual and expected log files have identical real paths. The test now compares
  the canonical full expected path, not a string prefix, and retains both error
  probes.
- An independent guarded synthetic probe found that `fs.cpSync` of the parent
  Application Support directory could copy a protected `Margin/identity-sentinel`
  without a guard record. No real application data was used. The regression test
  reproduced this before the fix. A second synthetic probe found native recursive
  directory listing could follow a nested symlink to the same protected data.
  The guard now rejects ancestor-covering copies/removals/moves, cp dereferencing,
  native recursive directory operations and glob; ordinary directory creation and
  non-recursive queries remain available. This conservative test-only restriction
  avoids introducing a general recursive filesystem scanner.

No formal-identity application was launched locally. These checks do not prove
OS-wide or native-library filesystem isolation.
