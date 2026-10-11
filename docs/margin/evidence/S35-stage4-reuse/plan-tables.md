<!-- AG-40 code -->
| 文件 | 做法 | Margin 行 / 有效行 | 命中 | 快照行 | 缺少的依赖 |
| --- | --- | --- | --- | --- | --- |
| `electron/audio/MeetingSttSession.ts` | 改写命中行后引入 | 188/190 | 15 | 2 | — |
| `electron/osEventSubscriptions.ts` | 改写命中行后引入 | 38/40 | 0 | 2 | — |
| `native-module/src/microphone.rs` | 取 Margin 改动 | 18/303 | 2 | 0 | — |
| `electron/audio/AudioDevices.ts` | 取 Margin 改动并改写命中行 | 42/48 | 1 | 1 | `electron/audio/audioDeviceSelection.mjs` |
| `src/components/ui/RollingTranscript.tsx` | 取 Margin 改动并改写命中行 | 3/42 | 2 | 3 | `src/i18n.tsx` |
| `electron/IntelligenceManager.ts` | 只取片段 | 26/270 | 0 | 90 | — |
| `electron/SessionTracker.ts` | 只取片段 | 163/732 | 1 | 236 | — |
| `electron/audio/AudioSettingsTestSession.ts` | 只取片段 | 209/209 | 58 | 0 | — |
| `electron/audio/MeetingAudioPipeline.ts` | 只取片段 | 1409/1793 | 459 | 384 | — |
| `electron/audio/TranscriptDisplayThrottle.ts` | 只取片段 | 30/38 | 8 | 8 | — |
| `electron/audio/screenCapturePermissions.ts` | 只取片段 | 19/279 | 0 | 260 | — |
| `electron/ipc/interviewSessionHandlers.ts` | 只取片段 | 101/101 | 47 | 0 | — |
| `electron/lifecycle/intelligenceEventBridge.ts` | 只取片段 | 168/191 | 39 | 23 | — |
| `native-module/src/lib.rs` | 只取片段 | 17/538 | 0 | 191 | — |

