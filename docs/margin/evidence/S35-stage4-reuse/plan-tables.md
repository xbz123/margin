<!-- AG-40 code -->
| 文件 | 做法 | 候选行 / 有效行 | 须处置：命中 / 近似 / 快照行 | 依赖 | 跨票 |
| --- | --- | --- | --- | --- | --- |
| `electron/audio/MeetingSttSession.ts` | 处置标出行后引入 | 173/190 | 15 / 0 / 2 | — | — |
| `electron/osEventSubscriptions.ts` | 处置标出行后引入 | 38/40 | 0 / 0 / 2 | — | — |
| `electron/audio/AudioDevices.ts` | 取 Margin 改动并处置标出行 | 41/48 | 1 / 0 / 1，看 diff | `audioDeviceSelection.mjs` 须自写；1 项待核对字段 | — |
| `native-module/src/microphone.rs` | 取 Margin 改动并处置标出行 | 16/303 | 2 / 0 / 0 | — | — |
| `src/components/ui/RollingTranscript.tsx` | 取 Margin 改动并处置标出行 | 1/42 | 2 / 0 / 3，看 diff | `i18n.tsx` 须自写，AG-60a | AG-60a |
| `electron/IntelligenceManager.ts` | 只取片段 | 26/270 | 0 / 0 / 90，看 diff | `SessionTracker.ts` 需适配；`turnIdentity.ts` 改接本分支实现；`DynamicAction.ts` 已退役，删调用；`LiveTranscriptBrain.ts` 须自写；`transcriptQuestionExtractor.ts` 改接本分支实现；另 1 项；3 项待核对字段 | — |
| `electron/SessionTracker.ts` | 只取片段 | 162/732 | 1 / 0 / 236，看 diff | `turnIdentity.ts` 改接本分支实现；`punctuationProvenance.ts` 改接本分支实现；`promptSystemV2.ts` 改接本分支实现；`interimInjectionGuard.ts` 改接本分支实现；2 项待核对字段 | — |
| `electron/audio/AudioSettingsTestSession.ts` | 只取片段 | 151/209 | 58 / 0 / 0 | `screenCapturePermissions.ts` 须自写；2 项待核对字段 | — |
| `electron/audio/MeetingAudioPipeline.ts` | 只取片段 | 950/1793 | 459 / 0 / 384 | `systemAudioHealthClassifier.mjs` 须自写；`audioDeviceSelection.mjs` 须自写；`screenCapturePermissions.ts` 须自写；`speechEdge.ts` 须自写；`MeetingSttSession.ts` 计划引入；5 项待核对字段 | — |
| `electron/audio/TranscriptDisplayThrottle.ts` | 只取片段 | 22/38 | 8 / 0 / 8 | — | — |
| `electron/audio/screenCapturePermissions.ts` | 只取片段 | 19/279 | 0 / 0 / 260 | — | — |
| `electron/ipc/interviewSessionHandlers.ts` | 只取片段 | 54/101 | 47 / 0 / 0 | `SearchOrchestrator.ts` 须自写；1 项待核对字段 | — |
| `electron/lifecycle/intelligenceEventBridge.ts` | 只取片段 | 129/191 | 39 / 0 / 23 | — | — |
| `native-module/src/lib.rs` | 只取片段 | 17/538 | 0 / 0 / 191，看 diff | — | — |

