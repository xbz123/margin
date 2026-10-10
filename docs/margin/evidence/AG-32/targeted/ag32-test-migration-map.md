# AG32 test migration ledger

Baseline: 85cade1cb18a532b56cc30b12d76f8766f2110ae. This ledger distinguishes retained invariants, intentional new-contract behavior, and retired scheduling/telemetry behavior. The two deleted files contain **39 named leaf test calls: 30 + 9**. The previous summary's 31 + 9 = 40 was a counting error; do not use it as a verified baseline count.

Replacement aliases: GT = electron/llm/__tests__/generateTask.test.mjs; GI = electron/llm/__tests__/generationInterfaces.test.mjs; GO = electron/llm/__tests__/generateOnce.test.mjs; SL = electron/services/__tests__/ScopeLocalFallback.test.mjs; PG = electron/services/__tests__/ProviderGatewayPolicy.test.mjs. All actual generation entrance tests use built LLMHelper / wrappers / Engine / ProcessingHelper and mock/synthetic/loopback transports under X2.

## Deleted VisionStreamFallback.test.mjs: 30 named cases

| Old case | Replacement or approved retirement |
| --- | --- |
| timedOut flag short-circuits to timeout | GT construction TTFT/total test; GI actual Engine mockclock first-token failure; timeout ends logical task, never opens backup |
| expired API key -> auth | GI AUTH actual prompt entry; no regex-based key guessing; structured status/code only |
| 401 / 403 / quota -> auth | GI AUTH and GT auth precedence over model code; permission/scope cases SL/PG; health penalty removed |
| 429 -> rate | GI retry-after permission revocation; GT Retry-After exceeds budget and long Node timer test; within one 2-send budget |
| ECONNRESET / fetch failed -> network | GT explicit ECONNRESET; GI real OpenAI SDK loopback dropped socket with maxRetries=0; free-text 'fetch failed' guessing retired |
| 413 / too large -> payload | HTTP non-retryable class is terminal, not provider rotation; GO terminal selected vision entry, GI CONFIG; free-text classification retired |
| does not support images -> no_vision | Unsupported/configuration failure terminates instead of silently dropping images or discovering another provider; GO selected vision terminal case, GI original-image transport tests |
| 503 / overloaded -> server | GI each of legacy/structured/summary/stream transient -> explicit backup, physical sends <= 2 |
| unrecognized -> unknown | GI CONFIG and GT ordinary404/message-only cache terminal; default remains terminal, no free-text guessing |
| no measurements -> priority order preserved | Retired: no implicit provider pool; GI explicit selected primary and user backup request model assertions |
| measured faster provider leads regardless of priority | Retired: no measured-latency reordering; GI pinned primary/backup snapshot |
| unmeasured high-priority provider not buried | Retired with implicit discovery/reordering; no substitute performance claim |
| OPEN-breaker provider demoted | Retired with cross-request circuit breaker; selected target is not substituted |
| all cooling -> still returned | Retired: no cooling/provider pool; configuration failures end the request |
| cooldown expires -> provider live again | Retired with circuit breaker state; no clock or speed assertion substituted |
| single provider succeeds -> all tokens | GI actual WhatToAnswer images/text; GO physical generation and prompt wrappers; Engine real token/final assertions in IntelligenceEngineSentinel |
| pre-commit failure -> silent fallback | GI real selected interfaces transient -> explicit backup; GT backup preferred and no-backup original-model retry |
| auth failure -> unhealthy/skip/no retry | Terminal/no second send retained by GI AUTH; unhealthy pool mutation/skip retired |
| transient retries maxAttempts then moves on | Deliberately changed: logical task max2 total, not per-provider maxAttempts; GI/GT model list and count assertions |
| exhaust all providers -> throws | GI explicit cache recovery invalid and terminal failures, GT final failure; unlimited/all-family discovery retired |
| post-commit failure keeps partial/no switch | GI PARTIAL and GO Gemini partial failed/refused/incomplete; no backup send |
| empty stream -> fallback | Deliberately changed: empty terminal even with valid backup; GO empty-primary case, GT empty never retries, GI EMPTY |
| no providers -> config error | GI CONFIG / selected client-not-initialized boundary; no arbitrary provider discovery |
| already-aborted signal -> zero call | GT construction/cancel and SL Gemini explicit-backup already-aborted controller; rejects AbortError, no physical send |
| TTFT aborts slow provider -> fallback | Deliberately changed: TTFT aborts logical task, does not grant backup time; GI real Engine held-prefix/visible-body mockclock controls |
| no_vision opens breaker/demotes next time | Retired breaker mutation; unsupported terminal path remains fail-closed |
| payload-too-large opens breaker/skips provider | Retired breaker/provider skip; non-retryable failure remains terminal |
| upstream iterator closes on every exit | GI actual cancel/switch/consumer-return aborts transport and fences late results; withGenerationTask immediate consumer close and generateTask upstream return finally remain; exact old manual iterator health harness retired |
| outer abort does not penalize breaker | GI actual cancellation/switch/return/reset aborts transport with no second send; breaker penalty state no longer exists |
| records TTFT EWMA on committed provider | Retired telemetry/reordering state; GT deadlines + GI real visible-text semantics replace the required timeout invariant, not performance/latency conclusions |

