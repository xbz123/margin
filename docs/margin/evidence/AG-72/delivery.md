# AG-72 公开代码交付与远端验证

2026-10-23，用户批准仅代码推送、Windows/Mac CI、核对后判断 AG-73；不合并、不安装，不自动开始 AG-73。

## 已完成

- 公开仓库 `xbz123/margin`，分支 `codex/windows-parity`，提交 `f02abb052bf57bd0bffeafeae05e9388878f2cd7`；远端 ref 回读一致。
- 在公开基线 `fe47126e` 上生成独立代码提交，15 个文件：已验收源码/测试、6 条必要来源登记和 Windows workflow；无私有 Markdown、日志或私有分支祖先。
- 公开投影的14份源码/测试/配置与私有验收树逐字一致。Windows workflow 额外加入现有 AG-72 路径/截图/偏好/快捷键测试，以便实际在 Windows runner 执行；未新增测试框架。
- YAML 解析和全部 run 块 `bash -n` 通过；新增 Windows 命令在本机隔离运行 **265/265**，无失败/跳过/取消。公开树来源检查0命中，`git diff --check` 通过。
- 沿用已独立验收的同源16/16本地门禁、1276单测及关键82/82；源码未变，不再重复全量本地测试。

## 首轮远端失败及修正验收

- Windows：https://github.com/xbz123/margin/actions/runs/40028028386
- Mac：https://github.com/xbz123/margin/actions/runs/40028031348
- 均为一次手动触发，目标 SHA `f02abb05`；Mac `no_cache=true`、`package_apps=false`，不打包安装。
- Windows 原生构建/加载、Rust 通过，Node 260/265；5 条失败均为测试夹具的 POSIX 路径假设。Mac 新原生、1276 单测和4组 Electron 通过，15/16，仅来源扫描命中 `const w = path.win32;`。
- 两份日志 ZIP 已核对 GitHub 摘要并安全解包：Windows `5a82ed6b3c371e1cadb820051d1f3e843a9a92b01296b2eb67423798e8ada093`；Mac gates `a29d130e6689b5bbeda923bc27df26df46f6df903c48c5e40fdc22ab36a861d7`。原始取证目录：`/private/tmp/margin-AG72-delivery-j462Ps/`。
- 原 Claude 修正两份 fixture，统一用注入的路径模块构造完整路径，保留全部断言；另精确登记一条通用 Node namespace 别名，不改名规避扫描、不扩展排除目录。生产代码不变。
- 当前 Codex 独立复跑：Windows 路径注入旧版分别6/8、14/17，新版8/8、17/17；真实本机隔离测试25/25。红绿日志 `checks-AG72-remote1/probe-root-*.log`，实现者同源完整265组合、1276单测证据已核对。公开来源检查0命中，diff检查通过。

## 修正后远端运行（原始证据核验通过）

- 公开修正 `39a36d1e1375bdd02d2ce7b3efabcbd737b193ef`，仅两份测试和必要来源 JSON，远端 ref 回读一致。私有文档和祖先未公开。
- Windows：https://github.com/xbz123/margin/actions/runs/40030280561
- Windows 已终态成功并核验原始证据：MSVC release 原生构建、加载1/1、Rust 12/12、Node 265/265（无失败/跳过/取消）；两类型检查及 Electron/renderer 构建通过。BUILD-INFO 源提交匹配 `39a36d1e`，记录 win32-x64-msvc 模块 SHA256 `bbc4ea3654596fe375558eb727b218254773527693ef45ef84df6b37755d6b8e`。产物仅包含构建记录与测试二进制，不含模块本体，模块哈希是 runner 记录而非本机重算。
- artifact `12534501995` ZIP SHA256 `de76277ea9860d942604cec828619205c473fb48740bef3e7d13acf4440a7c27` 与 GitHub digest 一致；14 个平面普通文件，无路径穿越或符号链接，仅解压日志与 BUILD-INFO 到 `windows-correction/`。加载日志两条 device blocked 是守卫主动包装原生模块，不是实际设备调用或未解释测试失败。
- Mac：https://github.com/xbz123/margin/actions/runs/40030284209
- Mac 已终态成功：无缓存原生构建、完整16/16门禁；137文件1276/1276单测，无跳过/取消、未结束文件或未解释隔离阻断。四组 Electron 分别21/21、3/3、2/2、17/17；正式/本地身份各7/7，S42必需项全部运行，来源池679512项、0命中。守卫自测12/12中的18次主动拦截符合自测目的。
- Mac gates artifact `12534878277` ZIP SHA256 `b0aed53adcfd5fb001b255c531a255cb4bdce86bd65cd512fdf84a57bc6c3d4b`；native artifact `12535131025` ZIP SHA256 `4a753d7633116132d7ce8465e6096d6ec9dc9901bcbd1fbc0430bbd73ceac7d9`，均与 GitHub digest 一致。条目全部为平面普通文件，安全解包到 `mac-correction-gates/`、`mac-correction-native/`。
- BUILD-INFO 与门禁 summary 的源 SHA 均为 `39a36d1e`，工作树干净；`no_cache=true`，本次实际编译 cidre。下载的 arm64 `.node` 重算 SHA256 `254d82902b852b05c01bd25d3d37ea3eeb89ad52f66022ed717a7d9a2e41fbd3` 与记录一致；未执行下载模块。`package_apps=false`，未生成或安装应用包。

## AG-73 准入判断

AG-72 单屏软件范围已完成独立验收、仅代码公开交付及双平台 CI 原始证据核验，AG-73（x64 安装包与许可）的软件前置条件满足，可在用户批准后开始开发；本轮未启动它。

Win10 最低 build/验证来源、Win11 实测组合、Windows 测试包身份仍待确认。它们分别阻塞相应兼容承诺、实测、身份相关打包/安装，不推翻当前软件验收。证书、最终图标和正式发布另行决定。私有 AG-71修正/AG-72及记录仍未提交，不以公开提交冒称私有提交已完成。

## 范围

本阶段只要求单屏截图，跨屏拼接已由用户排除。Windows Server CI 不代替 Win10/Win11 实机的共享隐藏、IME、热键、DPI 和设备验证。私有计划与独立报告不推送；不合并、不安装。