<!-- AG-40 tests -->
| 文件 | 做法 | 候选行 / 有效行 | 须处置：命中 / 近似 / 快照行 | 依赖 | 跨票 |
| --- | --- | --- | --- | --- | --- |
| `electron/audio/__tests__/BeforeQuitShutdownRace.test.mjs` | 取 Margin 改动（候选） | 9/74 | 0 / 0 / 0 | — | — |
| `electron/audio/__tests__/IpcOnIdempotency.test.mjs` | 取 Margin 改动（候选） | 7/24 | 0 / 0 / 0 | — | — |
| `electron/audio/__tests__/MicRecoveryUsesCanonicalWiring.test.mjs` | 取 Margin 改动（候选） | 3/62 | 0 / 0 / 0 | — | — |
| `electron/audio/__tests__/ReconnectStormCap.test.mjs` | 取 Margin 改动（候选） | 42/50 | 0 / 0 / 0 | — | — |
| `electron/audio/__tests__/SystemAudioRecoveryRouteChangeMutex.test.mjs` | 取 Margin 改动（候选） | 3/116 | 0 / 0 / 0 | — | — |
| `electron/audio/__tests__/TokenBatchFlushNoTrailing.test.mjs` | 取 Margin 改动（候选） | 1/72 | 0 / 0 / 0 | — | — |
| `electron/services/__tests__/MicRecoveryEmitsTerminalIpc.test.mjs` | 取 Margin 改动（候选） | 1/175 | 0 / 0 / 0 | `MeetingAudioPipeline.ts` 须自写 | — |
| `electron/services/__tests__/RestartCapturesAfterResumeResetsCounters.test.mjs` | 取 Margin 改动（候选） | 2/172 | 0 / 0 / 0 | `MeetingAudioPipeline.ts` 须自写 | — |
| `electron/services/__tests__/SetupSystemAudioPipelineConstructionGuards.test.mjs` | 取 Margin 改动（候选） | 1/227 | 0 / 0 / 0 | `MeetingAudioPipeline.ts` 须自写 | — |
| `electron/services/__tests__/SetupSystemAudioPipelinePermissionAlwaysChecked.test.mjs` | 取 Margin 改动（候选） | 1/235 | 0 / 0 / 0 | `MeetingAudioPipeline.ts` 须自写 | — |
| `electron/services/__tests__/SttAwaitingAudioInitialState.test.mjs` | 取 Margin 改动（候选） | 4/125 | 0 / 0 / 0 | `interviewSessionBridge.ts` 须自写；`electronAPI.ts` 须自写；2 项待核对字段 | — |
| `electron/services/__tests__/StuckWatchdogTwelveSeconds.test.mjs` | 取 Margin 改动（候选） | 5/153 | 0 / 0 / 0 | — | — |
| `electron/audio/__tests__/MeetingAudioPipelineRaces.test.mjs` | 处置标出行后引入 | 368/375 | 5 / 0 / 2 | — | — |
| `electron/audio/__tests__/MeetingSttSession.test.mjs` | 处置标出行后引入 | 171/173 | 0 / 0 / 2 | `MeetingSttSession.ts` 计划引入；`AliyunStreamingSTT.ts` 计划引入，AG-41；`DoubaoStreamingSTT.ts` 计划引入，AG-41；1 项待核对字段 | AG-41 |
| `electron/audio/__tests__/TranscriptDisplayThrottle.test.mjs` | 处置标出行后引入 | 44/48 | 1 / 0 / 3 | — | — |
| `electron/lifecycle/__tests__/intelligenceEventBridge.test.mjs` | 处置标出行后引入 | 113/118 | 5 / 0 / 0 | `intelligenceEventBridge.ts` 须自写 | — |
| `electron/services/__tests__/Mg21StopConsumer2026_09_27.test.mjs` | 处置标出行后引入 | 98/106 | 2 / 0 / 6 | `meetingLifecycleQueue.ts` 须自写；1 项待核对字段 | — |
| `electron/audio/__tests__/AudioStatusBroadcastTargeting.test.mjs` | 取 Margin 改动并处置标出行 | 24/73 | 0 / 0 / 6，看 diff | — | — |
| `electron/audio/__tests__/DefaultOutputWatcherEpoch.test.mjs` | 取 Margin 改动并处置标出行 | 2/51 | 0 / 0 / 0，看 diff | — | — |
| `electron/audio/__tests__/EndMeetingAbortsInFlightInit.test.mjs` | 取 Margin 改动并处置标出行 | 26/32 | 0 / 0 / 1，看 diff | `MeetingAudioPipeline.ts` 须自写；1 项待核对字段 | — |
| `electron/audio/__tests__/ForwardLogHardening.test.mjs` | 取 Margin 改动并处置标出行 | 8/12 | 1 / 0 / 0 | — | — |
| `electron/audio/__tests__/StuckWatchdogDisarmOnEndAndAbort.test.mjs` | 取 Margin 改动并处置标出行 | 10/118 | 0 / 1 / 7，看 diff | — | — |
| `electron/services/__tests__/AudioInitPromiseClearedInFinally.test.mjs` | 取 Margin 改动并处置标出行 | 26/124 | 0 / 0 / 2，看 diff | — | — |
| `electron/services/__tests__/AudioTestSystemAudioLevelMeter.test.mjs` | 取 Margin 改动并处置标出行 | 136/141 | 3 / 0 / 0 | `AudioSettingsTestSession.ts` 须自写；`interviewSessionBridge.ts` 须自写；`electronAPI.ts` 须自写；`SpeechTranscriptionSettings.tsx` 须自写，AG-41；1 项待核对字段 | AG-41 |
| `electron/services/__tests__/MainTeardown.test.mjs` | 取 Margin 改动并处置标出行 | 6/24 | 0 / 0 / 1，看 diff | — | — |
| `electron/audio/__tests__/AudioDevicesAsyncBoundary.test.mjs` | 只取片段 | 126/149 | 18 / 0 / 5 | `audioDeviceSelection.mjs` 须自写 | — |
| `electron/audio/__tests__/MeetingLifecycleDbLiveness2026_08_07.test.mjs` | 只取片段 | 21/160 | 2 / 1 / 136，看 diff | `meetingLifecycleQueue.ts` 须自写；1 项待核对字段 | — |
| `electron/audio/__tests__/MeetingLifecycleSerialization2026_08_07.test.mjs` | 只取片段 | 67/302 | 1 / 3 / 231，看 diff | 1 项待核对字段 | — |
| `electron/services/__tests__/OsEventSubscriptions2026_09_27.test.mjs` | 只取片段 | 51/61 | 2 / 0 / 8 | `osEventSubscriptions.ts` 计划引入；3 项待核对字段 | — |
| `src/components/__tests__/MeetingStartFailureConsumer2026_09_27.test.mjs` | 只取片段 | 52/59 | 0 / 0 / 7 | — | — |

<!-- AG-41 code -->
| 文件 | 做法 | 候选行 / 有效行 | 须处置：命中 / 近似 / 快照行 | 依赖 | 跨票 |
| --- | --- | --- | --- | --- | --- |
| `electron/audio/AliyunStreamingSTT.ts` | 处置标出行后引入 | 316/355 | 14 / 0 / 25 | 1 项待核对字段 | — |
| `electron/audio/DoubaoStreamingSTT.ts` | 处置标出行后引入 | 407/445 | 18 / 0 / 20 | `AliyunStreamingSTT.ts` 计划引入；`stt.constants.ts` 需适配；1 项待核对字段 | — |
| `electron/ipc/sttHandlers.ts` | 处置标出行后引入 | 44/45 | 0 / 0 / 1 | `stt.constants.ts` 需适配；`requestSafety.ts` 须自写；2 项待核对字段 | — |
| `src/components/settings/SpeechProviderSettings.tsx` | 处置标出行后引入 | 64/70 | 6 / 0 / 0 | `stt.constants.ts` 需适配；`i18n.tsx` 须自写，AG-60a | AG-60a |
| `electron/audio/OpenAIStreamingSTT.ts` | 取 Margin 改动并处置标出行 | 223/680 | 1 / 0 / 15，看 diff | `wsSafeTeardown.ts` 须自写；`requestSafety.ts` 须自写；3 项待核对字段 | — |
| `electron/audio/RestSTT.ts` | 取 Margin 改动并处置标出行 | 145/397 | 9 / 0 / 0，看 diff | 1 项待核对字段 | — |
| `electron/config/languages.ts` | 取 Margin 改动并处置标出行 | 7/67 | 0 / 0 / 0，看 diff | — | — |
| `src/config/stt.constants.ts` | 取 Margin 改动并处置标出行 | 65/66 | 1 / 0 / 0，看 diff | — | — |
| `electron/audio/SonioxStreamingSTT.ts` | 只取片段 | 89/424 | 2 / 0 / 76，看 diff | 2 项待核对字段 | — |
| `src/components/settings/SpeechTranscriptionSettings.tsx` | 只取片段 | 86/386 | 4 / 0 / 296 | `i18n.tsx` 须自写，AG-60a；`SpeechProviderSettings.tsx` 计划引入；`SettingsKit.tsx` 须自写，AG-60a；`SettingsToggle.tsx` 须自写；1 项待核对字段 | AG-60a |