## Deleted VisionProviderFallbackChain.test.mjs: 9 named cases

| Old case | Replacement or approved retirement |
| --- | --- |
| first succeeds, second never invoked | GI actual image entry one physical send, GO selected image terminal/success; no preanalysis request |
| first fails, second succeeds | GI selected transient -> explicit backup for four real interfaces, only 2 sends |
| all providers fail -> failureReason=all_vision_failed | Deliberately changed to accurate terminal error/status; GT exhausted 2 sends, GO partial status preservation; old aggregate label retired |
| no providers -> no_vision_provider | Selected-client configuration failure is terminal; no registry scanning or invented answer |
| scope_blocked custom provider skipped | Deliberately changed: scope refusal terminal before send, never skipped to another provider; SL/PG actual current-scope wait/retry/backup tests |
| text-only provider skipped | Deliberately changed: selected provider validation, no implicit multi-provider discovery; all-original-image GI and actual IPC harness assertions |
| per-provider timeout -> fallback | Deliberately changed: one logical TTFT/total budget from entry, no fallback after timeout; GI real Engine mockclock + cancellation controls |
| empty output -> next provider | Deliberately changed to terminal empty; GT/GO/GI empty tests |
| telemetry attempt/success/fallback/failed/skipped callbacks | Retired chain callback interface; GI actual task metadata counts/model/provider/status/image transmission, and real preload/IPC AG09 metadata assertions replace user-visible result evidence |

## Other migrations

