# Wayfinder

**Project outcome:** 在上游 `a786910e` 基线上以 AGPL 重建 Margin：不引入上游 6 月之后的代码，来源可追溯，分阶段验收，最后出 Mac 包（`docs/margin/PLAN.md` §1、AG-62）。详细状态以 PLAN 为准，本文件只指路。

## In progress

- **阶段 3 只读复查（W1，Claude）** — paused；resume：PLAN §6"阶段 3 收尾计划"W1，复查基准 `246e4ffa`；next：读 AG-30 提交 `bcd7ebf5` 的改动，在 PLAN §9 新建"阶段 3 复查（Claude）"并记下第一批发现。

## Waiting

- **W2 修复与关闭（Codex 修，Claude 核对）** — 等 W1 的发现清单（PLAN §9"阶段 3 复查（Claude）"）。
- **W3 阶段 3 出口 CI** — 等 W2 全部关闭，并且用户批准触发 CI（参数见 PLAN W3）。
- **W4 本机核对与阶段 3 签收** — 等 W3 的产物；签收由用户决定。
- **阶段 4（AG-40 起）** — 等阶段 3 签收和用户允许开始（PLAN §6"阶段 3–6"表）。

## Watching

- 未经真实环境验证：Codex 登录（AG-34）、真实模型服务的兼容性、S29 提示词改动对回答质量的影响。签收时要写明（PLAN S27、S29、W4）。
- 提示词分层和按场景的附加指令已记入 AG-51，属于后期工作（PLAN S29 第 3 条）。
- `licenses/README.md` 仍说源码包是 "private workflow artifact"，S25 之后已不准确，尚未修改。

## Done (rolling)

- 阶段 3 提示词定案（S29）：`90fae433`，本地 gates 16/16（`docs/margin/evidence/AG-33/prompt-decision/gates/`），已推送到私有和公开两个仓库。
- 原生模块补 stdarch 许可：`23a25388`，gates 16/16（`docs/margin/evidence/stdarch-notice/gates/`）。包内许可正文在 W3 确认。
- 阶段 2 出口签收（2026-10-10）：完整 CI `38057787157` 及本机核对（PLAN §8"阶段 2 出口签收"）。
