# AG-41a: 退役 Margin 中的三家云端 STT（Google, Deepgram, ElevenLabs）

## 概述
依据 PLAN S35 第 1 条及交接文档 `docs/margin/HANDOFF-stage4-6.md` 4.3，本票（AG-41a）完成了对 Google Cloud Speech-to-Text、Deepgram 和 ElevenLabs 三家云端 STT 提供商的全面退役清理。

## 1. 删除内容与范围

### 1.1 实现文件与专属服务（已删除）
- `electron/audio/GoogleSTT.ts`: Google STT 客户端与流式识别实现
- `electron/audio/DeepgramStreamingSTT.ts`: Deepgram WebSocket 流式转录实现
- `electron/audio/ElevenLabsStreamingSTT.ts`: ElevenLabs WebSocket 转录实现
- `electron/services/googleServiceAccount.ts`: Google 服务账号凭据解析辅助工具

### 1.2 依赖项删除与锁文件同步
从 `package.json` 的 `dependencies` 中移除了 6 个依赖包：
1. `@google-cloud/speech` (^7.2.1)
2. `@deepgram/sdk` (^3.13.0)
3. `@elevenlabs/client` (^0.15.1)
4. `@elevenlabs/elevenlabs-js` (^2.39.0)
5. `@grpc/grpc-js` (^1.14.3)
6. `@grpc/proto-loader` (^0.8.0)

通过 `npm install --package-lock-only --ignore-scripts --offline` 离线更新 `package-lock.json`，确保未修改 `node_modules`。

### 1.3 核心业务逻辑与入口清理
- **凭据管理 (`electron/services/CredentialsManager.ts`)**:
  - 移除 `GoogleServiceAccount` 类型引用及 `googleServiceAccountPath`, `deepgramApiKey`, `elevenLabsApiKey` 字段存储。
  - 在 `getSttProvider()` 中，对于历史保存的 `'google' | 'deepgram' | 'elevenlabs'` 旧配置，安全返回 `'none'`（未选择服务商），不读也不迁移旧凭据。
  - 移除 `setGoogleServiceAccountPath`, `setDeepgramApiKey`, `setElevenLabsApiKey` 及其 getter。
  - 限制 `setSttProvider` 允许的服务商列表。
- **主进程与生命周期 (`electron/main.ts`)**:
  - 移除 `GoogleSTT`, `DeepgramStreamingSTT`, `ElevenLabsStreamingSTT`, `googleServiceAccount` 的导入。
  - 更新 `STTProvider` 类型联合。
  - 移除 `createSTTProvider` 中的 google/deepgram/elevenlabs 分支。
  - 移除 `reconfigureSttProvider` 中的 google 处理逻辑。
  - 移除 `updateGoogleCredentials` 方法及启动时服务账号加载代码。
  - 保留 `this.googleSTT` 和 `this.googleSTT_User` 实例属性名（用于音频管道和既有测试兼容）。
- **IPC 处理程序 (`electron/ipcHandlers.ts`)**:
  - 移除 `select-service-account`, `set-deepgram-api-key`, `set-elevenlabs-api-key` IPC 信道。
  - 清理 `get-stored-credentials`（移除已退役的 key/path 字段及布尔标志）。
  - 清理 `test-stt-connection`（移除 deepgram 与 elevenlabs 连接测试分支）。
  - 更新 `set-stt-provider` 参数校验与类型。
- **Preload 桥接与类型定义 (`electron/preload.ts`, `src/types/electron.d.ts`)**:
  - 移除 `selectServiceAccount`, `setDeepgramApiKey`, `setElevenLabsApiKey` 接口及桥接暴露。
  - 更新 `getStoredCredentials`, `setSttProvider`, `testSttConnection` 类型。
- **设置界面与常量 (`src/config/stt.constants.ts`, `src/components/SettingsOverlay.tsx`, `AboutSection.tsx`, `ChannelCard.tsx`, `HelpSettings.tsx`)**:
  - `stt.constants.ts`: `SttProviderId` 移除三家，`DEFAULT_STT_PROVIDER` 设为 `'groq'`。
  - `SettingsOverlay.tsx`: 移除三家下拉选项、Service Account 文件选择器及 Key 输入框与对应 handlers。
  - `HelpSettings.tsx`: 移除 Google、ElevenLabs、Deepgram 专属帮助卡片及模拟组件。
  - `AboutSection.tsx`, `ChannelCard.tsx`: 移除相关标签和芯片展示。

## 2. 保留内容
- 保留其余 STT 服务商：OpenAI, Soniox, Groq, 阿里云百炼 (Azure/Custom), 豆包等。
- 保留共享网络与音频基础设施：`RestSTT.ts`（移除 elevenlabs 分支）、`dnsHelpers.ts`、`SystemAudioCapture.ts`。