<!-- AG-40 tests -->
| 文件 | 做法 | Margin 行 / 有效行 | 命中 | 快照行 | 缺少的依赖 |
| --- | --- | --- | --- | --- | --- |
| `electron/audio/__tests__/MeetingAudioPipelineRaces.test.mjs` | 改写命中行后引入 | 373/375 | 5 | 2 | — |
| `electron/audio/__tests__/MeetingSttSession.test.mjs` | 改写命中行后引入 | 171/173 | 0 | 2 | — |
| `electron/audio/__tests__/TranscriptDisplayThrottle.test.mjs` | 改写命中行后引入 | 45/48 | 1 | 3 | — |
| `electron/lifecycle/__tests__/intelligenceEventBridge.test.mjs` | 改写命中行后引入 | 118/118 | 5 | 0 | — |
| `electron/services/__tests__/Mg21StopConsumer2026_09_27.test.mjs` | 改写命中行后引入 | 100/106 | 2 | 6 | — |
| `electron/audio/__tests__/BeforeQuitShutdownRace.test.mjs` | 取 Margin 改动 | 9/74 | 0 | 0 | — |
| `electron/audio/__tests__/DefaultOutputWatcherEpoch.test.mjs` | 取 Margin 改动 | 2/51 | 0 | 0 | — |
| `electron/audio/__tests__/ForwardLogHardening.test.mjs` | 取 Margin 改动 | 9/12 | 1 | 0 | — |
| `electron/audio/__tests__/IpcOnIdempotency.test.mjs` | 取 Margin 改动 | 7/24 | 0 | 0 | — |
| `electron/audio/__tests__/MicRecoveryUsesCanonicalWiring.test.mjs` | 取 Margin 改动 | 3/62 | 0 | 0 | — |
| `electron/audio/__tests__/ReconnectStormCap.test.mjs` | 取 Margin 改动 | 42/50 | 0 | 0 | — |
| `electron/audio/__tests__/SystemAudioRecoveryRouteChangeMutex.test.mjs` | 取 Margin 改动 | 3/116 | 0 | 0 | — |
| `electron/audio/__tests__/TokenBatchFlushNoTrailing.test.mjs` | 取 Margin 改动 | 1/72 | 0 | 0 | — |
| `electron/services/__tests__/AudioTestSystemAudioLevelMeter.test.mjs` | 取 Margin 改动 | 139/141 | 3 | 0 | — |
| `electron/services/__tests__/MicRecoveryEmitsTerminalIpc.test.mjs` | 取 Margin 改动 | 1/175 | 0 | 0 | — |
| `electron/services/__tests__/RestartCapturesAfterResumeResetsCounters.test.mjs` | 取 Margin 改动 | 2/172 | 0 | 0 | — |
| `electron/services/__tests__/SetupSystemAudioPipelineConstructionGuards.test.mjs` | 取 Margin 改动 | 1/227 | 0 | 0 | — |
| `electron/services/__tests__/SetupSystemAudioPipelinePermissionAlwaysChecked.test.mjs` | 取 Margin 改动 | 1/235 | 0 | 0 | — |
| `electron/services/__tests__/SttAwaitingAudioInitialState.test.mjs` | 取 Margin 改动 | 4/125 | 0 | 0 | — |
| `electron/services/__tests__/StuckWatchdogTwelveSeconds.test.mjs` | 取 Margin 改动 | 5/153 | 0 | 0 | — |
| `electron/audio/__tests__/AudioStatusBroadcastTargeting.test.mjs` | 取 Margin 改动并改写命中行 | 24/73 | 0 | 6 | — |
| `electron/audio/__tests__/EndMeetingAbortsInFlightInit.test.mjs` | 取 Margin 改动并改写命中行 | 26/32 | 0 | 1 | — |
| `electron/audio/__tests__/StuckWatchdogDisarmOnEndAndAbort.test.mjs` | 取 Margin 改动并改写命中行 | 11/118 | 0 | 7 | — |
| `electron/services/__tests__/AudioInitPromiseClearedInFinally.test.mjs` | 取 Margin 改动并改写命中行 | 26/124 | 0 | 2 | — |
| `electron/services/__tests__/MainTeardown.test.mjs` | 取 Margin 改动并改写命中行 | 6/24 | 0 | 1 | — |
| `electron/audio/__tests__/AudioDevicesAsyncBoundary.test.mjs` | 只取片段 | 144/149 | 18 | 5 | — |
| `electron/audio/__tests__/MeetingLifecycleDbLiveness2026_08_07.test.mjs` | 只取片段 | 24/160 | 2 | 136 | — |
| `electron/audio/__tests__/MeetingLifecycleSerialization2026_08_07.test.mjs` | 只取片段 | 71/302 | 1 | 231 | — |
| `electron/services/__tests__/OsEventSubscriptions2026_09_27.test.mjs` | 只取片段 | 53/61 | 2 | 8 | — |
| `src/components/__tests__/MeetingStartFailureConsumer2026_09_27.test.mjs` | 只取片段 | 52/59 | 0 | 7 | — |

<!-- AG-41 code -->
| 文件 | 做法 | Margin 行 / 有效行 | 命中 | 快照行 | 缺少的依赖 |
| --- | --- | --- | --- | --- | --- |
| `electron/audio/AliyunStreamingSTT.ts` | 改写命中行后引入 | 330/355 | 14 | 25 | — |
| `electron/audio/DoubaoStreamingSTT.ts` | 改写命中行后引入 | 425/445 | 18 | 20 | — |
| `electron/ipc/sttHandlers.ts` | 改写命中行后引入 | 44/45 | 0 | 1 | `electron/utils/requestSafety.ts` |
| `src/components/settings/SpeechProviderSettings.tsx` | 改写命中行后引入 | 70/70 | 6 | 0 | `src/i18n.tsx` |
| `electron/config/languages.ts` | 取 Margin 改动 | 7/67 | 0 | 0 | — |
| `src/config/stt.constants.ts` | 取 Margin 改动 | 66/66 | 1 | 0 | — |
| `electron/audio/OpenAIStreamingSTT.ts` | 取 Margin 改动并改写命中行 | 224/680 | 1 | 15 | `electron/audio/wsSafeTeardown.ts`, `electron/utils/requestSafety.ts` |
| `electron/audio/RestSTT.ts` | 取 Margin 改动并改写命中行 | 154/397 | 9 | 0 | — |
| `electron/audio/SonioxStreamingSTT.ts` | 只取片段 | 91/424 | 2 | 76 | — |
| `src/components/settings/SpeechTranscriptionSettings.tsx` | 只取片段 | 90/386 | 4 | 296 | — |

