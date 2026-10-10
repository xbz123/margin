# Wayfinder

**Project outcome:** 在上游 `a786910e` 基线上以 AGPL 重建 Margin：不引入上游 6 月之后的代码，来源可追溯，分阶段验收，最后在公开仓库 `xbz123/margin` 发布 macOS 与 Windows 双平台 Release（`docs/margin/PLAN.md` §1、S30、AG-62、AG-74）。详细状态以 PLAN 为准，本文件只指路。

## Next actions

- 没有未认领的事项。

## Waiting

- **W3 阶段 3 出口 CI** — W2 已关闭，只等用户批准触发（参数见 PLAN W3）。
- **W4 本机核对与阶段 3 签收** — 等 W3 的产物；签收由用户决定。
- **阶段 4（AG-40 起）** — 等阶段 3 签收和用户允许开始（PLAN §6"阶段 3–6"表）。
- **阶段 7 其余（AG-71–75）** — 等对应的 macOS 功能完成（PLAN §6"阶段 7"表）；签名（D6）和架构（D7）等用户决定。

## Watching

- 未经真实环境验证：Codex 登录（AG-34）、真实模型服务的兼容性、S29 提示词改动对回答质量的影响。签收时要写明（PLAN S27、S29、W4）。
- 提示词分层和按场景的附加指令已记入 AG-51，属于后期工作（PLAN S29 第 3 条）。
- `licenses/README.md` 仍说源码包是 "private workflow artifact"，S25 之后已不准确，尚未修改。

## Done (rolling)

- W2 关闭（2026-10-11）：R3-1、R3-2、R3-5 在 `3e779466` 修复，门禁 16/16，Windows 编译检查 38089471774 通过，Claude 复跑 136/136（PLAN §9"W2 关闭核对"）。
- S31：R3-1 选甲；AG-70 并入每票门禁，`windows-compile.yml` 推送时自动运行，只在公开仓库运行（PLAN S31）。
- W1 阶段 3 只读复查：没有阻断问题，R3-1 应修，R3-2 至 R3-5 为建议（PLAN §9"阶段 3 复查（Claude）"）。
- AG-70 Windows 编译检查首次运行通过：运行 38087756944，提交 `1f6313a8`（PLAN §8）。
- 阶段 3 提示词定案（S29）：`90fae433`，本地 gates 16/16（`docs/margin/evidence/AG-33/prompt-decision/gates/`），已推送到私有和公开两个仓库。
- 原生模块补 stdarch 许可：`23a25388`，gates 16/16（`docs/margin/evidence/stdarch-notice/gates/`）。包内许可正文在 W3 确认。
- 阶段 2 出口签收（2026-10-10）：完整 CI `38057787157` 及本机核对（PLAN §8"阶段 2 出口签收"）。
