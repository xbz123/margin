# Margin adaptation checklist

What Margin must do, what the AGPL baseline (`a786910e`) already does, and what has to be built. Current behavior is owned by [PLAN S41/S42](PLAN.md#requirements-20261013), with checked implementation gaps and incremental tickets in [S42](PLAN.md#tickets-20261013). The earlier Margin plan (`docs/fresh-release-implementation-plan.md` at `b8ade3f7`) is a historical behavior reference only, not the current specification or a source of code.

Status values: `todo`, `doing`, `done`, `blocked`. "Not verified" lists anything not yet checked for real. Tickets, acceptance checks and execution order are in [PLAN.md](PLAN.md); if this table and PLAN.md disagree, PLAN.md wins.

The phase 0–2 rows below retain the original baseline comparison, not current execution status. Do not reopen completed tickets from their historical `todo` labels; current acceptance belongs to PLAN. The later-phase targets below reflect S33/S34/S41; baseline columns remain historical.

## Phase 0 – baseline and records

| Item | Target | Baseline | Gap / source | Check | Status |
| --- | --- | --- | --- | --- | --- |
| Baseline | Published pre-1 June AGPL commit | `a786910e` | — | [BASELINE.md](BASELINE.md) | done |
| Provenance rules and ledger | Every imported item recorded | — | New file | [PROVENANCE.md](PROVENANCE.md) | done |
| Baseline build state | Known starting point | Builds; 33 Electron type errors | — | Commands in BASELINE.md | done |

## Phase 1 – minimal buildable core (no premium or natively-api)

Removed outright: code, UI entry points, IPC, preload, dependencies, build steps and tests that only these features use. They are deleted, not hidden.

| Item | Target | Baseline | Gap / source | Check | Status |
| --- | --- | --- | --- | --- | --- |
| Premium and natively-api | Gone | Optional submodules, license checks, Gumroad/Dodo verification in the native module, Pro STT, trial and ad toasters, Natively API and Pro settings | Delete | Build and typecheck; grep finds none | todo |
| Telemetry and install ping | Gone | GA4, telemetry service, install ping, renderer analytics | Delete | grep for endpoints | todo |
| Auto-update and release notes | Gone; users download releases by hand | electron-updater, release notes, update UI | Delete | No `electron-updater` dependency | todo |
| RAG, embeddings, sqlite-vec | Gone | `electron/rag`, vector store, sqlite-vec | Delete; keep the meeting database | Database starts without the vector extension | todo |
| Ollama and local-only mode | Gone; any compatible endpoint can still be typed in | OllamaManager and bootstrap | Delete | No requests to port 11434 | todo |
| Local STT and model downloads | Gone; cloud STT only | Local Whisper, worker, model downloads, onnxruntime, transformers | Delete | `npm ci` downloads no models | todo |
| Other features | Gone | Phone mirror, calendar, cURL provider, profile intelligence, premium modes, dynamic actions, web search, OCR, follow-up email, donation and support toasters | Delete or reduce to the plain answer path | Build and typecheck | todo |
| Type errors | Electron `tsc` exits 0 | 33 errors | Fix in kept code | `npm run typecheck:electron` | todo |

## Phase 2 – identity, build and security base

| Item | Target | Baseline | Gap / source | Check | Status |
| --- | --- | --- | --- | --- | --- |
| Name and IDs | `Margin`, `io.github.xbz123.margin` | `Natively`, `com.electron.meeting-notes` | Change config and runtime | Packaged Info.plist | todo |
| Data directory | Only `~/Library/Application Support/Margin`; never reads old Natively data | Electron default (`natively`) | Set name and path before any storage access | Test against a synthetic home directory | todo |
| Icons | Margin two-line icon | Natively icon | Self-authored SVGs and generator from Margin commit `cbb92b8a` | Ledger row; regenerate | todo |
| Credential storage | Encrypted with OS secure storage; never stored as plain text | CredentialsManager with safeStorage | Check and fix the failure path | Unit test without real keys | todo |
| Log redaction | Keys and tokens never written to logs | `redactForLog` exists | Check coverage | Unit test | todo |
| Outbound boundary | Only user-configured AI and STT endpoints; no other hosts | Many fixed hosts | Remove fixed hosts | grep and a test of the endpoint list | todo |
| Local build | Builds a Mac package without publishing | `publish` points at upstream GitHub | `publish: null`; local build script | Inspect config; local build | todo |
| Notices | AGPL kept; Natively copyright kept; Margin changes stated | Natively README | NOTICE and README rewritten | Review | todo |

## Phases 3–6 (later)

| Phase | Items | Baseline has |
| --- | --- | --- |
| 3 Answers | Text and screenshot questions, written-exam mode, streaming, cancel; OpenAI Chat, OpenAI Responses, Anthropic Messages and Gemini protocols; fallback model; errors; Codex CLI login as a separate source | Multi-provider LLMHelper, Codex CLI provider, screenshots, streaming |
| 4 Audio | Mic and system audio; OpenAI, Soniox, Groq, Aliyun and Doubao STT; retained manual actions with the S41/S43 dual-channel input contract (D8=A, keep connections); no automatic answers or Judge | Native capture, Deepgram, Soniox, ElevenLabs, OpenAI, Google and REST STT; "what to answer" path |
| 5 Context and meetings | Full-text Local Context without prewarming; append-only prompt Skills and interview/written scenarios; local transcript list/detail/copy only, no automatic summaries, title generation, startup recovery or meeting chat | SkillsManager, MeetingPersistence |
| 6 Settings and release | Settings pages, English and Simplified Chinese UI, window protection, shortcuts, click-through, onboarding, README and PRIVACY | Content protection, disguise, stealth keyboard, keybinds, click-through |

Release order: macOS first, Windows implementation/acceptance/release later, then assess shared code and branch integration. Portability remains a constraint during Mac work. Separate platform icon designs and real screen-sharing evidence are pending; existing code is not proof of invisibility on a particular OS/application version. A black rectangle replacing the assistant is explicitly unacceptable (S43). Ticket CI in the public repository is authorized after each ticket commit; that is not a release or real-service authorization.
