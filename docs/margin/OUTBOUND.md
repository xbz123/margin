# Outbound boundary inventory (AG-24)

This is an implementation inventory, not an AG-24 acceptance record. AG-41a retired
Google, Deepgram, ElevenLabs, Azure and IBM STT (S35/S39). No live credentials, services,
audio devices or keychain are used by the synthetic checks.

## Application HTTP

`electron/services/outbound.ts` validates absolute HTTP/HTTPS URLs without
userinfo, fragments, whitespace or backslashes. Explicit user addresses remain
supported for independent gateways and HTTP-compatible STT servers. This is URL
syntax and redirect protection, not a host-authorization allowlist: initial
origins come from the fixed or explicit configuration sources inventoried below.
Fetch forces `redirect: 'error'`; the separate
Axios instance forces `maxRedirects: 0` in a synchronous request interceptor.
Automatic redirects are refused even when the target appears official. There is
no automatic credential/content forwarding to a new origin.

`bootstrap.ts` installs the idempotent fetch wrapper before evaluating `main` and
its SDK imports. Gemini uses global fetch; the installed SDK has no public
redirect/fetch hook in its legacy HttpOptions API. Groq/OpenAI/Anthropic explicitly
receive the same wrapper; standalone SDK tests install it explicitly for Gemini.
Request objects, AbortSignal, streaming responses and the transport receiver are
preserved. Nothing patches node_modules or SDK prototypes.

| Entry | Effective configuration / endpoint | Content |
| --- | --- | --- |
| LLMHelper OpenAI via llm/generateOnce (Chat or Responses) | Fixed https://api.openai.com/v1; only the nonpackaged loopback development override can change it | Text/images; Responses uses store:false |
| LLMHelper Anthropic via llm/generateOnce (Messages) | Fixed https://api.anthropic.com | Text/images |
| LLMHelper DeepSeek via llm/generateOnce (Chat) | Fixed https://api.deepseek.com | Text/images subject to exact-target capability admission |
| LLMHelper Gemini via llm/generateOnce; GeminiPromptCache caches.create | Fixed https://generativelanguage.googleapis.com; explicit API-key v1alpha backend | Text/images/system instructions |
| LLMHelper independent gateway via llm/generateOnce | Explicit saved URL, own stable identity and Key; separate Gemini/Anthropic/OpenAI client according to protocol, never an official fallback | Text/images subject to gateway-specific confirmation; final SDK errors are replaced after retry classification before reaching renderer/log consumers |
| utils/modelFetcher, fetch-provider-models / fetch-gateway-models IPC | Saved official target or independent gateway; gateway model IDs unfiltered, no official fallback | User-triggered saved key/config only |
| test-llm-connection / test-gateway-connection IPC | Saved target and protocol through generateOnce; supplied expected configuration must match storage | Fixed Hello and saved key |
| test-stt-connection IPC | Soniox WS, Groq/OpenAI transcription POST | Manual validation; synthetic WAV only |
| DomesticStreamingSTT / test-domestic-stt | Aliyun: empty workspace uses `wss://dashscope.aliyuncs.com/api-ws/v1/inference`, otherwise `wss://<validated-workspace>.cn-beijing.maas.aliyuncs.com/api-ws/v1/inference`; Doubao: `wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async` | Only explicitly selected credentials and PCM; manual test uses synthetic silence. A supplied Aliyun workspace is a validated single label, not an arbitrary authority. Doubao uses the selected hourly/concurrent resource, with no automatic resource switch. No redirects or region/model fallback. General-endpoint model availability still needs separately authorized real-service validation. |

Groq is retired for answers, not STT. Production address environment variables
cannot redirect official clients: a conflicting value pauses that provider.
Gateway Key changes and origin binding use the same encrypted transaction as
their configuration. The constructor inventory records both official and
gateway clients; no new dependency or transport bypass is introduced.

