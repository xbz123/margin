# Wayfinder

**Project outcome:** 在上游 `a786910e` 基线上以 AGPL 重建 Margin：不引入上游 6 月之后的代码，来源可追溯，分阶段验收，最后在公开仓库 `xbz123/margin` 发布 macOS 与 Windows 双平台 Release（`docs/margin/PLAN.md` §1、S30、AG-62、AG-74）。详细状态以 PLAN 为准，本文件只指路。

## Next actions

- **AG-60a 等待只读复查** — 实现 `e05ad25e`、记录 `4a782acc` 已按用户批准推送两个远端并核对，本地 gates 单次 16/16；证据 `docs/margin/evidence/AG-60a/`，记录 PLAN §8。Claude 复查完成后才开始 AG-40；阶段出口 CI 仍须用户批准。

- **阶段 4–6 交给 Astra 执行**（S36）— 交接文档 `docs/margin/HANDOFF-stage4-6.md`：顺序 AG-60a → AG-40 → AG-41 → AG-42 →（阶段 4 出口）→ AG-50 → AG-51 →（阶段 5 出口）→ AG-60 → AG-61 → AG-62 →（阶段 6 出口）；每票 Claude 只读复查，出口 CI 须用户批准。复用依据见 PLAN §6"旧 Margin 复用清单（S35）"。

## Waiting

- **阶段 7** — Windows（AG-71–73）按 S33 推迟；AG-74 先只发 macOS，等 AG-62；签名（D6）和架构（D7）等用户决定。

## Watching

- 未经真实环境验证：Codex 登录（AG-34）、真实模型服务的兼容性、S29 提示词改动对回答质量的影响。已写入阶段 3 签收（PLAN §8"阶段 3 签收"）。
- 提示词分层和按场景的附加指令已记入 AG-51，属于后期工作（PLAN S29 第 3 条）。
- 截图截取环节是否为原生像素密度只能用真实屏幕确认（PLAN §9"S34 删除 sharp"）。

## Done (rolling)

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