<!-- AG-41 tests -->
| 文件 | 做法 | Margin 行 / 有效行 | 命中 | 快照行 | 缺少的依赖 |
| --- | --- | --- | --- | --- | --- |
| `electron/audio/__tests__/DomesticStreamingLifecycle.test.mjs` | 改写命中行后引入 | 284/290 | 16 | 6 | — |
| `electron/audio/__tests__/MeetingStartAudioGate2026_09_27.test.mjs` | 改写命中行后引入 | 95/102 | 0 | 7 | — |
| `electron/audio/__tests__/SonioxRestProviderContract.test.mjs` | 改写命中行后引入 | 175/182 | 14 | 7 | — |
| `electron/services/__tests__/SttHandlers.test.mjs` | 改写命中行后引入 | 108/112 | 5 | 4 | — |
| `electron/services/__tests__/SttSettingsContract.test.mjs` | 改写命中行后引入 | 48/52 | 1 | 4 | — |
| `electron/audio/__tests__/RestSttSafetyNetGate.test.mjs` | 取 Margin 改动 | 7/79 | 0 | 0 | — |
| `electron/services/__tests__/SttApiKeyRedaction.test.mjs` | 取 Margin 改动并改写命中行 | 47/55 | 1 | 2 | — |
| `electron/audio/__tests__/DoubaoProtocol.test.mjs` | 只取片段 | 40/46 | 0 | 6 | — |
| `electron/services/__tests__/OpenAIRealtimeGAProtocol.test.mjs` | 只取片段 | 170/665 | 7 | 79 | — |
| `electron/services/__tests__/StaleSttConnectionGuards2026_08_18.test.mjs` | 只取片段 | 15/34 | 0 | 19 | — |
| `src/components/__tests__/SpeechProviderBrandMarkCoverage.test.mjs` | 只取片段 | 18/21 | 0 | 3 | — |

<!-- AG-42 code -->
| 文件 | 做法 | Margin 行 / 有效行 | 命中 | 快照行 | 缺少的依赖 |
| --- | --- | --- | --- | --- | --- |
| `src/lib/directAssistAnswerState.ts` | 整文件引入 | 43/43 | 1 | 0 | — |
| `electron/direct-assist/DirectAssistService.ts` | 改写命中行后引入 | 88/93 | 4 | 5 | `electron/direct-assist/errors.ts`, `electron/direct-assist/requestBuilder.ts`, `electron/direct-assist/types.ts` |
| `src/lib/overlayActionDedup.mjs` | 取 Margin 改动 | 3/31 | 0 | 0 | — |
| `electron/IntelligenceEngine.ts` | 只取片段 | 402/1176 | 6 | 314 | — |
| `electron/direct-assist/errors.ts` | 只取片段 | 33/99 | 0 | 66 | — |
| `electron/ipc/answerActionHandlers.ts` | 只取片段 | 92/285 | 2 | 193 | — |
| `electron/ipc/answerHandlers.ts` | 只取片段 | 452/460 | 202 | 8 | — |
| `electron/ipc/directAssistValidation.ts` | 只取片段 | 236/273 | 150 | 37 | — |
| `electron/ipc/legacyChatHandlers.ts` | 只取片段 | 115/155 | 0 | 40 | — |
| `electron/preload/answerBridge.ts` | 只取片段 | 26/292 | 0 | 266 | — |
| `src/components/NativelyInterface.tsx` | 只取片段 | 531/7388 | 11 | 4224 | — |

