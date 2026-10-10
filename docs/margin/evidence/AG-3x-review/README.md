# Stage 3 review fixes — W2

Starting commit: `832e5777`. R3-1, R3-2 and R3-5 are implemented and full local
gates pass. The code commit's Windows gate and Claude closure remain pending;
this is not phase-exit acceptance.

## Local result

`summary.json` records one full 16/16 passing run: 113 unit files, 981 tests,
976 passed, zero failed and five existing skips. No file is unfinished and no
isolation-blocked attempt or unexplained exit is recorded. AG-09 passes 16/16,
storage 5/5, startup 1/1 and renderer checks 5/5. G2 has zero hits with unchanged
approved sources and allowlist; all 261 retirement rules pass. Builds, both
typechecks and IPC/preload contracts pass. The 13 implementation/test file hashes
in `targeted/10-frozen-source-inspection.log` were checked again after the gates
and are unchanged.

The real preload R3-1 regression rejects a new origin without a re-entered key,
returns the actionable message, preserves stored/default/backup/current-target
state and key availability, and sends no extra request to the mock server.
Targeted transaction checks additionally cover explicit same-byte re-entry,
scheme/port changes, custom-to-official changes, equivalent normalized origins,
environment/development effective targets and failed atomic saves.

Image handler checks cover selected queue rejection before optimization or
generation, canonical paths for legitimate symlinks, malformed explicit input,
explicit-image precedence, empty queue and WhatToSay's existing no-fallback
behavior. Legacy privacy tests retain the screenshot ban and other settings
through successful migration, write failure, rename failure and restart.

`targeted/test-map.md` maps the six removed dead-method test instances to three
checks on the retained `generateContent` entry. Their refusal, zero-send,
positive-send and no-backup assertions remain. The new checks plus this
deduplication explain the unit count change from 972 to 981; no skip was added.
Published evidence mechanically normalizes machine-specific paths only. Raw
output remains archived locally; outcomes, errors and counts are preserved.

## Red and intermediate evidence

- `targeted/01-red.*`: exit 1, 56 tests / 51 passed / five expected failures
  (three origin/key controls and two queue-path controls).
- `targeted/03-green-targeted.*`: exit 1, 136 tests / 135 passed. An old fixture
  attempted to change origin and clear its key together. It now explicitly
  supplies a synthetic key for the changed origin, then clears it on the same
  origin. The existing no-environment-key-fallback assertion is unchanged.
- `targeted/06-green-targeted.*`: exit 0, 136/136. Electron and renderer builds
  and typechecks also pass. The renderer retains its existing large-chunk warning.
- `targeted/08-migration-stage-proof.*`: exit 0, 12/12, including the six privacy
  migration cases. Temporary-file assertions distinguish write from rename
  failures. This narrows evidence; it is not another implementation change.
- The added preload case was only syntax-checked in the targeted run; its actual
  Electron execution is in the full `regression.log`, not claimed from syntax.

## Approved scope

- R3-1 / PLAN S31 option A: compare old and new effective provider origins in
  the main-process save transaction. A changed origin requires a nonempty key
  explicitly supplied with the update. Re-entry may use the same key bytes;
  this is an explicit destination decision, not a demand for key rotation.
  Rejection or storage failure must preserve stored and live configuration.
- R3-2: select explicit images or the existing queue fallback first, then
  validate once and pass only the returned canonical paths. Malformed explicit
  input must not escape validation through fallback. Preserve each entry's
  existing no-image behavior; do not introduce a new screenshot source.
- R3-5: remove the unconsumed screen-understanding mode interface and the two
  generation methods without production callers. Preserve legacy
  `private`/`private_vision` conversion to `providerDataScopes.screenshots=false`.
  Removed tests need an explicit mapping to retired behavior or retained safety
  checks on live entry points.

R3-3 remains Windows functional work for phase 7. R3-4 does not change protocol
serialization in this ticket. Dependencies, native modules, libvips, packaging,
prompt text and workflows are outside this repair scope.

## Verification boundary

All application checks use synthetic credentials and image files under X2.
G7 reuses accepted installation evidence
while dependencies/native inputs remain unchanged. S31 additionally requires
the code commit's automatic public-repository Windows compile check to pass.

No real model, login, keychain, capture device, installation or local native
rebuild is included. The macOS package-apps exit CI is W3, not part of this W2
run, and still requires the planned separate approval. Claude verifies closure
after implementation; this record must not stand in for that review.
