# AG-73 Windows x64 安装包、许可与对应源码

**当前独立结论**：两项阻断已由 Codex 复验关闭，本地软件范围通过；Windows 实际包/启动/安装仍未验证，不称整票完成。证据与首次沙箱图标失败及重跑见 [independent-review.md](independent-review.md)。下文保留实现者各轮摘要。

2026-10-24，Claude 会话 `68357856-1194-4334-b15d-76528cc6501e`，分支 `codex/windows-parity`（HEAD `fd989b3f`，加已验收未提交的 AG-71/72），未提交。原始日志在 `/private/tmp/margin-windows-wchdTl/`（`checks-AG73/`、`gates-AG73/`），完整报告 `result-AG73.txt`。本页是实现者摘要，**不是独立验收**。Windows runner 未运行，Windows 包的构建、检查和启动都没有在 Windows 上执行过。

## 调用链

`windows-compile.yml`（手动 `package_apps`）→ `setup:native`（Electron、better-sqlite3、keytar）→ `build-local.cjs`（`packageTarget`：仅 GitHub Actions，temp/release，x64）→ electron-builder `--win nsis --x64` → afterPack `license-bundle.cjs`（按 `win32-x64` 核对许可）→ `package-check.cjs` 检查 `win-unpacked` → BUILD-INFO 记录安装包 sha256 → `packaged-launch.mjs` 在一次性 profile 中启动 → `source-bundle.mjs`（`x86_64-pc-windows-msvc` crates）→ 只上传报告和源码包，不上传安装包。

## 改动

| 位置 | 内容 |
| --- | --- |
| `package.json` | Windows 目标只保留 NSIS x64。去掉遗留 ia32；portable 是另一种安装形式，也没有检查覆盖，一并去掉。NSIS 仍为按用户安装，卸载不删数据 |
| `package-check.cjs` | 新增 Windows 布局：`<name>.exe`；版本资源中的 ProductName、FileDescription、InternalName；所有 PE 必须是 x64，出现 Mach-O/ELF 即失败；3 个必需原生文件和 5 个运行时图标；许可。Mac 检查顺序与结果不变 |
| `license-bundle.cjs`、`collect-licenses.mjs`、`licenses/manifest.json` | Electron 的 `LICENSES.chromium.html` 在各平台内容不同（Mac `4fc0507a…`，Windows `b911161e…`），原先只固定了 Mac 版，Windows 打包在 afterPack 一定失败。现在 deferred 条目带 `targets`，Windows 值取自官方 zip（与 SHASUMS256 一致）；没有对应目标的值即失败 |
| `build-local.cjs` | 共用 `packageTarget`。Windows 只能在 CI 上打包，拒绝 local 身份，拒绝 `WIN_CSC_*`；不打 zip，BUILD-INFO 记录安装包 sha256 |
| `packaged-launch.mjs` | Windows 分支：一次性 USERPROFILE/APPDATA/LOCALAPPDATA/TEMP。不假定 Electron 使用这些环境变量，而是以 Electron 报告的 appData 为准：要求 userData、logs 都在 appData/name 下，且启动后只新增本应用目录 |
| `source-bundle.mjs` | 按主机选择 Rust 目标，使用 `CARGO_HOME`，ffmpeg 文件名按平台写 |
| `windows-compile.yml` | `package_apps` 输入及上述步骤，新测试加入 Node 测试组；已定义，未触发 |

## 本机验证（macOS arm64，隔离入口，合成数据）

- 新 `windowsPackage.test.mjs` 8/8。覆盖：完整合成 `win-unpacked` 通过；缺原生文件、ia32/arm64 PE、混入 Mach-O、缺或替换为其他平台的 Chromium 许可、缺 NOTICE、缺图标、未改写的版本字符串、可执行文件名、内置身份、更新配置、发布配置、模型文件，均按对应检查项失败；打包目标规则；NSIS 配置及按身份区分的 GUID。
- 14 个变异（忽略架构、外来格式、必需文件、许可目标、身份/CI 守卫、PE 签名、版本字符串、ia32 回退、删除数据、固定值）全部被测出，文件全部恢复。
- PE 解析在官方 Electron 43.1.0 win32-x64 二进制上的结果：electron.exe 为 x64，ProductName `Electron`、CompanyName `GitHub, Inc.`、版本 43.1.0；6 个 DLL 均为 x64。仅作数据读取。
- Mac 差分：HEAD 与新版 `checkPackage` 对 7 个已 ad hoc 签名的合成 `.app` 逐项结果和顺序完全一致。
- Windows workflow 的 Node 测试组在 Mac 上 273/273；许可与打包回归 57/57；来源检查 0 命中（新登记 2 行，原文精确登记）。
- 冻结后完整 16 步门禁一次通过：单测 138 个文件 1285/1285，0 跳过、0 拦截；门禁前后代码指纹一致。

