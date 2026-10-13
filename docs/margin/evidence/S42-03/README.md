# S42-03 manual speech snapshot acceptance

2026-10-13; source baseline `e7d9aaa9` plus this ticket. Claude Opus 5.5 medium
implemented the ticket and review repairs. After its confirmed session quota
limit, Astra completed the remaining regression coverage. The main agent
independently reviewed the source and actual IPC/request consumers, repaired
collector/batch/cancellation defects, and ran the final acceptance gates.

Manual interview actions now share a main-owned action and two-channel speech
snapshot. The actual IPC receipt ends the first stage within 750 ms; pending or
unknown speech gets at most 3 seconds afterward, and proven final/no-pending
speech at most 1 second. Both channels run in parallel, freeze independently,
and retain only eligible same-fragment revisions. The original generation
budget includes this wait. Provider final, task completion, unknown state and
connection closure are not interchangeable. Aliyun/Doubao manual actions do not
finish their ongoing recognition tasks; meeting shutdown remains separate.

Answer creates a sender-owned dictation mark; Stop freezes its question and
both channels without waiting indefinitely for Answer's reply. Cancel,
supersession, window destruction, connection epochs and capacity limits have
explicit behavior. REST batches own copied pre-cut input and cannot absorb
later audio when the queue fills. Their timestamps describe application
ingress, not hardware capture precision. A dictation that cannot be recovered
whole from the bounded ledger fails explicitly rather than silently truncating.

The base conversation is copied at the action boundary. Delayed begin cannot
import a later coding question or a post-deadline revision through live context;
unavailable older text is conservatively omitted. Every frozen shortcut and
Stop filters denied assistant history and carries allowed history's data scope
through actual sends, queue waits and automatic retries. Existing image and
Local Context boundaries remain in force.

## Evidence

- Final complete local gates: **16/16**, all exit 0 (`summary.json`).
- Unit inventory: **127 files, 1075 tests; 1074 pass, 0 fail, 1 existing skip**
  (`tests.files.json`). The skip is the pre-existing AG-61 activation-policy check.
- Main-agent independent counterexamples: **9/9** after repairs; these cover
  unknown vs settled waits, independent freezing, late continuation, abort,
  bounded ledger/REST queue, cancellation ownership, delayed coding state and
  denied-history egress. Their durable coverage is in the existing test files.
- The required-evidence checker passes for all 15 designated files and the
  guarded renderer step. Image-path validation is included and passes **12/12**.
- G2: zero unreviewed hits. Twenty-six exact generic statements were reviewed
  and recorded individually; no source pool or excluded path was broadened.
- Guarded answer regression, storage, startup and renderer checks all pass.

The first full gate attempt is retained in `attempt-1/`: its unit step failed
because the image-path fixture lacked the new scope wrapper and view getters.
The fixture was updated without relaxing any image/security assertion, then
12/12 targeted checks and the full gates passed. Earlier partial test counts
and initial failed independent probes do not establish final acceptance.
Generated evidence normalizes machine-specific repository/account/temp/Node paths.

Public CI is pending this ticket's commit and push. Local acceptance is not
product sign-off or release approval. Real STT/LLM services, hardware capture,
shared-screen protection, answer quality and latency have not been tested.
Actual UI-first-text observation and manual retry snapshots remain S42-04.
