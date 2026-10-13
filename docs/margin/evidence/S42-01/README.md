# S42-01 domestic speech configuration acceptance

2026-10-13; source baseline `a5b7c75a` plus this ticket. Claude Opus 5.5 medium
implemented the configuration slice in auto mode; the main agent independently
reviewed production callers, bridge types, persistence, UI and tests and repaired
the findings below. No real STT, credential, audio device or installed app used.

Delivered: Aliyun accepts an empty workspace and uses the fixed Beijing general
endpoint, while validated nonempty values select the dedicated endpoint. Doubao's
hourly/concurrent selection is saved and read without exposing its key, and the
same saved configuration reaches connection tests and meeting capture. Legacy
App ID authentication remains. No region/model/resource fallback or second pass.

Review and evidence:

- The original save path rejected explicit null, but the saved-config reader and
  adapter default silently mapped it to hourly. Added counterexamples failed
  2/20 before the undefined-only default repair, then 20/20 passed. Missing legacy
  fields still work. See `review-red.log`.
- The first full run found the stale outbound inventory. The exact approved
  DashScope origin and validated workspace expression are now recorded in the
  inventory and its test; no wildcard or network guard was weakened.
- The mounted settings test uses real React controls, extracted preload methods,
  production handlers/credential storage and mock providers. It checks save,
  reload, test, failed encryption retaining old values, invalid-resource refusal,
  deletion and no keys in IPC replies. Its module cache is restored afterwards.
- Final full local gates: **16/16 passed**, 988 tests (987 pass, 0 fail, 1 existing
  skip), plus 7/7 mounted renderer checks in the separate renderer gate. Typechecks,
  provenance, outbound inventory, guarded regression/storage/startup and required
  evidence checks pass. Exact commands and outcomes are in `summary.json`.
- G2 has zero unreviewed hits; three ordinary test idioms are individually recorded
  with reasons. No dependency, test skip or excluded-source expansion.

Generated evidence normalizes repository/account/temp prefixes and the Node binary
path for publication. Results and counts are unchanged. The existing workflow is
not changed by this ticket; it will run against this ticket's commit after push.

Not verified: real 3.1 model availability on the general endpoint, long-session
service behavior or paid-resource entitlement. Mock header/address correctness
does not establish these. Changing the saved resource still requires reentering
the key, preserving the existing explicit-key save rule.
