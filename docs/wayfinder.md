# Wayfinder

**Project outcome:** 在 AGPL 基线 `a786910e` 上交付符合 [产品 Spec](product.md) 的 Margin（macOS arm64 与 Windows x64），不引入后期上游内容。执行规则与门禁见 [PLAN](margin/PLAN.md)。

**Current answer:** Mac 线与 Windows 线已于 2026-11-10 合并到 `codex/margin-unified`，两条旧分支已从远端删除，回退点见 [PLAN R16](margin/PLAN.md#执行规则)。2026-11-28 主线改名为 `main`。之后的改动都在主线上，用测试包交付；正式发布、正式 Margin 身份和签名仍未决定。

**Current focus:** 最新测试包 test.25（`7bbf55493`，2026-11-28），公开 CI gates 通过，包含 2026-11-28 决定的代码改动。test.10–test.24 主要是清理退役代码、修复历史/重试/PDF 导出/转写收尾、破折号处理、模型列表更新，以及新增网络代理。代理功能在 Windows 安装版上实测通过，见[记录](margin/evidence/network-proxy/README.md)。下一步是用户的朋友在国内实际使用代理。

## Waiting

- **代理国内实测** — test.24 已装在 Windows 本机并测过手动代理和中文错误提示；待用户的朋友在国内用 Clash 等工具实际使用。带密码的代理、SOCKS5/HTTPS 代理和转写经代理仍未实测；resume：[记录](margin/evidence/network-proxy/README.md)。
- **Mac 实测** — Mac 上还没有实测统一分支的测试包，包括 Answer / Stop 口述（test.9 起）和代理；resume：[口述记录](margin/evidence/answer-dictation/README.md)。
- **阶段 6 用户签收** — 实际采集、Zoom/腾讯会议共享接收端和真实服务质量仍待实测；只测核心场景，不做 SHA256 核对；resume：[阶段 6 清单](margin/STAGE6-CHECKLIST.md)、[Windows 最小清单](margin/WINDOWS-TEST-CHECKLIST.md)。
- **2026-11-28 决定的代码改动** — 删除 Codex 登录来源；Reset 只在生成中取消回答；去掉设置文件损坏的特殊处理；DeepSeek 始终直连；另删除快速回答模式。已出测试包 test.25（`7bbf55493`，两个平台构建成功），还没实测。
- **正式身份、图标与发布** — AG-62 正式 Margin 身份、S42-06 图标与平台交付、AG-74 发布都待用户决定；见 [PLAN](margin/PLAN.md)。
- **主线改名收尾** — 私有仓库的 `main` 已指向主线；还差同事在公开仓库 `xbz123/margin` 推送 `main`、把默认分支改为 `main`，然后删除两边的 `codex/margin-unified`。在此之前公开 CI 不会因推送触发；resume：[PLAN R15、R16](margin/PLAN.md#执行规则)。
- **练习模式** — 2026-11-28 确认设计：Margin 扮演面试官，从开始会议走到会后回顾，分“演示”和“彩排”两档。待用户决定剧本内容、记录去留和彩排录音的播放方式，并授权实现；resume：[PLAN PRACTICE](margin/PLAN.md#未完成的-ticket)、[架构](architecture.md#练习模式的接入)。

## Watching

- 未经真实环境验证：真实模型服务的兼容性；阿里云百炼默认模型 3.1 在通用域名和长会话下是否可用尚未实测。
- 截图是否保持屏幕原生像素密度，只能在真实屏幕上确认。
- “发新消息会取消旧生成”还没有按每个真实入口核对，不能当作现成保证。
- 破折号处理的已知局限：数字范围里的短破折号（如 `1–3`）会变成 `1, 3`；`- — item` 变成 `-, item`。

## Done (rolling)

- 文档精简（2026-11-28）：spec 按现行代码和用户决定改写；PLAN 只留现行执行规则和未完成 ticket，原文归档到 [archive](margin/archive/PLAN-2026-10.md)。面试精简提示的回答质量由用户确认完成。

- 网络代理与代理错误显示（2026-11-24 至 11-26）：test.23、test.24 两个平台构建成功，公开 CI 通过；Windows 安装版实测手动代理、打字提问、What to answer 和笔试截图的中文错误提示；[记录](margin/evidence/network-proxy/README.md)。macOS 未实测。
- Answer / Stop 口述与 What to answer 问题来源（2026-11-10 至 11-12）：test.6–test.9 两个平台构建成功，公开 CI 通过；test.8 Windows 真机（真实豆包）9 个场景 8 个通过，剩一项已知边界；[记录](margin/evidence/answer-dictation/README.md)。
- Mac 线与 Windows 线合并为 `codex/margin-unified`（2026-11-10）。
- 更早的完成记录（阶段 1–5 签收、各 AG/S 票）见[归档的 Wayfinder](margin/archive/wayfinder-2026-11.md#done-rolling) 和[归档的 PLAN](margin/archive/PLAN-2026-10.md)。
