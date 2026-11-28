# Margin 仓库指南

Margin 是一款桌面辅助应用（笔试练习与软件工程师面试），包含 Electron 主进程、React 界面与 Rust 原生音频。

## 权威文档与分支

- 产品规格（唯一产品行为入口）：[docs/product.md](docs/product.md)
- 执行规则与门禁：[docs/margin/PLAN.md](docs/margin/PLAN.md)
- 当前进度与待办：[docs/wayfinder.md](docs/wayfinder.md)
- 五分钟产品总览：[docs/overview.md](docs/overview.md)
- 系统结构与状态归属：[docs/architecture.md](docs/architecture.md)
- 分支、提交、文档归属和代理的工作方式：[CONTRIBUTING.md](CONTRIBUTING.md)（每次改动前先读）
- 主线是 `main`。改动在从主线开出的工作分支上做，当天推送，验收后合回主线并删除分支（[PLAN R16](docs/margin/PLAN.md#执行规则)、[CONTRIBUTING](CONTRIBUTING.md#branches)）。

## 核心执行规则

- **R9 需要用户同意的动作**：提交、推送（含公开仓库）、打标签出测试包、安装或替换本机应用、正式发布、建 PR、建远程 issue 及联系上游，必须先获用户同意；修改文档本身不算授权（[PLAN R9](docs/margin/PLAN.md#执行规则)）。
- **R10 正式 Margin 身份只在 CI**：正式身份 `Margin`（`io.github.xbz123.margin`）只在 GitHub Actions 中构建和运行，本机不启动正式包也不伪造 CI 环境，发现读写真实 Margin 数据立即停止（[PLAN R10](docs/margin/PLAN.md#执行规则)）。
- **R6 测试在隔离守卫下运行**：自动测试和启动冒烟都经隔离守卫运行，不读写真实用户数据与密钥，也不调用付费服务；本地门禁运行 `node scripts/margin/run-gates.mjs --out docs/margin/evidence/<票号>`（[PLAN R6](docs/margin/PLAN.md#门禁与-ci)、[PLAN R17](docs/margin/PLAN.md#门禁与-ci)）。
- **R3 来源边界**：不引入 2026-06-01（IST）及以后公开的上游代码、测试、提示词或资源，不合并也不 cherry-pick 旧线 `windows-support`，旧 Margin 代码须逐文件审查来源并登记后再用（[PLAN R3](docs/margin/PLAN.md#执行规则)）。
- **R24 / R25 执行分工**：主线程负责定范围、写计划、审 diff 与最终验收，实现和测试默认交给 Sonnet 子代理（仅用户开启性能模式时改用 Opus 5.5 medium）；同一工作树同一时间只有一个写入者（[PLAN R24 / R25](docs/margin/PLAN.md#执行规则)）。