<!-- AG-41 tests -->
| 文件 | 做法 | 候选行 / 有效行 | 须处置：命中 / 近似 / 快照行 | 依赖 | 跨票 |
| --- | --- | --- | --- | --- | --- |
| `electron/audio/__tests__/RestSttSafetyNetGate.test.mjs` | 取 Margin 改动（候选） | 7/79 | 0 / 0 / 0 | — | — |
| `electron/audio/__tests__/DomesticStreamingLifecycle.test.mjs` | 处置标出行后引入 | 268/290 | 16 / 0 / 6 | `esbuild` 本分支未声明的 npm 包；`AliyunStreamingSTT.ts` 计划引入；`DoubaoStreamingSTT.ts` 计划引入 | — |
| `electron/audio/__tests__/MeetingStartAudioGate2026_09_27.test.mjs` | 处置标出行后引入 | 95/102 | 0 / 0 / 7 | — | — |
| `electron/audio/__tests__/SonioxRestProviderContract.test.mjs` | 处置标出行后引入 | 161/182 | 14 / 0 / 7 | — | — |
| `electron/services/__tests__/SttHandlers.test.mjs` | 处置标出行后引入 | 103/112 | 5 / 0 / 4 | `esbuild` 本分支未声明的 npm 包；`sttHandlers.ts` 计划引入；1 项待核对字段 | — |
| `electron/services/__tests__/SttSettingsContract.test.mjs` | 处置标出行后引入 | 47/52 | 1 / 0 / 4 | `esbuild` 本分支未声明的 npm 包；`MeetingAudioPipeline.ts` 须自写，AG-40；`sttHandlers.ts` 计划引入；2 项待核对字段 | AG-40 |
| `electron/services/__tests__/SttApiKeyRedaction.test.mjs` | 取 Margin 改动并处置标出行 | 46/55 | 1 / 0 / 2 | `providerSettingsHandlers.ts` 改接本分支实现；`sttHandlers.ts` 计划引入；`SpeechProviderSettings.tsx` 计划引入；1 项待核对字段 | AG-60a |
| `electron/audio/__tests__/DoubaoProtocol.test.mjs` | 只取片段 | 40/46 | 0 / 0 / 6 | `DoubaoStreamingSTT.ts` 计划引入 | — |
| `electron/services/__tests__/OpenAIRealtimeGAProtocol.test.mjs` | 只取片段 | 162/665 | 7 / 1 / 79，看 diff | — | — |
| `electron/services/__tests__/StaleSttConnectionGuards2026_08_18.test.mjs` | 只取片段 | 15/34 | 0 / 0 / 19，看 diff | — | — |
| `src/components/__tests__/SpeechProviderBrandMarkCoverage.test.mjs` | 只取片段 | 17/21 | 0 / 1 / 3，看 diff | `SpeechTranscriptionSettings.tsx` 须自写；`SpeechProviderSettings.tsx` 计划引入；1 项待核对字段 | AG-60a |

<!-- AG-42 code -->
| 文件 | 做法 | 候选行 / 有效行 | 须处置：命中 / 近似 / 快照行 | 依赖 | 跨票 |
| --- | --- | --- | --- | --- | --- |
| `src/lib/overlayActionDedup.mjs` | 取 Margin 改动（候选） | 3/31 | 0 / 0 / 0 | — | — |
| `electron/direct-assist/DirectAssistService.ts` | 处置标出行后引入 | 84/93 | 4 / 0 / 5，看 diff | `errors.ts` 须自写；`requestBuilder.ts` 须自写；`answerGeneration.ts` 改接本分支实现；`generateContract.ts` 需适配；`types.ts` 须自写 | — |
| `src/lib/directAssistAnswerState.ts` | 处置标出行后引入 | 42/43 | 1 / 0 / 0 | — | — |
| `electron/IntelligenceEngine.ts` | 只取片段 | 386/1176 | 6 / 10 / 314，看 diff | `logicalGeneration.ts` 改接本分支实现；`FinalAnswerGenerationPolicy.ts` 改接本分支实现；`PrefetchBuffer.ts` 已退役，删调用；`types.ts` 须自写；`recapFollowUp.ts` 须自写；另 10 项；4 项待核对字段 | — |
| `electron/direct-assist/errors.ts` | 只取片段 | 33/99 | 0 / 0 / 66，看 diff | `types.ts` 须自写 | — |
| `electron/ipc/answerActionHandlers.ts` | 只取片段 | 90/285 | 2 / 0 / 193 | `screenshotCaptureOwnership.ts` 改接本分支实现；`ImageOptimizer.ts` 须自写；`TelemetryService.ts` 已退役，删调用；2 项待核对字段 | — |
| `electron/ipc/answerHandlers.ts` | 只取片段 | 250/460 | 202 / 0 / 8 | `WrittenExamMode.ts` 须自写，AG-60；`index.ts` 须自写；`LocalContextStore.ts` 须自写；`screenshotCaptureOwnership.ts` 改接本分支实现；`answerActionHandlers.ts` 须自写；另 2 项；5 项待核对字段 | AG-60 |
| `electron/ipc/directAssistValidation.ts` | 只取片段 | 86/273 | 150 / 0 / 37 | `local-build.json` 须自写；`CompleteCodeSkill.ts` 须自写；`screenshotCaptureOwnership.ts` 改接本分支实现；`index.ts` 须自写；`requestSafety.ts` 须自写；1 项待核对字段 | — |
| `electron/ipc/legacyChatHandlers.ts` | 只取片段 | 115/155 | 0 / 0 / 40 | `index.ts` 须自写；`LocalContextStore.ts` 须自写；`screenshotCaptureOwnership.ts` 改接本分支实现；`directAssistValidation.ts` 须自写；5 项待核对字段 | — |
| `electron/preload/answerBridge.ts` | 只取片段 | 26/292 | 0 / 0 / 266 | `electronAPI.ts` 须自写 | — |
| `src/components/NativelyInterface.tsx` | 只取片段 | 501/7388 | 11 / 19 / 4224，看 diff | `CodeBlock.tsx` 须自写；`plainCodeText.ts` 须自写；`AutoAnswerManualStatus.tsx` 已退役，删调用；`windowsStealthInput.ts` 计划引入，阶段 7；`displayMarkup.ts` 须自写；另 24 项；9 项待核对字段 | AG-60、AG-60a、阶段 7 |

