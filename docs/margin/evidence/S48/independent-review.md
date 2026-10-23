# S47/S48 独立代码验收（2026-10-23）

最新结论：**P2 已修复并通过当前 Codex 独立复验，S47/S48 本地代码验收通过**（2026-10-23）。下面保留首次发现及红色证据；复验见文末。没有提交、推送、远端 CI、安装或调用真实服务。

## 范围与基线

- 分支 `codex/margin-agpl-migration`，HEAD `9482439825469df77469b5b2bb2e9b8be538405d` 加未提交 S47/S48。
- 审阅共享能力表及图片守卫、官方/网关身份边界、默认/会中状态、旧配置兼容、存储/IPC/preload/界面消费者、任务快照、备用与连接测试、会议结束与相关测试调整。没有扩展为整个仓库审计。
- 审阅代码摘要 SHA256：`0d1ad041ca3f628b6c72d76a99fdeb9604d2c05aebfe0de6fdbc3ba0aadcd033`。计算范围为 `git diff HEAD --name-only` 中非 Markdown 文件，加六个新增生产/测试文件，路径排序后按 `path + NUL + bytes` 聚合。后续文档编辑不改变该摘要。

## P2 / Spec：协议保存后未刷新派生的旧推理设置

位置：`electron/ipcHandlers.ts:1072–1074` 的 `set-provider-configuration` 应用分支，及其调用的 `ProcessingHelper.applyStoredProvider`。

受影响条件：用户保留旧版逐模型推理配置、尚未保存新的统一偏好，且旧设置无法无损映射为表中选项，因此处于“旧设置待确认”。这是 C4 明确要求支持的读取路径。

复现使用合成的 OpenAI 未收录模型、旧 `effort=high`、默认选择该模型：

1. 启动时 `getSavedReasoning()` 生成绑定 Chat Completions 完整目标的 legacy 状态，运行请求含 high。
2. 通过真实 `set-provider-configuration` 回调把协议改成 Responses，保留旧字段；保存返回 `{ok:true}`，默认目标和运行目标都跟随新协议。
3. 应用分支更新了 provider 和 generation policy，但没有重新读取/应用 `getSavedReasoning()`。运行中的 legacy 状态仍绑定旧协议，被 `reasoningApplies` 判为不适用：下一任务不带推理字段。
4. 对同一合成持久文件 `disk.boot()` 并执行真实启动链，新 legacy 状态绑定 Responses，下一任务重新带上 `effort=high`。

观察：保存后快照为 `null`，冷启动快照为 `{effort:'high'}`；持久默认控件显示 legacy，运行控件显示 default。断言保存后与冷启动一致时 exit 1，失败是产品行为，不是夹具加载错误。

最小修正：成功保存官方配置后的共同应用路径，应从存储重新取得并应用保存的推理状态，再通知消费者；保留明确的会中临时覆盖，不用重选默认模型代替刷新。补“旧待确认设置 → 协议保存 → 即时状态/任务快照 → 冷启动”的回归，检查失败保存仍零副作用。

## 独立复跑与证据

原始日志在本机审阅目录 `/private/tmp/margin-s48-independent-L1ETIu/`，不公开分发：

- `node scripts/build-electron.js`：exit 0，`build.log`。
- 项目隔离入口运行 `answerReasoning`、`SessionReasoningMeetingEnd`、`credentialTransactions`、`SpeechActions`、`ScopeLocalFallback`：**190/190，exit 0**，`key-tests.log`。
- 项目隔离入口运行 `outbound-renderer`，名称过滤 `S47|S48`（亦命中名称含 S48 的 S45 用例）：**3/3，exit 0**，`mounted-unsandboxed.log`。首次系统沙箱内 Electron 启动失败，未进入产品断言；按权限批准在沙箱外复跑，项目自身临时 profile/mock/loopback 守卫始终保留。
- 独立补充兼容性检查：`compatibility-probe.cjs` 复用既有合成存储和真实 ProcessingHelper/LLMHelper/IPC 回调，不修改仓库测试；隔离入口加精确 `--allow-exec esbuild` 后 **0/1，exit 1**，`compatibility-probe-2.log`。首次遗漏 esbuild 子进程白名单被守卫拒绝，单独保留 `compatibility-probe.log`，不算产品失败。
- `git diff --check`：exit 0。
- 核对 Claude 原始 `gates-2/summary.json`：16/16、每步 exit 0；135 个单元文件、1239/1239、0 skip/cancel、无隔离拦截或不明退出。未无故重跑全量；现有绿色门禁没有覆盖上述反例，不能据此签收。

