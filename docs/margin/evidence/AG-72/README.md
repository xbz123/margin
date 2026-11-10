# AG-72 窗口、输入与截图

2026-10-23，Claude 会话 `68357856-1194-4334-b15d-76528cc6501e`，分支 `codex/windows-parity`（HEAD `fd989b3f`，加未提交的 AG-71 修正），未提交。原始日志在 `/private/tmp/margin-windows-wchdTl/`（`checks-AG72/`、`gates-AG72/`），完整报告 `result-AG72.txt`。本页只是摘要，**不是独立验收**。

**当前状态**：本轮修改通过 [Codex 独立复验](independent-review.md)，关键82/82、原失败场景1/1，同源完整门禁16/16。用户已排除跨屏拼接，并批准代码专用推送；公开提交 `f02abb05` 的 Windows/Mac CI 正在运行，见 [交付记录](delivery.md)。私有文档未推送，实机未验，未进入 AG-73、未合并安装。随后 Windows CI 40028028386 有 5 项失败，均为测试夹具的 POSIX 路径写法；已修正，**待 Codex 复核**，见下文“Windows CI 测试夹具路径修正”。

## 缺口与修复

先用只读工作流（11 个 agent，逐项对抗复核）沿“界面 → IPC → 平台”核对，只修已证实的缺口。macOS 调用顺序与输出保持不变。

