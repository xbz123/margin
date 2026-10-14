# 阶段 4–6 执行交接

Claude 整理，2026-10-11，依据用户指示"可以把这些整理好，然后目标是交给astra去做执行"（PLAN S36）。本文只是执行入口，具体规则以 PLAN 为准；两处不一致时以 PLAN 为准，并报告差异。

**当前执行入口**：具体职责与 CI 以 [PLAN §7](PLAN.md#7-依赖与并行) 的当前有效规则为准；旧 S36–S38 执行人分工仅为历史。D8=A、D9 已定，S42-01～05 已验收，证据按票归档。阶段 6 技术验收已通过，[用户签收](PLAN.md#阶段-6-验收标准与当前结果)等待授权后实机复测；真实服务、正式身份和发布不自动授权，不覆盖既有 AG-51 未跟踪证据。

## 1. 范围和起点

- **执行与审阅**：当前按 PLAN §7 和用户最新授权分配，由主 Agent 负责集成及最终核验；S36–S38 的历史分工与各票原始复查证据保留在 PLAN。用户负责阶段签收。
- **范围**：剩余 9 张 ticket，AG-60a、AG-40、AG-41、AG-42、AG-50、AG-51、AG-60、AG-61、AG-62。
  - 已完成或已删除的不做：AG-43 已按 S33 删除；AG-52 已按 S34 提前完成。
  - 阶段 7（Windows 和发布）不在本次范围。
- **开始时间**：用户把本交接交给 Astra 时，阶段 4 开始（S36）。
- **起点**：
  - 分支 `codex/margin-agpl-migration`，从包含本文的提交起（上一次 S35 修订为 `cec771ee`）。
  - 工作目录 `/Users/mac/code/Natively/.claude/worktrees/margin-agpl-migration`。
- **开工前必读**：
  - PLAN §2 的 S8–S36，以及 S15、S21、S27、S28、S33、S35 的细则。
  - PLAN §5 全局闸门 G1–G7。
  - PLAN §6 的阶段 3–6 表和"旧 Margin 复用清单（S35）"。
  - PLAN §9"S35 复用清单审阅"。
  - PROVENANCE.md 的来源规则。
  - ADAPTATION.md 中与本票有关的功能行。

## 2. 硬边界（违反即停止并报告）

**历史原始边界（原文照录；安装例外与 CI 现行规则见下文及 PLAN）**：

> 不改原工作区（/Users/mac/code/Natively，分支 codex/ai-assistant-refactor）、已安装的 Margin、用户数据目录、钥匙串或现有凭据；不读真实密钥，不调用付费服务，不录真实会议；不发布，不安装或覆盖应用；不改 main 分支；保留来源记录，不引入上游 6 月之后的代码；所有测试都在隔离守卫下运行。

**并行规则**：并行交给子代理需要用户另外同意。阶段 4–6 默认串行（S27、§7）。

**工作区规则，原文照录**：

> 所有文件写入只能落在 /Users/mac/code/Natively/.claude/worktrees/margin-agpl-migration 下，一律用这个绝对路径；不要用相对路径写文件。
>
> 所有 git 命令一律用 `git -C /Users/mac/code/Natively/.claude/worktrees/margin-agpl-migration ...`，npm/node 命令先 cd 到该目录或用 --prefix 指定。
>
> 每张 ticket 提交前，确认 `git -C /Users/mac/code/Natively status --short` 为空、分支仍是 codex/ai-assistant-refactor；如果原工作区出现任何改动，立即停下并报告，不要自行还原。

**补充**：
- 本机默认使用隔离 `temp` 身份；已批准 `local` / `Natively Local` 独立身份安装测试，不读取或迁移 `Margin` 数据。正式身份保护不变。
- 发现读写了真实的 `~/Library/Application Support/Margin`、`io.github.xbz123.margin` 的偏好设置或 `Margin Safe Storage` 钥匙串条目时，立即停止。
- 每张实现 ticket 本地验收并提交推送后运行公开仓库普通 CI，成功后继续下一票；阶段出口打包 CI 按对应授权执行。纯文档回执不重复运行相同代码的测试。
- 真实服务、真实麦克风、屏幕录制等实机验收都要按 D2 逐项请用户授权。没有授权时只用 mock 和合成数据，并在记录里写"未实机验证"。
- 来源扫描（G2）的命中不加白名单。只有通用写法可以按 AG-30 的先例逐条登记到 `provenance-config.json`，并写明理由。
- 普通 CI 沿用现有手动或 `[gates]` 触发方式；不得借此触发未经授权的打包或发布。

## 3. 执行顺序

```
AG-60a → AG-40 → AG-41 → AG-42 → [阶段 4 出口]
       → AG-50 → AG-51 → [阶段 5 出口]
       → AG-60 → AG-61 → AG-62 → [阶段 6 出口]
```

- AG-60a 是 S35 新增的前置项，放在最前：AG-41、AG-50、AG-61、AG-62 的设置界面依赖它。如果 AG-40 先遇到界面需求，只写后端，界面留到 AG-60a 之后。
- AG-42 依赖 AG-33 和 AG-41。AG-51 的整链联合用例依赖 AG-42（见 4.6）。
- 每个阶段出口均完成适用的独立审阅、获准的出口 CI 与产物核对，再由用户签收，之后进入下一阶段。

## 4. 每张 ticket 的做法

### 4.0 通用流程

1. **读需求**：PLAN §6 阶段表中本票那一行、S35 清单中本票小节，以及 `evidence/S35-stage4-reuse/reuse-ranges.md` 中本票的逐文件记录。
2. **先写行为测试**：先把要保留的行为写成测试。只检查源码字符串的旧测试，按 S27 改为行为测试。
3. **按候选处理旧 Margin 内容**。做法一栏只估计工作量，不说明来源已经清楚；每个文件仍要逐行审查。

   | 做法 | 怎么处理 |
   | --- | --- |
   | 整文件候选、取 Margin 改动（候选） | 逐行读后才能用；"待核对字段"的依赖要先对照本分支实现，核对字段和行为 |
   | 处置标出行后引入 | 命中行、近似快照行、快照行（行号都在 `reuse-ranges.md`）逐行处置：属于上游派生的，按需求重新实现，不能改到扫描不命中为止 |
   | 表中标"看 diff" | 用 `git -C <工作目录> log -p fcfbb02a..b8ade3f7 -- <路径>` 读 Margin 的每次改动和父版本，判断是否在改上游函数 |
   | 只取片段 | 只能取 `reuse-ranges.md` 列出的候选行段，按需求组装，不整体搬用 |
   | 资产待审、未扫描 | 人工确认来源；能在本分支重新生成的就重新生成 |
   | 依赖"须自写" | 在本分支自己写，不把旧依赖带回来 |
   | 依赖"改接本分支实现" | 改为调用阶段 1–3 的实现 |
   | 依赖"已退役，删调用" | 删掉对它的调用 |

   短行（12 个字符以下）没有扫描过，要随所在函数一起审查。
4. **登记 PROVENANCE**：每张 ticket 在 Ledger 下新增一节，写明引入了哪些旧 Margin 提交、路径和行段，做了哪些检查，哪些内容按需求重写了。没有引入的写"仅参考行为"。
5. **跑门禁**：用以下命令跑完整门禁，要求 16/16：

   ```
   node scripts/margin/run-gates.mjs --out docs/margin/evidence/<ticket>/gates
   ```

   - 门禁要启动 Electron，需要关闭沙箱运行。
   - G2 来源扫描要求 0 命中。
   - 删除依赖时同步 `package-lock.json`（G7）。退役规则写进 `retired-rules.json` 并归属本票，本票完成时把票号加进其中的 `completedTickets`，规则才会参与检查（G3）。
   - 测试改动按 G6 写明新增的跳过项和删除测试的替代测试。
   - 新测试放在 `npm test` 覆盖的目录下（见 `package.json` 的 test 脚本）。
6. **提交**：
   - 先做第 2 节的原工作区检查。
   - 提交后推送到两个远端：`origin`，以及 `git@github.com:xbz123/margin.git` 的同名分支。
7. **记录**：
   - 在 PLAN §8 原位更新本票实际状态，附提交号和对应证据目录；不将本地通过写为远端 CI 或阶段签收通过。
   - 在 §8 写本票记录：范围、改了什么、证据、未实机验证的项。
   - 同步更新 wayfinder。
8. **复查**：按 PLAN §7 的当前职责进行独立审阅，核对 diff 与原始证据；发现的问题修复并验证后才验收。

### 4.1 AG-60a 共享基础

- **目标**：只定翻译接口和设置组件契约，不做设置页重组（那是 AG-60）。
  - 翻译接口：`src/i18n.tsx`，包括语言切换、缺词时的回退、中英两种语言。
  - 设置组件：`SettingsKit.tsx` 一类共用组件。
- **旧内容**：
  - `i18n.tsx` 和 `SettingsKit.tsx` 都只能取片段：`i18n.tsx` 分叉时含 315 行上游内容，`SettingsKit.tsx` 有 15 处命中。接口按本分支现有界面自己写。
  - `i18n.zh.ts` 有 921 行 Margin 行，其中 90 行命中、4 行快照行，逐行处置；短行随条目一起审查。只引入本分支界面实际用到的词条。
- **验收**：
  - 翻译查找、回退和切换的行为测试。
  - 共用组件的渲染测试。
  - 现有界面行为不变（regression、startup 门禁通过）。

### 4.2 AG-40 双路音频与会话生命周期

- **目标**：开始、停止、尾段排空，以及睡眠、唤醒和显示器变化时的处理。
- **旧内容**：
  - `MeetingSttSession.ts`：188 行 Margin 行，15 行命中、2 行快照行，处置后引入。它的测试按路径加载 AG-41 的 STT 类，本票先用替身，AG-41 完成后补联合用例。
  - `osEventSubscriptions.ts`：38 行候选，另有 2 行快照行要处置。
  - `MeetingAudioPipeline.ts` 只能取片段：459 行命中、384 行快照行。按需求重写，以 `MeetingAudioPipelineRaces.test.mjs`（5 处命中，须处置）作为行为规格。
  - 停止顺序按 `Mg21StopConsumer` 测试，去掉停止自动回答和 Judge 两步（S33）。
  - `AudioDevices.ts` 依赖的设备过滤（`audioDeviceSelection.mjs`）须自写；该文件分叉时含 17 行上游内容，要看 diff。
- **边界**：不授予麦克风或屏幕录制权限，不采集真实音频；原生采集用 mock。
- **验收**：开始、停止、尾段排空、重配、系统事件的行为测试，全部用 mock。

### 4.3 AG-41 云端 STT（五家）

- **目标**：
  - 只保留 OpenAI、Soniox、Groq（`RestSTT` 分段转写）、阿里云百炼、豆包（S35 第 1 条）。
  - 未配置时阻止开始。
  - 恢复 AG-17 跳过的 4 个 `OpenAIRealtimeGAProtocol` 用例，用例自己清理保活定时器。
- **退役 Google、Deepgram、ElevenLabs**：
  - 删除实现、设置入口、专属测试和依赖。依赖包括 `@google-cloud/speech`、`@deepgram/sdk`、`@elevenlabs/*`，`@grpc/*` 先核对是否还有其他使用者，再决定删不删。
  - 退役规则写进 `retired-rules.json`。
  - S16 不再适用。
- **旧内容**：
  - `stt.constants.ts`：取 Margin 改动，1 处命中要处置；分叉时含 1 行上游内容，要看 diff。
  - `sttHandlers.ts`：`validateSttBaseUrl`（`requestSafety.ts`）须自写。
  - `SpeechProviderSettings.tsx`：界面等 AG-60a。
  - `OpenAIStreamingSTT.ts`：去掉 `wsSafeTeardown` 和 F-201 相关部分。
  - `RestSTT.ts`：9 处命中逐处处置。
- **阿里云和豆包的 STT 类**：来源待审，命中分别为 14、18 行，快照行分别为 25、20 行。
  - 引入前整体审查缓冲、重连、终止排空和事件顺序；判断为以上游类为模板时，按需求整体重写。
  - 两家的缓冲上限都不是严格上限（阿里云第 412 行、豆包第 476 行）。要加超大单块测试，并在拒绝、分块、按 PCM 帧边界裁剪三种处理中选定一种，写进本票记录。
- **边界**：不调用真实 STT 服务，只用本地 mock 服务。
- **验收**：
  - 五家的协议行为测试，覆盖连接、重连、终止排空和错误显示。
  - 未配置时不开始麦克风和音频（`MeetingStartAudioGate` 的对应用例）。
  - API key 不进日志。
  - 退役检查 0 命中。

### 4.4 AG-42 手动回答

- **目标**：用户手动触发回答，接到阶段 3 的生成入口。
- **做法**：
  - 先按本分支生成契约（`GenerateRequest`：`protocol`、`model`、`contents`、`dataScopes` 等）定义一层最小的请求和事件适配，再决定旧 `DirectAssistService.ts` 的哪些片段可用。
  - 不重建旧版的 `requestBuilder.ts` 和 `types.ts`，它们几乎全是快照内容。
  - 旧服务依赖的 `errors.ts` 须自写，`answerGeneration.ts` 改接本分支实现；`GenerateTurn` 和旧版 `AnswerGenerationInput` 本分支没有。
- **旧内容**：
  - `directAssistAnswerState.ts`：1 处命中，处置后引入。
  - `answerHandlers.ts`（202 行命中）、`answerActionHandlers.ts`、`directAssistValidation.ts`、`legacyChatHandlers.ts` 只取片段。
- **验收**：手动触发、流式显示、取消、终态与身份匹配的行为测试，用 mock 生成服务。

### 4.5 AG-50 Local Context 全文

- **目标**：把 Local Context 全文放进请求。没有预热（S33）。
- **旧内容**：
  - `promptAssembly.ts`：1 处命中，依赖本分支没有的 `GenerateTurn`。
  - `promptBudget.ts`：读取 `request.target`、`request.turns`，本分支没有这两个字段；按本分支的容量逻辑和请求结构改写。
  - `LocalContextStore.ts` 是上游内容，须自写。
  - `configContextHandlers.ts`、`LocalContextSettings.tsx` 只取片段，预热部分删除。
- **文件类型**：旧 Margin 的 Local Context 只接受 `.md`、`.markdown`、`.txt`。
  - `tests/fixtures/documents/` 的 PDF 和 DOCX 合成文档没有任何旧测试引用，不引入。
  - 要支持 PDF 或 DOCX 就得重新引入解析器（S21 已删除 `pdf-parse` 和 `mammoth`），属于范围变更，先停下来问用户。
- **验收**：读取上限、非文本拒绝、容量不足时的提示，以及请求里的位置，都写成行为测试。

### 4.6 AG-51 提示词类 Skills

- **目标**：
  - 按 PLAN 阶段表的 AG-51 行实现，并入 S29 第 3 条的提示词分层：基础层加面试或笔试场景层，按入口自动选择，可以手动切换。
  - 高级设置里加按场景的附加指令：只追加、限长、可恢复默认、只存本机。
- **旧内容**：
  - `PromptSkillImporter.ts` 有 4 处命中。
  - 它依赖的 `SkillValidator.ts`、`SkillUploader.ts`、`LocalContextStore.ts` 都是上游内容。要写职责明确的本地校验和存储，不为满足导入器的类型把旧依赖带回来。
- **`PromptSkillConsumerChain.test.mjs`**：
  - 本票改接阶段 3 已完成的回答入口验收。
  - 经手动回答的整条链，等 AG-42 完成后补联合用例。
- **验收**：导入校验、安装、按场景选择、附加指令限长和恢复默认的行为测试。

### 4.7 AG-60 设置页重组与双语

- **目标**：设置页重组，所有界面中英双语。
- **旧内容**：
  - `mainStrings.ts`（主进程托盘、菜单、对话框）：2 处命中、1 行快照行，处置后可用。
  - `overlayMessageLocalization.ts`、`settingsTabs.ts` 是整文件候选。
  - 其余界面文件依赖 AG-60a。

### 4.8 AG-61 窗口保护、快捷键、鼠标穿透、伪装

- **旧内容**：
  - `WindowPrivacySettings.tsx`、`KeybindsSettings.tsx` 各 4 处命中，处置后可用。
  - `WindowPrivacyController.ts`、`windowPrivacyHandlers.ts`、`KeybindManager.ts`、`WindowHelper.ts` 只取片段。后两者分叉时含大量上游内容，要看 diff。
- **AG-17 跳过的用例**：恢复 `ActivationPolicyOrdering` 用例，或按定下的激活策略改写后启用。
- **边界**：实机项（截图或屏幕共享中是否可见）需要 D2 授权；没有授权时只写 mock 测试，记为未实机验证。

### 4.9 AG-62 首次启动引导、README、PRIVACY、Mac 包

- **旧内容**：
  - `setupChecklistStatus.ts` 是整文件候选，但依赖 `stt.constants.ts`（需适配）和 `modelTargetCapabilities.ts`（改接本分支实现）。
  - `SetupChecklist.tsx` 有 8 处命中；检查项去掉自动回答和 Gemini Judge。
  - `README.md`、`PRIVACY.md` 按本分支实际功能重写。
  - `package.json`、`.gitattributes` 人工审查，依赖版本以本分支为准。
  - 旧冒烟脚本只作参考。
- **必须停下来交用户决定**：
  - 放开 `electron/margin/appIdentity.ts` 中"正式身份只能在 GitHub Actions 中运行"的保护（S15），以及本机何时改用正式身份。在用户决定前，不改这项保护。
  - 后续新增 Mac 包出口 CI 按对应授权执行；已批准并完成的阶段 6 出口 CI 见 PLAN，不重复索要批准或重跑。

## 5. 阶段出口

阶段 4、5 保留各自历史签收；阶段 6 的技术验收、实机复测和用户签收以 [PLAN 阶段 6 验收标准](PLAN.md#阶段-6-验收标准与当前结果) 为唯一当前入口。通用出口检查：

1. **票与审阅**：对应验收范围已通过本地门禁并推送，适用的独立审阅无未处理阻塞项；阶段 6 正式身份及后置项不混入已批准的本机测试范围。
2. **退役规则全量检查**：`retired-check.mjs --all` 0 命中。
3. **出口 CI**：完整 CI（`package_apps`），由用户批准后运行。原生模块和工具链没有变化时不用 `no_cache`（S26）。
4. **核对和签收**：核对 CI 结果与下载产物，更新 PLAN 对应验收记录；技术通过不代替用户签收。

真实服务、实机验收、稳定签名、正式身份、发布和阶段 7 分别按对应授权执行；本机 Natively Local 安装例外不扩大这些范围。

## 6. 停止条件（遇到即停下并报告用户）

- 原工作区出现改动或切换了分支。
- 超出已批准的 Natively Local 用户测试范围，读写真实用户数据、钥匙串或正式 Margin 身份数据。
- 需要真实服务、真实设备、付费服务或正式身份。
- 需要新增或升级依赖，或者扩大功能范围（例如 Local Context 支持 PDF 和 DOCX）。
- 旧内容无法确认来源，又无法按需求重写。
- G2 命中只能靠加白名单才能通过（通用写法除外）。
- 与 PLAN 或本文的规定有冲突。
