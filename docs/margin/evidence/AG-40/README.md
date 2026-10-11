# AG-40 双路音频与会话生命周期

2026-10-11。状态：**实现和本地检查通过；完整门禁和复查待 Claude**。
起点 `3da28cf2`，分支 `codex/margin-agpl-migration`。实现提交由 PLAN §8 记录。
这是本地实现检查，不是阶段 4 签收、完整 gates、云端协议验收或实机验收。

## 实现

- 主进程开始/停止由 `MeetingLifecycleQueue` 串行化；相邻重复请求加入同一操作，
  start → stop → start 保持顺序，下一次开始不能越过上一会话保存。
- `MeetingAudioPipeline` 管理麦克风和系统音频的所有权、初始化、设备/服务商重配、
  默认输出路由变化和有上限的恢复。开始顺序为麦克风采集、user STT、系统采集、
  interviewer STT。PCM、采样率、单声道和 speech-ended 统一接线，原分支的
  12 秒无数据告警和 DC-offset 静音检测仍由主进程健康监测提供。
- 停止顺序：取消手动生成 → 标记非活动并撤销旧采集代次 → 等待初始化/重配/恢复 →
  释放原生采集 → STT finalize/尾段排空/stop → 保存会话 → 清空显示队列。
  排空只有一个 5 秒总预算，默认至少 1.5 秒 grace；超时会撤销 provider 发送并报告失败。
  只接受当前会话尾段 final，拒绝旧会话/旧 provider 的排队回调。原生释放失败仍尝试
  排空和保存，但后续开始会拒绝，避免复用状态不明的句柄。
- 输入/输出枚举保持同步；过滤本分支原生后端的私有聚合设备，保留用户的合法虚拟音频
  路由。按精确 ID 选择，已消失的选择回退默认设备并通知 UI。系统音频 `sck` 是既有
  后端选择，不误当枚举设备。现有 main/IPC 调用形状不变，生产 IPC 回调有 mock 行为测试。
- 睡眠撤销在途初始化并释放采集；唤醒等待释放、重新枚举/打开，并重置恢复次数。
  显示器变化及解锁重新核验快捷键。退出先移除 OS 订阅并等待音频/会话清理，
  再进入原有应用退出清理。设置中的音频测试也等待实际 destroy，并拒绝权限等待后的迟到采集。
- S33：不引入自动回答、Judge 或 Local Context 预热；转写入口直接更新 SessionTracker，
  不进入旧投机回答/自动跟进引擎。既有 SessionTracker 上下文及压缩策略未在本票重构。

## 本地检查

所有测试经 `scripts/margin/isolation/run-node.mjs`；单文件带
`--test --test-timeout=60000 --test-reporter=tap`，临时身份及合成 HOME 位于工作区
`.agy-tmp/`。临时目录交付前删除。没有启动 Electron、读取真实凭据、采集真实音频、
授予权限、调用真实 STT/模型服务或触发 CI。

| 检查 / 命令 | 退出码 | 结果 / checks 下证据 |
| --- | --- | --- |
| 清理未跟踪的 dist、dist-electron 后 `npm run build:electron` | 0 | `build-electron.log`；默认 temp 身份，没有原生编译 |
| `npx --no-install vite build` | 0 | `vite-build.log`；保留既有大 chunk 警告 |
| `npx --no-install tsc -p electron/tsconfig.json --noEmit` | 0 | `tsc-electron.log` |
| `npx --no-install tsc --noEmit` | 0 | `tsc-renderer.log` |
| 本票新增/修改的 24 个测试文件逐文件隔离运行 | 0 | **85/85 通过，0 失败、0 跳过**；`changed-*.log`、`tests.files.json` |
| 隔离运行 npm test 的六组测试目录，带 60000ms 超时与 TAP | 1（已批准例外） | **120 文件、962 测试：956 通过、1 图标环境失败、5 既有跳过、0 取消**；`unit-final.log` |
| 两个 Node 隔离守卫自测（`--allow-blocked`） | 0 | **12/12**；`guard-selftest.log`，其中故意触发的拦截属于自测预期 |
| `node scripts/margin/provenance-check.mjs --max-hits 0` | 0 | **G2 0 命中**；`provenance.log` |
| `node scripts/margin/retired-check.mjs` | 0 | **267 条规则、0 失败**，含本票 6 条；`retired.log` |
| `node scripts/margin/preload-contract-check.mjs` | 0 | 227 声明 / 235 实现、0 缺口；`preload-contract.log` |
| `node scripts/margin/ipc-channel-check.mjs` | 0 | 136 调用 / 151 handler、0 缺口；`ipc-channels.log` |
| `git diff --check` 和提交前暂存区检查 | 0 | `diff-check.log`；只暂存本票文件 |

`MeetingAudioPipelineRaces` 为 **16/16**：保留初始 13 个场景的适用断言，
按 Claude 决定将 HFP 场景替换为“不自动换麦且旧 PCM 无效”，再补三个所有权/取消边界。
最初启动顺序失败、路由/恢复等待超时保留在 `races-before.log`；
取消时立即撤销 PCM 的 red/green 见 `abort-revocation-before.log` 与最终逐文件日志。
阻止投机回答的生产入口 red/green 见 `transcript-ingress-before.log` 和对应 changed 日志。

### 图标例外与既有跳过

