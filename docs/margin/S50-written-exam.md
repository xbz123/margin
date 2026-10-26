# S50 完整笔试设置与定时截图解答

2026-10-26；按用户授权实现、公开代码交付和安装完成。最终CI `40294534327`门禁16/16通过，已安装公开提交 `e7a4a383c` 的Natively Local，待实测。开发基线 `1f0ff318`；参考分支 `codex/ai-assistant-refactor` 的 `36af1111db5b608b2ec3eff0f276a7eed97e92c1`，未合并旧分支历史。[验收与安装记录](evidence/S50/README.md)。

## 需求与复用依据

### 2026-10-26 实机反馈后的已批准修订（本地完成，未推送/安装）

最终门禁16/16，1258单元、24回答、3存储、2启动、17挂载全部通过。详见[修订验收](evidence/S50-mode-controls/README.md)，真实设备/服务仍待实测。

本节替代下文初版的“重启暂停”和“问题场景选择器”契约；当前产品行为以产品规格为准。本次不包含推送、远端CI、安装或真实设备/服务测试。

- Outcome：设置中开启不跳转；会话开始后才截图。笔试零音频、无转写Key要求；会中自动捕获/面试两个开关立即生效且互斥，关闭面试进入手动笔试。
- Scope：`WrittenExamSession`持有活动会话、运行状态和临时暂停；`SettingsManager`保存新增`autoCaptureEnabled`，旧配置补false；`AppState`复用`MeetingLifecycleQueue`串行设置、音频切换、开始和结束，不重置会话历史。保持所有原有截图隐藏、格式、输入清空/失败恢复和隐私/重试规则。
- Interfaces：设置和菜单沿用`written-exam:get/save/running`；新增`written-exam:interview(boolean)`。状态`captureEnabled`表示当前可操作开关（笔试+保存偏好+未临时暂停），`running`仅表示实际计时。保存的偏好在面试期间保留，关闭面试时临时暂停；下一次笔试会话恢复偏好。失败切入面试不自动重试。
- Sequence：先状态/持久化及队列，后音频生命周期与IPC，再两处控件及翻译，最后复用现有测试并完整门禁；单写入者，不并行共享构建。
- Validation：合成计时覆盖无会话零截图、首周期、间隔重计时、重启偏好、临时手动模式；真实主进程方法和mock采集覆盖笔试零音频、双向切换、失败/快速切换/结束竞态、旧音频被丢弃；真实Electron挂载覆盖无跳转、两个开关同步、旧选择器移除、缺Key失败及中英深浅截图。最终16/16门禁；真实硬件与用户签收另列。
- Stop：出现需要改动隐私边界、会话数据删除或真实权限/服务调用时暂停对应步骤。仅本次两个模式与自动捕获调整，不顺带修改音频无数据告警。

