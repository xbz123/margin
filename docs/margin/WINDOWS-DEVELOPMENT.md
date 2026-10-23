# Windows 10/11 对等功能开发

**最新恢复结论（2026-10-23，Codex）**：AG-71 review1 两项P2独立复验关闭，本地整改与完整门禁通过；仍等待Windows runner、双平台新原生构建及Win10/Win11实机证据，不进入AG-72/73。见[独立复验](evidence/AG-71/independent-review.md)。下方实现者交回记录中“等再次复验”已由本结论更新；定时复验检查已结束。

2026-10-23 用户授权 Claude 开发、Codex 独立验收；支持 Windows 10/11 x64，已有 Win11 实机。采用独立分支，Mac 实测不阻塞 Windows 开发；正式发布仍先 Mac 后 Windows。

## 基线、范围与责任

- 基线 `db992097e1342aef5abf0d794dec42b07b47d95c`，含 S47–S49 已验收源码 `9247cc19`；分支 `codex/windows-parity`，工作树 `/Users/mac/code/Natively/.claude/worktrees/windows-parity`。
- Claude 是本工作树唯一写入者；Codex 在其停止后审阅 diff、原始证据及必要复跑。AG-71 → 独立验收 → AG-72 → 独立验收 → AG-73；首轮只放行 AG-71。
- 保留 Mac 工作树的未提交 `STAGE6-CHECKLIST.md`、未跟踪 `STAGE6-TEST-REPORT.md`、AG-51 和音频取证目录，不复制、覆盖或提交。
- 复用多模型/能力表/推理、凭据事务、取消/重试、截图、STT、会议保存与界面，不分叉重写业务；只补平台缺口及其直接消费者。Mac 行为不变。
- 产品契约见 `docs/product.md`；来源边界见 BASELINE/PROVENANCE。禁止引入受限后期上游或合并旧 windows-support。平台事实查 Microsoft、Electron、Rust crate 官方资料并保留出处。
- 本轮 Claude 不提交、推送、触发远端 CI、合并、安装或发布，不继续委派、不用 Codex CLI 自行签收。主线程验收后按项目门禁组织后续动作。禁止真实服务/凭据/数据/设备调用、全局设置/权限/系统服务修改、安装新全局工具链或绕过正式身份保护。

## 已定位入口

- `.github/workflows/windows-compile.yml`（AG-70）：现有手动公开 workflow 仅类型/renderer/main/MSVC 编译，不运行测试、不打包，不能证明 Win10/11 运行。
- `native-module/src/speaker/windows.rs`、`native-module/src/lib.rs`、`native-module/Cargo.toml`：已有 WASAPI/CPAL 分支，存在 multimedia/communications 默认设备差异的注释，先核对设备选择链，不凭注释新增自动路由或双采集。
- `electron/audio/{SystemAudioCapture,MicrophoneCapture,MeetingAudioPipeline}.ts` 及 main 会议消费者：沿用生命周期和清理契约。
- `electron/WindowHelper.ts`、其他窗口 helper、相关设置 IPC、native keyboard/stealth 分支：检查 Windows 行为，Mac 特有 API 不算 Windows 实现。
- `electron/utils/imagePathValidation.ts` 当前拒绝所有盘符路径。后续修复保持 realpath 后目录归属、文件类型及穿越校验，不能仅删正则放行任意文件。
- `electron-builder.config.cjs`、`package.json`、`scripts/margin/{package-check.cjs,package.config.cjs,source-bundle.mjs,license-bundle.cjs}`：检查目前 Mac 专用假设；遗留 ia32 目标不代表已授权支持32位。

## AG-71：原生音频及 Windows 验证基础（复验第 1 轮的修复已交回，待 Codex 再次复验）

**Outcome**：Windows x64 原生构建/加载和双路采集生命周期有明确验证路径，受控模拟下开始、停止、切换/失败及尾段排空满足共用契约。

**Scope**：native 音频分支及直接 capture/pipeline 消费者；现有 build-native/setup-native、AG-70 workflow、隔离入口和直接相关测试。跨平台入口的 POSIX 假设仅修复本票必需部分，不新建测试框架。依赖调整需说明系统下限及 Mac 影响。

**Steps**：先列调用链及缺口 → 最小修复 → 现有 mock 生命周期测试 → 为 Windows runner 准备原生加载/非设备测试与产物记录。当前做本地实现和可运行验证；远端执行交主线程，不因本机无 Windows 而绕过验收或自行启动 CI。

**Interfaces / Validation**：采集数据格式、回调、release/destroy 顺序及 pipeline 消费方沿用。中止初始化、重复停止无残余计时器/重复回调；设备打开失败显式报错或按既定规则默认回退；停止后迟到数据不再进入会话，尾段不完整沿用提示。关键缺陷留最小失败反例；合成测试不得真实枚举或采集设备。Windows 原生加载检查需在对应 runtime 执行，Mac 平台 mock 不算 WASAPI 实测。