<!-- AG-42 tests -->
| 文件 | 做法 | Margin 行 / 有效行 | 命中 | 快照行 | 缺少的依赖 |
| --- | --- | --- | --- | --- | --- |
| `electron/services/__tests__/InterviewDirectAssist.test.mjs` | 改写命中行后引入 | 95/101 | 2 | 6 | — |
| `electron/services/__tests__/MeetingAnswerBoundary2026_09_27.test.mjs` | 改写命中行后引入 | 64/67 | 1 | 3 | — |
| `electron/audio/__tests__/LlmStreamAbortController.test.mjs` | 取 Margin 改动 | 21/89 | 1 | 0 | — |
| `electron/audio/__tests__/ModelChangedTargeting.test.mjs` | 取 Margin 改动 | 4/45 | 0 | 0 | — |
| `electron/audio/__tests__/NativelyInterfaceEffectDeps.test.mjs` | 取 Margin 改动 | 6/109 | 0 | 0 | — |
| `src/lib/__tests__/overlayActionDedup.test.mjs` | 取 Margin 改动 | 6/67 | 0 | 0 | — |
| `electron/llm/__tests__/DirectAssistCore2026_08_29.test.mjs` | 只取片段 | 77/86 | 0 | 9 | — |
| `electron/services/__tests__/DirectAssistIpcBridge2026_08_29.test.mjs` | 只取片段 | 76/342 | 1 | 266 | — |
| `electron/services/__tests__/ScreenshotOutranksTextDecline2026_08_19.test.mjs` | 只取片段 | 24/101 | 1 | 77 | — |
| `src/lib/__tests__/DirectAssistAnswerState2026_09_27.test.mjs` | 只取片段 | 53/61 | 0 | 8 | — |
| `src/lib/__tests__/directAssistRenderer2026_08_29.test.mjs` | 只取片段 | 26/339 | 0 | 313 | — |

<!-- AG-50 code -->
| 文件 | 做法 | Margin 行 / 有效行 | 命中 | 快照行 | 缺少的依赖 |
| --- | --- | --- | --- | --- | --- |
| `electron/llm/promptAssembly.ts` | 整文件引入 | 41/41 | 1 | 0 | — |
| `electron/llm/promptBudget.ts` | 整文件引入 | 51/51 | 0 | 0 | — |
| `electron/ipc/configContextHandlers.ts` | 只取片段 | 167/248 | 47 | 81 | — |
| `src/components/settings/LocalContextSettings.tsx` | 只取片段 | 56/69 | 2 | 13 | — |

<!-- AG-50 tests -->
| 文件 | 做法 | Margin 行 / 有效行 | 命中 | 快照行 | 缺少的依赖 |
| --- | --- | --- | --- | --- | --- |
| `tests/fixtures/documents/README.md` | 整文件引入 | 5/5 | 0 | 0 | — |
| `tests/fixtures/documents/synthetic.docx` | 整文件引入 | 2/2 | 0 | 0 | — |
| `tests/fixtures/documents/synthetic.pdf` | 整文件引入 | 18/18 | 0 | 0 | — |
| `electron/llm/__tests__/PromptBudget2026_09_27.test.mjs` | 改写命中行后引入 | 78/84 | 0 | 6 | — |
| `electron/services/__tests__/ManualContextFallback2026_06_16.test.mjs` | 只取片段 | 16/179 | 0 | 163 | — |

<!-- AG-51 code -->
| 文件 | 做法 | Margin 行 / 有效行 | 命中 | 快照行 | 缺少的依赖 |
| --- | --- | --- | --- | --- | --- |
| `electron/services/skills/PromptSkillImporter.ts` | 改写命中行后引入 | 139/139 | 4 | 0 | `electron/services/LocalContextStore.ts`, `electron/services/skills/SkillUploader.ts`, `electron/services/skills/SkillValidator.ts` |
| `src/components/settings/SkillsSettings.tsx` | 只取片段 | 79/214 | 2 | 105 | — |

