# S47 官方服务多模型候选（2026-10-22）

基线 `94824398`，Claude 实现，未推送公开仓库、未安装、未调用真实服务。当前 Codex 首次复查未通过（第二候选的推理下拉显示第一候选的值），该控件由 S48 取代；S47 与 S48 合并后的工作树已通过独立验收，见 [S48 独立报告](../S48/independent-review.md)。票据见 [PLAN §8 S47](../../PLAN.md#8-执行与恢复记录)，产品要求见 [Spec S47](../../../product.md#s47)。原始日志留在本机任务目录，不随提交分发。

## 改动

- **S47-01 数据契约**：`ProviderConfiguration` 新增可选 `models`（`{ model, reasoning?, imageSupportConfirmedFor? }`），顶层模型即第一个候选；无其余候选时不写该字段，旧单模型配置原样读取。`providerCandidates` / `candidateConfiguration` / `withCandidates` 为共用函数。`validateProviderConfiguration` 在信任边界拒绝非数组、非对象、非法 ID、重复（含与顶层同名）和协议不接受的推理；图像确认只保留与该候选完整目标一致的值。`resolveModelTarget` 对候选返回其自身设置，非候选同家模型仍无参数解析。`followSelection` 对仍是候选的模型只随协议迁移。`setProviderConfiguration` / `setPreferredModel` 在移除被主、备或运行（会中）选择使用的候选时返回 `write_failed`，存储与 runtime 不变；运行选择由 IPC 传入。`test-llm-connection` 与 `LLMHelper.testProviderConnection` 增加候选参数，只测已保存候选。
- **S47-02 界面**：`answerModelOptions` 列出每家所有已保存候选（顶部主/备与会中选择器共用，按 ID 去重）。`ProviderCard` 改为“编辑已保存模型”下拉（只决定编辑与测试对象）、从获取结果或本次草稿移除的已保存项中“添加模型”、“移除模型”；推理与图像确认按编辑项写入；OpenAI 协议切换重置所有候选的推理与图像确认；“保存并测试”只测编辑项，成功状态绑定该候选。中英文文本同步。

## 行为变化

- 替换正在被主模型、备用模型或会中模型使用的模型（包括旧 `set-provider-preferred-model` 入口和未写入时的内置默认主模型）不再自动跟随到新模型，而是拒绝并提示先改选。原测试中“保存替换后默认/会中模型跟随”的 4 处期望据此改为“拒绝且不变”，原有的原子保存、失败零副作用、会中模型不被重置为默认等断言保留。

## 验证

完整本地门禁 16/16：单元 1221/1221、回答 21/21、存储 3/3、启动 2/2、挂载界面 15/15，来源检查 0 命中，`git diff --check` 通过；5 个变异（候选参数、移除保护、选择列表、跟随规则、按候选测试）均被识别。命令与原始记录见任务目录 `result.txt`。窄测试、挂载界面测试、5 个变异和完整本地门禁均在隔离入口下运行；全程合成凭据、内存加密存储与回环服务，无真实请求。截图未取得（未验证视觉效果）；Windows 仅静态审查（改动不含平台分支）。真实服务权限、模型效果和用户体验未验证，阶段 6 不因此关闭。
