# S46 笔试回答契约与笔试消息样式（2026-10-22）

基线 `d6bc80ce`，Claude 实现，当前 Codex 独立验收通过；已完成公开 CI 与 Natively Local 安装，待用户实测。票据见 [PLAN §8 S46](../../PLAN.md#s46-笔试回答契约与笔试消息样式2026-10-22已交付安装待用户实测)，产品要求见 [Spec U8](../../../product.md#u8)。原始日志留在本机任务目录，不随提交分发。

## 改动

- **S46-01**：`WRITTEN_SCENE_PROMPT` 的 `<coding>` 段改为编程语言优先级、ACM/LeetCode 框架、代码先、报错修复、真实性和可读性规则，删除原“思路先于代码”；`WRITTEN_ANSWER_SHAPE` 改为非编程题结论先、编程题按 `<coding>`。实际入口 `handleManualSubmit` → `gemini-chat-stream`（未指定时默认 written）→ `scenarioPrompt('written')` → `LLMHelper.streamChat` → `appendPromptGuidance` 未改。面试与 tiny 提示词哈希不变（`17cb60bd…`、`a24cf049…`），笔试新哈希 `d52c4544…`。
- **S46-02**：`Message` 加可选 `scene`，只在 `handleManualSubmit` 写入实际发送的场景（`auto` 与主进程默认一致记为 written）；`MessageRow` 对 written 用户消息改为中性色框、细边框和 `MessageSquareText` 小图标（`aria-hidden`）。面试和无 `scene` 的旧消息保持原蓝色；模型回复无外框不变。

## 验证

- 完整门禁 16/16，全部 exit 0：单元 133 个文件、1215/1215（较上次 1213 多 2 条本票测试），回答 21/21，存储 3/3，启动 2/2，挂载界面 14/14；来源检查 0 命中，未新增登记。门禁运行后只改了文档和本证据。
- 实际拼接：IPC → `streamChat` → mock OpenAI 请求中，笔试带新契约、面试不带；笔试 Skill 和附加指令仍只追加在 `</coding>` 之后。Electron 挂载测试中 auto/interview/written 三种提交的线上提示词和用户消息场景正确，切换模式后历史消息不变。
- 变异：恢复“思路先于代码”、auto 不记为 written、所有用户消息都用中性色，三项均被测试识别。
- `screens/`：用真实 `MessageRow` 和构建后的 CSS 在隔离 Electron 中渲染的合成消息（深浅两套），不是完整悬浮窗截图。

## 边界

只证明提示词拼接和渲染，不证明真实模型遵从或解题正确。未启动用户应用、未调用真实服务。Windows 只做静态审查，改动不涉及平台分支。

## Codex 独立验收（2026-10-22）

- 审查完整代码/测试 diff、实际提交→IPC→场景提示词链路及消息渲染调用方，未发现阻断项。面试/tiny 提示词保持原哈希；补充 Skill 仍受默认规则约束，不读取或迁移用户 Skill。
- 独立重新构建主进程；隔离运行 `PromptSkillConsumerChain`、`IdentityGuard`、`manualAnswerRenderer`，20/20；真实 Electron `answer-regression` 21/21。首次沙箱内 Electron 未能启动，隔离守卫缺失导致失败；获准后在沙箱外保留项目临时目录/mock 守卫重跑，exit 0，非代码修复或跳过断言。
- 核对实现者原始完整门禁汇总和分类日志：16 步 exit 0、1215/1215 单元测试、来源 0 命中。独立重跑针对性及界面回归后复用其余完整门禁证据，远端 CI 另验证干净环境。
- 两张深浅主题合成截图已目视检查。最终模型回复无外框；生成中的临时边框是既有行为，本次不改变。真实透明度/界面主题、长代码可读性和模型实际遵从由安装后的用户测试验证。

## 公开 CI 与安装回执（2026-10-22）

- 私有实现/验收提交 `d7d01ccbf5204c298cffa390a8f5aab702dcf654`；公开仅代码提交 `62eab310f4846df8a050eaff9f94175683504de8`。公开提交仅含 6 个代码/测试文件，不含私有文档或截图；两库应用、测试、脚本、依赖、原生及许可目录无差异。
- [CI 39818808638](https://github.com/xbz123/margin/actions/runs/39818808638) 为 completed/success。下载产物核对 HEAD、16 步 exit 0、单元 1215/1215 零跳过、回答 21/21、存储 3/3、启动 2/2、挂载界面 14/14；两身份契约各 7/7；来源 0 命中。此 CI 未打包或发布 Release。
- CI 门禁 ZIP SHA-256：`ac2ed3159560fef92d5fb0cdb7b08a5f63715240074f662467a7cec1a39bddf7`。
- 从干净的 `d7d01ccb` 使用既有 local 构建入口打包；包检查 12/12、隔离包内启动 10/10、安装检查 12/12。已核对包内有新的笔试提示词与消息场景代码。
- 安装位置 `/Applications/Natively Local.app`；标识 `local.natively.desktop`，版本仍为 2.7.0，macOS arm64，ad-hoc 签名。正式 Margin 命名/权限列表显示按用户决定留到最终发布处理；本次不重置权限或钥匙串。
- 安装时应用已退出，未强行终止进程。已装文件内容、权限位和符号链接与包逐项一致；用户配置目录顶层文件（含设置、加密凭据及会议数据库）哈希不变，另一份 Margin 的 asar 不变。未启动真实配置或调用真实服务。
- 新 asar SHA-256：`362f0fe8942991335628d978a458018181cf2349114c17170ecf01a126904e36`；旧 asar：`48a88d1f3e23b3853fe723ad79ca81d7a4b91474f9e033f79319464a0bf567f5`，与前次安装记录一致。
- 安装包 ZIP SHA-256：`41df1d8e65930f9b0b8818f24aaa06748c9a642225c8e01f731b011d0b5ca79d`。

本机恢复入口（仅私有记录）：包与 smoke 在 `/private/var/folders/1k/d8x0x94s27g81fbsdbnhsfy00000gn/T/natively-local-package-Paos0M`；安装脚本及 `installation.json` 在 `/private/tmp/natively-install-S46-GWDzJj/`，旧包暂留其 `previous.bundle`。CI/独立测试原始日志在 `/private/tmp/margin-written-tickets-EZEAnS/`。临时目录不是长期备份，系统清理后可能不存在。

用户下一步：在笔试/自动模式用截图核查语言及 ACM/LeetCode 格式、报错题代码先于修改说明、代码可读性；核查深浅主题的中性消息框及面试消息仍保持原样。模型实际遵从、透明界面效果仍未签收，不以 CI 代替。
