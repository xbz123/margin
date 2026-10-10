# R3-5 safety test replacement map

No production callers existed for generateWithPro/generateWithFlash.

| Old cases | Replacement case | Retained assertions |
| --- | --- | --- |
| ProviderGatewayPolicy.test.mjs: generateWithPro / generateWithFlash: final send rechecks after limiter wait | generateContent: final send rechecks after limiter wait | Denial after limiter wait throws ProviderScopeError with zero SDK sends; allowed control reaches SDK once. |
| ScopeLocalFallback.test.mjs: fixed Pro / fixed Flash: scope refusal stays terminal with an explicit backup | selected content generation: scope refusal stays terminal with an explicit backup | Same scope-error object propagates; explicit backup is not sent; exactly one initial send. |
| ScopeLocalFallback.test.mjs: generateWithPro / generateWithFlash refuses transcript denial at the actual send boundary | generateContent refuses transcript denial at the actual send boundary | Allowed control sends once; denied transcript throws ProviderScopeError and sends zero times. |

generateContent remains called by the production testConnection entry. Existing public selected chat, structured generation and streaming tests remain.

R3-5 legacy settings protection adds private/private_vision with successful save, write failure, and rename failure. It checks screenshots=false, other scopes/settings retained, old disk decision retained on failed save, precise tmp-write stage, restart denial, and retired field removal after successful save.

R3-1 fixture adjustments authorize changed origins with synthetic key reentry. The removed-key fixture first saves the changed origin with a nonempty synthetic key, then clears its key at the same origin. Its existing no-environment-fallback assertion remains.

The targeted run only syntax-checks the R3-1 preload case. Its actual Electron execution is recorded in the full `../regression.log` (16/16), with the overall result in `../summary.json`.