LLMHelper's final sends recheck request scopes after limiter/image processing and
before application retries/fallback. Groq/OpenAI/Anthropic/DeepSeek SDK retries
are disabled (`maxRetries: 0`), including each physical request's options.
All four generation protocols are centralized in `llm/generateOnce.ts`.
Gemini uses `retryOptions.attempts: 1` on each physical request.
AG-32 moves application retries into `llm/generateTask.ts`: a logical task has
at most two physical generations, with one explicitly configured backup rather
than a traversal of configured providers. Task targets are snapshots, while
permissions are read again before each send. Retries, explicit cache-reference
recovery and backup selection share the same attempt and deadline budget.
The shared Gemini client constructor and cache creation also explicitly
set one attempt. Cache creation is an outbound request: both callers check
scopes and abort **before** getOrCreate, the cache helper checks immediately
before `caches.create`, and generation checks again after the cache wait.
An already submitted cache cannot be recalled; a later generation/retry is refused.

The installed Gemini SDK receives the request AbortSignal for generation and
cache creation. Cancelled generation discards late response content; this is
client-side cancellation, not a promise that the remote service stops billing.
The single-send result distinguishes complete, refused, incomplete, empty,
cancelled and failed responses. Scope refusal remains a terminal exception.
Refusal, incomplete or empty output and failures after partial output are
terminal rather than silently succeeding or appending another provider's
answer. Authentication, configuration and scope errors do not select a backup.
Only an eligible pre-text transient or explicit model-unavailable error can
justify a second attempt. No new endpoint, credential source or automatic
redirect is introduced by this scheduler.

AG-33 admits image input against the actual model/protocol/effective endpoint
before each generation attempt, including a backup. Exact official models use
the small documented capability table; compatible or unknown targets require
explicit target-bound confirmation. Backup confirmation is independent, including
for a different model in the same provider slot. A changed target cannot reuse
the old binding. Known unsupported models cannot be overridden. Explicit server
image rejection is terminal, not a reason to retry without images or switch
models; the interface retains the input and attachments.

Renderer image paths are validated by the actual IPC handlers before reaching
generation: resolve real paths, require a regular image file under app-owned
userData, reject traversal, missing files and symlink escapes. Image decoding
failure does not fall back to sending arbitrary raw file bytes as PNG. This
does not replace scope checks and is not a claim to withstand an independent
host process replacing files concurrently.

Request identity and the originating webContents accompany generation events;
queued batches and late completion/error cannot retarget a newer request or a
different window. Renderer partial results retain terminal/model metadata.
Cancellation blocks later local work, not data already accepted by a service.

AG-31 adds explicit saved provider/protocol/base/model targets, not a new
credential source. The five encrypted credential slots remain separate.
Saving configuration plus an optional new key is one transaction; failure does
not hot-switch clients. Provider cards require explicit Save. Tests and model
listing reject unsaved replacement keys and use the saved target. Unknown and
ambiguous legacy model IDs are not assigned to a provider by name prefix.
Switching a configured active slot updates its selected model/protocol, and a
matching saved default is updated in the same transaction.

R3-1 / S31 requires explicit key re-entry when a save changes the effective
origin (scheme, hostname or port). The main-process credential transaction uses
the same effective-target resolver as generation, including supported environment
and development overrides. A missing or blank replacement key refuses the whole
save before persisted state or live clients change. An explicitly re-entered key
may have the same bytes; origin-preserving path/model edits do not require it.
This controls configuration saves, not arbitrary external changes to the process
environment or a remote service's behavior.

R3-2 selects explicit images or the existing screenshot-queue fallback before
validation; the optimizer and generation receive only canonical validated paths.
Malformed explicit input is rejected, not replaced by the queue. WhatToSay keeps
its existing explicit-image behavior. This removes duplicated checks; it does
not claim that a pathname alone prevents every concurrent filesystem mutation.

Compatible API bases reject userinfo, fragments and queries. Messages accepts
a trailing `/v1` without duplicating it; Gemini bases exclude the API version,
and both generation and compatible model listing use v1alpha. Saved addresses
take precedence over supported env overrides. SDK-global Gemini base defaults
and implicit Vertex routing no longer select an application target. No ADC
credential route is introduced.