<!-- AG-42 tests -->
| 文件 | 做法 | 候选行 / 有效行 | 须处置：命中 / 近似 / 快照行 | 依赖 | 跨票 |
| --- | --- | --- | --- | --- | --- |
| `electron/audio/__tests__/ModelChangedTargeting.test.mjs` | 取 Margin 改动（候选） | 4/45 | 0 / 0 / 0 | — | — |
| `electron/audio/__tests__/NativelyInterfaceEffectDeps.test.mjs` | 取 Margin 改动（候选） | 6/109 | 0 / 0 / 0 | — | — |
| `src/lib/__tests__/overlayActionDedup.test.mjs` | 取 Margin 改动（候选） | 6/67 | 0 / 0 / 0 | 1 项待核对字段 | — |
| `electron/services/__tests__/InterviewDirectAssist.test.mjs` | 处置标出行后引入 | 93/101 | 2 / 0 / 6 | 1 项待核对字段 | — |
| `electron/services/__tests__/MeetingAnswerBoundary2026_09_27.test.mjs` | 处置标出行后引入 | 63/67 | 1 / 0 / 3 | `esbuild` 本分支未声明的 npm 包；`answerHandlers.ts` 须自写；`answerActionHandlers.ts` 须自写；`legacyChatHandlers.ts` 须自写 | — |
| `electron/audio/__tests__/LlmStreamAbortController.test.mjs` | 取 Margin 改动并处置标出行 | 20/89 | 1 / 0 / 0，看 diff | `legacyChatHandlers.ts` 须自写；`answerBridge.ts` 须自写；`electronAPI.ts` 须自写；1 项待核对字段 | — |
| `electron/llm/__tests__/DirectAssistCore2026_08_29.test.mjs` | 只取片段 | 75/86 | 0 / 2 / 9，看 diff | `DirectAssistService.ts` 计划引入；`promptAssembly.ts` 计划引入，AG-50 | AG-50 |
| `electron/services/__tests__/DirectAssistIpcBridge2026_08_29.test.mjs` | 只取片段 | 42/342 | 1 / 33 / 266，看 diff | `answerHandlers.ts` 须自写；`directAssistValidation.ts` 须自写；`answerBridge.ts` 须自写；`configurationBridge.ts` 须自写；`electronAPI.ts` 须自写；另 2 项；3 项待核对字段 | — |
| `electron/services/__tests__/ScreenshotOutranksTextDecline2026_08_19.test.mjs` | 只取片段 | 22/101 | 1 / 1 / 77，看 diff | `refusalPolicy.ts` 须自写；`DirectAssistService.ts` 计划引入；`legacyChatHandlers.ts` 须自写 | — |
| `src/lib/__tests__/DirectAssistAnswerState2026_09_27.test.mjs` | 只取片段 | 53/61 | 0 / 0 / 8 | `directAssistAnswerState.ts` 计划引入；`answerActionHandlers.ts` 须自写；`answerBridge.ts` 须自写；`interviewSessionBridge.ts` 须自写；`intelligenceEventBridge.ts` 须自写，AG-40；3 项待核对字段 | AG-40 |
| `src/lib/__tests__/directAssistRenderer2026_08_29.test.mjs` | 只取片段 | 24/339 | 0 / 2 / 313，看 diff | `directAssistWhatToSayPayload.mjs` 须自写 | — |

<!-- AG-50 code -->
| 文件 | 做法 | 候选行 / 有效行 | 须处置：命中 / 近似 / 快照行 | 依赖 | 跨票 |
| --- | --- | --- | --- | --- | --- |
| `electron/llm/promptBudget.ts` | 整文件候选 | 51/51 | 0 / 0 / 0 | `modelTargetCapabilities.ts` 改接本分支实现；`generateContract.ts` 需适配 | — |
| `electron/llm/promptAssembly.ts` | 处置标出行后引入 | 40/41 | 1 / 0 / 0 | `generateContract.ts` 需适配 | — |
| `electron/ipc/configContextHandlers.ts` | 只取片段 | 120/248 | 47 / 0 / 81 | `LocalContextStore.ts` 须自写；`generateOnce.ts` 需适配；`mainStrings.ts` 计划引入，AG-60；`modelCapacityAutoFill.ts` 改接本分支实现；`debug-config.ts` 已退役，删调用；另 5 项；2 项待核对字段 | AG-60 |
| `src/components/settings/LocalContextSettings.tsx` | 只取片段 | 53/69 | 2 / 1 / 13，看 diff | `SettingsKit.tsx` 须自写，AG-60a；`LocalContextPrewarmSetting.tsx` 已退役，删调用；`electronAPI.ts` 须自写；`i18n.tsx` 须自写，AG-60a | AG-60a |

<!-- AG-50 tests -->
| 文件 | 做法 | 候选行 / 有效行 | 须处置：命中 / 近似 / 快照行 | 依赖 | 跨票 |
| --- | --- | --- | --- | --- | --- |
| `tests/fixtures/documents/README.md` | 整文件候选 | 5/5 | 0 / 0 / 0 | — | — |
| `electron/llm/__tests__/PromptBudget2026_09_27.test.mjs` | 处置标出行后引入 | 78/84 | 0 / 0 / 6 | `promptAssembly.ts` 计划引入；`promptBudget.ts` 计划引入；`promptImage.ts` 改接本分支实现 | — |
| `electron/services/__tests__/ManualContextFallback2026_06_16.test.mjs` | 只取片段 | 16/179 | 0 / 0 / 163，看 diff | — | — |
| `tests/fixtures/documents/synthetic.docx` | 资产待审 | — | blob `5978c31d0a08` | — | — |
| `tests/fixtures/documents/synthetic.pdf` | 资产待审 | — | blob `171e30539f1d` | — | — |

<!-- AG-51 code -->
| 文件 | 做法 | 候选行 / 有效行 | 须处置：命中 / 近似 / 快照行 | 依赖 | 跨票 |
| --- | --- | --- | --- | --- | --- |
| `electron/services/skills/PromptSkillImporter.ts` | 处置标出行后引入 | 135/139 | 4 / 0 / 0 | `LocalContextStore.ts` 须自写；`SkillUploader.ts` 须自写；`SkillValidator.ts` 须自写 | — |
| `src/components/settings/SkillsSettings.tsx` | 只取片段 | 67/214 | 2 / 10 / 105，看 diff | `SettingsKit.tsx` 须自写，AG-60a；`i18n.tsx` 须自写，AG-60a；`electron.d.ts` 需适配 | AG-60a |

