# AG-73 公开仅代码交付与远端验证

## 当前结论（2026-10-24，双平台CI通过，用户调整验收范围）

用户最新要求：不再下载源码包，本项目不再安排哈希核对；后续使用单独的Windows机器实机验收。`ag-73-ci` 检查已删除。下文摘要记录是此前已完成的历史工作，不再作为新增验收要求。下载在指令到达前已完成，文件留在临时目录，不继续展开依赖包、不执行内容，也不擅自删除。

双平台修正版CI均success，Windows测试274/274、两包检查13/13、两次隔离启动9/9；Mac16/16、1286单测、四组Electron和两身份全部通过。用户已澄清选择“远端核验、只取报告”，不是分支合并；本次回读远端终态及Windows日志确认上述结果和源码生成成功，不重复运行CI。对应源码清单逐文件完整性核对按用户要求停止，不能写成已完成；已读生成绑定diff仅移除Rust中cfg(macos)的键盘/窗口接口。真实安装/升级/卸载及设备验收待用户，未合并、未安装。

`4ed00ae5bcc3636c25fda965a66177053a0874e3` 已仅投影三份文件并推送，远端回读一致：`package.json` 不打包无updater用途的elevate工具；Windows测试夹具等ASAR内容完整；3行精确来源登记。独立慢写旧7/9、新9/9、相关73/73及同源门禁16/16/1286已核验，详见 [独立记录](independent-review.md)。公开来源0命中、暂存diff检查通过，未公开私有文档/日志。

- 新Windows：https://github.com/xbz123/margin/actions/runs/40051834282 ，package_apps=true。
- 新Mac：https://github.com/xbz123/margin/actions/runs/40051836480 ，no_cache=true/package_apps=false。
- 各一次，远端报告核验完成；旧失败run保留不原样重跑。源码生成成功不等于逐文件独立完整性验证，后者按用户要求不再执行。未合并安装发布，实测身份/版本待定。

### Windows 修正版已核对的结果

Mac40051836480亦已终态success并核验：16/16门禁、1286/1286单测、四组Electron21/3/2/17、正式/本地身份各7/7、S42必需项通过，来源池680175零命中。summary源SHA为4ed00ae5，无未结束单测或未解释隔离阻断。gates artifact12543584361 ZIP摘要 `12e614ad85aa9b00ba8b03dcffc96ed3e7749fc5e0a5a239bf2e01ee48fde0bf`，native12543284359 ZIP摘要 `792e722635ef56cbfc1b57404342e78a114af848e5b52d74876be8064f87ed20` 均与GitHub一致并安全解包。BUILD-INFO记录本次无缓存重编cidre；下载arm64.node重算SHA256 `254d82902b852b05c01bd25d3d37ea3eeb89ad52f66022ed717a7d9a2e41fbd3` 一致，未加载执行。Mac不打包安装。剩Windows源码包仍在下载，整体取证未结束。

Windows40051834282终态success。compile artifact12544101393 ZIP SHA256 `96834577bf391274492b63c0c9c6ea68b1312af95ecb975158bb058a30b441f7`，package报告12543374333 ZIP SHA256 `80c98f15979fc97bc5f9a97d22de58949a970853351ab52566ee81ba575fa51d`，均与GitHub digest一致。安全条目核对后仅解包日志/报告；原始在 `windows-correction/`、`windows-correction-package/`。

- 目标SHA匹配`4ed00ae5`；原生构建/加载1/1、Rust12/12、Node274/274，无失败/跳过/取消。加载日志2次设备包装拦截为预期守卫行为。
- temp/release包检查各13/13，13个PE均x64，无elevate.exe；必需绑定、许可、包内身份和package-name通过。隔离启动各9/9，appData实际在throwaway profile，userData/logs仅属于当前身份。
- runner记录原生SHA256 `8f173691ad515f8262f499cbfce8c488efd4d1667c7903c397a243ff00d0b105`；安装包temp `2e8a3b3a83d9ef6348481aa5d14cfcac816ecc6419a798f45f46c88169444245`，release `1b7579de381dd3db8da51e22b67f61f8f87355fa0f7574df5687cc3fcf298e7b`。这些二进制未上传/本机重算或运行，不能等同下载包验收。
- source artifact12543897674（242751318字节）在停止指令前已下载完成，保留临时文件，不继续解包或逐文件核对。远端报告记录源码生成成功，cleanTree=false仅涉及Windows生成的两个绑定文件；生成绑定diff已解释。Mac亦已成功，本轮按用户选择的远端报告范围结束，不等同实机验收。