Unknown compatible targets receive neither OpenAI `prompt_cache_key` nor
Messages `cache_control`; custom Gemini targets do not create explicit caches.
Hot configuration clears Gemini caches and prevents old in-flight cache results
from repopulating them. Model discovery aborts its old generation, drops its
old keys, and does not promote results arriving after reconfiguration.
Protocol EOF without the required finish event/reason is incomplete, not
success. Single-send tests use real installed SDKs with local HTTP services;
they do not certify arbitrary remote compatible services.

The active answer, structured-generation and summary helpers delegate to
`selectedGeneration` and the shared scheduler. Prompt wrappers preserve the task
through lazy generator iteration; background compression and summaries have
their own total deadline without an interview first-token timer. The
WhatToSay screenshot entry forwards the original images to the answer rather
than first generating a separate screen analysis with another provider chain.
Connection testing remains a single physical request to the saved target.

Cache system content is not assumed to be permanently static. Language settings
are inserted into it; systemPromptOverride and the optional skill prompt interface
also exist. The latter has no identified current renderer/IPC supplier. Cache
creation receives no exemption when a request scope has been refused.

OpenAI STT base URL save uses validateSttBaseUrl (AG-41b); runtime and connection
tests share openAiSttEndpoint. Both reuse the branch's HTTP authority validation
and reject query strings. Aliyun's workspace identifier is validated before socket creation.

## Network proxy

Settings → Network & Proxy stores `networkProxy` (`mode`, `protocol`, `host`,
`port`, optional `username`/`password`, `bypass`) inside the safeStorage-encrypted
`credentials.enc`; the renderer only ever receives `hasPassword`. An empty
password keeps the saved one, `clearPassword` removes it, and invalid input
(host with scheme, path, user info, query, fragment, port or whitespace; port
outside 1–65535; CR/LF/NUL in credentials; malformed or too many bypass entries)
is refused whole. As R3-1 does for API keys, a saved password is kept only for the
same proxy: a save that changes the protocol, host, port or user name without
entering the password again (or clearing it) is refused, so the password never
reaches a proxy it was not entered for. The runtime switches only after the
encrypted save succeeded.
`main.ts` loads the setting right after the credentials and before any outbound
request; until then (and in standalone tests) the default "follow system" mode
has no system resolver and only honours proxy environment variables.

Resolution order for every outbound URL (`electron/services/proxy/index.ts`):

1. Always direct, in every mode: loopback (`localhost`, 127.0.0.0/8, ::1),
   private address literals (10/8, 172.16/12, 192.168/16, 169.254/16, fc00::/7,
   fe80::/10), the built-in domestic services `dashscope.aliyuncs.com`,
   `*.aliyuncs.com` (covers Bailian workspace hosts), `openspeech.bytedance.com` and
   `api.deepseek.com` (exact host; DeepSeek answers),
   and the user's bypass list (`host`, `*.domain` / `.domain` = domain and its
   subdomains, IP literal). Only foreign traffic is meant to use the proxy.
2. `off`: direct.
3. `manual`: the configured HTTP, HTTPS or SOCKS5 proxy.
4. `system` (default): `HTTPS_PROXY`/`https_proxy` (https, wss), `HTTP_PROXY`/
   `http_proxy` (http, ws) or `ALL_PROXY`/`all_proxy`, honouring `NO_PROXY`/
   `no_proxy` (`*`, host or domain with subdomains, `.domain`, `:port`, IP,
   CIDR); `http://`, `https://`, `socks5://` and `socks5h://` URLs, credentials
   from the URL user info. Without such a variable the URL's origin is passed to
   `session.defaultSession.resolveProxy` (system settings, PAC, WPAD). Only the
   first entry is used: `DIRECT`, `PROXY` (HTTP), `HTTPS`, `SOCKS5`/`SOCKS`
   (SOCKS5). SOCKS4 and unknown entries connect directly with a fixed log line.
   There is no failover between PAC entries. Results are cached per origin for
   30 seconds and the cache is cleared whenever the settings change.