唯一全量失败为 `electron/margin/__tests__/icons.test.mjs` 的
“generation is repeatable in synthetic directories and system iconutil decodes the ICNS”。
**沙箱内 iconutil 不可用，Claude 已在沙箱外验证**：本轮续派消息明确报告同一隔离命令
4/4 通过，并允许本地检查按此例外继续。这里保留原始退出 1，不删除/跳过/修改图标测试，
也不把 Claude 的外部结果冒充本会话运行；外部 TAP 未复制到本目录，完整 gates 由 Claude 补入。

5 个既有跳过未变：ActivationPolicyOrdering 的 1 项留 AG-61；
OpenAIRealtimeGAProtocol 的 4 项留 AG-41。本票没有新增跳过。

### 旧字符串测试的行为替代（G6）

原文件名保留，以下已重写为执行生产代码的 mock 测试；不以新代码字符串替代旧字符串断言：

| 原测试 | 现在验证的行为 |
| --- | --- |
| BeforeQuitShutdownRace / DefaultOutputWatcherShutdown | quitting 不再访问路由；生产退出取消 watcher 并释放双路采集 |
| DefaultOutputWatcherEpoch / StartStopRaceDeferredInit / EndMeetingAbortsInFlightInit | 旧代次失效、延迟开始可取消、生产 Stop 等待在途权限探测 |
| SystemAudioRecoveryRouteChangeMutex | 恢复与路由变化共享重建所有者 |
| MicRecoveryUsesCanonicalWiring / MicRecoveryEmitsTerminalIpc | 新麦克风复用统一数据/格式/端点接线，恢复有界且旧错误不再触发恢复 |
| AudioInitPromiseClearedInFinally | 成功和失败都清理初始化句柄并正确报告 |
| RestartCapturesAfterResumeResetsCounters | 生产唤醒恢复完整次数预算，旧恢复定时器失效 |
| SetupSystemAudioPipelineConstructionGuards | 单路原生/provider 创建失败有终态通知，不抑制另一条可用通道 |
| SetupSystemAudioPipelinePermissionAlwaysChecked | 即使已有采集也重新检查权限，拒绝时释放系统采集、保留麦克风 |
| StuckWatchdogDisarmOnEndAndAbort | 使用真实主进程健康监测方法，证明每路 native destroy 之前先 disarm |
| MainTeardown | 保存失败时仍清理 draining、会话标识和显示队列 |
| OutboundSttRevocation（只改消费者用例） | 实际 AppState/session 在等待重配之前同步撤销两路 provider；其余协议用例保留 |
| AudioTestSystemAudioLevelMeter（只改受影响用例） | 真实 stopAudioTest 立即清空所有权、等待两路释放；权限等待中停止后不创建采集 |

`Mg21StopConsumer` 不再含假停止实现：测试提取实际 AppState 方法，使用本票的
真实 queue/session/pipeline 与 fake 原生采集，覆盖保存顺序、重复请求、睡醒、退出和失败清理。
`MeetingTranscriptIngress` 直接运行实际 IntelligenceManager 方法并把自动引擎替身设为抛错，
证明转写入口不触发自动回答引擎。云端提供商的协议联合测试仍是 AG-41，不在本票冒充完成。

## 草稿及来源处置

逐处 G2 处理见 [PROVENANCE 的 AG-40 节](../../PROVENANCE.md#ag-40-dual-audio-and-meeting-lifecycle-2026-10-11)。
不存在“改到扫描不命中”的处置：受限设备模块和 HFP 行为删除，其他逻辑按需求重写；
通用命中按原样逐条说明。

| 草稿文件 | 最终处置 |
| --- | --- |
| AudioDevices.ts | 整体重写，保持原生同步 API；设备过滤自写 |
| audioDeviceSelection.mjs / .d.mts | 删除，并删除对应的 4 条不当 allowLines |
| MeetingAudioPipeline.ts | 整体重写；删除 HFP 及其 allowLine；保留测试要求的外部管线契约 |
| MeetingSttSession.ts | 改为绑定级身份/监听器、单 deadline 排空；不用原草稿的双层停止预算结构 |
| meetingLifecycleQueue.ts / TranscriptDisplayThrottle.ts / osEventSubscriptions.ts | 按本票行为重新实现，去掉无意义包装和并未接通的 archive flush 假契约 |
| screenCapturePermissions.ts（上一轮临时补件） | 删除；复用本分支既有 resolver |
| MeetingAudioPipelineRaces / MeetingSttSession / TranscriptDisplayThrottle 测试 | 经 S35 行段审查后保留/适配 mock 行为；共享 fixture 真实导出、ES2022 编译，未削弱竞态断言 |
| Mg21StopConsumer / OsEventSubscriptions 测试 | 重写为生产入口/订阅行为测试 |
| provenance-config.json | 受限设备/HFP 豁免及不再使用的草稿豁免删除；只保留逐条审核的通用写法 |

保留的运行时基础来自本分支：原生包装器、权限探测、健康监测、STT 工厂、
SessionTracker 和 MeetingPersistence。不修改 native-module、不重编原生模块、不新增或升级依赖。
`checks/` 中非最终命名的旧日志是调试历史，包含已经撤回的中间接线检查，不能当成最终状态。
原先的 INCOMPLETE 记录已被本记录取代；图标阻塞由本轮明确决定解除。

## 交付边界

完整 `node scripts/margin/run-gates.mjs` 未运行；Claude 在 `gates/` 写入证据并复查后才可推送。
不运行阶段出口 CI、不安装/发布应用、不改正式身份，也不进入 AG-41/42/60。
未实机验证：真实麦克风/系统采集、权限界面、睡眠唤醒、显示器热插拔、真实 STT 服务。
检查结束及提交前再次确认原工作区干净、分支未变；无越界写入或新的停止条件。
