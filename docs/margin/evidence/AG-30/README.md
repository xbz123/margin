# AG-30 — Gemini single-send entry

Starting point: `58a1b446d3da8a158255ea31822f4197cf9c7828` on
`codex/margin-agpl-migration`. PLAN S27–S28 govern this ticket. This record is
not a phase-3 exit or independent-review approval.

## Scope and reference

`electron/llm/generateOnce.ts` owns the physical Gemini SDK generation call
and response interpretation. `LLMHelper` retains routing, prompt assembly,
application retries, sequential fallback and other providers. The existing
Gemini Pro/Flash, generic content, structured, streaming, collected response,
compatibility proxy and meeting-summary paths all delegate to the new entry.
Cache creation stays in `GeminiPromptCache`, with a final scope/abort check.

The result distinguishes completed, refused, incomplete, empty, cancelled and
failed. Missing finish metadata is not synthesized as STOP. Existing pre-output
empty-result fallback remains caller-owned. Terminal refusal/incomplete/partial
failure propagates through the vision helper, answer wrappers and the
what-to-answer engine catch; it cannot be converted into a successful answer or
have another provider's text appended. Other-provider error handling is retained.

Earlier Margin `b8ade3f7` is a structural reference only, as recorded in
`../../PROVENANCE.md`. No old module, prompt, dependency or native binary is
imported. No CI is dispatched for this ticket.

## S27 source-test replacements

All names below refer to tests under `electron/`.

| Removed source assertion | Behavioral replacement |
| --- | --- |
| `suggestionPromptAssembly`: fixed default suffix in generateSuggestion | `llm/__tests__/generateOnce`: suggestion and screenshot wrappers reach the physical Gemini entry with separated content; checks the actual system content |
| `suggestionPromptAssembly`: no custom notes appended to system branches | Same physical-entry test checks notes/transcript in user contents and absent from config; existing suggestion behavior test remains |
| `suggestionPromptAssembly`: WhatToAnswerLLM suffix/no mode strings | Existing WhatToAnswerLLM default-system/transcript-user and runtime-intent/screen-context behavior tests remain |
| `ProviderGatewayPolicy`: routeLLMProviders argument spelling | Existing runtime revocation tests at limiter, retry and provider rotation; new physical-entry context-scopes test |
| `ScopeLocalFallback`: context omission source spelling | New context-scopes test observes no send after revocation and omission of denied saved context on a later allowed request; existing cloud permission tests remain |
| `ScopeLocalFallback`: auxiliary-scope inference source spelling | Same saved-context runtime test plus existing summary/history propagation and revocation tests |

The SDK-send AST guard remains for the 16 legacy non-Gemini sends. Its former
minimum of 20 included the Gemini calls now tested at the new interface.
Image-path and meeting-persistence source tests are not removed by this ticket.

## Verification

`gates-first/summary.json`: all 16 steps exit 0. This run tested the frozen
working-tree implementation on the starting commit above; the summary lists
the uncommitted paths. Only documentation and path-normalized evidence export
were changed after the run, not application code or tests.

- Unit tests: 111 files, 854 tests, 849 passed, 0 failed, 5 existing skips.
  No blocked isolation access or unfinished files. Relative to the accepted
  reference: 17 new interface cases minus 6 replaced source assertions = 11
  additional tests. No new skip; see `gates-first/tests.files.json` and
  `gates-first/tests.tap` rather than a hand-maintained test inventory.
- AG-09: 6/6; storage: 5/5; startup: 1/1; renderer outbound: 2/2.
- Both typechecks and both builds exit 0. G2 has 0 matches. The separate
  `retired-all.log` records 261 rules checked, 0 failing, exit 0.
- `targeted/targeted-final.log`: 138/138, exit 0; final targeted build and
  Electron typecheck both exit 0.

All executable tests use X2, synthetic data/credentials and loopback transports.
The real installed Gemini SDK is exercised against a local HTTP server, not a
real model service. G7 reuses the accepted installation evidence from
`../CI-38057787157/`; dependency manifests, lockfile and native code are unchanged.

The initial source scan is preserved in `provenance-initial/`: exit 1, 14
matches for 13 exact generic statements. Their exact registrations and reasons
are in `../../provenance-config.json`; source pools and exclusions are unchanged.

The three unsuccessful targeted runs remain in `targeted/`:

1. 115/121 passed: successful Gemini fixtures lacked STOP; synchronous fixture
   iterables needed the compatibility previously provided by `for await`; the
   old SDK-send AST count still included the migrated Gemini calls.
2. 135/137 passed: the old AST count and a new test mistaking a normal first-token
   health record for a terminal-error penalty.
3. 136/137 passed: the new exact prompt assertion expected one default suffix,
   whereas the retained suggestion pipeline produces two (see below).

Published logs normalize repository/tool and temporary paths. Unsanitized logs
are preserved locally; only paths were replaced, not assertions, test names,
counts, errors or exit statuses. The first failed records are not overwritten.

## Boundaries and deferred work

- Cancellation stops client waiting/output; it does not establish server-side
  cancellation or billing behavior.
- A behavior test confirmed the retained suggestion path already appends the
  default answer suffix twice (suggestion assembly then streamChat). This is
  not changed here; prompt decisions remain with AG-33.
- Other protocols, centralized retry/deadline policy and frontend changes remain
  AG-31–AG-34 work. No real service, real device, production identity, package
  build or new native installation is part of this ticket.
- Independent review remains pending after local implementation and gates.