One tunnel serves all three channels. Fetch (OpenAI, Anthropic, Groq, DeepSeek,
gateways and Gemini through the global wrapper) adds an undici
`Agent` as `dispatcher` after `validateHttpEndpoint`; a direct decision passes no
dispatcher, so that path is unchanged. Axios always sets `proxy: false` (it no
longer reads environment variables itself) and gets routing `http.Agent`/
`https.Agent` subclasses for targets that may be proxied. Every `ws` connection
takes its options from `streamingStttWsOptions(url)`, which adds the same routing
agent only when the target may be proxied and otherwise keeps the IPv4 lookup;
proxied WebSocket targets are not resolved locally. A settings change clears the
cache, closes old dispatchers gracefully and drops old agents (keep-alive off);
connections already open are not interrupted, and transcription picks up the new
setting on its next connection.

The tunnel is HTTP `CONNECT host:port` (over verified TLS to the proxy for the
HTTPS protocol) or SOCKS5 (RFC 1928, host names sent as names so the proxy
resolves DNS, RFC 1929 user/password; without credentials only "no auth" is
offered). Only a 2xx CONNECT reply succeeds: 3xx, 407 and every other status,
an oversized (16 KiB) or malformed reply, a SOCKS failure, a 15 s timeout or an
abort destroy the socket and raise a `ProxyError` with a fixed code and message
(`PROXY_UNREACHABLE`, `PROXY_AUTH_REQUIRED`, `PROXY_AUTH_FAILED`, `PROXY_REFUSED`,
`PROXY_PROTOCOL`) that never echoes proxy output, credentials or the target query.
Redirects are not followed by the proxy layer either, and a proxy failure is
never retried directly: there is no fallback to a direct connection.
The fixed message is what the user sees: the fetch wrapper rejects with the
`ProxyError` itself instead of undici's "fetch failed", the generation scheduler
replaces an SDK connection error whose cause chain holds one with that
`ProxyError` (terminal, so no retry or backup), and the connection-test and
model-list handlers return its message.

For https/wss targets TLS runs end to end inside the tunnel: the certificate and
host name verified are the target's, with normal verification (no
`rejectUnauthorized: false`; tests add a trust anchor through a test-only hook).
The proxy sees the target host and port but not API keys, headers or bodies.
Plain `http://` targets (for example an HTTP-compatible STT server that is not
local) also go through CONNECT, so their plaintext bytes pass through the proxy
exactly as they would cross the network directly. `Proxy-Authorization` (or the
SOCKS credentials) is sent only to the proxy, never into the tunnel or to the
target. Logs carry fixed text only.

The bundled `undici` 7 `Agent` must stay on the same major version as the undici
inside Electron's Node (Electron 43 / Node 24: undici 7.28); a newer major in the
runtime's `fetch` can pass request headers the older dispatcher rejects. Check
this when upgrading Electron. `NetworkProxy.test.mjs` covers the resolver order,
local CONNECT (with and without auth) and SOCKS5 proxies for fetch, axios and ws,
the real OpenAI/Anthropic/Groq/Gemini SDKs refusing 307 through the proxy, target
certificate verification and ciphertext-only relaying, and the fixed failures.

## Actual STT audio

| Provider | Endpoint / transport | Deferred sends |
| --- | --- | --- |
| Soniox | wss://stt-rt.soniox.com/transcribe-websocket | Config/buffer flush, reconnect timer |
| OpenAI | wss://api.openai.com/v1/realtime?intent=transcription; official or explicit compatible REST endpoint | Model reconnect, ring replay, accumulator, REST fallback/queued upload |
| Groq | https://api.groq.com/openai/v1/audio/transcriptions | REST safety timer and queued flush |
| Aliyun Bailian | Validated workspace hostname above | Task-started ACK, bounded PCM queue, capped reconnect |
| Doubao | Fixed openspeech.bytedance.com endpoint above | Binary gzip frames, bounded PCM queue, capped reconnect |

Groq uploads also carry the user's saved term hints as the Whisper `prompt` field
(2026-11-01): text typed in Settings, stored with the encrypted credentials, at most
about 224 tokens, never derived from transcripts, Local Context or other data. An
empty hint sends no field.

