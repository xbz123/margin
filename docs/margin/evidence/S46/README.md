# S46 笔试回答契约与笔试消息样式（2026-10-22）

基线 `d6bc80ce`，Claude 实现，当前 Codex 独立验收通过。用户已授权远端 CI 和之后的新版安装；交付终态另记。票据见 [PLAN §8 S46](../../PLAN.md#s46-笔试回答契约与笔试消息样式2026-10-22本地实现待独立验收)，产品要求见 [Spec U8](../../../product.md#u8)。原始日志留在本机任务目录，不随提交分发。

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
