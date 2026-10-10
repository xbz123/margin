# AG34 retired CLI test behavior map

Baseline: AG33 commit 49b44e8c9e4450f8b1e5264a6f58a9db67d94cdc. Original file: electron/services/__tests__/CodexCliService.test.mjs (35 cases).

Replacement names below identify executed assertions, not one-for-one semantic equivalence. Intentional changes: no executable/sandbox/discovery/process path; strict boolean instead of coercion; shared deadlines instead of independent timeout; explicit Responses completion instead of permissive plain-text/JSONL success; cancellation is a distinct task outcome instead of successful stream completion. Default fast model follows the existing startup/UI gpt-5.3-codex-spark, not the old leaf's inconsistent gpt-5.3-codex default.

New leaf tests: electron/services/__tests__/CodexAuthSource.test.mjs. Consent/transaction tests: electron/services/__tests__/codexConsent.test.mjs. Actual lifecycle tests: electron/llm/__tests__/generationInterfaces.test.mjs. GUI controls are in tests/margin/outbound-renderer.test.mjs: the actual Settings React test composes extracted real preload/IPC functions with synthetic main dependencies; it is not native IPC end-to-end. The separate native launcher test uses the built application's actual preload and registered main IPC, with only exact synthetic auth-file open/read/close instrumentation.

| Original exact case name | Preserved/replaced safety or behavior evidence |
| --- | --- |
| DEFAULT_CODEX_CLI_CONFIG has expected shape | migration 01: built shared defaults/validation; no path/sandbox/timeout; existing UI/startup models retained |
| CODEX_SANDBOX_MODES enumerates the three valid modes | sandbox removed; migration 02 strict tier/effort and migration 01 forbidden fields; no privilege selection/executable remains |
| normalizeConfig: empty input returns defaults | migration 01 actual exported validateCodexSourceConfig({}) equals defaults |
| normalizeConfig: invalid timeouts fall back to default | migration 04/31 shared total/first-visible deadlines; existing generation policy validation controls invalid values |
| normalizeConfig: whitespace path falls back to default | executable path removed; migration 05 literal endpoint and migration 25 missing file has no executable fallback |
| normalizeConfig: enabled is coerced to boolean | intentionally stricter: enabled is strict boolean and current risk version is not inferred; consent tests require explicit current confirmation |
| normalizeConfig: invalid sandboxMode falls back to read-only | sandbox eliminated; unsupported configuration rejected by transaction allowlist; no sandbox/execution feature |
| normalizeConfig: valid sandboxModes are preserved | intentionally retired execution privileges; migration 01 no sandbox field and fixed source architecture |
| buildArgs: argv ordering and fixed flags | migration 09 fixed stream/store/system/input body, migration 05 fixed URL/redirect policy |
| buildArgs: defaults sandbox to read-only | no execution or writable credential operations; migration 26 readonly file preservation |
| buildArgs: respects explicit sandboxMode | intentionally no CLI sandbox control; strict source configuration, no subprocess |
| buildArgs: image paths are repeated as --image, empties skipped | migration 12 image input; flat text/image same user-message and history-role test; actual original-image pipeline and scope/capability controls |
| extractText: parses Codex --json delta event stream | migration 13 Responses output_text delta + explicit completed; migration 20 split multibyte SSE |
| extractText: passes through plain text untouched | intentional fail-closed protocol change: migration 14 plain text not completed |
| extractText: strips markdown json fence | migration 15 fences preserved as literal output, not transport parsing |
| extractText: lifecycle-only events return empty string | migration 16 lifecycle-only EOF is incomplete, not success |
| extractText: agent_message item with text payload | migration 17 only actual Responses output-text deltas emitted; reasoning ignored |
| extractText: error item is suppressed | migration 18 explicit failure stays failure; safe error without secret contents |
| extractText: walks output_text key | migration 19 terminal output_text alone cannot fabricate streamed delta text |
| extractText: joins content arrays | migration 20 chunk/multibyte assembly; flat/turn input normalization test preserves ordered content |
| extractText: empty input returns empty | migration 21 explicit empty/whitespace completion remains empty; EOF remains incomplete |
| extractCodexError: pulls message from stringified error envelope | migration 22 safe allowlisted error classification; no raw remote message exposure; model_not_found vs generic 404 control |
| extractCodexError: returns empty when no error events present | migration 23 successful finish has no synthetic error |
| extractCodexError: handles plain string error message | intentional sanitization: migration 24 arbitrary message/code cannot enter errors; safe transient network allowlist control |
| getCandidatePaths: includes /Applications/Codex.app on macOS | executable discovery retired; migration 25 fixed readonly-file failure cannot trigger discovery/CLI |
| autoDetectPath: returns null or a real, existing executable file | migration 26 actual synthetic regular-file bounded readonly load; symlink/oversize controls replace executable probing |
| validateExecutable: returns resolvedPath on success | migration 27 safe local status only; does not expose account/token/path or claim connectivity |
| validateExecutable: bare unfound name falls back to auto-detection if available | intentional no fallback: migration 28 malformed/oversize/API auth rejection and migration 25 missing file; no keyring/CLI/discovery |
| validateExecutable: missing binary returns success=false with error string | migration 29 safe file-unavailable local status, remote/reader error secrets excluded |
| validateExecutable: real --version-capable binary returns success=true | executable invocation removed; migration 27 only local validation success; migration 30 expiry needs external sign-in, no refresh |
| run: timeout is enforced (binary outlives timeoutMs) | migration 04/31 shared total/first-visible deadline, at most one in-flight send, no new retry deadline |
| run: AbortSignal pre-aborted rejects without spawning | migration 32 preabort zero auth reads and zero sends |
| run: AbortSignal aborts an in-flight call quickly | migration 33 actual reader abort/cancel and late-event fencing; actual auth-waiting consent/model/fast/policy cancellation tests |
| stream: AbortSignal pre-aborted throws on first iteration | migration 34 preabort zero reads; same GenerationTask cancellation contract |
| stream: AbortSignal aborts an in-flight stream and returns without throwing | intentional explicit cancelled task outcome; migration 33 reader release, migration 35 consumer close, AG33 partial/cancel terminal regressions retained |

Additional security controls beyond old cases: bounded auth/JWT expiry/account consistency; same-account changed-token 401 once only; unchanged/other account/expired/revoked reject; shared two-send budget including backup; API/source separation; literal endpoint and redirect rejection; independent source/main/fast/backup image confirmations (including equal normal/fast model IDs); prepared inline screenshot scope zero reads/sends; HTTP and HTTP-200 SSE allowlisted error/Retry-After/network classification without raw secrets (pre-text model_not_found backup, arbitrary/image errors terminal, partial output never replays); post-fetch body release; saved-config-only status; transactional confirmation and failed withdrawal/retry in the composed actual React/preload/IPC control.

Native preload/main IPC control: disabled getter/local check and rejected unconfirmed enable cause zero auth opens; explicit confirmed enable itself causes zero auth opens; saved local check reads the synthetic regular file and reports only locally-valid with service/models unverified; actual generation delayed at exact synthetic auth-file open is cancelled by disabled source, metadata is cancelled with attempts=0, the resumed open closes without reading new bytes, and later getter/local check cannot reopen auth. A separately delayed local status check is also cancelled on withdrawal; releasing its open closes without additional bytes and returns disabled/discarded. X2 remains active and no external network attempt is allowed. This does not claim real authentication, service/model/entitlement verification or native IPC coverage of the composed fault/restart matrix.

Evidence is under this directory, including the red and intermediate failure logs. Final local validation is recorded in `../summary.json` and `../README.md`; this behavior map is not itself a pass report.
