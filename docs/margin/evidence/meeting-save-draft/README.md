# 会议保存与发送草稿修复（2026-10-26）

**后续交付更新：** 已按用户授权随`b7f57addf`模式修订重新构建并安装；包内保存/重启读取及安装检查通过，用户配置未改。见[合并安装回执](../S50-mode-controls/README.md#安装回执2026-10-26)。下文保留本票最初验证及未安装阶段的记录。

范围仅限用户要求的两项：手动发送后立即清空输入框，以及安装包会议数据库不可用。未实施仍在确认中的笔试/面试切换方案，也未修改音频无数据提示。

## 根因及修改

- 原输入直到回答完成才清空，而且用 trim 后的文本比较原草稿。现在 IPC 发起后立即清空；完成事件不再修改输入框。准备或流式失败时只恢复空输入框，保留原始首尾空格；非空的新草稿不被覆盖。原输入重试与图片预检失败保留附件的行为不变。
- 已安装 S50 包包含 better-sqlite3 原生模块，但缺少运行依赖 bindings 和 file-uri-to-path。直接使用包内 DatabaseManager，在隔离临时配置中保存合成会议，稳定报 Cannot find module 'bindings'。原生模块显式加载的内存数据库探针能通过，因此不能把它当作完整包验收。
- 上轮公开工作树通过 node_modules 符号链接复用依赖；原打包日志出现 ELSPROBLEMS 和 missing: bindings。此次使用开发工作树真实依赖目录重新打包，未新增依赖、未修改数据库结构。build-local 拒绝链接的 node_modules；package-check 增加 SQLite 运行依赖检查；asar-smoke 增加真实包内保存和新进程读回，防止仅启动成功掩盖数据库故障。

## 验证

- 输入框回归先红后绿：旧代码在回答未结束时仍保留原文；修复后即时清空，随后输入完全相同的草稿也不被完成事件删除。另测失败恢复空草稿、不覆盖新草稿、图片预检失败不丢附件。
- 最终完整门禁 16/16，全部 exit 0；单元1251/1251、回答24/24、存储3/3、启动2/2、挂载17/17。来源检查0未登记命中。
- 首轮失败保留：旧手动提交VM夹具缺少 setInputValue，已同步并断言清空；未改的AG34挂载测试出现一次 Execution context was destroyed，单独1/1及最终完整门禁通过，未修改该测试。早期沙箱不能启动GUI、包测试身份和路径别名不匹配的诊断失败，不算数据库回归结果。
- 旧安装包在新增真实包内存储检查中失败，明确缺 bindings；新候选包检查13/13，隔离包内启动/保存/重启读取13/13，零外发。包内原生模块来源检查通过，未借用仓库SQLite运行模块。
- 链接依赖预检的隔离VM探针通过：在任何构建/打包前拒绝符号链接。

## 证据与交付边界

- 最终门禁：`/private/tmp/margin-save-fix-gates-final/summary.json`；初轮：`/private/tmp/margin-save-fix-gates/`。输入红色证据：`/private/tmp/margin-send-clear-red-host.log`；新草稿/预检初次绿色证据：`/private/tmp/margin-send-clear-green.log`。AG34单独复跑与夹具单测为 `/private/tmp/margin-save-fix-ag34-alone.log`、`/private/tmp/margin-save-fix-renderer-unit.log`。
- 候选包与报告：`/private/tmp/margin-save-fix-package-KngXC0/`，含 `package-checks.json`、`old-package-storage.json`（失败）、`new-package-storage.json`（通过）、构建日志。以 local 身份直接调用同一 electron-builder 配置，未运行要求整个工作树干净的正式打包入口，因为用户的阶段6清单有未提交改动；没有覆盖或提交这些改动。候选包不是正式发布产物。
- 候选asar SHA256：`a1ea11dcac70112163de16c544d60aca3101fd09e0fc30dafa98242a5c13802d`。
- 已安装asar仍为 `f17f7339397615cad39379ad4d68615db76af2a606361a091415285b5e07be60`，未替换安装、未推送、未运行远端CI，未退出真实应用、修改真实数据库或调用真实服务。
- 当前未保存会议仍需先确定是否保留，再安排退出和安装；本轮没有恢复或导出其内存内容。临时候选和日志可能被系统清理，不能作为长期备份。
