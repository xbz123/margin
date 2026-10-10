# AG-31 — four protocols and explicit compatible targets

Starting commit: `bcd7ebf5fb2c7a68ded818c616cd9bb786553819` on
`codex/margin-agpl-migration`. This is ticket evidence, not phase-3 exit or
independent-review approval.

## Scope

The retained five credential slots now bind provider, protocol, API base and
model explicitly. OpenAI supports Chat Completions or Responses; Groq and
DeepSeek use Chat, Claude uses Messages, and Gemini retains its protocol.
Unknown model names are not routed by prefix. Qualified selector IDs distinguish
provider/protocol identity from the unchanged wire model ID.

The complete configuration and optional new key are one encrypted transaction.
Failed persistence leaves the previous runtime unchanged. Explicit Save replaces
partial-key auto-save. Test/model-list actions use the saved target, not an
unsaved key with an old endpoint. Startup, hot configuration and default-model
selection share this contract. Custom targets do not receive official discovery
requests, default-model rotation, or unconfirmed provider-specific cache options.

All four protocols reach `generateOnce`; its results distinguish complete,
incomplete, refused, empty, failed and cancelled. Responses uses instructions,
input blocks and `store: false`. Messages requires a stop reason and message-stop
event. SDK internal retries are disabled. Request scopes are checked immediately
before sends, and cancellation suppresses late content. Existing application
retry/fast-mode policy remains until AG-32.

OpenAI-only meeting summaries are exercised with synthetic Responses replies.
Gemini cache clear cannot be undone by an older in-flight create. Existing
env-only keys remain usable, but unreadable credential storage or an explicitly
saved slot without a key cannot silently borrow an env key.

## Checks and retained failures

`provenance-initial/` records 16 matches for 12 exact generic statements, exit 1.
The reviewed statements are registered in `../../provenance-config.json`; no
source pool or path exclusion was enlarged. See `../../PROVENANCE.md` for the
requirements reference and fetched official OpenAI documentation.

`gates-first/` is intentionally failed evidence:

- 14/16 steps passed. Unit tests: 892 total, 886 passed, 1 failed, 5 existing
  skips. The failure was the outbound construction-site inventory, whose counts
  still described the old constructors/direct connection-test requests.
- Storage: 1/5 passed. The new generic Chat client misinterpreted the existing
  `GROQ_BASE_URL` host-root convention, sending to `/chat/completions` instead of
  `/openai/v1/chat/completions`; summary/title requests missed the mock route.
  This also prevented dependent stored-meeting checks from completing.
- AG-09, including the new real renderer/preload/IPC opaque-target case, passed
  7/7. Startup 1/1 and renderer outbound 2/2 passed. Builds, typechecks,
  provenance, retirement, preload/IPC contracts and guard selftests passed.

`gates-final/` records 15/16 passing steps on the repaired application: 112 unit
test files, 895 tests, 890 passed, zero failed and five existing skips; no
isolation-blocked tests. AG-09 passed 7/7, startup 1/1 and renderer outbound 2/2.
Both typechecks, build, provenance, retirement, contracts and guard checks passed.
Storage passed 3/5: its model assertion still expected the old raw ID rather
than the qualified selector ID; the dependent recovery case then also failed.

Only that assertion was corrected. `storage-final/` reruns storage on the same
application build: 5/5 passed, with diff-check also exit 0. Thus all required
checks have passing evidence across these runs, not a single 16/16 final run.
The original mock server, routes and remaining assertions were not relaxed.
`targeted/` retains implementation checks, including the final 180/180 targeted
tests and earlier failed attempts. No new skip was added.

Published logs mechanically replace machine-specific paths with `<repo>` or
`<temporary-path>` and normalize the Node executable path. Test status, counts,
errors and exit codes are unchanged; raw copies are retained locally.

## S27 replacements

The two `ScopeLocalFallback` SDK send-syntax tests and their private AST helper
are removed after moving those sends. `multiProtocolGeneration.test.mjs` now
checks each protocol's final scope/cancel guard, exact local HTTP request counts,
503 no-retry and 307 no-forward behavior, real terminal/refusal events and
transport cancellation. Existing consumer-level limiter/cache/backoff/rotation
revocation tests remain. Successful fixtures now supply real finish reasons;
production does not fabricate a terminal event for missing metadata.

Credential transaction tests cover the new setter, failed save without runtime
update, restart, active default protocol/model changes and env-only/recovery
states. The AG-09 addition saves through real preload, reads back configuration,
selects an opaque model, types a UI question and verifies the actual wire model.
It restores synthetic settings afterward.

## Boundaries

No dependency, lockfile, native code, prompt text or real credential is changed.
G7 reuses accepted installation evidence; no CI is dispatched for this ticket.
All executable checks use X2, synthetic credentials/devices and loopback services.
Compatibility with arbitrary remote endpoints and model output quality are not
claimed. AG-32 scheduling, AG-33 answer UI/image capability and AG-34 Codex login
remain separate work. Independent review is pending.
