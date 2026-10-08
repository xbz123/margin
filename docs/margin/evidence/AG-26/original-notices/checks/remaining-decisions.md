# Remaining license decisions (read-only findings)

Checked 2026-10-08. No dependency change or upstream message is authorized by
this record. Normal license verification continues to reject these candidates.

| Candidate | Exact limitation | Decision boundary |
| --- | --- | --- |
| eastasianwidth 0.2.0 | The later original MIT-LICENSE addition at `1d41951a59d63fb2d77cda021050fc070cae424a` has package version 0.3.0 and changed JavaScript, unlike the same-version matches used for stream-events/stubs. Exact 0.2.0 source `b89f04d44dc786885615e94cd6e2ba1ef7866fa4` has no complete original license file. | Need an applicable confirmed original notice, or a separately approved dependency-change investigation. Do not silently borrow 0.3.0's notice. |
| react-remove-scroll-bar 2.3.8 | Published gitHead `b3b1287aad81def2e2ae707274b74531b61ddbaf` does not resolve. LICENSE merge `8ca9ba5ea52de03308fe8ced94f7b159a44d28ff` still says version 2.3.7; its later copyright notice is not confirmed for the 2024-published 2.3.8 artifact. PR 76 comments asking this remain without an owner answer. | Need a maintainer-confirmed notice/source binding, or separately approved dependency work. A neighboring version cannot be treated as the exact artifact. |
| realfft 3.5.0 | Exact `d0d4eee0525fd27c96c8a046d6d107acd5ed84a6` declares MIT but lacks a complete original notice. Issue 45 requests MIT+Apache and remains open with zero comments; that proposal is not a grant. | Cannot delete as unused: `native-module/src/resampler.rs` imports and constructs `rubato::FftFixedIn`; rubato 0.16.2's default fft_resampler feature depends on realfft. Disabling it or replacing the resampler changes retained functionality and needs a separate decision. |

Primary references:

- https://github.com/komagata/eastasianwidth/commit/1d41951a59d63fb2d77cda021050fc070cae424a
- https://github.com/theKashey/react-remove-scroll-bar/pull/76
- https://github.com/HEnquist/realfft/issues/45
- https://github.com/HEnquist/realfft/blob/d0d4eee0525fd27c96c8a046d6d107acd5ed84a6/Cargo.toml

Independently fetched metadata hashes:

- eastasianwidth later package.json: SHA-256 `32ffd87591938680573e7ccf18e507d7e0c79e0e25bbc15d77288d097b69690e`, version 0.3.0.
- react-remove-scroll-bar LICENSE-merge package.json: SHA-256 `484ad46c8cc261e168d7e2602bbb70b80f8d10307b7de91d99485da28c350a03`, version 2.3.7.
- realfft exact Cargo.toml: SHA-256 `d72ddbadf9bb55ed21ae973ac97f0bb4e8df2064af628c54b802b2c7d764c8de`, version 3.5.0, MIT only.

Even resolving all three notices would not fulfill libvips/Skia/vendor coverage,
corresponding-source provision or replacement/relinking obligations. The package
inventory proves observed contents, not these legal/distribution conclusions.
No source-hosting commitment or legal risk acceptance is inferred from S18.

The official npm registry's current latest metadata was also read without
installation: eastasianwidth is 0.3.0 (`e5ee638e2039093c924b60d8a2ba7c12c52549f8`),
whereas react-remove-scroll-bar is still 2.3.8 with the unresolved gitHead above.
A general instruction to upgrade both therefore does not yet identify two
verified replacement artifacts. No registry metadata alone closes the notices.
