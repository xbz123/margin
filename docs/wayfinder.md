# Wayfinder

**Project outcome:** 在 AGPL 基线 `a786910e` 上交付符合 [产品 Spec](product.md) 的 Margin：先 macOS、后 Windows，核对共享代码和平台差异后统一分支，不引入后期上游内容。执行与发布门禁见 [PLAN](margin/PLAN.md) / AG-74。

**Current answer:** 截至 2026-10-15，阶段 6 技术验收及 S44 软件修复通过，Natively Local 已安装且已能进入设置。此前 CoreAudio 启动卡顿风险未关闭，真实模型测试及阶段 6 实机签收仍未完成；[签收标准](margin/PLAN.md#阶段-6-验收标准与当前结果)。

**Current focus:** S45 设置对齐及独立网关已完成本地门禁和独立复查，下一步提交并核对公开 CI。S44 安装后的真实启动与阶段 6 签收风险仍独立保留。

## In progress

- **S45 设置对齐** — running；resume：[验收证据](margin/evidence/S45/README.md)、[执行契约](margin/PLAN.md#s45-settings)；本地验收通过，下一步两库提交及公开普通 CI，不安装或调用真实服务。

## Waiting

- **S44 真实参数验证** — 已能进入设置；等待 S45 交互稳定后按现有授权测试已保存 Key，CoreAudio 风险不因单次恢复关闭；[证据与边界](margin/evidence/S44/README.md)。不重复重置权限、不绕过钥匙串。

- **阶段 6 实机复测与用户签收** — 用户报告系统权限已授予，实际采集、设备切换及共享接收端仍待对应实测，执行前确定测试组合；resume：[签收标准](margin/PLAN.md#阶段-6-验收标准与当前结果)、[出口回执](margin/evidence/CI-38492031013/README.md)。

- **AG-62 正式 Margin 身份** — 本轮只批准 Natively Local 测试身份；正式 Margin 的 CI 外运行与发布仍待决定；resume：[本机授权](margin/PLAN.md#阶段-6-本机用户测试授权2026-10-14)。
- **S42-06 保护与平台交付** — 图标参考旧 Margin、简洁，具体图形及真实服务预算待定；D2 与发布仍按授权范围；resume：[增量票](margin/PLAN.md#tickets-20261013)。黑框不可接受，README 只录实测。
- **阶段 7** — Windows（AG-71–73）后置；AG-74 先 Mac，等 AG-62。D7 已定 Mac M 系列/Windows x64；D6 未购买、后续处理，见 [Spec](product.md#open-questions)。

## Watching

- 未经真实环境验证：Codex 登录（AG-34）、真实模型服务的兼容性、S29 提示词改动对回答质量的影响。已写入阶段 3 签收（PLAN §8"阶段 3 签收"）。
- AG-51 默认提示词拼接字节已核对；真实模型的质量和对附加指令的遵从性未评估（S27/S29），不以 mock 代替。
- 截图截取环节是否为原生像素密度只能用真实屏幕确认（PLAN §9"S34 删除 sharp"）。

## Done (rolling)

- S44 设置与退出修复（2026-10-14）：`51eeed7a` 两库推送、本地门禁、独立复查及公开 CI 38616962535 通过，新 Natively Local 已安装并保留配置；[验收记录](margin/evidence/S44/README.md)。真实启动/连接仍有独立阻塞。

- 阶段 6 软件/打包验证（2026-10-14）：`f35f7b3f` 出口 CI、产物和源码核对、下载版隔离启动通过；同源 Natively Local 已安装并核对；[验收记录](margin/evidence/CI-38492031013/README.md)。不是整体签收。

- AG-62 引导/文档及本机测试包：软件门禁、CI 与产物核对通过，Natively Local 已安装；[引导验收](margin/evidence/AG-62/README.md)、[本机包](margin/evidence/AG-62-local/README.md)。正式 Margin 身份放开仍待决定。
- AG-61 窗口控制软件范围（2026-10-13）：`ffc08ab1` 两库交付，本地完整门禁、[公开 CI](https://github.com/xbz123/margin/actions/runs/38472041728)及下载证据核对通过；[验收记录](margin/evidence/AG-61/README.md)。实机共享效果仍未验证。

- AG-60 设置与双语（2026-10-13）：`968ea59d` 两库交付，本地完整门禁和[公开 CI](https://github.com/xbz123/margin/actions/runs/38465269168)通过；[验收记录](margin/evidence/AG-60/README.md)。
- 阶段 5 用户签收（2026-10-13）：用户“同意，可以开始阶段6”；技术证据及未实测边界见[出口回执](margin/evidence/CI-38447881500/README.md)。
- S42-04 原输入重试与可见首字计时（2026-10-13）：`7915b627` 已推送两库，独立审阅、本地门禁及[公开 CI](https://github.com/xbz123/margin/actions/runs/38394532024)通过；[验收证据](margin/evidence/S42-04/README.md)。回执与状态更新留待下一次已授权提交，不重复运行测试。
- AG-40（Codex）和 AG-41a（AGY，与 AG-40 并行）（2026-10-11）：双路音频与会话生命周期；退役 Google、Deepgram、ElevenLabs、Azure、IBM Watson 五家 STT（S39）。合并后完整 gates 16/16。
- AG-40 实现和本地检查通过（2026-10-11，`5241e414`）：生产停止链、尾段排空、重配、睡眠/唤醒及 OS 订阅接线；完整门禁和复查待 Claude，未推送、未实机验证（PLAN §8，`docs/margin/evidence/AG-40/`）。
- AG-60a 共享翻译和设置组件（2026-10-11）：Astra 实现 `e05ad25e`，Claude 复查通过（PLAN §9"AG-60a 复查"）；AG-40 起改由 AGY 执行（S37）。
- 阶段 4–6 执行交接（2026-10-11，S36）：`docs/margin/HANDOFF-stage4-6.md`，交给 Astra 执行。
- S35 复用清单按 Astra 审阅修订（2026-10-11）：候选与已审分开，快照行和近似快照行逐行列出，资产和未扫描扩展名单列，依赖按 `0769715e` 分级并求闭包，新增 AG-60a；重跑结果逐字节可复现，`rule_probes.py` 8/8（PLAN §9"S35 复用清单审阅"）。
- S35（2026-10-11）：AG-41 的 STT 定为 OpenAI、Soniox、Groq、阿里云百炼、豆包；旧 Margin 复用清单（阶段 4–7，1655 个文件）写入 PLAN §6（`docs/margin/evidence/S35-stage4-reuse/`）。
- 阶段 3 签收（2026-10-11）：W4 本机核对通过（源码包 587 个文件一致、与 `git archive` 逐字节相同；`asar-smoke` 10/10），依据 W3 出口 CI 38123550800（PLAN §8"阶段 3 签收"，`docs/margin/evidence/W4-local-verify/`）。
- W3 出口 CI 38123550800 通过（2026-10-11）：gates 16/16、正式身份契约 6/6、两个身份包检查 12/12 和启动 7/7、原生 `0f92a0b1`、包内许可含 stdarch、源码包 `cleanTree`（`docs/margin/evidence/CI-38123550800/`）。
- W3 重跑 38120147426 已记录（2026-10-11）：失败，原因是测试没有关闭首次启动的权限卡片，已修复；原生 `0f92a0b1`、两个身份 12/12 和启动 7/7、源码包都通过（`docs/margin/evidence/CI-38120147426/`）。
- AG-52 删减（2026-10-11）：会议只保存本地转写和用量，删除自动摘要、标题生成、启动恢复、会议聊天和 `post_call_summary`；本地 gates 16/16（`docs/margin/evidence/AG-52-trim/gates/`）。
- S34 删除 sharp 和 libvips（2026-10-11）：截图改用 nativeImage、按原图分辨率发送；本地 gates 16/16（`docs/margin/evidence/S34-sharp-removal/gates/`）。
- S33 范围精简（2026-10-11）：删除 AG-43 和 Local Context 预热，AG-52 缩减，Windows 推迟、`windows-compile.yml` 改为只手动触发；nativeImage 实验见 `docs/margin/evidence/nativeimage-pilot/`。
- S32（2026-10-11）：引用其他项目时只需确认使用开源协议，不再逐项做许可分析；上游 6 月边界不变（PLAN S32）。
- W3 出口 CI 38090230126 已记录（2026-10-11）：结论为失败，但除 storage 和因此跳过的身份契约外，其余验收项都通过，产物已下载核对（`docs/margin/evidence/CI-38090230126/`）。
- W2 关闭（2026-10-11）：R3-1、R3-2、R3-5 在 `3e779466` 修复，门禁 16/16，Windows 编译检查 38089471774 通过，Claude 复跑 136/136（PLAN §9"W2 关闭核对"）。
- S31：R3-1 选甲；AG-70 并入每票门禁，`windows-compile.yml` 推送时自动运行，只在公开仓库运行（PLAN S31）。
- W1 阶段 3 只读复查：没有阻断问题，R3-1 应修，R3-2 至 R3-5 为建议（PLAN §9"阶段 3 复查（Claude）"）。
- AG-70 Windows 编译检查首次运行通过：运行 38087756944，提交 `1f6313a8`（PLAN §8）。
- 阶段 3 提示词定案（S29）：`90fae433`，本地 gates 16/16（`docs/margin/evidence/AG-33/prompt-decision/gates/`），已推送到私有和公开两个仓库。
- 原生模块补 stdarch 许可：`23a25388`，gates 16/16（`docs/margin/evidence/stdarch-notice/gates/`）。包内许可正文在 W3 确认。
- 阶段 2 出口签收（2026-10-10）：完整 CI `38057787157` 及本机核对（PLAN §8"阶段 2 出口签收"）。