<!-- AG-51 tests -->
| 文件 | 做法 | Margin 行 / 有效行 | 命中 | 快照行 | 缺少的依赖 |
| --- | --- | --- | --- | --- | --- |
| `electron/services/__tests__/PromptSkillImporter.test.mjs` | 改写命中行后引入 | 110/113 | 6 | 3 | — |
| `electron/llm/__tests__/modePrompts.test.mjs` | 取 Margin 改动 | 1/22 | 0 | 0 | — |
| `electron/llm/__tests__/CodeHintV3Adoption2026_09_05.test.mjs` | 只取片段 | 35/44 | 0 | 9 | — |
| `electron/llm/__tests__/ProactiveV3PromptSubstitution.test.mjs` | 只取片段 | 34/52 | 0 | 18 | — |
| `electron/llm/__tests__/ResponseLanguageUnified2026_09_27.test.mjs` | 只取片段 | 18/24 | 0 | 6 | — |
| `electron/services/__tests__/Issue303SkillInvocation.test.mjs` | 只取片段 | 38/139 | 0 | 101 | — |
| `electron/services/__tests__/PromptSkillConsumerChain.test.mjs` | 只取片段 | 58/68 | 4 | 10 | — |
| `electron/services/__tests__/SkillsIpcWiring.test.mjs` | 只取片段 | 60/584 | 0 | 336 | — |

<!-- AG-60 code -->
| 文件 | 做法 | Margin 行 / 有效行 | 命中 | 快照行 | 缺少的依赖 |
| --- | --- | --- | --- | --- | --- |
| `src/components/settings/settingsTabs.ts` | 整文件引入 | 9/9 | 0 | 0 | — |
| `src/lib/overlayMessageLocalization.ts` | 整文件引入 | 28/28 | 0 | 0 | — |
| `electron/i18n/mainStrings.ts` | 改写命中行后引入 | 42/43 | 2 | 1 | — |
| `src/i18n.zh.ts` | 改写命中行后引入 | 921/925 | 90 | 4 | — |
| `electron/ThemeManager.ts` | 取 Margin 改动 | 1/61 | 0 | 0 | — |
| `src/components/EditableTextBlock.tsx` | 取 Margin 改动 | 4/106 | 2 | 0 | `src/i18n.tsx` |
| `src/components/ErrorBoundary.tsx` | 取 Margin 改动 | 8/92 | 0 | 0 | `src/i18n.tsx` |
| `src/components/TopSearchPill.tsx` | 取 Margin 改动并改写命中行 | 17/232 | 0 | 1 | `src/i18n.tsx` |
| `src/components/settings/HelpSettings.tsx` | 取 Margin 改动并改写命中行 | 81/85 | 5 | 1 | `src/i18n.tsx`, `src/assets/zoom-capture-mode.png`, `src/components/settings/SettingsKit.tsx` |
| `src/components/ui/TopPill.tsx` | 取 Margin 改动并改写命中行 | 4/56 | 2 | 3 | `src/i18n.tsx` |
| `src/App.tsx` | 只取片段 | 40/317 | 2 | 81 | — |
| `src/components/Launcher.tsx` | 只取片段 | 58/650 | 1 | 213 | — |
| `src/components/SettingsOverlay.tsx` | 只取片段 | 92/689 | 1 | 244 | — |
| `src/components/SettingsPopup.tsx` | 只取片段 | 22/373 | 2 | 208 | — |
| `src/components/settings/CodeOutputSettings.tsx` | 只取片段 | 21/37 | 2 | 16 | — |
| `src/components/settings/GeneralSettings.tsx` | 只取片段 | 240/347 | 18 | 107 | — |
| `src/components/settings/SettingsKit.tsx` | 只取片段 | 71/72 | 15 | 1 | — |
| `src/components/settings/WrittenExamSettings.tsx` | 只取片段 | 42/59 | 2 | 17 | — |
| `src/i18n.tsx` | 只取片段 | 46/65 | 2 | 19 | — |