## 3. 测试删除与调整说明 (遵循 G6)

### 3.1 随功能删除的测试文件及理由
- `electron/audio/__tests__/GoogleServiceAccountBoundary.test.mjs`:
  - **理由**: 随功能删除。用于测试 Google Service Account 独立解析边界及项目凭据合法性校验；对应功能模块 `googleServiceAccount.ts` 已退役删除。
- `electron/audio/__tests__/GoogleSttPendingLanguageChangeCleared.test.mjs`:
  - **理由**: 随功能删除。用于测试 Google STT 切换语言时 pending 清理机制；`GoogleSTT.ts` 已退役删除。
- `electron/audio/__tests__/ReconnectStormCap.test.mjs`:
  - **理由**: 随功能删除。针对 Google STT gRPC 流连接风暴限制机制；`GoogleSTT.ts` 已退役删除。
- `electron/audio/__tests__/DeepgramStabilityTimerTracked.test.mjs`:
  - **理由**: 随功能删除。针对 Deepgram SDK 客户端连接稳定性定时器追踪；`DeepgramStreamingSTT.ts` 已退役删除。

### 3.2 调整的测试文件及用例说明
- `electron/audio/__tests__/OutboundSttRevocation.test.mjs`:
  - **调整**: 从待测列表中移除 `DeepgramStreamingSTT` 和 `ElevenLabsStreamingSTT`，移除 `Google stopped stream cannot flush queued audio or restart` 用例；保留 `SonioxStreamingSTT` 和 `OpenAIStreamingSTT` 的完整撤销与音频流关闭测试。
- `electron/services/__tests__/OutboundInventory.test.mjs`:
  - **调整**: 从 `registered` 中移除已删除的 3 个 STT 文件；从固定端点列表中移除 `wss://api.deepgram.com`, `https://api.elevenlabs.io`, `wss://api.elevenlabs.io`；移除对已删除文件的静态断言。
- `electron/services/__tests__/SensitiveLogRedaction.test.mjs`:
  - **调整**: 从敏感日志检查列表移除已删除的 3 个实现文件，添加 `SonioxStreamingSTT.ts` 保持多服务商覆盖。
- `electron/services/__tests__/SttApiKeyRedaction.test.mjs`:
  - **调整**: 移除已退役的 `hasDeepgramKey`, `hasElevenLabsKey`, `sttDeepgramKey`, `sttElevenLabsKey` 断言。
- `electron/margin/__tests__/credentialTransactions.test.mjs`:
  - **调整**: 移除 Google Service Account、Deepgram、ElevenLabs 的 IPC 与 UI 测试分支，调整 STT 提供商枚举为当前剩余的 5 个提供商。
- `electron/margin/__tests__/loggingPrivacy.test.mjs`:
  - **调整**: 移除 ElevenLabs 开发模式构造函数日志测试。
- `electron/margin/__tests__/packagingTools.test.mjs`:
  - **调整**: 将 mock 路径中的 `@elevenlabs/elevenlabs-js` 替换为现存依赖 `@anthropic-ai/sdk`。

## 4. 退役规则 (docs/margin/retired-rules.json)
- 将 `"AG-41a"` 加入 `completedTickets`。
- 新增 rules 涵盖：
  - 路径: `electron/audio/GoogleSTT.ts`, `DeepgramStreamingSTT.ts`, `ElevenLabsStreamingSTT.ts`, `electron/services/googleServiceAccount.ts`
  - 依赖: `@google-cloud/speech`, `@deepgram/sdk`, `@elevenlabs/client`, `@elevenlabs/elevenlabs-js`, `@grpc/grpc-js`, `@grpc/proto-loader`
  - 符号: `DeepgramStreamingSTT`, `ElevenLabsStreamingSTT`, `loadGoogleServiceAccount`, `googleSpeechClientOptions`, `select-service-account`, `set-deepgram-api-key`, `set-elevenlabs-api-key`

## 5. 检查与验证证据

所有检查命令均成功通过，日志保存在 `docs/margin/evidence/AG-41a/checks/`：
1. `npm run build:electron`: 退出码 0（日志: `build-electron.log`）
2. `npx tsc --noEmit -p tsconfig.json`: 退出码 0，无任何类型错误（日志: `tsc-renderer.log`）
3. `npm test`: 退出码 0，942 个测试全部执行完毕（937 通过，0 失败，5 跳过）（日志: `npm-test.log`）
4. `node scripts/margin/retired-check.mjs --all`: 退出码 0，278 条退役规则 0 命中（日志: `retired-check.log`）
5. `node scripts/margin/provenance-check.mjs --target HEAD --max-hits 0`: 退出码 0，0 命中（日志: `provenance-check.log`）
