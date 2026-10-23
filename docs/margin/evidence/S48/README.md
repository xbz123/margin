# S48 执行记录（含中断历史）

**最新结论（2026-10-23，Codex 独立复验）：本地代码验收通过。** Claude 修复了旧推理协议切换一致性 P2；当前 Codex 独立重跑原反例 1/1、关键套件 191/191 通过，并核对修复后完整门禁 16/16。详见[独立报告](independent-review.md)。已提交并推私有 origin（2026-10-23）；尚未推公开仓库、跑 CI 或安装，真实服务与实机签收未完成；以下中断、首次审阅与实施记录为历史证据。

2026-10-23，当前 Codex 核对；本票部分实现，未完成验收。契约见 [Ticket/Spec](../../S48-model-capabilities-and-reasoning.md)。基线仍为 `94824398`，合并工作树包含未提交 S47 与 S48。

## 已核实终态

- Claude 原会话在 S48 窄测修正期间停止，进程 exit 1。
- 执行日志末条虽然 subtype 为 success，但同时 `is_error=true`、`terminal_reason=api_error`、HTTP 429、`api_error=usage_limit_reached`，不能解释为实现成功。
- 服务提示会话额度于 2026-10-23 02:10（Europe/Stockholm）重置；这是服务提示，不保证届时恢复成功。未换模型、未重新派发。
- 最终 result.txt 尚未生成，完整 gates 目录及验收回执尚未生成。

## 当前证据边界

工作树已出现共享能力表、统一推理控件、持久/会中状态与相关调用修改，但尚未独立审查，不能称为已完成。

原始窄测末轮仍报告失败：`credentialTransactions.test.mjs` 的 S47 按候选连接测试，以及 `ScopeLocalFallback.test.mjs` 文件级失败。这里仅记录日志事实，尚未判定为产品缺陷还是测试适配问题。此前失败日志保留；构建日志完成不等于测试通过。

## 恢复与验收

额度恢复后继续同一 Claude 会话，先读末轮失败日志与本票验收条款，修正并补齐测试、现行 Spec/PLAN，取得完整隔离门禁证据，然后由当前 Codex 独立验收。不得从旧 S47 的16/16推定本票通过，不重复启动并行写入者。

本次仅记录中断状态，未修改实现代码，未提交、推送、远端 CI、安装或调用真实服务。已安装版本不变；旧未跟踪证据目录保留。

## 恢复执行（Claude resume-2，2026-10-23）

以下为恢复后的本地结果，仍待当前 Codex 独立验收；Claude 不自报验收通过。未提交、推送、远端 CI、安装，未调用真实服务、未读真实 Key/用户数据。原始日志在任务临时目录 `/private/tmp/margin-capability-reasoning-SYRJQD/`（`checks/` 编号 01–32 起、`gates/` 首轮、`gates-2/` 次轮、`mutations/`），终态报告为同目录 `result.txt`。

**中断前两处窄测失败的定位**（`checks/05-narrow-third.log`）：

- `credentialTransactions` S47 按候选测试：测试夹具去掉逐候选推理后，“配置已变化”用例与已保存配置变得相同，不再构成变化；改为确实不同的候选列表。不是产品缺陷。
- `ScopeLocalFallback` 文件级失败：Claude 自己改测试时重复声明了 `openaiClient`（SyntaxError）。改为复用已有夹具。不是产品缺陷。
- 复核时另发现并修正一个设计问题：换模型时会把“继承保存值”误改成明确的会中覆盖，导致 A→B→A 回到 A 仍停在服务商默认；改为只调整明确设定的会中值。

**新增 S48 专属测试**：`electron/llm/__tests__/answerReasoning.test.mjs`（9：能力表匹配、图片守卫、各模型档位、完整字段组合、mock wire 字段、拒绝前零出站、任务快照与备用/测试/网关隔离、会中覆盖与 A→B→A、旧设置待确认）；`credentialTransactions` 新增 5（保存→运行→冷启动、陈旧/非法/写失败/apply 失败、会中 IPC、换主模型的同次保存与提示、旧结构读取、未保存会议 retry/discard）；`SessionReasoningMeetingEnd.test.mjs`（4：会议保存成功/无记录/保存失败/未开始）；`outbound-renderer` 新增 1 个挂载用例（真实 manager、IPC、preload、LLMHelper，设置页与会中窗口同页，A→B→A、3/4/5 档、禁用、Preview 停用提示、未核实图片文字、中文可访问名称、600px 外壳布局）。旧测试按新契约改写处保留安全断言，改为使用表内模型或断言新拒绝语义。

**变异**（`mutations/`）：旧设置泄漏到其他模型、备用/显式目标继承主模型强度、旧确认绕过未知图片、会中控件绑定保存值，4 个均被对应测试识别，源码已逐字节还原。

**首轮完整门禁**（`gates/`）14/16：来源检查 1 处命中（新测试中一行与受限源码相同，改为仓库已登记写法，未扩大豁免）；单元 3 失败（一处静态守卫因新加的全窗口循环靠近 `stt-status` 而命中，改用既有 `broadcast`；会议夹具未包含新方法；一处旧测试的 ES5 转译使 Set 展开为空，生产代码改为 `Array.from`）。修正后窄测 80/80、来源 0 命中。

**次轮完整门禁**（`gates-2/`）：16/16 通过（单元 1239/1239，回答 21/21，存储 3/3，启动 2/2，挂载界面 16/16，来源 0 命中，`git diff --check` 通过；MeetingPersistence 时钟波动未复现）

**未验证**：真实服务是否采用所选强度、图片质量、费用与权限；Windows 仅静态审查；未安装，阶段 6 不关闭。


## P2 修复（Claude，2026-10-23，待当前 Codex 独立复验）

[独立验收](independent-review.md) 复现的 P2：旧设置待确认时保存官方配置（如改协议）后，运行态仍用旧目标推导的 legacy 状态，冷启动则按新目标推导。修复只在官方保存的共同应用路径 `ProcessingHelper.applyStoredProvider` 中，配置 provider 后从存储重新读取 `getSavedReasoning()` 并应用，再由调用方刷新和通知；会中覆盖、临时模型选择与在途快照不变，失败保存不进入该路径。新增回归“S48 P2 …”（credentialTransactions）修复前 exit 1、修复后 exit 0；3 个 LLMHelper 替身补 `setSavedReasoning`（并记录调用顺序）。完整本地门禁 16/16（单元 1240/1240）。原始日志 `checks-P2/`、`gates-P2/`，报告 `result-P2.txt`。P2 仍待独立复验，不在此称已通过。
