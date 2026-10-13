# AG-62 setup guidance and documentation — partial ticket

2026-10-13. Source baseline `ffc08ab1` plus the AG-62 working diff. This record
covers onboarding and documentation only. The formal-identity restriction and
Mac packaging remain awaiting explicit decisions; neither the whole ticket nor
phase 6 is signed off by completing this slice.

## Implemented scope

- An inline Launcher checklist reads only existing local configuration metadata:
  the selected answer source/model, selected STT provider and reported system
  permissions. It does not use another provider's key to mark the selected one
  configured, inspect Codex auth files, test connections or start capture.
- Configured, missing and unknown states stay distinct from actual service/device
  verification. Bailian allows blank Workspace ID; Doubao retains the selected
  resource. Codex requires enabled configuration and current risk confirmation.
  Non-macOS placeholder permission replies are not presented as verification.
- Existing settings and permission-review entry points are reused. Context and
  Skills are optional. The checklist is non-blocking, can be hidden/reopened,
  refreshes after settings/focus/configuration changes and drops stale reads.
- Active meetings stop checklist listeners. Starting a meeting dismisses pending
  or visible permission guidance; late closed/replaced card replies are ignored.
- README/PRIVACY now describe retained manual actions, timing/retry behavior,
  local records without automatic summaries, the five STT providers, prompt-only
  Skills/Local Context transmission and the actual Codex file-login source.
  They explicitly retain unverified sharing/real-service boundaries and the
  current development/formal-identity restrictions.

## Review and verification

One implementation worker owned the UI and narrow tests; the main agent owned
documentation, independent review and integration. No parallel source writers,
dependency, native, asset, IPC framework, packaging or release changes were made.

The main agent checked the real metadata getters, selected-provider decisions,
all callers, cleanup, permission-card timing and documentation against current
source. Reader tests pass **11/11**. Two mounted Electron checks pass **2/2**:
actual Launcher/settings navigation/refresh and actual App/permission guidance
cancellation, including late replies, language changes and forbidden action probes.
Their initial fixture failures were the Start button's image-inclusive accessible
name and missing loaders for existing App assets. Fixtures were corrected, not
product assertions weakened. README/PRIVACY local links resolve.

Final complete local gates pass **16/16**, every exit code 0: **132 files,
1161/1161 tests, zero failures and zero skips**. Answer regression passes 21/21,
storage 2/2, startup 1/1 and the complete outbound-renderer suite 12/12. S42
required-evidence validation passes; G2 has zero unreviewed matches after ten
individually reviewed ordinary statements were recorded. Source pools, path
exclusions and isolation policy are unchanged. Generated evidence prefixes are
normalized for publication without changing outcomes or counts.

The main-agent software review has no remaining blocker within this slice.
Submission and public ordinary CI are pending. No result here is a real account,
credential store, device, permission-prompt or sharing test.

## Remaining authorization

- Decide how to remove the formal identity's GitHub-Actions-only restriction and
  when, if ever, to run that identity locally without touching the installed app.
- Approve the separate phase-6 packaging/exit CI and subsequent artifact checks.
- Actual sharing receiver checks, icon visual design, release architecture,
  real-service budget, installation and publication remain outside this slice.

No verified Chrome/Zoom/Tencent Meeting/Feishu compatibility row is invented.
Black replacement frames remain unacceptable. Mock protection success is not
proof that a real sharing receiver cannot see the assistant.
