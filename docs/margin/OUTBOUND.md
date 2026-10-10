# Outbound boundary inventory (AG-24)

This is an implementation inventory, not an AG-24 acceptance record. Google STT
uses the service-account-only contract approved in PLAN S16. No live credentials, services,
audio devices, keychain or Codex CLI are used by the synthetic checks.

## Application HTTP

`electron/services/outbound.ts` validates absolute HTTP/HTTPS URLs without
userinfo, fragments, whitespace or backslashes. Explicit user addresses remain
supported, including env endpoints and HTTP-compatible STT servers. This is URL
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
| LLMHelper Groq chat/completions | Explicit option, otherwise GROQ_BASE_URL, otherwise https://api.groq.com | Text/images |
| LLMHelper OpenAI chat/completions | Nonpackaged loopback dev override, otherwise OPENAI_BASE_URL, otherwise https://api.openai.com/v1 | Text/images; no current Responses call |
| LLMHelper Anthropic messages | Explicit option, otherwise ANTHROPIC_BASE_URL, otherwise https://api.anthropic.com | Text/images |
| LLMHelper DeepSeek chat/completions | Explicit https://api.deepseek.com overrides OpenAI env | Text |
| LLMHelper Gemini generateContent/Stream and caches.create | HttpOptions baseUrl > SDK setDefaultBaseUrls > GOOGLE_GEMINI_BASE_URL / GOOGLE_VERTEX_BASE_URL for the selected backend > official default | Text/images/system instructions |
| ModelVersionManager discovery | Official OpenAI/Gemini/Anthropic/Groq model-list URLs, fetch | Key/config only; startup/background/model-error discovery |
| utils/modelFetcher, fetch-provider-models IPC | Official five-provider model-list URLs, Axios | User-triggered key/config only |
| test-llm-connection IPC | Official five-provider POSTs | Fixed Hello and supplied/stored key |
| test-stt-connection IPC | Deepgram/Soniox WS, ElevenLabs voices GET, regional Azure/IBM POST, Groq/OpenAI transcription POST | Manual validation; synthetic WAV only |

LLMHelper's final sends recheck request scopes after limiter/image processing and
before application retries/fallback. Groq/OpenAI/Anthropic/DeepSeek SDK retries
are disabled (`maxRetries: 0`). Gemini has no retryOptions configured, so its
installed apiCall sends once. Cache creation is an outbound request: both callers
check scopes and abort **before** getOrCreate and check again before generation.
An already submitted cache cannot be recalled; a later generation/retry is refused.

Concrete helper send paths include generateWithPro/Flash, generateContent,
generateContentStructured, generateWithGroq/Openai/Claude/Deepseek,
generateWithGroqMultimodal, streamWithGroq/Openai/Claude/Deepseek and their image
variants, streamWithGeminiModel, collectStreamResponse, generateWithFallback,
streamWithGroqOrGemini and generateMeetingSummary. Chat/vision/summary fallback
wrappers delegate to these final sends rather than defining separate transports.

Cache system content is not assumed to be permanently static. Language settings
are inserted into it; systemPromptOverride and the optional skill prompt interface
also exist. The latter has no identified current renderer/IPC supplier. Cache
creation receives no exemption when a request scope has been refused.

Azure and IBM share regionalSttEndpoint across credential save, RestSTT runtime
and connection tests. Region accepts ASCII letter/digit/hyphen tokens, and the
constructed official hostname is verified. Invalid persisted or incoming values
fail closed, rather than becoming a request to an injected authority. OpenAI STT
base URL save/runtime/test share openAiSttEndpoint; compatibility remains until AG-41.

## Actual STT audio

| Provider | Endpoint / transport | Deferred sends |
| --- | --- | --- |
| Deepgram | SDK listen.live, wss://api.deepgram.com/v1/listen | Handshake buffer, application reconnect |
| Soniox | wss://stt-rt.soniox.com/transcribe-websocket | Config/buffer flush, reconnect timer |
| ElevenLabs | wss://api.elevenlabs.io/v1/speech-to-text/realtime | Session-ready buffer, accumulator, reconnect |
| OpenAI | wss://api.openai.com/v1/realtime?intent=transcription; official or explicit compatible REST endpoint | Model reconnect, ring replay, accumulator, REST fallback/queued upload |
| Groq | https://api.groq.com/openai/v1/audio/transcriptions | REST safety timer and queued flush |
| Azure / IBM | Validated regional official endpoints | REST safety timer and queued flush |
| Google | SpeechClient.streamingRecognize, speech.googleapis.com:443 by default; validated explicit universe | gRPC write/buffer, lazy/proactive restart; service-account-only local JWT |

RestSTT retains helper branches for OpenAI/ElevenLabs but the current main factory
selects their streaming classes. All application WS URLs are fixed; `ws` does not
follow redirects by default. The Deepgram listen SDK default is its official URL;
the application supplies no proxy/custom websocket endpoint.

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

## Renderer, active links, native and Codex

Nine ReactMarkdown call sites use SafeMarkdown to reject img. The imperative
streaming marked/DOMPurify path rejects img and SVG image. CSP limits images to
self/data and renderer connections to self; screenshot previews/local assets
remain. The unused external Google Fonts import is removed in favor of local
fonts. Browser behavior checks run without CSP for a positive image-load control,
so CSP cannot conceal a component/sanitizer regression.
The `outbound-renderer` step is part of the ordinary run-gates sequence (and its
CI callers), running serially under X2 with only Electron/esbuild exec allowed.

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

Codex run/stream checks scopes before spawn. Prompt stdin/image args, its own
authentication/destination/retries after spawn remain opaque; cancellation kills
the process but cannot recall content already submitted. This known boundary
stays in AG-34. No real CLI is launched for AG-24 testing.