## 其他结论与边界

- 官方能力按精确目标匹配、未知/不支持图片拒绝且旧确认不能绕过、网关独立确认、三/四/五档字段组合、正常默认/会中隔离、在途快照及官方备用/连接测试不继承主模型强度，相关审阅与复跑未发现其他已确认阻断。
- 抽查官方 Gemini thinking、OpenAI GPT-6.1 Sol、Claude thinking/models overview，与已读来源合并核对所列核心能力；没有用真实 API 探测。能力表未收录的模型仍只允许文字和默认推理，这是已约定边界，不算新增缺陷。
- 报告中的 ProviderCard 是否再显示推理档位、默认预设删除保护及候选数量上限均不需要为本票新增产品决定；按当前已确认规则即可。
- Windows 运行、真实服务参数受理/图片质量/费用、安装后的用户操作未验证。没有取得截图，不将挂载测试的元素断言称为实机签收。
- 本次停在审阅结果，未自行修复；上述 P2 修正后再做针对性复验。

## P2 独立复验（2026-10-23）

Claude 在原会话完成最小修复后，当前 Codex 按 code-review / test-verification 核对共享应用路径及调用方，并独立复跑原反例与关键测试；不以实现方自报通过替代复验。

- 生产修复仅在 `ProcessingHelper.applyStoredProvider` 的 `configureProvider` 后同步调用 `setSavedReasoning(getSavedReasoning())`。三个官方应用入口均在保存成功后进入该路径、在消费者通知之前刷新；setter 只替换保存值，不修改会中覆盖、当前模型或在途快照。启动时重复赋同一值没有额外持久写入。
- 新增永久回归使用真实存储/运行类及 IPC 回调，验证协议切换后的即时任务和控件状态与冷启动一致、明确会中 default 覆盖保留、在途旧协议/推理快照不变、rename 写失败时存储字节和运行状态不变且 apply 调用为零。核对实现方修复前红色日志：失败正是 live null / cold high；未放宽该断言。
- 当前 Codex 重新运行 `node scripts/build-electron.js`：exit 0；原独立 `compatibility-probe.cjs` 通过隔离入口、精确 esbuild 白名单和 REVIEW 名称过滤：**1/1，exit 0**，live/cold 均为 `{effort:'high'}`。
- 当前 Codex 独立复跑原五个关键套件（answerReasoning、SessionReasoningMeetingEnd、credentialTransactions、SpeechActions、ScopeLocalFallback）：**191/191，exit 0，0 skip/cancel**；`git diff --check` exit 0。复验日志在原独立审阅目录的 `p2-build.log`、`p2-probe.log`、`p2-key-tests.log`，没有覆盖原失败证据。
- 核对修复后的原始 `gates-P2/summary.json` 与测试日志：**16/16**，单元 **1240/1240**，回答 21/21、存储 3/3、启动 2/2、挂载 16/16；无未完成单测文件或隔离拦截。此处是原始门禁复核，不冒称当前 Codex 再跑全量；这次生产修复未改界面，未重复挂载全量。
- 复验代码摘要（沿用上文算法）：`e6d3a92692fdd84ba78fef3fa867d507615d933fa761a3b90dcdf8c054214221`。HEAD 仍为 `94824398`，S47/S48 尚未提交。

结论：原 P2 关闭；本轮修复未发现新的阻断项。真实服务字段受理、图片质量、费用、Windows 运行和安装后的用户操作仍未验证。代码验收通过不代表发布、安装或阶段 6 实机签收；后续推送/CI/安装等待明确授权。
