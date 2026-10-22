# 无消费者残留清理（2026-10-22）

基线 `978b4cd3`，Claude 实现。用户要求先把 Mac 上不需要额外决定的工作做完；[2026-10-15 审阅](../../REVIEW-2026-10-15.md) 的 4 项清理候选里，这次处理其中 3 项。`ClarifyLLM` 的重复代码按审阅意见留到下次修改该动作时局部整理，这次不动。

## 改动

- **`react-query` 别名**：删除 `package.json` 里的 `"react-query": "@tanstack/react-query@^5.100.10"`，以及 lock 文件里对应的三处（根依赖一行、`node_modules/react-query` 链接、空的 `@tanstack/react-query@^5.100.10` 条目）。代码里没有 `from 'react-query'` 的引用，实际使用的是 `@tanstack/react-query`，保持不变。用 `npm install --package-lock-only --ignore-scripts` 在临时目录复核，npm 不再改动新 lock 文件；改动前的 lock 用同样方式复核也不变，说明不是 npm 版本差异。
- **许可清单**：`collect-licenses.mjs` 去掉只为这个别名保留的两种特例，可选包按系统/CPU 排除的规则不变。重新生成后：候选 599、文本 347 不变，排除项从 2 变为 0，未解决 0；`licenses/manifest.json` 只改 lock 哈希和排除列表，`NOTICE` 与 `licenses/README.md` 的生成段只改排除数，README 说明文字同步改写。
- **`renderer/` 脚手架**：删除 19 个文件的独立 CRA 示例。应用入口是 `index.html` 的 `src/main.tsx`；`tsconfig.json` 只包含 `src`，构建、打包配置、workflow 和脚本都不引用 `renderer/`。
- **`ConversationSummarizer.ts`**：删除模块及其专属测试。它的三个导出（`compressConversation`、`formatSummaryAsBlock`、`TurnSummary`）在 `electron`、`src`、`scripts`、`tests` 中只被这份测试使用；`SessionTracker` 里实际使用的长会话压缩与截断不受影响。

本机 `node_modules/react-query` 是指向不存在目录的旧符号链接，已删除，使本机状态和干净安装一致。本机 `node_modules` 里还有若干退役服务留下的多余包（`npm ls` 标为 extraneous），属于旧的本机安装残留，不在仓库内，这次不处理。

## 结果

完整门禁 16/16，全部 exit 0：单元测试 133 个文件、1213/1213，零失败、零跳过。比上次公开 CI 39785283178 少 1 个文件、1 条测试，对比 `tests.files.json` 确认正是删除的 `ConversationSummarizer.test.mjs`（1 条）。回答 21/21，存储 3/3，启动 2/2，挂载界面 14/14；来源检查 0 命中。原始日志留在本机任务目录，不随提交分发。

## 边界

- 只删除没有消费者的文件和依赖别名，不升级依赖，不改应用行为。
- 平台：改动不涉及平台分支。lock 文件少了一个别名条目，对 macOS 和 Windows 的安装相同；Windows 安装未实际运行。
- 公开交付时，除平常的代码目录外，还要带上 `licenses/`、`NOTICE` 和 `renderer/` 的删除，否则公开仓库的许可清单哈希会和 lock 文件对不上。

## 公开仅代码交付（2026-10-22）

用户同意按顺序收尾后，私有分支推到 origin（`fe00f272..faa4da27`）。公开提交 `075d2f44` 带上代码目录以及 `licenses/`、`NOTICE` 和 `renderer/` 的删除，与私有提交 `faa4da27` 的这些目录逐字节一致，文档没有推送。

[CI 39801535976](https://github.com/xbz123/margin/actions/runs/39801535976) 通过。按下载的产物核对：16 个步骤全部 exit 0；来源检查 0 命中，引用池 679248 个受限行键；单元测试 1213/1213，零失败、零跳过；回答 21/21，存储 3/3，启动 2/2，挂载界面 14/14。本机已安装的 `9ea320d6` 不含这次清理；清理不改应用行为，没有另装。
