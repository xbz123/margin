# Margin 执行计划

本文件只写现行的执行规则：怎么做、门禁与 CI、测试包与发布，以及还没完成的 ticket。产品行为只看 [Spec](../product.md)。进度和下一步看 [Wayfinder](../wayfinder.md)。

2026-11-28 之前的完整计划已归档到 [archive/PLAN-2026-10.md](archive/PLAN-2026-10.md)。归档保留原来的 §1–§9 编号、决定 S1–S50、各 AG 票和执行、评审记录。代码注释和旧证据里写的 “PLAN.md §8”“PLAN S35” 这类引用，指的都是这份归档。

## 目标与范围

- 在 AGPL 基线 `a786910e` 上交付符合 [Spec](../product.md) 的 Margin，平台是 macOS arm64 和 Windows x64（[U12](../product.md#u12)）。
- 范围、非目标和未决问题都以 Spec 为准，见 [Non-goals](../product.md#non-goals) 和 [Open questions](../product.md#open-questions)。本文件不再写第二份需求。

## 执行规则

- **R1 · PLAN 管执行，Spec 管产品**：产品行为只写在 Spec。用户的新决定先改 Spec，再改这里的规则或 ticket。归档里的历史决定和验收记录不改写。
- **R3 · 来源边界**：不引入 2026-06-01（IST）及以后公开的上游代码、测试、提示词或资源。旧线 `windows-support` 不合并、不 cherry-pick。旧 Margin 代码要按 [PROVENANCE](PROVENANCE.md) 逐文件审查并登记后才能用。基线证据见 [BASELINE](BASELINE.md)。
- **R5 · 引用其他项目**：只要确认是开源协议，并记下项目名和协议，不做逐项许可分析。许可清单要和锁文件一致（`scripts/margin/collect-licenses.mjs`）。
- **R7 · 真实服务和实机逐项授权（D2）**：调用真实 API、用真实设备、做共享测试，每次都要用户明确授权，并写清服务、模型、次数和费用。D2 的整体测试组合还没定，见下面的 D2 ticket。
- **R8 · 实测时的凭据和系统权限**：实测只用用户在应用里保存的 Key，不输出、不复制密钥。不重置系统权限，不改 TCC、证书和钥匙串。
- **R9 · 需要用户同意的动作**：提交、推送（包括推送公开仓库）、打标签和出测试包、安装或替换本机应用、正式发布、建 PR、建远程 issue、联系上游。用户可以按任务一次授权，例如“自动提交并出测试包”，范围只到这个任务。修改文档本身不算授权。
- **R10 · 正式 Margin 身份只在 CI**：`Margin` / `io.github.xbz123.margin` 只在 GitHub Actions 里构建和运行，`scripts/margin/app-identity.cjs` 和 `electron/margin/appIdentity.ts` 会拒绝在 CI 外使用。本机不启动正式包，也不伪造 CI 环境绕过打包守卫。发现读写真实 Margin 数据就立即停下。何时放开见 AG-62。
- **R16 · 主线与工作分支**：唯一主线是 `main`（2026-11-28 前叫 `codex/margin-unified`，该名称已停用），测试包、公开 CI 和发布都只从它出。改动在从主线开出的短期工作分支上做，当天推送到 `origin`，门禁和公开 CI 通过后用合并提交合回主线并删除分支，细则见 [CONTRIBUTING](../../CONTRIBUTING.md#branches)。旧 ai-assistant 线（分支 `old`，标签 `v1.0.0-macos`、`v1.0.0-windows`）与 Margin 没有共同历史，只读保留。Mac 线和 Windows 线已于 2026-11-10 合并到这里（`1ce0a7172`）。旧分支 `codex/margin-agpl-migration`、`codex/windows-parity` 已从远端删除；需要回退时用合并提交的两个父提交：Mac 线 `1dab212b`、Windows 线 `a5ac933c`。
- **R21 · 精简测试**：人工和实机测试只覆盖两个核心场景：笔试截图提问、面试双路语音。不核对安装包、源码包或原生产物的 SHA256。归档里的哈希核对要求都不再执行。
- **R22 · 测试增删**：源码字符串测试，要等新代码有同类行为测试后才能删，删除时写明替代测试。优先看端到端行为，验证层次见 [U13](../product.md#u13)。
- **R23 · 技术验收不代替用户签收**：CI、门禁或子代理验收通过，都不能代替用户签收。
- **R24 · 执行人分工**：主线程定范围、写计划、审 diff、做最终验收。实现和测试默认交给 Sonnet 子代理；只有用户明确开启性能模式时才改用 Opus 5.5 medium。需要独立审查时，另派一个只读审查者，审查者不改代码。
- **R25 · 单一写入者**：同一工作树同一时间只有一个写入者。并行开发要用不同的工作树或分支，由主线程合并。

## 门禁与 CI

- **R6 · 隔离**：自动测试和启动冒烟都经 `scripts/margin/isolation/run-node.mjs` 在隔离守卫下运行。不读写真实用户数据和密钥，不调用付费服务。
- **R17 · 本地门禁**：每票提交前跑完整 gates：

  ```
  node scripts/margin/run-gates.mjs --out docs/margin/evidence/<票号>
  ```

  共 15 步，顺序和 id 与 `scripts/margin/run-gates.mjs` 一致：

  | # | id | 内容 |
  | --- | --- | --- |
  | 1 | `clean-dist` | 清空 `dist-electron`，避免旧产物残留 |
  | 2 | `build-electron` | `scripts/build-electron.js` |
  | 3 | `vite-build` | 渲染层构建 |
  | 4 | `tsc-renderer` | 渲染层类型检查 |
  | 5 | `tsc-electron` | 主进程类型检查（`electron/tsconfig.json`） |
  | 6 | `retired` | 退役检查 `scripts/margin/retired-check.mjs`，规则在 [retired-rules.json](retired-rules.json) |
  | 7 | `preload-contract` | `scripts/margin/preload-contract-check.mjs` |
  | 8 | `ipc-channels` | `scripts/margin/ipc-channel-check.mjs` |
  | 9 | `guard-selftest` | 隔离守卫自检 |
  | 10 | `tests` | 单元测试，每个文件一个隔离进程 |
  | 11 | `regression` | 回答回归 `tests/margin/answer-regression.test.mjs` |
  | 12 | `storage` | 会议存储 `tests/margin/meeting-storage.test.mjs` |
  | 13 | `startup` | 启动冒烟 `tests/margin/startup-smoke.test.mjs` |
  | 14 | `outbound-renderer` | `tests/margin/outbound-renderer.test.mjs` |
  | 15 | `diff-check` | `git diff HEAD --check` |

  - 每步只看自己的结果，不和以前的运行比较（`--ref` 已删除）。
  - `tests` 在守卫拦下任何调用、找不到测试文件或退出码无法由失败用例解释时也算失败。
  - `regression`、`storage`、`startup`、`outbound-renderer` 的最少用例数登记在 `scripts/margin/gate-evidence.mjs` 的 `PINNED_NODE_TEST_STEPS`（`minTests`）。
  - 来源检查不是门禁，改为发布前手动跑（R4）。
  - 删改依赖时同步更新 `package-lock.json`，CI 里的 `npm ci` 要能成功。
- **R18 · 每票公开 CI**：每票本地验收、提交并推送后，在公开仓库手动触发 gates：

  ```
  gh workflow run margin-gates.yml -R xbz123/margin --ref main
  gh run list -R xbz123/margin -w margin-gates.yml -L 3 --json databaseId,headSha,event,status,conclusion
  ```

  - 推送本身不会跑 gates：只有提交信息含 `[gates]` 才会，平时都靠手动触发。
  - 运行的 `headSha` 必须等于刚推送的提交，取得 success 终态后再做下一票。CI 失败先修这一票，不用下一票掩盖。
  - CI 在门禁后还会检查 S42 必需证据（`gate-evidence.mjs required`）和身份契约。
  - 纯文档提交不重跑 CI。
  - 已知偶发失败：`outbound-renderer` 的 AG34 “native launcher ... cancel delayed file reads”、`startup` 的 “macOS native termination exits after asynchronous cleanup”。遇到先重跑一次，再排查。
  - 工作流的 `no_cache`、`package_apps` 输入不属于每票流程。测试包走下一节的标签流程。
- **R19 · Windows 编译检查只手动**：`windows-compile.yml` 只有手动触发，只在公开仓库运行，不算每票门禁。

## 测试包与发布

- **R15 · 公开与私有仓库**：私有仓库 `xbz123/AI-for-AI-Interview-Tests`（远端 `origin`）是唯一真源。公开仓库 `xbz123/margin` 只跑 CI：不建 Release，不上传正式身份的包；只有手动开启 `package_apps` 时，才把 `temp` 包 zip 作为保留 14 天的 workflow artifact 上传。本机没有配置公开仓库的远端，推送时用 `git push git@github.com:xbz123/margin.git main`，推送与私有仓库相同的提交。推送公开仓库要用户同意（R9）。
- **R14 · 测试包**：在 `origin` 推送轻量标签 `margin-v2.7.0-test.<n>-windows` 和 `margin-v2.7.0-test.<n>-macos`，由 `.github/workflows/margin-test-release.yml` 构建未签名的 `temp` 身份包（`io.github.xbz123.temp`），发成该标签的预发布：
  - Windows：x64 NSIS 安装包。
  - macOS：arm64 的 zip 和 dmg。
  - `<n>` 每次加 1，目前最新是 test.25（`7bbf55493`）。
  - 这个工作流不重跑门禁。打标签前，这个提交的公开 CI 要已经通过（R18）。
  - `temp` 测试包不代替正式身份，也不算发布。
- **R12 · 签名（D6）**：不做 Developer ID 签名和 Apple 公证，允许 ad hoc。`scripts/build-local.cjs` 会拒绝 `CSC_`、`APPLE_` 等签名变量。未签名的包要如实说明 Gatekeeper / SmartScreen 警告。以后的签名凭据只放 GitHub Secrets，只在打发布标签时使用。
- **R13 · 正式发布**：先 Mac 后 Windows（[U12](../product.md#u12)），每次发布都要当次授权。发布要附对应的源码包和许可声明，版本与标签不一致就不发。发布放在哪个仓库还要请用户确认：S30 定的是公开 `xbz123/margin`，而测试包现在发在私有仓库。目前还没有正式发布工作流（AG-74）。
- **R4 · 来源检查在发布前手动跑**：发布前运行 `node scripts/margin/provenance-check.mjs`。它的结果取决于运行时拉取的上游 refs，不只取决于本分支，所以已移出门禁（`31ba5a3ea`）。每个命中都要解释，或在 [PROVENANCE](PROVENANCE.md) 登记后才能发布。

## 未完成的 ticket

只列还没完成的票。已完成和已取消的票见 [Wayfinder](../wayfinder.md) 和[归档](archive/PLAN-2026-10.md)；2026-11-28 整理时删去了 10 月各票的逐项实测，面试精简提示的回答质量确认完成。

- **2026-11-28 决定的代码改动**（待实测）
  - 删除 Codex 登录回答来源，取代原来的 AG-34-REAL 真实登录验证。
  - Reset/Cancel（Ctrl+R，Mac 上 Cmd+R）只取消正在生成的回答；没有回答在生成时什么都不做（[U2](../product.md#u2)）。
  - 去掉设置文件读不出时的特殊处理，原来的 fail-secure 条款不再保留。
  - DeepSeek（`api.deepseek.com`）和阿里云、豆包语音一样始终直连（[网络与代理](../product.md#network-proxy)）。
  - 另外删除了快速回答模式。
  - 现状：代码已推送到 `1182c0d76`，[OUTBOUND](OUTBOUND.md) 已同步，公开 CI gates 通过（run 46150067737）。test.25（`7bbf55493`）两个平台已构建并发布为预发布版，还没实测。
- **PROXY-CN · 代理国内实测**（等用户的朋友试用）
  - 已完成：test.24 在 Windows 上测过手动 HTTP 代理和中文错误提示。
  - 还没测：在国内用 Clash 等工具实际使用、带密码的代理、SOCKS5 和 HTTPS 代理、转写经代理、英文界面、macOS。
  - 详情：[network-proxy 记录](evidence/network-proxy/README.md#未验证)。
- **STAGE6 · Mac 实测与阶段 6 用户签收**（合并了原 MAC-TEST）
  - 已完成：技术验收（`f35f7b3f`，CI `38492031013`）。
  - 还没做：Mac 上没有实测过统一分支的任何测试包，包括 test.9 起的口述和代理。
  - 下一步：在 Mac 上装最新 `temp` 测试包，按 [STAGE6-CHECKLIST](STAGE6-CHECKLIST.md) 测两个核心场景（R21），再由用户签收（R23）。
  - 详情：[归档的阶段 6 记录](archive/PLAN-2026-10.md#阶段-6-验收标准与当前结果)、[口述记录](evidence/answer-dictation/README.md)。
- **WIN-DEVICE · Windows 实机验收**
  - 已完成：软件、双平台 CI 和 `temp` 安装包；真机测过口述（test.8）和代理（test.24）。
  - 还没做：[WINDOWS-TEST-CHECKLIST](WINDOWS-TEST-CHECKLIST.md) 大部分条目未勾选。共享软件组合、Win10 最低 build、音频“通信”角色还没定。
  - 详情：[Windows 开发计划](WINDOWS-DEVELOPMENT.md#恢复点与待确认)。
- **S42-06 · 图标与共享保护交付**
  - 已完成：伪装、穿透等软件部分（[AG-61](evidence/AG-61/README.md)）。
  - 还没做：图标的具体图形未定；Zoom / 腾讯会议共享接收端没有实测（STAGE6-CHECKLIST 的 B5）。
  - 详情：[归档的 S42 增量票](archive/PLAN-2026-10.md#tickets-20261013)。
- **D2 · 真实服务验收**
  - 测试组合、样本数、费用和 P50/P95 达标线都没定，等用户决定。
  - 目前只有按任务单独授权的零散真机测试（R7）。
  - 详情：[Spec 未决项](../product.md#open-questions)、[归档的待定决策](archive/PLAN-2026-10.md#3-待定决策)。
- **AG-62 · 正式 Margin 身份**
  - 已完成：引导和文档（`bae89f6c`）。
  - 还没做：放开“release 身份只在 CI 运行”的保护（R10），以及决定本机何时改用正式身份。等用户决定。
  - 详情：[归档票表](archive/PLAN-2026-10.md#stage3-6-tickets)、[引导记录](archive/PLAN-2026-10.md#ag62-guidance)。
- **AG-74 · 正式发布与签名**（合并了 AG-75 / D6）
  - 还没有正式发布工作流。先要请用户定发布仓库（R13），发布前手动跑来源检查（R4）。
  - 签名和公证服务没有购买，方案和时间未定（R12）。
  - 依赖 AG-62。
  - 详情：[归档的阶段 7](archive/PLAN-2026-10.md#阶段-7windows-与双平台发布概要s30)、[待定决策 D6](archive/PLAN-2026-10.md#3-待定决策)。
- **SETTINGS-SLIM · 设置简化范围**
  - 用户提出“减少永久需要输入的内容”，具体字段还没给。
  - 在此之前不据此删配置项。
  - 详情：[Spec 未决项](../product.md#open-questions)。
- **PRACTICE · 练习模式**（2026-11-28 用户确认设计）
  - 产品行为见 [Spec 练习模式](../product.md#practice)，结构与四步路线见[架构](../architecture.md#练习模式的接入)。
  - 还没做：实现未开始，也还没授权。剧本内容、练习记录去留、彩排录音的播放方式待用户决定（[Spec 未决项](../product.md#open-questions)）。
  - 执行时按架构路线逐步交付，每步单独跑门禁和公开 CI（R17、R18）；彩排一步调用真实服务，按 R7 逐次授权。