RestSTT implements Groq and the OpenAI-compatible REST fallback. New domestic
adapters share a task transport; `ws` does not follow redirects. Their settings
IPC never returns the stored key to the renderer. Provider bodies and transport
errors are not forwarded to logs or UI because they can echo credentials.

Transcripts is a **text-to-LLM** permission, not raw-audio consent. No audio scope
is added. Explicit STT provider selection plus meeting start governs cloud audio;
none/unknown/unconfigured selected provider creates no fallback Google provider.
Google requires an explicitly selected credential path/env at the main factory.

Reconfiguration discards both old senders before capture teardown or any await.
Removal of the active provider's key discards only after persistence succeeds;
failed saves and inactive-provider edits have no such runtime effect. Ordinary
meeting Stop retains capture stop, finalize and the 250 ms tail-final drain.
Discard skips OpenAI append/commit, Soniox end-of-audio and Deepgram CloseStream,
destroys the Google application stream, and clears pending audio/reconnect state. Already
submitted requests/frames cannot be recalled. Metadata/manual tests are recorded
separately from these actual-audio and text sharing checks.

## Google authentication: approved service-account-only boundary

Installed versions: @google-cloud/speech 7.3.1, google-gax 5.0.6,
google-auth-library 10.6.2, gaxios 7.1.4. SpeechClient defaults to gRPC and enables
useJWTAccessWithScope (speech_client.js:104-139). The shared loader accepts only
service_account JSON with a nonempty safe project ID, a Google service-account
email and a parseable RSA PRIVATE KEY. Domain-scoped project IDs and iam,
Compute/developer and AppEngine/appspot account emails remain supported.
Standard Google-generated metadata is accepted (including numeric client_id and
the legacy Google token URI); auth/certificate URL metadata must match Google
or the validated explicitly declared universe. Alternative credential-source,
impersonation, refresh-token, delegated subject and scope inputs are rejected.

SpeechClient receives only public projectId, credentials with client_email and
private_key, and universeDomain options. GOOGLE_CLOUD_UNIVERSE_DOMAIN takes
precedence over validated file universe_domain, then googleapis.com. The auth
and Speech service universe remain aligned; no servicePath/apiEndpoint override
or SDK private/prototype patch is introduced. Neither keyFilename nor the full
JSON reaches the SDK, so SDK ADC, gcloud, metadata/project discovery, external
STS and impersonation branches are not selectable from the file.

Selection/save, stored/environment startup, reload and actual construction use
the same validator. Selection passes one validated snapshot through persistence
and runtime application; failed reads/type/field validation do not overwrite the
previous ciphertext, in-memory credentials, environment or running client.
Later construction re-reads the selected path, so changed file contents are not
implicitly trusted. The saved path takes precedence over environment fallback
at startup, factory construction and configuration status; an invalid saved
path cannot silently select a different environment account. Invalid old configuration is nonfatal to app startup,
is not advertised as a usable saved file, and reports a fixed safe STT failure
when the factory is invoked. Valid active replacement discards the old stream
without flushing and starts with the new validated client.

GoogleServiceAccountBoundary tests exercise the installed SDK with synthetic RSA
credentials: a valid local JWT signature, zero auth HTTP, ADC, gcloud and metadata
calls, standard/legacy account and explicit-universe controls, rejected token-URI
injection pointing at a loopback 307 server (neither hop is contacted), and queued
audio revocation using the installed streaming helper plus a mock gRPC transport.
This proves the no-auth-HTTP contract, not a live OAuth exchange or OAuth redirect
test. The installed helper does not attach its underlying request stream to the
outer pipe until first audio; outer destruction before that point does not prove
that an SDK-owned authentication/connection attempt was synchronously cancelled.
No queued audio is sent after application revocation; already submitted work
still cannot be recalled.

OutboundInventory checks all production Electron/renderer files for the listed
direct HTTP/WS and SDK constructor forms, including metadata/manual test entry
counts; fixed endpoint origins and Google/Deepgram construction sources match
this inventory. New recognized entry forms/sites require registration. It is a
finite consistency check, not whole-program alias/data-flow analysis or proof
about arbitrary future SDK internals. Behavioral redirect and explicit-config
controls remain in OutboundBoundary and ProviderGatewayPolicy tests.