2026-10-24 用户批准推送并进行CI测试。不合并、不安装；Windows测试包身份/Win10最低build及实机组合仍未确认，不提供供安装的产物。

## 已完成

- 公开 `xbz123/margin:codex/windows-parity` 提交 `be029b9401c3bc378c52e09aa828c7a3b52752a9`，从公开 `39a36d1e` 生成，远端回读一致。
- 13份源码/测试/workflow/必要许可JSON；与私有已验收内容逐字一致。未公开私有Markdown、日志、机器路径记录或私有分支祖先。私有实现和记录仍未提交。
- 27份冻结代码指纹核对通过，复用已独立验收的16/16门禁1286单测及独立复验，不重复全量运行；见 [独立记录](independent-review.md)。
- 两workflow YAML解析、28个bash run块语法检查通过；公开来源扫描0命中（本地池664426），暂存区diff检查通过。公开工作树干净。

## 运行中，未验收终态

### 首轮终态失败（2026-10-24）

- Windows40049343934：编译/原生与依赖准备通过，Node273/274。唯一失败在合成包负例读取ASAR package.json时遇NUL JSON，待定位真实原因。temp/release安装包均生成，检查12/13，仅 `resources/elevate.exe` 的ia32被全PE x64规则拒绝；两次隔离启动各9/9，appData实际在throwaway profile。源码步骤成功但cleanTree=false（生成native-module/index.js/index.d.ts），源码artifact尚未核验，不称完整通过。
- Mac40049346596：15/16，仅来源扫描两句 `const optional = pe + 24;` 和 `for (let i = 0; i < sectionCount; i++) {` 命中（池680175）。1286/1286及四组Electron通过，身份检查因失败跳过。
- 已核对GitHub digest与ZIP安全条目、仅安全解包日志/报告：Windows compile `b7916dd39555fa9212d5952a4d4f68b6a14dccb73fa00b409aea5b3386b79aad`；package报告 `069effc32b1e7a8f13b8ea25a42987dbf146f52925f63a3ae6e3ff9be2a3c48b`；Mac gates `e2007f410f4009295a7a4e5b630004ebdfd6417966e95a62fecdf898af0e35e4`。原始在取证目录windows-first、windows-first-package、mac-first-gates。没有执行下载二进制。
- 最小修正交原Claude `/private/tmp/margin-windows-wchdTl/fix-AG73-remote1.txt`，新报告 `result-AG73-remote1.txt`；root独立复验后才投影修正版。不得放宽必需原生绑定/来源守卫，失败SHA不原样重跑。

- Windows：https://github.com/xbz123/margin/actions/runs/40049343934 ，`package_apps=true`。
- Mac：https://github.com/xbz123/margin/actions/runs/40049346596 ，`no_cache=true`、`package_apps=false`。
- 每项仅触发一次，均确认目标为 `be029b94`。Windows首次真实运行temp/release的NSIS构建、包检查、隔离启动和对应源码包，仅上传报告及源码，不上传安装包；不是安装/卸载实测，也不是批准正式身份发布。
- 原始产物取证目录 `/private/tmp/margin-AG73-delivery-UrOWHt/`。完成后核对摘要、ZIP安全、源SHA、原生/安装包记录、测试计数、包/启动结果、源码清单及哈希；绿色状态本身不构成验收。
- 每5分钟检查 `ag-73-ci` 已恢复；无变化静默，完成/失败/需决定时通知。Windows实际产物目前未签收，Win10/11设备行为仍待实测。