<!-- AG-51 tests -->
| 文件 | 做法 | 候选行 / 有效行 | 须处置：命中 / 近似 / 快照行 | 依赖 | 跨票 |
| --- | --- | --- | --- | --- | --- |
| `electron/services/__tests__/PromptSkillImporter.test.mjs` | 处置标出行后引入 | 104/113 | 6 / 0 / 3 | `PromptSkillImporter.ts` 计划引入 | — |
| `electron/llm/__tests__/modePrompts.test.mjs` | 取 Margin 改动并处置标出行 | 1/22 | 0 / 0 / 0，看 diff | — | — |
| `electron/llm/__tests__/CodeHintV3Adoption2026_09_05.test.mjs` | 只取片段 | 35/44 | 0 / 0 / 9，看 diff | — | — |
| `electron/llm/__tests__/ProactiveV3PromptSubstitution.test.mjs` | 只取片段 | 33/52 | 0 / 1 / 18，看 diff | — | — |
| `electron/llm/__tests__/ResponseLanguageUnified2026_09_27.test.mjs` | 只取片段 | 18/24 | 0 / 0 / 6 | 1 项待核对字段 | — |
| `electron/services/__tests__/Issue303SkillInvocation.test.mjs` | 只取片段 | 34/139 | 0 / 4 / 101，看 diff | `legacyChatHandlers.ts` 须自写，AG-42；`directAssistValidation.ts` 须自写，AG-42；2 项待核对字段 | AG-42 |
| `electron/services/__tests__/PromptSkillConsumerChain.test.mjs` | 只取片段 | 54/68 | 4 / 0 / 10 | `PromptSkillImporter.ts` 计划引入；`DirectAssistService.ts` 计划引入，AG-42；`answerGeneration.ts` 改接本分支实现；1 项待核对字段 | AG-42 |
| `electron/services/__tests__/SkillsIpcWiring.test.mjs` | 只取片段 | 55/584 | 0 / 5 / 336，看 diff | `configurationBridge.ts` 须自写；`electronAPI.ts` 须自写；`answerBridge.ts` 须自写，AG-42；`interviewSessionBridge.ts` 须自写；`meetingRecordsBridge.ts` 须自写；另 5 项；4 项待核对字段 | AG-42、AG-61 |

<!-- AG-60a code -->
| 文件 | 做法 | 候选行 / 有效行 | 须处置：命中 / 近似 / 快照行 | 依赖 | 跨票 |
| --- | --- | --- | --- | --- | --- |
| `src/i18n.zh.ts` | 处置标出行后引入 | 831/925 | 90 / 0 / 4 | — | — |
| `src/components/settings/SettingsKit.tsx` | 只取片段 | 56/72 | 15 / 0 / 1 | — | — |
| `src/i18n.tsx` | 只取片段 | 42/65 | 2 / 2 / 19，看 diff | `i18n.zh.ts` 计划引入 | — |

<!-- AG-60 code -->
| 文件 | 做法 | 候选行 / 有效行 | 须处置：命中 / 近似 / 快照行 | 依赖 | 跨票 |
| --- | --- | --- | --- | --- | --- |
| `src/components/settings/settingsTabs.ts` | 整文件候选 | 9/9 | 0 / 0 / 0 | — | — |
| `src/lib/overlayMessageLocalization.ts` | 整文件候选 | 28/28 | 0 / 0 / 0 | — | — |
| `electron/ThemeManager.ts` | 取 Margin 改动（候选） | 1/61 | 0 / 0 / 0 | — | — |
| `src/components/ErrorBoundary.tsx` | 取 Margin 改动（候选） | 8/92 | 0 / 0 / 0 | `i18n.tsx` 须自写，AG-60a | AG-60a |
| `electron/i18n/mainStrings.ts` | 处置标出行后引入 | 40/43 | 2 / 0 / 1 | 1 项待核对字段 | — |
| `src/components/EditableTextBlock.tsx` | 取 Margin 改动并处置标出行 | 2/106 | 2 / 0 / 0 | `i18n.tsx` 须自写，AG-60a | AG-60a |
| `src/components/TopSearchPill.tsx` | 取 Margin 改动并处置标出行 | 16/232 | 0 / 1 / 1，看 diff | `i18n.tsx` 须自写，AG-60a；1 项待核对字段 | AG-60a |
| `src/components/settings/HelpSettings.tsx` | 取 Margin 改动并处置标出行 | 75/85 | 5 / 1 / 1，看 diff | `i18n.tsx` 须自写，AG-60a；`zoom-capture-mode.png` 改接本分支实现；`SettingsKit.tsx` 须自写，AG-60a；2 项待核对字段 | AG-60a |
| `src/components/ui/TopPill.tsx` | 取 Margin 改动并处置标出行 | 2/56 | 2 / 0 / 3，看 diff | `i18n.tsx` 须自写，AG-60a；1 项待核对字段 | AG-60a |
| `src/App.tsx` | 只取片段 | 38/317 | 2 / 0 / 81，看 diff | `OverlayAuxWindows.tsx` 须自写；`SetupChecklist.tsx` 计划引入，AG-62；`audioDeviceSelection.mjs` 须自写；`i18n.tsx` 须自写，AG-60a；8 项待核对字段 | AG-60a、AG-62 |
| `src/components/Launcher.tsx` | 只取片段 | 54/650 | 1 / 3 / 213，看 diff | `usePrimaryAnswerTargetLabel.ts` 改接本分支实现；`i18n.tsx` 须自写，AG-60a；`useToggleInit.ts` 须自写；`MeetingSaveNotice.tsx` 已退役，删调用；`meetingSaveStatus.ts` 已退役，删调用；6 项待核对字段 | AG-60a |
| `src/components/SettingsOverlay.tsx` | 只取片段 | 90/689 | 1 / 1 / 244，看 diff | `i18n.tsx` 须自写，AG-60a；`AIProvidersSettings.tsx` 需适配；`SpeechTranscriptionSettings.tsx` 须自写，AG-41；`LocalContextSettings.tsx` 须自写，AG-50；`WrittenExamSettings.tsx` 须自写；另 5 项；6 项待核对字段 | AG-41、AG-50、AG-60a、AG-61 |
| `src/components/SettingsPopup.tsx` | 只取片段 | 20/373 | 2 / 0 / 208，看 diff | `useToggleInit.ts` 须自写；`i18n.tsx` 须自写，AG-60a；3 项待核对字段 | AG-60a |
| `src/components/settings/CodeOutputSettings.tsx` | 只取片段 | 19/37 | 2 / 0 / 16，看 diff | `SettingsKit.tsx` 须自写，AG-60a；`i18n.tsx` 须自写，AG-60a | AG-60a |
| `src/components/settings/GeneralSettings.tsx` | 只取片段 | 222/347 | 18 / 0 / 107 | `i18n.tsx` 须自写，AG-60a；`AutoAnswerIcon.tsx` 已退役，删调用；`SettingsToggle.tsx` 须自写；`AccordionSection.tsx` 须自写；1 项待核对字段 | AG-60a |
| `src/components/settings/WrittenExamSettings.tsx` | 只取片段 | 39/59 | 2 / 1 / 17，看 diff | `CodeOutputSettings.tsx` 须自写；`SettingsKit.tsx` 须自写，AG-60a；`i18n.tsx` 须自写，AG-60a | AG-60a |

