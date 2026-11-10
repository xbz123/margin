# AG-72 Codex 独立验收（2026-10-23）

## 结论

本轮已交付修改的代码审阅与本机隔离验证通过；首轮发现的 P2 不透明度计时器问题关闭。用户随后明确本阶段只要求单屏截图及输出，跨屏拼接移出范围，不再阻塞本地软件验收。Windows runner 和 Win10/Win11 实机均未验，Win10 最低版本待确定；不能称完整 Windows 验收通过。本票未提交、推送、合并或安装，未进入 AG-73。

范围：`codex/windows-parity` 的 `fd989b3f` 加未提交 AG-72 修改；其中 AG-71 guard/config 修正已独立验收并公开为 `fe47126e`，不重复计算为本票远端通过。

## 独立证据

- 已读完整生产/测试 diff、未跟踪截图测试及真实 IPC/窗口/截图/图片验证消费者；本轮修复只有 WindowHelper 与生命周期测试相对首轮交付变化。
- 14 份代码文件与 `gates-AG72-review1/code-file-hashes-before.txt` 逐一一致；来源 JSON 单独核对，保持精确语句登记，未扩大路径/来源池排除。
- 原计时器缺陷：实际 WindowHelper 加原测试 fixture，仅补真实取消语义与逐窗口 opacity 观察，连续两次稳定失败。修复后同一独立序列 **1/1 exit 0**。独立复跑关键套件 **82/82 exit 0**，无跳过/取消。
- 复验修正后的完整门禁原始 summary 核对：**16/16**，单元 **1276/1276**，无隔离拦截、未结束或异常退出；回答21、存储3、启动2、renderer17、守卫12均通过。可信同源全量结果复用，未再无理由全量重跑。
- 首轮原始完整门禁15/16的 AG24 `Execution context was destroyed` 保留；原样复跑16/16也保留。Codex 独立单跑 AG24 **1/1**；首次外层沙箱不能启动 Electron 的环境错误另存，获准后仍使用项目隔离守卫，未读取真实数据。
- `git diff --check` 通过。原始独立日志及首轮报告：`/private/tmp/margin-AG72-independent-Rrvh00/`；实现者原始日志：`/private/tmp/margin-windows-wchdTl/checks-AG72-review1/`、`gates-AG72-review1/`。

## P2 关闭依据

旧 `showLauncherForSettings` 清掉可能属于可见悬浮窗的 `opacityTimeout`。现在设置显示使用独立 `settingsRevealTimeout`；重复打开只取消自己的任务，回调检查窗口仍存活且可见，保护失败取消两种恢复。现有测试 fixture 也已由空 `clearTimeout` 改为真实取消，覆盖双窗口重叠显示、重复打开、隐藏/销毁与保护失败。不引入新调度框架，macOS 不创建新计时器。

## 下一步边界

用户 2026-10-23 确认：只考虑单屏截图及输出，不考虑跨屏拼接。因此本轮不修改共用的多屏画布，也不把旧跨屏逻辑宣称为已验证功能。单屏请求/裁剪已覆盖，真实像素质量仍需设备验收。该范围决定不改变已运行测试或代码指纹。

快捷键保存成功但注册失败时保留新配置并返回 `apply_failed` 是现有契约，不自动改成回滚。托盘、IME、共享接收端无黑框、DWM 时序、单屏缩放、NTFS junction 等真实行为均不得由 mock 推导为通过。后续按 Windows runner 和实机验证组织；五分钟检查已在本轮独立验收结束时停止。
