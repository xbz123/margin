# S50 模式与自动捕获修订验收

2026-10-26，基于 `c742b00ca` 实施用户确认的会中模式与持久捕获需求，代码提交`b7f57addf`。此前的发送即时清空及打包存储修复保留。后经用户明确授权，现已重新构建并安装；没有推送、远端CI、真实服务或设备测试。

## 安装回执（2026-10-26）

- 来源`b7f57addff9242dee74990537ba76ac473163f3d`；相关源码、构建脚本及依赖清单与HEAD一致。只保留用户原有文档改动；使用工作树真实node_modules而非链接。复用同源码的完整门禁，不重复运行全量测试。
- 包含输入即时清空、SQLite依赖打包修复及本票模式功能。以现有local身份配置重新构建，19个关键构建文件与asar逐字节一致；包检查13/13、包内隔离启动/保存/重启读回13/13、安装检查13/13全部通过，零真实服务外发。
- 已安装`/Applications/Natively Local.app`，2.7.0、arm64、`local.natively.desktop`、ad-hoc签名。安装前通过进程列表及可执行文件占用检查确认应用已退出，没有强制终止、放弃或恢复内存会议。
- 新asar SHA256：`5468761ced052019cf8a18dd4004329300d445442c1bdbc6eba235129239a435`；旧asar：`f17f7339397615cad39379ad4d68615db76af2a606361a091415285b5e07be60`。安装后文件、权限位及符号链接与验证包一致。
- 用户配置顶层文件哈希不变，另一份`/Applications/Margin.app`的asar不变；未重置系统权限/钥匙串，未启动真实用户配置。
- 原始构建、验证及安装报告：`/private/tmp/margin-mode-install-6OOqkG/`，包括`package-code.json`、`package-checks.json`、`asar-smoke.json`、`installation.json`。旧应用备份为其中的`previous.bundle`；临时目录不是长期备份。

## 实现结果

### 安装后反馈：重复菜单与首字超时（2026-10-26，本地修正，未安装）

- 用户截图中的下方旧“面试模式”实际控制 `recap/brainstorm`，不是新音频/笔试模式开关。按用户要求删除该菜单行、专属状态和监听；保留既有动作偏好及后台接口，不重置用户配置。帮助页去掉“面试开关控制构思/回顾”的误导说明。
- 真实 Electron 中文菜单回归先红后绿：旧代码精确标签计数为 2，修正后为 1，且唯一标签对应新的模式 switch。证据为 `/private/tmp/margin-duplicate-mode-red-local.log`、`/private/tmp/margin-duplicate-mode-green.log`。首次未指定 local 身份的运行因隔离身份不匹配失败，不计为产品复现。
- 本次受影响检查 `/private/tmp/margin-duplicate-mode-checks/summary.json` 为 5/5：renderer 类型、来源、退役、真实挂载界面 17/17、diff-check 均通过；Vite 构建通过。没有把上一版的全量 16/16 当作本次全量结果。
- 首字超时诊断：对 `c742b00ca` 与当前实际 renderer/IPC 表达式做 AST 求值，并调用真实 `GenerationTask`。同一文字入口从 `auto → written` 变成面试时 `interview`；默认预算从 180 秒总时限变成 10 秒首个可见文字、60 秒总时限。假时钟推进 10.001 秒可复现截图中的 `Generation first-token timeout`。证据 `/private/tmp/margin-timeout-routing-probe.log`（1/1）。这里只证明代码路径和默认预算，未证明用户当前保存时限、真实模型速度或其他报错原因；本轮未修改超时策略。
- 真实服务测试经用户明确授权读取应用已保存的 Gemini Key。首次辅助进程在 macOS `SecItemCopyMatching` 同步读取阻塞、尚未发送请求；只停止已核对路径的辅助进程。用户再次允许后重试成功，未修改钥匙串权限。Google 官方端点、当前 `generateOnce` 适配器、同一合成短问题，累计仅发送 3 次，不发送截图/会话/个人内容，不记录 Key 或答案正文。实际保存首字时限为 10 秒；凭据文件前后哈希一致。

  | 模型 | 推理 | 首个可见文字 | 终态 | 超过保存首字时限 |
  | --- | --- | --- | --- | --- |
  | gemini-3.5-flash-lite | medium | 18.864 秒 | completed / STOP | 是 |
  | gemini-3.5-flash-lite | 服务商默认，不发送 effort | 20.850 秒 | completed / STOP | 是 |
  | gemini-3.1-flash-lite | medium | 3.312 秒 | completed / STOP | 否 |

  原始脱敏报告 `/private/tmp/margin-gemini-real-60YWmJ/result.json`；测试刻意给单次请求 45 秒观察上限，没有改应用保存的 10 秒限制。3 次成功证明此 Key 和两个模型在这些样本可用；结合生产任务计时复现，3.5 的这两次延迟足以触发当前应用的首字超时。不能据 3 个串行样本判断长期延迟、网络与服务负载各自占比，或把其他模型的所有错误归为同一原因。未改变推理、模型或超时设置，未运行更多请求。
