# AG-41a: 退役 Margin 中的云端 STT（Google, Deepgram, ElevenLabs, Azure, IBM Watson）

## 概述
依据 PLAN S35 第 1 条、交接文档 `docs/margin/HANDOFF-stage4-6.md` 4.3，以及用户 2026-10-11 的决策（Azure Speech 与 IBM Watson 一起退役，S35 只保留五家：OpenAI、Soniox、Groq、阿里云百炼、豆包），本票（AG-41a）分两阶段完成了对 Google Cloud Speech-to-Text、Deepgram、ElevenLabs、Azure Speech 与 IBM Watson 五家云端 STT 的全面退役清理。

---

## 1. 删除内容与范围

### 1.1 第一阶段（提交 8f05e4cc）：退役 Google, Deepgram, ElevenLabs
- **实现文件与专属服务（已删除）**:
  - `electron/audio/GoogleSTT.ts`: Google STT 客户端与流式识别实现
  - `electron/audio/DeepgramStreamingSTT.ts`: Deepgram WebSocket 流式转录实现
  - `electron/audio/ElevenLabsStreamingSTT.ts`: ElevenLabs WebSocket 转录实现
  - `electron/services/googleServiceAccount.ts`: Google 服务账号凭据解析辅助工具
- **依赖项删除与锁文件同步**:
  从 `package.json` 的 `dependencies` 中移除了 6 个依赖包：
  1. `@google-cloud/speech` (^7.2.1)
  2. `@deepgram/sdk` (^3.13.0)
  3. `@elevenlabs/client` (^0.15.1)
  4. `@elevenlabs/elevenlabs-js` (^2.39.0)
  5. `@grpc/grpc-js` (^1.14.3)
  6. `@grpc/proto-loader` (^0.8.0)
  通过 `npm install --package-lock-only --ignore-scripts --offline` 离线更新 `package-lock.json`。
- **业务逻辑与入口清理**:
  - `electron/services/CredentialsManager.ts`: 移除 `googleServiceAccountPath`, `deepgramApiKey`, `elevenLabsApiKey` 字段及 getter/setter。
  - `electron/main.ts`: 移除相关导入、`createSTTProvider` 分支及启动时凭据初始化。
  - `electron/ipcHandlers.ts`: 移除 `select-service-account`, `set-deepgram-api-key`, `set-elevenlabs-api-key`。
  - `electron/preload.ts`, `src/types/electron.d.ts`: 移除对应桥接及类型。
  - `src/components/SettingsOverlay.tsx`, `HelpSettings.tsx`, `AboutSection.tsx`, `ChannelCard.tsx`: 移除前端入口及引导卡片。

### 1.2 第二阶段（修正提交）：退役 Azure Speech 与 IBM Watson，及细节规范化
- **退役依据**: 用户 2026-10-11 明确决定：Azure Speech 和 IBM Watson 一起退役（S35 只保留五家，旧 Margin 中亦无这两家）。这两家无独立 npm 依赖。
- **REST 与网络层清理 (`electron/audio/RestSTT.ts`, `electron/services/outbound.ts`)**:
  - `RestSTT.ts`: 将 `RestSttProvider` 类型收窄为 `'groq' | 'openai'`。移除 `PROVIDER_CONFIGS` 中的 `azure` 和 `ibmwatson` 配置。移除 `uploadType: 'multipart' | 'binary'` 与 `uploadBinary` 方法，直接使用 `uploadMultipart` 处理 WAV 上传。
  - `outbound.ts`: 删除仅服务于这两家的 `regionalSttEndpoint` 导出函数。
  - `electron/config/languages.ts`: 保留 `bcp47` 字段（仍由语言自动检测与相关测试使用）。
- **主进程与生命周期 (`electron/main.ts`)**:
  - `createSTTProvider`: 移除 `azure` 与 `ibmwatson` 分支，仅保留 `groq` 调用 `RestSTT`。
- **IPC 与 Preload 桥接 (`electron/ipcHandlers.ts`, `electron/preload.ts`, `src/types/electron.d.ts`)**:
  - `ipcHandlers.ts`:
    - `get-stored-credentials`: 移除 `hasAzureKey`, `azureRegion`, `hasIbmWatsonKey`, `ibmWatsonRegion`, `sttAzureKey`, `sttIbmKey`。
    - `set-stt-provider`: 提供商联合类型收窄为 `'none' | 'groq' | 'openai' | 'soniox'`。
    - 移除 IPC 处理器: `set-azure-api-key`, `set-azure-region`, `set-ibmwatson-api-key`, `set-ibmwatson-region`。
    - `test-stt-connection`: 提供商联合类型收窄为 `'groq' | 'openai' | 'soniox'`，删除 `azure` 与 `ibmwatson` 连接测试分支。
  - `preload.ts` & `src/types/electron.d.ts`: 同步清理上述字段、类型定义和桥接方法。