<!-- AG-60 tests -->
| 文件 | 做法 | 候选行 / 有效行 | 须处置：命中 / 近似 / 快照行 | 依赖 | 跨票 |
| --- | --- | --- | --- | --- | --- |
| `electron/audio/__tests__/InterfaceThemeAllowlist.test.mjs` | 取 Margin 改动（候选） | 1/120 | 0 / 0 / 0 | — | — |
| `electron/services/__tests__/WrittenExamMode.test.mjs` | 只取片段 | 15/91 | 0 / 0 / 76，看 diff | `WrittenExamMode.ts` 须自写；`requestBuilder.ts` 须自写，AG-42；`errors.ts` 须自写，AG-42 | AG-42 |
| `src/components/__tests__/SettingsPeriwinklePortalScopeGuard.test.mjs` | 只取片段 | 19/95 | 0 / 0 / 76，看 diff | `AnswerConfigurationFields.tsx` 改接本分支实现；`AnswerConfigurationPanel.tsx` 改接本分支实现；`CodeOutputSettings.tsx` 须自写；`CodexAuthorizationSettings.tsx` 改接本分支实现；`GeneralSettings.tsx` 须自写；另 12 项；5 项待核对字段 | AG-41、AG-50、AG-60a、AG-61 |
| `src/components/settings/__tests__/SettingsTabs2026_09_27.test.mjs` | 只取片段 | 17/20 | 0 / 0 / 3 | `settingsTabs.ts` 计划引入 | — |

<!-- AG-61 code -->
| 文件 | 做法 | 候选行 / 有效行 | 须处置：命中 / 近似 / 快照行 | 依赖 | 跨票 |
| --- | --- | --- | --- | --- | --- |
| `src/components/settings/KeybindsSettings.tsx` | 处置标出行后引入 | 61/66 | 4 / 0 / 1 | `i18n.tsx` 须自写，AG-60a；`SettingsKit.tsx` 须自写，AG-60a；2 项待核对字段 | AG-60a |
| `src/components/settings/WindowPrivacySettings.tsx` | 处置标出行后引入 | 82/93 | 4 / 0 / 7 | `SettingsKit.tsx` 须自写，AG-60a；1 项待核对字段 | AG-60a |
| `src/components/WindowControls.tsx` | 取 Margin 改动并处置标出行 | 2/48 | 3 / 0 / 0 | `i18n.tsx` 须自写，AG-60a | AG-60a |
| `electron/WindowHelper.ts` | 只取片段 | 32/2396 | 0 / 2 / 1751，看 diff | `launcherAspect.ts` 须自写；`launcherResizeAnimation.ts` 须自写；`windowsFocusPolicy.ts` 须自写，阶段 7；`overlayCustomSize.mjs` 须自写；5 项待核对字段 | 阶段 7 |
| `electron/WindowPrivacyController.ts` | 只取片段 | 99/432 | 14 / 0 / 319 | `toggleStateReducer.ts` 需适配；5 项待核对字段 | — |
| `electron/ipc/windowPrivacyHandlers.ts` | 只取片段 | 216/548 | 49 / 0 / 283 | `ProviderRouter.ts` 需适配；`micPermissionPolicy.mjs` 须自写；5 项待核对字段 | — |
| `electron/services/KeybindManager.ts` | 只取片段 | 15/502 | 0 / 0 / 183，看 diff | `keybindRegistrationState.ts` 须自写；`acceleratorValidation.ts` 须自写；`winChord.ts` 须自写；`mainStrings.ts` 计划引入，AG-60；1 项待核对字段 | AG-60 |

<!-- AG-61 tests -->
| 文件 | 做法 | 候选行 / 有效行 | 须处置：命中 / 近似 / 快照行 | 依赖 | 跨票 |
| --- | --- | --- | --- | --- | --- |
| `electron/services/__tests__/FormatPermissionMessageCrossPlatform.test.mjs` | 取 Margin 改动（候选） | 1/115 | 0 / 0 / 0 | `screenCapturePermissions.ts` 须自写，AG-40；1 项待核对字段 | AG-40 |
| `electron/services/__tests__/StealthBlockInputFocusGuards.test.mjs` | 取 Margin 改动（候选） | 1/265 | 0 / 0 / 0 | 1 项待核对字段 | — |
| `electron/services/__tests__/WindowPrivacyController.test.mjs` | 处置标出行后引入 | 128/143 | 10 / 0 / 5 | — | — |
| `electron/services/__tests__/WindowPrivacyPreloadBridge2026_09_27.test.mjs` | 处置标出行后引入 | 147/155 | 2 / 0 / 6 | `windowPrivacyBridge.ts` 须自写；1 项待核对字段 | — |
| `electron/services/__tests__/AcceleratorCrashGuard2026_08_28.test.mjs` | 只取片段 | 15/158 | 0 / 0 / 143，看 diff | `acceleratorValidation.ts` 须自写；`WindowPrivacyController.ts` 须自写；4 项待核对字段 | — |
| `electron/services/__tests__/WindowPrivacyHandlers2026_09_27.test.mjs` | 只取片段 | 56/64 | 0 / 0 / 8 | `windowPrivacyHandlers.ts` 须自写；1 项待核对字段 | — |

