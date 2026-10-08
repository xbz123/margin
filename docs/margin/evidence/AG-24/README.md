# AG-24 outbound boundaries and S16

Implementation and final local gates passed; fresh CI and Claude's read-only
review remain pending. [OUTBOUND.md](../../OUTBOUND.md) inventories current
transports, explicit configuration sources and retained limitations.

HTTP transports validate URL syntax and refuse automatic redirects. Fixed
provider origins and explicit user endpoints remain supported; this is not a
claim that the generic URL validator is an origin authorization allowlist.
Region-derived destinations cannot change authority. Gemini cache creation
rechecks sharing scopes after waits, as do final sends and application retries.
SDK/loopback tests include allowed requests and refused 307 forwarding.

STT provider/key revocation discards pending audio before capture teardown;
normal meeting Stop retains its tail-drain protocol. Transcripts remains a
text-sharing permission, not a new audio permission. Remote Markdown images,
including imperative streaming HTML, and the external font import are removed.
The real renderer check has a positive load control without CSP; its own gate
step is now included in both local and CI runs.

S16 was explicitly approved by the user: Google STT accepts validated
service_account JSON only. File selection, saved/environment paths and client
creation share validation, and SDK options contain only necessary validated
fields. Standard/legacy account formats and explicit universe configuration are
covered. Invalid input preserves stored credentials and gives safe existing UI
feedback without preventing settings startup or silently switching accounts.
The installed SDK signed a synthetic local JWT with zero auth HTTP, ADC,
gcloud or metadata calls. A malicious credential token URI is rejected before
either redirect hop; no real OAuth or provider service was exercised.

`checks/precommit-3/` is the final 16-step run, all commands exit zero: 112 test
files, 864 tests / 859 pass / 0 fail / 5 existing skips. Raw TAP totals match.
AG-09 6/6, storage 5/5, startup 1/1 and outbound renderer 1/1 passed. Root
summary/reference files are unchanged copies and retain original log paths.
This precommit run records dirty paths over `f7598036`, not a clean commit.

Earlier evidence is retained: cache-before-scope failure; URL construction and
test-fixture corrections; restricted renderer launches; initial Google boundary
and SDK-harness failures; the first full run's old VM dependencies; and the second
run's AG-09 partial-observation failure. The bootstrap fix preserves logging and
identity before outbound/Axios import, with a red/green import canary.

The AG-09 diagnostic observed a real partial state followed by the complete
answer 287 ms later, and reproduced a late-sampling false failure. It does not
reconstruct the original failed run's complete timing. The repaired test holds
the mock after exactly two chunks until the renderer shows a partial answer,
then releases the tail, including on failure. It neither changes production
streaming nor increases the original delay; cancellation checks remain intact.

Inventory AST checks cover the registered syntax/forms, not whole-program
alias/dataflow analysis. Already submitted data cannot be recalled. Codex-owned
destinations/retries remain the documented AG-34 limitation. No live service,
device, keychain, real credential or native rebuild was used locally; no app was
installed or published. Actual package verification remains AG-25.