## Renderer, active links and native

Nine ReactMarkdown call sites use SafeMarkdown to reject img. The imperative
streaming marked/DOMPurify path rejects img and SVG image. CSP limits images to
self/data and renderer connections to self; screenshot previews/local assets
remain. The unused external Google Fonts import is removed in favor of local
fonts. Browser behavior checks run without CSP for a positive image-load control,
so CSP cannot conceal a component/sanitizer regression.
The `outbound-renderer` step is part of the ordinary run-gates sequence (and its
CI callers), running serially under X2 with only Electron/esbuild exec allowed.
A zero exit is not enough for the S42 required check (`gate-evidence.mjs
required`): run-gates records the step's node:test counts, and the check fails
unless at least `OUTBOUND_RENDERER_MIN_TESTS` cases (17, pinned in
`PINNED_NODE_TEST_STEPS` in `scripts/margin/gate-evidence.mjs`) ran and all passed,
with none skipped, todo or cancelled, or when the counts are missing. Raise or lower
that number with the cases; `gateEvidence.test.mjs` fails while it differs from the
suite. Since 2026-11-15 the regression, storage and startup steps are checked the same
way (24, 4 and 2 cases).

User-clicked links are not automatic resources. `navigationPolicy.ts`, installed
in bootstrap before `main` and any window, handles every webContents: renderer
navigation is allowed only to the app's own `dist/index.html` (or the dev server
origin in an unpackaged development run); child windows are always denied and
webview attachment is refused. Since the stage 2 acceptance review, a refused
navigation or window.open opens nothing: Electron does not tell the main process
whether a user gesture caused it, so a script could otherwise open links on its
own. The browser opens only through the open-external IPC, which the preload sends
in two cases: a trusted click (or middle click) on a link that leaves the page and
that the page did not handle itself, and `electronAPI.openExternal` called while
a trusted click is still being dispatched, for the URL the clicked control declares
(`data-external-url` on the button, or a link's href). Scripts cannot create
trusted events. Transient user activation alone is not enough: it lasts about 5 s
after any click, so a timer could use the activation of an unrelated click (Astra
re-acceptance, 2026-10-10). The main process then opens the URL only when it is
https without userinfo, or the macOS settings scheme on macOS; everything else
(http, file, mailto, custom schemes) is dropped. The menu's Electron link and the
accessibility settings deep link call `shell` directly with fixed URLs.

The outbound-renderer gate checks this in the real launcher window. Real input
(Playwright's clicks) on two https links, a button calling `openExternal` with
the URL it declares, an http link, a mailto link, a link the page handles itself,
a plain button, and buttons whose handlers call `openExternal` with an undeclared
URL or with none declared records exactly the three expected `external-open`
entries; a timer armed without a user gesture before the first click, which calls
`openExternal` 20 times while that activation lasts (also with the declared URL),
records none. After the click activation has expired,
script-driven window.open, synthetic link clicks, `openExternal` and a location
change record none. The page URL and preload API survive, no window is created,
and a loopback page receives no request from the refused navigations (a
main-process positive control does reach it). The isolation guard replaces
`shell.openExternal` with a recorder of kind `external-open`, so followed links
are counted apart from automatic requests and never reach the real browser.
With the earlier policy (refused navigations handed to the browser) the test
fails with the three automatic URLs recorded
(`evidence/stage2-review/navigation-red-old-policy.log`); the first version of
the policy is in `evidence/AG-24-followup/navigation-red-without-policy.log`.
With the activation-only check the timer and both undeclared handlers open the
browser (`evidence/stage2-reacceptance/navigation-red-before-fix.log`).
Remaining boundary: a page script that handles the same click itself can still
open the URL the clicked control declares, as the app's own handler does, and a
script that can change the page could change a declared URL, as it could change a
link's href. Without a real click on that control nothing opens.
Native sources have no application-owned HTTP after the retired functionality.
