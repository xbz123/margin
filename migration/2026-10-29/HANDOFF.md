# Windows 交接：margin-windows

核对日期：2026-10-29。交付的是未完成开发的源码快照，未合并、未安装，不能当作 Windows 验收或发布通过。

## 取回与状态

在新的空目录运行 `gh repo clone xbz123/Assessment-Assistant margin-windows -- --branch codex/windows-transfer-20261029-margin-windows --single-branch`。来源分支 `codex/windows-parity`，基准提交 `fd989b3fb468910eb3df89a1407da549c0a3da2e`。本次保留的工作区改动和排除项见同目录 `source-inventory.json`。

Mac 和 Windows 两条开发线分别下载到不同目录，不互相覆盖。原始 worktree 的 `.git` 指针和 macOS 依赖不要直接用于 Windows。

## 项目地图

- 产品和当前路线：`docs/product.md`、`docs/wayfinder.md`、`docs/margin/PLAN.md`；来源和授权：`docs/margin/PROVENANCE.md`。
- 回答生成：`electron/LLMHelper.ts` → `electron/llm/WhatToAnswerLLM.ts`、`scenarioPrompts.ts`；测试入口 `electron/llm/__tests__/` 和 `electron/services/__tests__/PromptSkillConsumerChain.test.mjs`。
- 设置：`src/components/SettingsPopup.tsx`、`src/components/settings/HelpSettings.tsx`、`src/i18n.zh.ts`。
- Windows 截图与窗口：renderer → Electron IPC/main → `ScreenshotHelper`、`WindowHelper`、`imagePathValidation`；相关测试在 `tests/margin/` 与 Electron 测试目录。
- Windows 原生音频：`native-module/src/speaker/windows.rs`。打包入口 `electron-builder.config.cjs`、`scripts/margin/` 和 `package.json`。

## 接续工作

先读当前分支 `AGENTS.md`、`docs/wayfinder.md`、`docs/margin/WINDOWS-DEVELOPMENT.md`（若存在）。阶段证据在 `docs/margin/evidence/`；软件面试提示词实验见其中 `software-interview-prompt/`。已有报告是对应时间点证据，不能据此宣布本快照已安装或真机通过。

在 Windows 重装 Node/Rust/原生构建依赖，再按当前分支文档执行检查。现有检查入口包括 `npm run gates`、`npm run typecheck:electron`、相关 Node 测试及 Windows 包检查；先确认命令适用平台。截图、快捷键、系统音频、安装和实际模型请求仍需 Windows 实机验证。不要将单屏证据扩展到多屏，不自动启动付费模型测试。

## 本次迁移验证与缺口

迁移只验证所选改动逐文件 SHA-256 一致、Git 提交和远端分支对应；具体检查结果见迁移总表。原始 logs/TAP、依赖、构建产物、安装包、个人配置仍从硬盘完整备份恢复。没有重新跑产品全量门禁，因此快照不是功能验收。

## Suggested skills

`repo-map` 定位相关路径；`handoff` 接续记录；实现后按项目要求使用 `test-verification` 和 `code-review`。只有接到新的实现任务才修改产品。
