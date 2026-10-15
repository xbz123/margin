# S45 native macOS quit repair

2026-10-15. Base `2ca67bea`; user requested the repair after diagnosis.

## Failure and scope

An OS-native termination request could close all windows without ending the
process. The existing two-pass `before-quit` handler prevented the first quit,
awaited audio cleanup, then immediately called `app.quit()` from a Promise
continuation. The resulting native-quit ordering ended at `window-all-closed`,
not `will-quit` / `quit`. Reopening the surviving process created new windows
but retained the permanently closed generation service: `Application quit`.

Isolated diagnosis reproduced this twice using the installed S45 asar and
`NSRunningApplication.terminate` targeted by the newly launched child's PID.
Reactivation and a synthetic credential reproduced the exact connection-test
error, with zero unexpected guard events. Deferring the second quit to the
next event-loop turn exited normally in two controls. This does not prove the
private implementation of System Settings' permission/relaunch button; no TCC
settings, real credentials, devices or model services were accessed by the tests.

## Repair and regression

`electron/main.ts` schedules the second quit with `setImmediate`. Audio cleanup,
meeting persistence and terminal credential scrubbing stay intact. Production
does not force termination or reopen a scrubbed service.

The existing startup test file adds a macOS native-termination case. It must
reach `will-quit` and `quit` and exit 0, not merely lose its windows. Its external
request targets only the guarded child PID; failure cleanup likewise affects
only that child. The startup gate and `test:margin` allow `osascript` for this
test. No dependencies or native code were changed.

- [Red run](red/summary.json): old production build, native quit fails after
  two `before-quit` events followed by `window-all-closed`; internal quit passes.
- [Green run](green/summary.json): rebuilt production fix, both tests pass;
  native quit reaches `will-quit` / `quit`, exit 0 with no terminating signal.
- New skip: this native AppKit test is macOS-only; no existing test was removed
  or skipped, and both cases execute on the macOS gate target.

Independent read-only review (`gpt-6.1-sol`, high) found no actionable defects
in the production change, callers, isolation boundary or red/green evidence.
It did not run tests or the real application.

The first [full run](gates/summary.json) passed 15/16 gates: all 1187 unit tests,
21 answer regressions, 2 storage cases, both startup cases and 13 mounted UI
cases passed. Provenance alone failed on 16 unchanged lines in older tests.
The current pool has 644185 restricted keys. Blame and every surrounding
occurrence were reviewed; only three generic exact statements were registered
in the existing configuration (see PROVENANCE). An independent read-only
follow-up confirmed all 16 occurrences and the narrow registration scope.

The [final full run](final-gates/summary.json) passed **16/16**, with 133 unit
files / 1187 tests, 1187 passed, zero failures or skips. Answer regression
21/21, storage 2/2, startup 2/2 and mounted renderer 13/13 all passed.
`git diff --check` and the Wayfinder budget check passed. This was a working-tree
run over the recorded base, not a claim of clean-commit remote CI.

Delivery targets the existing private branch. Public push / ordinary CI remain
pending: the branch also contains three previously private document/publication
manifest commits; publishing those is a separate disclosure decision. No stage
exit packaging workflow or release was requested.

The installed app has not been replaced. This repair does not close the separate first-launch CoreAudio or
authorization-delay investigation, nor constitute stage-6 user acceptance.
