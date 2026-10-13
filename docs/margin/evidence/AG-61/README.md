# AG-61 window preferences and shortcuts

2026-10-13. Baseline `968ea59d` plus the AG-61 working diff. This is a ticket
record, not phase-6 exit, real-machine acceptance or permission to release.

## Scope

- Validate incoming protection, passthrough, disguise and shortcut values before
  side effects. Persist protection/disguise/keybind candidates atomically before
  changing runtime state; failed writes retain old memory and disk state.
- Distinguish saved preference from successful native application. Report
  `save_failed`/`apply_failed`, retain saved preferences after partial application,
  hide failed protected windows and permit same-value application retries.
- Preserve inactive Settings creation/recreation, independent session-only mouse
  passthrough and the existing Dock policy. Reuse the current platform icons and
  apply current window identity to all five window kinds.
- Reconcile actual renderer controls through authoritative results; stale replies
  cannot override newer broadcasts. Shortcut conflicts and health-check failures
  are visible inline for all affected actions, without creating an extra popup.

## Review and checks so far

A single `gpt-6.1-sol` worker implemented the bounded ticket after the previously
recorded Claude quota exhaustion. The main agent reviewed the diff and consumers,
owned documentation and ran the mounted Electron check; there were no concurrent
source writers. After delivery, the main agent took over the final repairs.

The main agent reproduced two additional failures before fixing them:

1. A same-value protection request invalidated the deferred blur-guard release,
   leaving Settings unable to close on normal outside clicks. The retained
   500 ms grace period now owns its timer independently of preference revisions.
2. Healthy OS shortcut registrations cleared a menu/update application error that
   had not recovered. Those failures remain visible until the corresponding full
   application succeeds; a mere registration health check is not that proof.

The production AppState group passes 13/13 and the persistence/keybind group
passes 7/7 after those repairs. The independent mounted test passes 1/1 and uses
actual SettingsOverlay, SettingsPopup, Launcher and NativelyInterface components
with their real hooks and synthetic IPC. Initial harness failures concerned
missing build constants/styles/configuration substitutes; no product assertion
was weakened. One native-glob attempt was rejected by the existing isolation
guard; the test now uses an allowed non-recursive read of the exact asset
directory. Guard policy is unchanged.

The old `ActivationPolicyOrdering` skip is replaced by actual initializer tests
for protected and normal startup. No accessory/regular activation policy was
introduced. New tests use existing discovery globs and CI steps; no new test
framework or runner is added.

## Final local acceptance

- Complete gates **16/16**, every exit code 0; see `summary.json`.
- **131 files, 1150 tests, 1150 pass, 0 fail, 0 skipped**.
- Answer regression **21/21**, storage **2/2**, startup **1/1** and the complete
  outbound-renderer suite **10/10**. S42 required-evidence validation passes.
- G2 has zero unreviewed matches. Seven exact ordinary statements are registered
  with individual reasons; source pools and path exclusions are unchanged.

The initial complete run failed G2 on the parent's ordinary `fail = false;`
fault reset and failed three unit checks: two existing identity/icon fixtures
needed the new production helper methods, and two accessible labels lacked
Chinese entries. The fixtures still assert the original identity, profile-path
and icon-path guarantees. Focused rechecks passed 3/3, then the full suite was
rerun successfully. Initial failures are retained in the working-run evidence;
they are not counted as passing results. Machine-specific prefixes in the final
generated logs are normalized without altering commands' outcomes or counts.

Local code acceptance is complete. Commit `ffc08ab1c92604992e116004f0a3b88f041cc0f3`
is pushed and verified on both repositories' migration branches. Public ticket
[CI 38472041728](https://github.com/xbz123/margin/actions/runs/38472041728)
completed successfully on that SHA with `gate_ref=docs/margin/evidence/AG-61`,
`no_cache=false`, `package_apps=false`. The downloaded gate artifact matches its
GitHub SHA-256 digest and the exact source commit: gates 16/16, 1150/1150 tests,
zero skips, required evidence passed and release identity contract 6/6. The job
API omitted step details; the artifact reports supply those checks. See
`ci-result.json`. Software ticket acceptance is complete; this does not sign off
the entire phase or real sharing behavior.

## Not verified

No real credentials, model/STT service, microphone, screen capture or sharing
receiver was used. Chrome, Zoom, Tencent Meeting and Feishu compatibility,
black-frame absence, real focus/IME and OS shortcut conflicts remain unverified.
Black replacement frames are not acceptable. Formal identity protection,
packaging, installation, visual icon redesign and release remain out of scope.