- generateOnce: keeps all one-physical-send/finish/scope/transport/cache/system-image/prompt checks; stale cache requires explicit structured cache-invalid evidence; replaces two private-fallback tests with actual selected entry; empty no longer switches providers. All nine mode wrapper refusal/terminal tests use explicit task fixture interfaces, not a production optional fallback.
- suggestionPromptAssembly: keeps prompt/notes/transcript/intent/history/image positioning; CLI enabled is no longer an independent provider-override attempt. Every fixture explicitly supplies task entry methods.
- ScopeLocalFallback: router and meeting/profile/summary scopes, wrapper/Engine refusal, Codex spawn interception, **8 real SDK constructor/key-update no-hidden-retry cases**, current-scope checks during cache/queue/retry remain. Old private adapters/all-family rotation become selected chat/stream/structured/fixed/summary with explicit backup/2-send cap; empty is terminal rather than scope-driven rotation.
- ProviderGatewayPolicy: preserves endpoint constructors, pure scope policy, IPC/preload/renderer settings assertions. Private adapters become five providers x stream/nonstream plus fixed Pro/Flash actual entrances; limiter/image/cache/retry/backup scope revocation uses current permissions. Old rotation's 3+ sends is deliberately reduced to 2.
- Engine fixtures: all four files explicitly provide runGeneration/runGenerationStream/getCurrentGenerationTask. Sentinel tests retain empty-renderer/history invariants; real answer token assertion now requires original streaming chunks, not one end-of-stream duplicate.
- ImagePathValidation: only method-name locator migrated to Inner body, existing static validation checks preserved. Stronger actual malformed/traversal handler and per-request IPC fence evidence remain AG33, not claimed here.
- credentialTransactions: all current **24** setters remain enumerated and exercised under failed persistence + restart. Adds independent deadline/backup validation, configure/default duplicate refusal without mutation, and policy atomic rollback.
- WhatToSay error delivery: GUI02/03 exposed a real zero-error display: Engine emitted and marked reported, but the initiating renderer received only the suppressed IPC null-result. Manual IPC now selects caller-owned error display; direct/automatic Engine calls retain the error event. ScopeLocalFallback asserts both contracts, and actual AG09 renderer action requires exactly one refusal and zero sends. The GUI fixture waits for a newly attached input preview rather than any old transcript image.
- multiProtocolGeneration: four retired `providerGeneration` / `sendGemini` / `sendProvider` calls now enter actual public chat/stream/task methods. URL/API prefix, opaque selected versus saved connection model, original image, system, custom cache omission, Responses store=false, exact physical request count and no automatic discovery assertions are retained. The old private adapter's arbitrary caller-cache-options input is retired; the actual public custom route must still omit cache metadata on the wire. Its summary case deliberately changes AG31 implicit configured-provider discovery to AG32 fixed selected target: default Gemini without a client fails with zero OpenAI requests; explicit Responses selection then retains all summary wire/newline/result checks.
- LlmStreamAbortController: retire exactly three implementation-spelling tests (`args[args.length - 1]`/`instanceof`, named local AbortSignal, hand-written pre-yield abort gate). GI actual public stream cancellation/model-switch/consumer-return verifies transport abort and rejection before late results; AG09 actual same-sender supersession/cancel verifies producer interruption and late token/done/error suppression. The five IPC sender-map/supersession/stop/preload binding/type checks remain, with the signal regex accepting the current non-null TypeScript assertion. No sender isolation claim is dropped.
- SensitiveLogRedaction: mandatory metadata log strings are retired because silence is safe; retain source negative leakage guards and add actual built-helper nonstream/stream execution, two physical mock sends, successful output, and log/warn/error capture excluding unique prompt/context/system/response sentinels.
- meeting-storage: after saving the synthetic Groq key, explicitly persist/select the qualified Groq default model and assert the credential transaction succeeds. This is AG32 selected-target setup, not implicit provider discovery; all summary payload/routes/default-sections/schema/transcript/restart/delete/scope/rollback/recovery assertions stay unchanged.
- Startup recovery production correction: storage01/02/03 were 4/5 after explicit model setup. storage03 captured `AbortError: Application quit` during the held title request; metadata catch then replaced its persisted unprocessed placeholder with a processed Untitled fallback, so restart could not recover it. MeetingPersistence now returns only on AbortError before final save, preserving the existing placeholder. Scope denial (local-only processed meeting) and other error behavior remain unchanged; no AG52 persistence refactor or MeetingPersistenceRace-test change. The unchanged actual storage recovery denied/on controls provide before/after evidence.
- Quit closure: `scrubKeys` now marks generation closed before aborting active tasks. Any queued next recovery/background generation fails with AbortError at beginGenerationTask instead of null-client configuration failure, so it cannot overwrite another placeholder as processed. GI actual public begin/stream/chat/structured/summary entries assert AbortError and zero sends after scrub; quit01 was red before this guard.
- Same target selection control: actual GI public stream receives a held mock transport, then restates the canonical selected target using qualified and raw model ids. The transport stays live, emits the held answer, and sends once. Existing actual different-target switch cancellation remains the negative control. No production setModel edit was necessary; source and current build already compare canonical provider/protocol/model identities.

## Remaining boundaries

- AG33: request/current-task fences for late token/done/error and dual awaitGeneration races; abort catch must not emit old held prefix into a new answer; retain valid short answer instead of current <5-char fabricated repeat prompt; stronger real handler image validation; complete renderer partial/error lifecycle.
- AG33 task state: shared debug two-step tasks can keep `terminalStatus='completed'` from step one after step two scope failure/timeout because terminal updates use `??=`. Cover/fix final logical-task lifecycle without losing partial output or reopening send budget; not changed in AG32.
- AG34: Codex CLI internal retries remain outside proven cloud SDK retry control; do not claim two physical CLI internal sends are proven.
- Google cached-content ErrorInfo reasons are synthetic strict-contract tests, not verified current official Google error-schema evidence. Ordinary404/message regex remain terminal.
- No real credentials/models/devices, native builds, npm install, CI, throughput benchmark or mock timing performance conclusion occurred.
- dist-electron may retain old deleted-module JS because build-electron does not clean. Migrated tests no longer import those dead artifacts; parent full gates should not treat stale files as current source.