**Stop**：需改变默认设备路由语义、削弱取消/数据保护、排除 Win10、加入驱动/管理员服务或改全局工具链时报告具体选择，仅暂停依赖项。AG-71 本地实施结束写结果并停止，等待 Codex 验收，暂不改 AG-72/73。

## AG-72：窗口、输入与截图（待 AG-71 验收）

**Outcome**：Win10/11 窗口保护、穿透、快捷键、输入与截图提问符合现有产品行为。

**Scope / Steps**：窗口 helper/IPC、必要 Windows 原生接口、截图路径及现有测试。核对焦点、中文 IME、快捷键冲突/恢复、保护/伪装互不干扰及后建窗口继承；不把 Mac Dock 行为变成新增 Windows 进程隐藏。

**Validation**：界面→IPC→平台替身链验证失败反馈、重试、旧回复不覆盖；合法应用图片通过，盘符/大小写/UNC/设备路径/符号链接或 junction 逃逸按真实平台语义处理，越界零外发。截图保持原生像素，不恢复 sharp/OCR。共享接收端看不见窗口且无黑框，本机仍能操作；须分别记录实际 OS/共享软件/方式，setContentProtection 成功不等于保护实测通过。

**Stop**：Windows 10 最低 build、最终图标及实测组合未定时暂停相应兼容承诺/资产/实测，不阻塞独立软件实现。开发用已审资产临时占位，不称最终图标。

## AG-73：x64 安装包与许可（待 AG-72 软件验收）

**Outcome**：可检查的 Windows x64 测试产物，身份/数据隔离与 Mac 一致，非正式发布。

**Scope / Steps**：复用 electron-builder、身份单源、native 产物选择和 license/source-bundle/workflow；限定 x64，处理遗留 ia32。优先现有 NSIS 配置，不引入新安装技术。核对 native/.node/运行时架构、资源/许可完整性；升级/卸载保留用户数据，不迁移旧 Natively/Margin 数据。

**Validation**：缺原生文件、错架构、缺许可明确失败；Windows runner 的包检查和隔离启动保留原始记录。测试包身份确定后，安装/升级/卸载由实机验证。正式 release 守卫不能为打包而绕过。

**Stop**：测试身份、证书/发布/付费资源未获批准时暂停对应步骤，先完成独立构建验证；AG-74/75 不在本轮开发范围。

## 共用验收与合并

- 分开报告代码、自动测试、Windows runner、Win10/Win11 实机、安装、发布；没有在 Windows 执行的只记“静态/平台分支 mock”，不称跨平台通过。
- 本地测试用项目隔离入口 `scripts/margin/isolation/run-node.mjs`；受影响类型和 Mac 回归沿用原入口，代码冻结后完整门禁由一人串行运行。守卫不支持时修入口或报告，不能无守卫运行。可信同源证据可复用。
- 新工作树可使用项目本地 `npm ci`，保留 ignore-scripts；不得把 node_modules、dist、target 链接到 Mac 工作树。需要已验证 Mac native 时按精确文件复制并记录哈希，不重编/安装全局工具链，不写原工作树。
- 来源命中逐条精确核对，不做目录白名单。原始日志放临时任务目录，仓库仅简短证据。
- 合并前对照主线同期修复、解决共享代码冲突，完成受影响的 Mac/Windows 回归；不要把 Windows 专用 AGENTS 路由覆盖进主线。不自动合并或推送。

## 恢复点与待确认

- AG-71 由 Claude 会话 `68357856-1194-4334-b15d-76528cc6501e` 实施，本地实现与检查已交回，等 Codex 独立验收；任务、原始日志与报告在 `/private/tmp/margin-windows-wchdTl/`（task-AG71.txt、result-AG71.txt、checks-AG71/、gates-AG71/），仓库摘要见 [AG-71 证据](evidence/AG-71/README.md)。Codex 第 1 轮复验暂不通过（Windows 路径 ESM 加载；producer 失败时尾部样本可能丢失）；修复与本地完整门禁记录在 `result-AG71-review1.txt`、`checks-AG71-review1/`、`gates-AG71-review1/`，等 Codex 再次复验。AG-70 Windows runner 已加入非设备检查，尚未运行；Win10/Win11 实机未验证。AG-72/73 排队。
- 已定：Win10/Win11、x64、已有 Win11 实机。不再询问 ARM/32 位或签名是否本轮实现。
- 待确认：Win10 最低版本（AG-71 建议见 [证据](evidence/AG-71/README.md#windows-10-下限建议)：技术下限 1703，承诺与测试以 22H2/19045 为准，待用户定）；Win11 build、共享软件/接收端；Win10 实机或 VM 的验证来源；系统音频是否需要跟随“通信”默认设备（当前只跟随多媒体/控制台默认设备）。上述不阻塞 AG-71 独立部分。
- 后续才需决定：最终 Windows 图标、测试包身份、真实服务组合/费用；不要求用户选择代码组织或测试框架。