## 未验证与待决定

- 未验证：Windows runner 上的 electron-builder/rcedit/NSIS 产物、真实 `win-unpacked` 检查、打包后启动（包括 Electron 是否使用环境变量中的 APPDATA）、Windows 源码包。安装、升级、卸载需要实机验证。
- 需用户决定：Windows 测试包身份（是否沿用 Natively Local / `local.natively.desktop`）；Win10 最低 build 及验证来源；Win11 build 与测试组合。在此之前不产出供安装的包，workflow 也不上传安装包。

## 复验第 1 轮修正（2026-10-24，待 Codex 复验）

原始日志在 `checks-AG73-review1/`、`gates-AG73-review1/`，报告为 `result-AG73-review1.txt`。

- **P1 数据删除跨产品**：
  - 问题：electron-builder 的卸载程序在显式 `--delete-app-data` 时，会删除 `$APPDATA\{APP_FILENAME, APP_PRODUCT_FILENAME, APP_PACKAGE_NAME}`。其中 APP_PACKAGE_NAME 取自包名 `natively`；安装程序还把自身缓存到 `$LOCALAPPDATA\natively-updater`。这两处都与旧 Natively 共用。
  - 修正：`electron-builder.config.cjs` 只在 Windows 上设置 `extraMetadata.name = identity.name`。根 package.json、Mac 包、显示名和 appId 都不变。
  - 验证：
    · 用真实的 `Packager.validateConfig()`、`AppInfo` 和 targetUtil 计算 temp 与 local 的全部删除目录，不区分大小写后都只有身份自己的目录；对合成的旧 Natively 及其他身份目录均不涉及；
    · 同时固定了模板中 3 条 RMDir 和对应 define 行的写法；
    · Windows 包检查新增 `package-name`；
    · release 身份按规则只能在 CI 上取，本机没有计算。
- **P2 损坏的必需原生文件**：新增 `required-native-x64`，3 个必需 `.node` 本身都必须是 x64 PE。零字节、文本和 PE 签名损坏的情况都会失败；原有的缺失和错误架构检查保留。

## 远端第 1 轮修正（2026-10-24，待 Codex 独立验收）

公开 `be029b94` 的首轮 CI：Windows 40049343934 的 Node 测试 273/274；Mac 40049346596 的门禁 15/16。原始日志在 `checks-AG73-remote1/`、`gates-AG73-remote1/`，报告为 `result-AG73-remote1.txt`。

- **合成 ASAR 读到 NUL**：
  - 原因：`@electron/asar` 3.4.1 的 `createPackage` 调用 `out.end()` 后即返回，不等写入完成；它的读取函数会把尚未落盘的字节当作 0。所以在慢盘上，测试读到的 `package.json` 全是 NUL。
  - 复现：在 Mac 上用延迟写入的探针重现了相同的错误和位置，修正前 7/9；修正后慢写和正常运行均为 9/9。
  - 修正：测试夹具等待归档写满头部列出的全部字节；生产检查不变。
- **`resources/elevate.exe` 为 ia32**：
  - 来源：electron-builder 只为 electron-updater 的按机器更新复制这个辅助程序（`packElevateHelper`）。本应用没有 updater；安装程序自身的提权走 UAC 插件，模板中没有引用 elevate.exe。
  - 修正：设置 `nsis.packElevateHelper: false`，`native-x64` 不加任何例外，并新增一个“ia32 elevate.exe 仍失败”的负例。
  - 说明：现有安装语义是向导式安装，带安装模式选择页（默认按用户，可选按机器），本修正不改变这一点。
- **来源检查**：Mac CI 的 680175 键池命中 `versionStrings()` 中 2 行（PE 格式常量和遍历节表的循环），本地 140 个受限 tip 都没有这两行；本地另命中夹具里 1 行通用 sleep。3 行都按原文精确登记。
- **Windows 源码包 `cleanTree=false`**：`native-module/index.js` 和 `index.d.ts` 在构建时由 `napi build --platform` 重新生成，源码包按设计记入了 `working-tree.diff`。diff 的内容和原因尚未核对，因为源码 ZIP 还未验收。