<!-- AG-62 code -->
| 文件 | 做法 | 候选行 / 有效行 | 须处置：命中 / 近似 / 快照行 | 依赖 | 跨票 |
| --- | --- | --- | --- | --- | --- |
| `src/lib/setupChecklistStatus.ts` | 整文件候选 | 51/51 | 0 / 0 / 0 | `stt.constants.ts` 需适配；`modelTargetCapabilities.ts` 改接本分支实现 | — |
| `docs/local-build.md` | 处置标出行后引入 | 28/29 | 0 / 0 / 1，看 diff | — | — |
| `electron/localBuildSetup.ts` | 处置标出行后引入 | 19/22 | 0 / 1 / 2，看 diff | — | — |
| `scripts/smoke-ai-assistant.cjs` | 处置标出行后引入 | 231/243 | 6 / 0 / 6 | `playwright` 本分支未声明的 npm 包 | — |
| `scripts/smoke-margin-identity.cjs` | 处置标出行后引入 | 955/973 | 14 / 0 / 4 | `playwright` 本分支未声明的 npm 包 | — |
| `scripts/smoke-margin-native.cjs` | 处置标出行后引入 | 170/179 | 5 / 0 / 4 | — | — |
| `scripts/smoke-margin-production.cjs` | 处置标出行后引入 | 56/59 | 0 / 0 / 3 | `playwright` 本分支未声明的 npm 包 | — |
| `scripts/verify-margin-package.cjs` | 处置标出行后引入 | 60/66 | 2 / 0 / 4 | — | — |
| `src/components/SetupChecklist.tsx` | 处置标出行后引入 | 80/91 | 8 / 0 / 3 | `setupChecklistStatus.ts` 计划引入；`i18n.tsx` 须自写，AG-60a | AG-60a |
| `PRIVACY.md` | 取 Margin 改动并处置标出行 | 17/17 | 0 / 0 / 0，看 diff | — | — |
| `README.md` | 取 Margin 改动并处置标出行 | 20/22 | 0 / 0 / 2，看 diff | — | — |
| `.github/workflows/full-ci.yml` | 只取片段 | 18/22 | 1 / 0 / 3 | — | — |
| `.github/workflows/release.yml` | 只取片段 | 35/43 | 2 / 0 / 6 | — | — |
| `scripts/ad-hoc-sign.js` | 只取片段 | 17/224 | 0 / 1 / 112，看 diff | — | — |
| `scripts/build-electron.js` | 只取片段 | 22/72 | 0 / 1 / 18，看 diff | `esbuild` 本分支未声明的 npm 包 | — |
| `.gitattributes` | 未扫描，人工审查 | 2/22 | 0 / 0 / 0 | — | — |
| `package.json` | 未扫描，人工审查 | 23/194 | 0 / 0 / 65，看 diff | — | — |

<!-- AG-62 tests -->
| 文件 | 做法 | 候选行 / 有效行 | 须处置：命中 / 近似 / 快照行 | 依赖 | 跨票 |
| --- | --- | --- | --- | --- | --- |
| `src/lib/__tests__/setupChecklistStatus.test.mjs` | 处置标出行后引入 | 50/52 | 0 / 0 / 2 | `setupChecklistStatus.ts` 计划引入 | — |
| `src/lib/__tests__/setupChecklistWiring.test.mjs` | 处置标出行后引入 | 28/32 | 1 / 0 / 3 | — | — |
| `electron/services/__tests__/OnboardingFlags.test.mjs` | 只取片段 | 37/72 | 5 / 2 / 28，看 diff | `windowPrivacyHandlers.ts` 须自写，AG-61；2 项待核对字段 | AG-61 |
| `scripts/__tests__/electron-build-entrypoints.test.mjs` | 只取片段 | 18/25 | 1 / 0 / 6 | 3 项待核对字段 | — |
| `scripts/__tests__/local-build.test.mjs` | 只取片段 | 32/59 | 0 / 4 / 23，看 diff | `build-native-local.cjs` 须自写；`electron-builder.local.cjs` 须自写；`esbuild` 本分支未声明的 npm 包；`electron-builder.signed.cjs` 须自写；1 项待核对字段 | — |
| `scripts/__tests__/mac-arch-packaging.test.mjs` | 只取片段 | 21/116 | 0 / 9 / 86，看 diff | `ensure-mac-optional-deps.cjs` 须自写；1 项待核对字段 | — |
| `scripts/__tests__/packaging-config.test.mjs` | 只取片段 | 20/53 | 1 / 0 / 32，看 diff | 1 项待核对字段 | — |

<!-- stage7 code -->
| 文件 | 做法 | 候选行 / 有效行 | 须处置：命中 / 近似 / 快照行 | 依赖 | 跨票 |
| --- | --- | --- | --- | --- | --- |
| `src/lib/windowsStealthInput.ts` | 整文件候选 | 21/21 | 0 / 0 / 0 | — | — |
| `electron/utils/windowsFocusPolicy.ts` | 只取片段 | 21/89 | 0 / 2 / 66，看 diff | — | — |

<!-- stage7 tests -->
| 文件 | 做法 | 候选行 / 有效行 | 须处置：命中 / 近似 / 快照行 | 依赖 | 跨票 |
| --- | --- | --- | --- | --- | --- |
| `src/lib/__tests__/windowsStealthInput.test.mjs` | 处置标出行后引入 | 30/34 | 2 / 0 / 2 | `windowsStealthInput.ts` 计划引入 | — |
| `electron/utils/__tests__/windowsFocusPolicy.test.mjs` | 只取片段 | 39/402 | 1 / 6 / 356，看 diff | `esbuild` 本分支未声明的 npm 包；`windowsFocusPolicy.ts` 须自写；`windowPrivacyBridge.ts` 须自写，AG-61；`windowPrivacyHandlers.ts` 须自写，AG-61；`keyboard_hook_windows.rs` 须自写；7 项待核对字段 | AG-61 |

<!-- mixed code -->
| 文件 | 做法 | 候选行 / 有效行 | 须处置：命中 / 近似 / 快照行 | 依赖 | 跨票 |
| --- | --- | --- | --- | --- | --- |
| `electron/ipcHandlers.ts` | 只取片段 | 169/522 | 7 / 7 / 212，看 diff | `localBuildSetup.ts` 计划引入，AG-62；`localDiagnosticLog.ts` 须自写；`CodexCliService.ts` 改接本分支实现；`mainStrings.ts` 计划引入，AG-60；`LocalContextStore.ts` 须自写；另 14 项；7 项待核对字段 | AG-40、AG-41、AG-42、AG-50、AG-51、AG-60、AG-61、AG-62 |
| `electron/main.ts` | 只取片段 | 475/2098 | 7 / 3 / 782，看 diff | `nativeArchGate.ts` 须自写；`localBuildSetup.ts` 计划引入，AG-62；`mainDiagnostics.ts` 须自写；`SessionTracker.ts` 需适配；`screenCapturePermissions.ts` 须自写，AG-40；另 27 项；18 项待核对字段 | AG-40、AG-41、AG-60、AG-61、AG-62、阶段 7 |
| `electron/preload.ts` | 只取片段 | 15/60 | 0 / 0 / 11，看 diff | `answerBridge.ts` 须自写，AG-42；`configurationBridge.ts` 须自写；`electronAPI.ts` 须自写；`windowPrivacyBridge.ts` 须自写，AG-61；`screenshotBridge.ts` 改接本分支实现；另 2 项 | AG-42、AG-61 |
| `electron/preload/configurationBridge.ts` | 只取片段 | 37/267 | 0 / 0 / 230 | `electronAPI.ts` 须自写；`stt.constants.ts` 需适配；`answerConfiguration.ts` 改接本分支实现；`modelTargetCapabilities.ts` 改接本分支实现 | — |
| `src/lib/electronAPI.ts` | 只取片段 | 103/581 | 0 / 0 / 478 | `stt.constants.ts` 需适配；`answerConfiguration.ts` 改接本分支实现；`modelTargetCapabilities.ts` 改接本分支实现；`modelCapacityConfirmations.ts` 改接本分支实现；`meetingSaveStatus.ts` 已退役，删调用 | — |