- 上述菜单修正尚未提交、推送或安装；下方安装回执仍只对应 `b7f57addf`。

- 设置页沿用笔试页面：移除重启暂停及额外状态文字；自动捕获按钮显示开启/暂停，开启时绿色（白字对比度约5.48:1）。不跳转、不启动会话。中英词条同步。
- 移除回答区问题场景选择器；会中菜单只有自动捕获、面试模式两个相关开关，复用主进程状态，与设置双向同步。
- 笔试开始不要求STT Key或麦克风权限，不创建采集或转写连接。模式切换沿现有会话队列串行执行，不清空历史，不结束会话；回到面试保留设备选择，成功通过配置/权限/音频启动后才提交模式。
- 面试开关关闭进入当场手动笔试；自动捕获偏好保留。失败切入面试暂停自动任务、保持笔试、显示错误，不自动重试。原生同步启动错误、缺Key、拒绝权限、保存失败均有测试。
- 持久字段`autoCaptureEnabled`与运行`running`分开；旧配置迁移补false。只有活动笔试会话才执行计时，首轮等待完整间隔；结束/退出停止任务但不清除偏好，下次笔试会话恢复。无会话时不会发送截图。
- 保存间隔保留当前开关状态并重新计时；预览/格式设置不取消当前回答。暂停只取消自动任务；实际模式切换及结束调用现有统一任务取消接口，取消独立文字流并丢弃迟到内容。
- 截图隐藏、纯文本/Markdown、语言与ACM/LeetCode规则、代码先行、Skill选择及Local Context边界保留。

## 验证与发现

- 最终门禁 `/private/tmp/margin-mode-gates-accepted/summary.json`：16/16全部exit0，136文件、1258/1258单元；24/24回答、3/3存储、2/2启动、17/17挂载，零跳过。类型、IPC/preload、退役及来源检查通过。
- `MeetingStartAudioGate`实际AppState方法接模拟音频流水线：笔试零音频/零权限调用、双向切换、设备保留、快速排队切换、结束期间迟到权限、重复结束、失败保存及失败启动后的资源释放。
- `WrittenExamMode`假时钟与真实SettingsManager持久文件：无会话零捕获、首周期、间隔重计时、手动暂停不被显示设置覆盖、跨重启偏好及旧配置兼容。
- 实际Electron设置/菜单控件：无原生窗口跳转、按钮绿色、菜单与设置同步、缺STT切换拒绝、关闭面试进入手动、结束后偏好仍开启但不截图；同时覆盖合成截图/模型、隐藏恢复和格式快照。
- 最终截图：`/private/tmp/margin-isolation-node-uls0gf/tmp/margin-isolation-regression-pcYNXE/s50-*.png`，包含中英×深浅的页面上/下部。核对布局，按钮绿色另由实际computedStyle断言验证。
- 新增取消回归先红后绿：原有resetEngine不取消独立文字流；真实IPC/LLMHelper配合实际AppState切换方法，旧代码signal仍未中止，补统一取消后切入笔试/面试/结束均中止，LATE输出不进事件和历史。证据 `/private/tmp/margin-mode-cancel-red.log`、`/private/tmp/margin-mode-cancel-green.log`，最终门禁包含该测试。
- 中间发现并修正：初版重复结束留下ending标志；结束后又调用pause导致开启偏好显示关闭；切换设备选择未沿用；间隔修改会意外恢复临时暂停；按钮颜色过渡导致即时颜色断言读到旧值。旧“保存任意设置即暂停”的断言按新契约更新。未以跳过测试替代验证。
- `/private/tmp/margin-mode-gates/`保留首轮颜色断言失败；`margin-mode-gates-final/`、`margin-mode-gates-delivery/`为增加后续修正前的中间通过结果，不能代替最终accepted目录。
- 来源扫描2条通用语句逐条核对后精确登记，见PROVENANCE；没有新增依赖或导入其他旧分支代码。

## 交付边界

代码本地完成，不等于实机签收。音频设备、系统权限交互、真实模型的解题/费用及共享接收端仍未实测；Windows只有共享代码静态核对。本次是当前Codex实施与自查，不冒称Claude独立验收。

当前安装已包含本票和保存修复，不是前一票的旧候选。安装不能恢复此前退出前未落盘的内存会议。原用户阶段6清单/报告和旧取证目录未改动；下一步由用户启动应用复测保存、输入框及模式切换。