<!-- AG-60 tests -->
| 文件 | 做法 | Margin 行 / 有效行 | 命中 | 快照行 | 缺少的依赖 |
| --- | --- | --- | --- | --- | --- |
| `electron/audio/__tests__/InterfaceThemeAllowlist.test.mjs` | 取 Margin 改动 | 1/120 | 0 | 0 | — |
| `electron/services/__tests__/WrittenExamMode.test.mjs` | 只取片段 | 15/91 | 0 | 76 | — |
| `src/components/__tests__/SettingsPeriwinklePortalScopeGuard.test.mjs` | 只取片段 | 19/95 | 0 | 76 | — |
| `src/components/settings/__tests__/SettingsTabs2026_09_27.test.mjs` | 只取片段 | 17/20 | 0 | 3 | — |

<!-- AG-61 code -->
| 文件 | 做法 | Margin 行 / 有效行 | 命中 | 快照行 | 缺少的依赖 |
| --- | --- | --- | --- | --- | --- |
| `src/components/settings/KeybindsSettings.tsx` | 改写命中行后引入 | 65/66 | 4 | 1 | `src/i18n.tsx`, `src/components/settings/SettingsKit.tsx` |
| `src/components/settings/WindowPrivacySettings.tsx` | 改写命中行后引入 | 86/93 | 4 | 7 | `src/components/settings/SettingsKit.tsx` |
| `src/components/WindowControls.tsx` | 取 Margin 改动 | 5/48 | 3 | 0 | `src/i18n.tsx` |
| `electron/WindowHelper.ts` | 只取片段 | 34/2396 | 0 | 1751 | — |
| `electron/WindowPrivacyController.ts` | 只取片段 | 113/432 | 14 | 319 | — |
| `electron/ipc/windowPrivacyHandlers.ts` | 只取片段 | 265/548 | 49 | 283 | — |
| `electron/services/KeybindManager.ts` | 只取片段 | 15/502 | 0 | 183 | — |

<!-- AG-61 tests -->
| 文件 | 做法 | Margin 行 / 有效行 | 命中 | 快照行 | 缺少的依赖 |
| --- | --- | --- | --- | --- | --- |
| `electron/services/__tests__/WindowPrivacyController.test.mjs` | 改写命中行后引入 | 138/143 | 10 | 5 | — |
| `electron/services/__tests__/WindowPrivacyPreloadBridge2026_09_27.test.mjs` | 改写命中行后引入 | 149/155 | 2 | 6 | — |
| `electron/services/__tests__/FormatPermissionMessageCrossPlatform.test.mjs` | 取 Margin 改动 | 1/115 | 0 | 0 | — |
| `electron/services/__tests__/StealthBlockInputFocusGuards.test.mjs` | 取 Margin 改动 | 1/265 | 0 | 0 | — |
| `electron/services/__tests__/AcceleratorCrashGuard2026_08_28.test.mjs` | 只取片段 | 15/158 | 0 | 143 | — |
| `electron/services/__tests__/WindowPrivacyHandlers2026_09_27.test.mjs` | 只取片段 | 56/64 | 0 | 8 | — |