<!-- summary -->
| 归属 | 文件（其中测试） | 整文件候选 | 取 Margin 改动（候选） | 处置标出行后引入 | 取 Margin 改动并处置标出行 | 只取片段 | 资产待审 | 未扫描，人工审查 | 本分支已有 | 未命中候选行 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| AG-40 | 44（30） | 0 | 12 | 7 | 11 | 14 | 0 | 0 | 0 | 3227 |
| AG-41 | 21（11） | 0 | 1 | 9 | 5 | 6 | 0 | 0 | 0 | 2407 |
| AG-42 | 22（11） | 0 | 4 | 4 | 1 | 13 | 0 | 0 | 0 | 2024 |
| AG-50 | 9（5） | 2 | 0 | 2 | 0 | 3 | 2 | 0 | 0 | 363 |
| AG-51 | 10（8） | 0 | 0 | 2 | 1 | 7 | 0 | 0 | 0 | 536 |
| AG-60a | 3（0） | 0 | 0 | 1 | 0 | 2 | 0 | 0 | 0 | 929 |
| AG-60 | 20（4） | 2 | 3 | 1 | 4 | 10 | 0 | 0 | 0 | 715 |
| AG-61 | 13（6） | 0 | 2 | 4 | 1 | 6 | 0 | 0 | 0 | 855 |
| AG-62 | 24（7） | 1 | 0 | 10 | 2 | 9 | 0 | 2 | 0 | 2010 |
| 阶段 7 | 4（2） | 1 | 0 | 1 | 0 | 2 | 0 | 0 | 0 | 111 |
| 混合文件 | 5（0） | 0 | 0 | 0 | 0 | 5 | 0 | 0 | 0 | 799 |
| 阶段 1–3 已完成范围 | 115（44） | 7 | 3 | 37 | 11 | 36 | 5 | 1 | 15 | 6279 |
| 已退役 | 47（27） | 1 | 1 | 15 | 6 | 24 | 0 | 0 | 0 | 2861 |
| 不属于剩余 ticket | 27（7） | 3 | 0 | 12 | 1 | 10 | 0 | 1 | 0 | 3280 |

<!-- done files -->
`AIProvidersSettings.tsx`、`AnswerConfigurationFields.tsx`、`AnswerConfigurationPanel.tsx`、`AnswerProviderGlyph.tsx`、`AssistLLM.ts`、`BrainstormLLM.ts`、`ClarifyLLM.ts`、`CodeHintLLM.ts`、`CodexAuthorizationSettings.tsx`、`CodexCliAuth.ts`、`CodexCliService.ts`、`ContextPacket.ts`、`CredentialsManager.ts`、`Cropper.tsx`、`FollowUpLLM.ts`、`FollowUpQuestionsLLM.ts`、`LLMHelper.ts`、`LiteLLMModelInfoCache.ts`、`ModelCapabilityFields.tsx`、`ModelSelectorWindow.tsx`、`ProviderCard.tsx`、`README.md`、`ScreenshotCaptureCoordinator.ts`、`ScreenshotHelper.ts`、`SettingsManager.ts`、`actionGeneration.ts`、`answerConfiguration.ts`、`answerGeneration.ts`、`app-icon-small.svg`、`app-icon.svg`、`electron.d.ts`、`generate.mjs`、`generateContract.ts`、`generateOnce.ts`、`glyph.svg`、`icon-512.png`、`icon.icns`、`icon.ico`、`icon.png`、`iconTemplate.png`、`iconTemplate@2x.png`、`icon_1024x1024.png`、`icon_128x128.png`、`icon_16x16.png`、`icon_256x256.png`、`icon_32x32.png`、`icon_512x512.png`、`icon_64x64.png`、`imageCapabilityGuard.ts`、`index.js`、`logicalGeneration.ts`、`margin.icns`、`modelCapabilities.ts`、`modelCapacityAutoFill.ts`、`modelCapacityConfirmations.ts`、`modelTargetCapabilities.ts`、`promptImage.ts`、`providerSettingsHandlers.ts`、`providerThinking.ts`、`screenshotBridge.ts`、`screenshotCaptureOwnership.ts`、`screenshotHandlers.ts`、`screenshotLeaseRegistry.ts`、`screenshotRetryClaim.ts`、`selectableAnswerModels.ts`、`usePrimaryAnswerTargetLabel.ts`、`visionPolicy.ts`

<!-- retired files -->
`AutoAnswerJudge.ts`、`AutoAnswerManualStatus.tsx`、`DynamicActionBar.tsx`、`DynamicActionCard.tsx`、`DynamicActionEngine.ts`、`LocalContextPrewarmSetting.tsx`、`MeetingDetails.tsx`、`MeetingPersistence.ts`、`MeetingRecordsSettings.tsx`、`MeetingSaveNotice.tsx`、`PrefetchBuffer.ts`、`SimpleAutoAnswer.ts`、`TelemetryService.ts`、`intelligenceFlagHandlers.ts`、`localContextPrewarm.ts`、`localContextPrewarmChanges.ts`、`meetingContextPrewarm.ts`、`meetingRecordsHandlers.ts`、`meetingSaveStatus.ts`、`redaction.ts`

<!-- none files -->
`DatabaseManager.ts`、`NativeOomTrace.ts`、`agent.md`、`architecture-simplification.md`、`audit-report.md`、`devElectronStub.ts`、`fresh-release-baseline.md`、`fresh-release-implementation-plan.md`、`functional-refactor-plan.md`、`improvement-status-and-plan.md`、`localDiagnosticLog.ts`、`mainDiagnostics.ts`、`modelSelectorHarness.html`、`module-map.md`、`package-lock.json`、`redactForLog.ts`、`refactor-branch-review.md`、`settingsOverlayHarness.html`、`stt-consolidation.md`、`wayfinder.md`