| 缺口 | 修复 | 红 / 绿 |
| --- | --- | --- |
| 图片路径校验拒绝一切盘符路径，Windows 截图无法发送（R3-3） | Windows 规则：盘符与 UNC 只按 realpath 后的归属判断，大小写不敏感；拒绝 `\\?\`、`\\.\`、`\??\` 命名空间、无盘符的根路径、`C:x` 盘相对路径、备用数据流和设备名。复审后补充：越出应用目录的路径在查文件系统前就拒绝，外部共享不会被连接 | 旧代码对合法路径报错；33/33；8 个变异均被识别 |
| Windows 全屏截图丢掉目标显示器，总是截主屏 | win32 也传 `preferredDisplay` | 旧代码截到主屏；变异被识别 |
| Windows 单屏缩略图按 DIP 请求、按 scaleFactor 裁剪；Electron 不保证缩略图尺寸，125%/150% 时分辨率和选区可能不对 | 仅 win32 单屏：按 bounds×scaleFactor 请求，按实际缩略图尺寸与 bounds 的比例裁剪，与多屏路径一致。多屏拼接未改，见“未完成” | 截图测试 4/4；5 个变异均被识别，含 macOS DIP 尺寸用例 |
| 托盘菜单在 Windows 上显示 Cmd+B/Cmd+H | 非 macOS 时 CommandOrControl 显示为 Ctrl；Command 单独出现时不改（Electron 中它是 Windows 键） | 3 个变异均被识别 |
| Windows 运行中切换保护不隐藏/恢复托盘，与启动规则不一致 | win32 与启动规则相同：开启保护时隐藏托盘，关闭时显示 | 2 个变异均被识别 |
| `settings:open-tab` 在 Windows 上可能把 opacity 0 的启动器显示出来（成为不可见窗口） | `WindowHelper.showLauncherForSettings`：win32 有保护时沿用 `switchToLauncher` 的不透明度保护，无保护时先恢复不透明度；macOS 调用不变，不切换模式 | 生命周期 16/16；4 个变异均被识别（复验第 1 轮后为 20/20，见下文） |
| 快捷键录制在 Windows 上把 Windows 键记成 Ctrl | Windows 上拒绝包含 Windows 键的录制，提示“Windows 键快捷键由 Windows 保留”（Microsoft RegisterHotKey 说明这类组合保留给系统）；macOS、Linux 录制不变 | 与旧逻辑的差分比较：456 个事件 0 差异，Windows 上 152 个被拒；4 个变异均被识别 |

只读复审（3 个视角 + 1 个复核）确认 1 项 P2（上表第一行中外部 UNC 在归属判断前已被访问）和 1 项 P3（Linux 也被拒并显示 Windows 文案），均已修复并补测。

## 检查结果（本机 macOS arm64）

- 冻结树完整门禁，代码指纹前后一致：第一次 15/16。`outbound-renderer` 中 AG24 导航测试报 Playwright “Execution context was destroyed”，即 PLAN 已记录的首次主进程 `evaluate` 与启动竞争，所涉路径本票在 macOS 上没有改动。原样完整重跑一次：**16/16 exit 0，`allPassed: true`**，`outbound-renderer` 17/17。两次日志均保留。
- 第一次运行的其余结果：单元 1272/1272、0 跳过、0 拦截；回答 21/21，存储 3/3，启动 2/2，守卫自测 12/12；两个 `tsc` 均 0 错误，来源 0 命中，`git diff --check` 通过。
- 来源：本地检查命中 6 行本票新写的通用语句（Electron 窗口调用、Electron API 替身、对象键、return），逐行核对后精确登记，未改写、未排除路径或池。受限引用只列文件名，未读取内容。

## 复验第 1 轮的修复（实现者自报）

Codex 复验（`/private/tmp/margin-AG72-independent-Rrvh00/review.md`）复现：开启保护时，`switchToOverlay(true)` 安排悬浮窗 60 ms 后恢复不透明度。若在此之前调用 `showLauncherForSettings`，它会清掉同一个 `opacityTimeout`，悬浮窗于是一直可见但透明度为 0。原测试 fixture 的 `clearTimeout` 是空函数，看不到被丢掉的回调。

- 修复：设置页的显示改用独立的 `settingsRevealTimeout`，不再替换悬浮窗的待执行恢复。重复打开时只取消自己上一次的计时器。回调执行时启动器若已隐藏或关闭则不做任何事。保护失败时与 `opacityTimeout` 一同取消。macOS 不创建该计时器，行为不变。
- 测试：生命周期 fixture 改为真实取消的计时器，并逐窗口记录不透明度。新增 4 项：悬浮窗恢复期间打开设置（两种激活方式）；重复打开只保留一个计时器并只 focus 一次；隐藏、切到悬浮窗或销毁后回调不动启动器；保护失败时取消计时器。
- 红 / 绿：按哈希逐字重建的交付版 `WindowHelper.ts` 上，新测试 2 项失败；修复后 20/20。4 个变异（共用计时器、去掉可见性判断、去掉重复取消、去掉失败取消）均被识别。Codex 的复现脚本在修复后 1/1 通过。关键套件 82/82。

## Windows CI 测试夹具路径修正（实现者自报）

Windows CI 40028028386 的 Node 测试共 265 项，260 项通过、5 项失败，没有跳过。5 项都是 AG-61 的测试，本次首次加入 Windows workflow：

- `WindowPreferencePersistence` 第 48 行（写入失败、重命名失败各一次）：`SettingsManager` 用宿主的 `path.join` 生成 `\synthetic\settings.json`，假磁盘却以 `/synthetic/settings.json` 预置数据，初始设置因此没有被读到。
- `WindowPreferences` 第 173、182、193 行：伪装图标路径由宿主 `path.join` 生成反斜杠形式，断言却写死了斜杠后缀。

只改这两个测试文件（+10/−6），生产代码未动。期望路径改用与夹具注入的同一个 `path.join` 生成，图标改为整条路径严格相等，比原来只比较后缀更严。保存失败、不写盘、重启、伪装和目标平台的断言全部保留。

在 Mac 上把夹具注入的 `path` 换成 `path.win32` 做探针：旧测试恰好复现这 5 项失败，位置与 CI 一致；新测试 25/25 通过；换回 `path.posix` 时新旧测试都通过。另做 3 个变异（图标平台目录、图标文件夹名、设置文件名），均被识别。workflow 的同一测试组合在 Mac 上 265/265，单元 1276/1276。原始记录见 `checks-AG72-remote1/` 与 `result-AG72-remote1.txt`。Windows 上的结果仍需 root 重跑 CI 确认。

Mac CI 40028031348 只有来源检查失败，命中 1 行：`validateImagePath.test.mjs:94` 的 `const w = path.win32;`（CI 池 679512 键）。该行是本票假 NTFS host 的路径别名，本地 140 个受限 tip 均不含此行，已按原文精确登记，未改名。

## 未验证与未完成

- Windows 运行：没有在 Windows 上执行任何测试；以上均为 macOS 上的平台分支 mock，不算跨平台通过。远端 CI 未运行，由主线程安排。
- Win10/Win11 实机：保护（WDA_EXCLUDEFROMCAPTURE 需 Win10 2004+，黑框不可接受）、共享接收端、混合 DPI 截图像素与裁剪、IME、托盘显隐、热键前台限制、点击穿透、Windows 键实际能否到达渲染层，均未实测。
- 截图原生像素：本阶段只要求单屏全屏/选区截图及输出（用户 2026-10-23 确认）。Windows 单屏路径已在 mock 中验证，真实像素待实机。旧跨屏拼接保留、不开发、不验收，不再要求决定混合 DPI 画布规则；此前报告中的待选方案因此不再阻塞。
- 快捷键：注册失败时保存新配置并报告 `apply_failed`、不恢复旧绑定，这是现有的“已保存 / 已应用”契约，不是缺陷。改为回滚属于行为变更提议。
- 待用户决定：Win10 最低 build；Windows 默认快捷键可能与系统或应用冲突；Windows 上“Stealth typing”文案。
