# AG-25 non-distributing inventory diagnostic (S17)

The user approved bringing forward the CI package-content diagnostic while
AG-26's license closure remains incomplete. This is not full AG-25 acceptance.

Scope: assemble a development-identity package only on CI, inventory actual
asar/unpacked/Resources/Frameworks content, record the unchanged normal license
check's result, and stop before signing or publishing. Upload only explicit
text/JSON diagnostic reports and logs, not application or native binary artifacts.
Nothing in this diagnostic permits a local application build, native rebuild,
formal Margin launch, dependency removal or feature change.

Success of evidence collection is distinct from acceptance: even when the
diagnostic process exits zero, its report must retain `acceptance: false` and
the normal license-check result. Unexpected builder/collection failure remains
a diagnostic failure. Source checkpoints enable reproducible CI inspection;
they are not a declaration that AG-26 or the stage-2 exit passed.

## Local checkpoint checks

The frozen diagnostic implementation passed all 16 local gate steps with real
zero exit codes: 114 test files, 880 tests, 875 passes, zero failures and five
existing skips. AG-09 passed 6/6, storage 5/5, startup 1/1 and outbound renderer
1/1. The seven new synthetic cases also have a separate target log under
`checks/`. The initial provenance failure is preserved; eight exact generic
lines were individually explained without widening pools or excluded paths.
Normal license rejection is unchanged. No application package was built locally.

This checkpoint also includes the previously uncommitted AG-26 implementation
and its evidence as prerequisites. It does not complete that ticket: its offline
collector and normal package hook still reject unresolved notices.

## First CI attempt

Checkpoint `c49fb86d` was pushed and dispatched as run `37824733686` with
`package_inventory=true`, explicit `gate_ref=docs/margin/evidence/AG-25` and
`no_cache=false`. Only provenance failed; the other 15 gates, clean installation
and native setup passed. The package step was skipped. Its verified raw evidence
is in `../CI-37824733686/`. A local refresh of the same upstream reference
prefixes reproduced the six matches, and the two exact standard/generic strings
were documented. `checks/fresh-pool-red/` and `fresh-pool-green/` retain both
verdicts. No application or diagnostic logic changed in that source-review fix.

Further CI results will be recorded after verification. Actual
static-library composition, complete notices/source obligations, dual-identity
packaging, signatures, verified download and isolated temp-package startup are
still pending. Claude's independent read-only stage review is also pending.