- **设置界面与常量 (`src/components/SettingsOverlay.tsx`, `HelpSettings.tsx`, `ChannelCard.tsx`, `src/config/stt.constants.ts`)**:
  - `SettingsOverlay.tsx`: 移除 `azure` 与 `ibmwatson` 状态变量、下拉选项、密钥输入、Azure 区域配置框、测试连接分支及外部链接。
  - `HelpSettings.tsx`: 移除 `MockProviderSelectionAnim` 中的 Azure 和 IBM 选项；移除 Specific Provider Setup 中的 Card 3 (Azure) 和 Card 4 (IBM Watson)，将 Soniox 重新编号为 3。
  - `ChannelCard.tsx`: 移除 `providerLabel` 中的 `azure` 与 `ibmwatson`。
  - `stt.constants.ts`: 移除 `azure` 与 `ibmwatson`；删除无使用者的 `DEFAULT_STT_PROVIDER`（避免误导默认走云端）。
- **数据库引导与无用类型清理**:
  - `electron/db/DatabaseManager.ts` (约 745–800 行): 将第 4 步改为中性说明（在 Settings 中选择语音识别服务商并填入其 API Key）；删除 "Creating a Google Speech-to-Text Service Account" 和 "Free Google Cloud Credit" 两节引导文档。
  - `src/types/credentialSave.ts`: 删除无引用的 `ServiceAccountSelectionResult` 接口类型。
- **凭据管理类型收窄与行为保障 (`electron/services/CredentialsManager.ts`)**:
  - 移除 `azureApiKey`, `azureRegion`, `ibmWatsonApiKey`, `ibmWatsonRegion` 存储及对应方法。
  - `getSttProvider()`: 消除 `(this.credentials.sttProvider as any)`，使用纯 TypeScript 类型收窄；对于所有已退役的 provider ID（`'google'`, `'deepgram'`, `'elevenlabs'`, `'azure'`, `'ibmwatson'`, `'local-whisper'`），一律返回 `'none'`，不读取、不删除、不迁移旧密钥。

---

## 2. 保留内容
- 保留现行支持的服务商：OpenAI, Soniox, Groq, 阿里云百炼 (S35 计划), 豆包 (S35 计划)。
- 保留共享网络与音频基础设施：`RestSTT.ts`（用于 Groq/OpenAI）、`openAiSttEndpoint`、`OpenAIStreamingSTT.ts`、`SonioxStreamingSTT.ts`。

---

## 3. 测试说明 (遵循 G6)

### 3.1 行为测试补充与恢复
1. **退役 ID 不创建 STT 实例 (`electron/audio/__tests__/OutboundSttRevocation.test.mjs`)**:
   - 将所有退役 ID（`'google'`, `'deepgram'`, `'elevenlabs'`, `'azure'`, `'ibmwatson'`, `'local-whisper'`）放回 `AppState.createSTTProvider` 测试循环，确保所有退役服务商均返回 `null`。
2. **退役 ID 返回 `'none'` (`electron/margin/__tests__/credentialTransactions.test.mjs`)**:
   - 新增用例 `AG-41a: CredentialsManager.getSttProvider() returns none for all retired providers`，直接测试当磁盘存储为任一退役 ID 时，`getSttProvider()` 稳定返回 `'none'`。
3. **出站测试与调用点清理 (`electron/services/__tests__/OutboundBoundary.test.mjs`, `OutboundInventory.test.mjs`)**:
   - `OutboundBoundary.test.mjs`: 移除针对 `regionalSttEndpoint` 的参数校验测试，保留 `googleSpeechUniverseDomain` 检验。
   - `OutboundInventory.test.mjs`: 更新生产调用计数，确认 `dynamicAuthorities` 为空数组。
4. **事务与界面测试更新 (`electron/margin/__tests__/credentialTransactions.test.mjs`, `SttApiKeyRedaction.test.mjs`)**:
   - 更新合法信道与方法列表（`set*` 方法总数由 21 变为 17）；移除 Azure/IBM 相关 IPC 与 UI 测试。

---

## 4. 退役规则 (docs/margin/retired-rules.json)
已在 `"AG-41a"` ticket 下补充规则，覆盖本次退役的所有关键标识：
- `set-azure-api-key` (symbol)
- `set-azure-region` (symbol)
- `set-ibmwatson-api-key` (symbol)
- `set-ibmwatson-region` (symbol)
- `regionalSttEndpoint` (symbol)
- `stt.speech.microsoft.com` (host)
- `speech-to-text.watson.cloud.ibm.com` (host)

---

## 5. 检查与验证证据

所有检查命令均在独立隔离守卫下执行通过，日志保存在 `docs/margin/evidence/AG-41a/checks/`：
1. `npm run build:electron`: 退出码 0（日志: `build-electron.txt`）
2. `npx tsc --noEmit -p tsconfig.json`: 退出码 0，无类型报错（日志: `tsc-renderer.txt`）
3. `npm test`: 退出码 0，942 个用例全部执行通过（937 pass, 0 fail, 5 skipped）（日志: `npm-test.txt`）
4. `node scripts/margin/retired-check.mjs --all`: 退出码 0，285 条退役规则 0 failing（日志: `retired-check.txt`）
5. `node scripts/margin/provenance-check.mjs`: 在清理后无任何非白名单命中的新增行。
