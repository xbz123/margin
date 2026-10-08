# AG-22 transactional credential saves

Implementation and final local/CI gates passed on source `2db88817`;
[CI 37767107984](../CI-37767107984/README.md) raw evidence was verified.
Claude's read-only review remains pending. No real keychain, provider or device
acceptance is claimed.

All 22 setters persist an encrypted candidate before replacing memory. Failed
encryption, write or rename preserves the prior state. Unread ciphertext locks
writes until a successful reload. Plaintext is never used as a fallback; no
retained feature depending on such a fallback was found.

Save IPC, preload and renderer consumers use the same discriminated result.
`ok` describes persistence; a subsequent runtime apply failure is a warning,
not a fictitious write failure. File-picker cancellation stays separate.
Behavior checks cover the actual manager-to-renderer chain and failure-side
effects, including model fetch/selection and all retained STT providers.

`checks/precommit-2/` contains 15 actual exit-zero steps: 107 test files,
799 tests, 794 pass, 0 fail and 5 existing skips; AG-09 6/6, storage 5/5,
startup 1/1. No unfinished test files or isolation blocks were reported.
The root summary and four reference files are unchanged copies from that run;
its log paths still point into `checks/precommit-2/`. This precommit run records
the dirty paths over `76d44ad4`, not a clean committed source tree.

`checks/precommit-1/` is retained: its regression/storage failures came from
four harness preconditions still expecting `success` instead of `ok`. They now
require exactly `{ ok: true }`, without accepting warnings or the old contract.
The complete rerun passed. Earlier credential/provenance red evidence is also
retained; exact scanner allowances are documented in PROVENANCE.

Dependencies were unchanged. X2 guards, synthetic HOME and mock keychain remained
enabled; only the temp identity ran locally. Packaging remains AG-25, and
continued implementation does not imply Claude review or stage-exit acceptance.