<!-- AG-62 code -->
| 文件 | 做法 | Margin 行 / 有效行 | 命中 | 快照行 | 缺少的依赖 |
| --- | --- | --- | --- | --- | --- |
| `src/lib/setupChecklistStatus.ts` | 整文件引入 | 51/51 | 0 | 0 | — |
| `docs/local-build.md` | 改写命中行后引入 | 28/29 | 0 | 1 | — |
| `electron/localBuildSetup.ts` | 改写命中行后引入 | 20/22 | 0 | 2 | — |
| `scripts/smoke-ai-assistant.cjs` | 改写命中行后引入 | 237/243 | 6 | 6 | — |
| `scripts/smoke-margin-identity.cjs` | 改写命中行后引入 | 969/973 | 14 | 4 | — |
| `scripts/smoke-margin-native.cjs` | 改写命中行后引入 | 175/179 | 5 | 4 | — |
| `scripts/smoke-margin-production.cjs` | 改写命中行后引入 | 56/59 | 0 | 3 | — |
| `scripts/verify-margin-package.cjs` | 改写命中行后引入 | 62/66 | 2 | 4 | — |
| `src/components/SetupChecklist.tsx` | 改写命中行后引入 | 88/91 | 8 | 3 | `src/i18n.tsx` |
| `.gitattributes` | 取 Margin 改动 | 2/22 | 0 | 0 | — |
| `PRIVACY.md` | 取 Margin 改动 | 17/17 | 0 | 0 | — |
| `README.md` | 取 Margin 改动并改写命中行 | 20/22 | 0 | 2 | — |
| `.github/workflows/full-ci.yml` | 只取片段 | 19/22 | 1 | 3 | — |
| `.github/workflows/release.yml` | 只取片段 | 37/43 | 2 | 6 | — |
| `package.json` | 只取片段 | 23/194 | 0 | 65 | — |
| `scripts/ad-hoc-sign.js` | 只取片段 | 18/224 | 0 | 112 | — |
| `scripts/build-electron.js` | 只取片段 | 23/72 | 0 | 18 | — |

<!-- AG-62 tests -->
| 文件 | 做法 | Margin 行 / 有效行 | 命中 | 快照行 | 缺少的依赖 |
| --- | --- | --- | --- | --- | --- |
| `src/lib/__tests__/setupChecklistStatus.test.mjs` | 改写命中行后引入 | 50/52 | 0 | 2 | — |
| `src/lib/__tests__/setupChecklistWiring.test.mjs` | 改写命中行后引入 | 29/32 | 1 | 3 | — |
| `electron/services/__tests__/OnboardingFlags.test.mjs` | 只取片段 | 44/72 | 5 | 28 | — |
| `electron/services/__tests__/StartupLogDirectoryAccess.test.mjs` | 只取片段 | 18/30 | 1 | 12 | — |
| `scripts/__tests__/electron-build-entrypoints.test.mjs` | 只取片段 | 19/25 | 1 | 6 | — |
| `scripts/__tests__/local-build.test.mjs` | 只取片段 | 36/59 | 0 | 23 | — |
| `scripts/__tests__/mac-arch-packaging.test.mjs` | 只取片段 | 30/116 | 0 | 86 | — |
| `scripts/__tests__/packaging-config.test.mjs` | 只取片段 | 21/53 | 1 | 32 | — |

<!-- stage7 code -->
| 文件 | 做法 | Margin 行 / 有效行 | 命中 | 快照行 | 缺少的依赖 |
| --- | --- | --- | --- | --- | --- |
| `src/lib/windowsStealthInput.ts` | 整文件引入 | 21/21 | 0 | 0 | — |
| `electron/utils/windowsFocusPolicy.ts` | 只取片段 | 23/89 | 0 | 66 | — |

<!-- stage7 tests -->
| 文件 | 做法 | Margin 行 / 有效行 | 命中 | 快照行 | 缺少的依赖 |
| --- | --- | --- | --- | --- | --- |
| `src/lib/__tests__/windowsStealthInput.test.mjs` | 改写命中行后引入 | 32/34 | 2 | 2 | — |
| `electron/utils/__tests__/windowsFocusPolicy.test.mjs` | 只取片段 | 46/402 | 1 | 356 | — |

<!-- mixed code -->
| 文件 | 做法 | Margin 行 / 有效行 | 命中 | 快照行 | 缺少的依赖 |
| --- | --- | --- | --- | --- | --- |
| `electron/ipcHandlers.ts` | 只取片段 | 183/522 | 7 | 212 | — |
| `electron/main.ts` | 只取片段 | 485/2098 | 7 | 782 | — |
| `electron/preload.ts` | 只取片段 | 15/60 | 0 | 11 | — |
| `electron/preload/configurationBridge.ts` | 只取片段 | 37/267 | 0 | 230 | — |
| `src/lib/electronAPI.ts` | 只取片段 | 103/581 | 0 | 478 | — |