权威行为见 [产品规格 S50](../product.md#s50--完整笔试设置与定时截图解答)。用户明确要求两张截图的全部功能，不只定时器或视觉页面。

参考分支现有实现：

- `electron/services/WrittenExamMode.ts`：配置验证、20秒默认间隔、主进程计时、不重叠、忙时跳过、指纹去重、generation失效、交付回执、超时暂停及丢弃截图。
- `electron/ipc/answerHandlers.ts`：配置保存、启停、状态广播、捕获交付和输出格式；`electron/preload/screenshotBridge.ts`、`configurationBridge.ts` 为桥接。
- `src/components/settings/WrittenExamSettings.tsx`、`CodeOutputSettings.tsx`：截图对应页面及控件；`NativelyInterface.tsx`、`writtenExamScreenshotDisplay.test.mjs` 为消息显示消费方。
- `electron/services/skills/CompleteCodeSkill.ts`：完整代码提示词和按截图/编程请求选择 Skill；旧语言优先级必须按 S46 更新。
- `electron/services/__tests__/WrittenExamMode.test.mjs`：已有定时、暂停中捕获、重复回执、忙时/相同画面跳过、回执超时、重启暂停和格式测试。
- 同分支 `docs/fresh-release-implementation-plan.md`、`docs/functional-refactor-plan.md` 说明保留范围，但其中面试自动回答、Judge、旧存储/生成接口不进入本票。

三个核心页面/调度文件与历史参考 `b8ade3f7` 字节相同。用户确认独立新增功能；既有 S35 来源清单仍将两个页面列为“片段复用”，因此引入时核对具体提交与命中，不整文件盲拷、不放宽来源扫描。UI 结构可保持一致，当前 `SettingsKit` 与 `useI18n` 接口优先复用；不引入旧全局 CSS。`WrittenExamMode` 的 `9501b83b` 补充了截图回收，不能退回其旧版丢弃行为。

## 顺序与验收

单一写入者，三项串行；后两项依赖第一项确定的配置和状态协议。不新建通用调度框架，不引入面试自动回答。

### S50-01 页面与设置（包含截图隐藏和代码格式）

- Outcome：独立笔试页具有截图中全部控件，保存/广播/重启一致；预览开关实际影响消息显示，格式选项实际影响提示词和渲染，不做空壳设置。
- Scope：当前 `SettingsManager`、`ipcHandlers.ts`、preload与renderer类型、`SettingsOverlay.tsx`、`SettingsKit`、`NativelyInterface.tsx`、中英词条；适配旧版两个设置组件。首次配置默认模式关闭、隐藏开启、20秒、纯文本。
- Interfaces：持久配置只含 enabled、intervalSeconds、hideScreenshots及输出格式；运行状态 running、generation、error 只在内存。保存入口主进程校验，成功后应用并广播；失败不得提前暂停或改变内存。所有窗口读同一权威状态，迟到读回不覆盖新设置；会中“问题场景”与模式开关不能形成互相矛盾的独立开关，显式切到面试必须暂停笔试自动捕获。
- Validation：非法值拒绝、保存失败不变、跨窗口同步及重启保持配置但暂停；隐藏仅影响已发送笔试图片且可恢复；两种代码格式、明确要求优先、当前流/历史格式不受后来切换影响；真实挂载深浅主题截图。

### S50-02 主进程定时捕获与自动解答

- Outcome：按设置间隔截图并解答，可从设置/回答窗暂停，自动任务不会和手动生成串答。
- Scope：优先适配旧 `WrittenExamSession`；接当前 `AppState.takeScreenshot`、截图清理/所有权、`gemini-chat-stream` 或现行生成契约及取消链，而非复制旧 Direct Assist 整套实现。
- Interfaces：所有计时/启停归主进程；用户显式启动，等待一周期；每轮最多一个捕获、一个待接收帧、一个自动回答。generation及接收窗口身份校验后才能发送；过期、相同、未消费截图须释放，不得删仍被手动附件/重试持有的图片。暂停只取消本自动任务；手动操作优先，忙时跳过而不排队。关闭/重建窗口、会话结束、关闭模式、保存间隔、权限/捕获失败均不能产生迟到发送。
- Validation：复用旧调度测试的有效场景并适配当前链路；假时钟验证首周期、5/300边界、重复start；受控Promise验证暂停中捕获、暂停后重开、旧回执、忙时、同图、失败/回执超时、资源回收；实际按钮→IPC→合成截图→mock请求验证模型/图片/来源/取消归属。

### S50-03 提示词、Skill与回归交付

- Outcome：手动/自动笔试截图不带Local Context，选择题和代码题按S46及本票输出规则；complete-code启用后适用于截图/编程请求，禁用不被自动重新启用。
- Scope：当前 `SkillsManager`/`PromptSettingsStore`、场景提示词、`LLMHelper` 的输入准备和重试快照、消息渲染。旧 Skill 字面内容不是权威，须修正“忽略编辑器语言”及泛化权限报错；普通问答、用户其他Skill和数据范围保持原约定。
- Validation：mock请求验证自动/手动截图、重试和备用均无Local Context，普通文字仍附带；Skill不执行脚本、不覆盖显式选择；中文/英文与两种格式；没有题目时不强制生成代码。相关套件和最终完整本地门禁16/16，来源命中逐条核对登记，用户截图逐项映射验收。

## 边界

- 本票规则只用于笔试练习，不恢复面试自动回答/Judge、OCR、语义判断题目变化或旧会话恢复。
- 定时截图包含当前选定显示器内容；保留明确外发提示和现有图片/隐私检查。测试只用合成截图/mock，不采集真实桌面、不调用真实服务。
- 本票的推送、远端CI、安装和真实桌面/付费模型测试需对应授权；不沿用上一票安装授权。出现必须复制受限代码、改变已定隐私规则或重写整个生成体系时暂停相关步骤。
- 本轮在当前分支移植/适配上述功能，不运行旧分支应用。旧分支其余功能不因被阅读而恢复。
