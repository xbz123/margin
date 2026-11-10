# AG-73 独立验收：本地软件范围通过，Windows 产物待验

## 2026-10-24 首轮远端失败修正独立验收

已核对 `increment-remote1.patch`、实际 asar 3.4.1 写入/读取机制及 electron-builder CopyElevateHelper/NSIS UAC 消费者。修改仅三份公开文件：合成归档等待全部内容落盘；不打包当前无 updater 用途的 elevate 辅助程序；三条通用语句精确来源登记。没有改名避扫、排目录或放宽主程序/原生绑定 x64 检查；安装模式和UAC模板未改。

当前 Codex 经项目隔离入口独立复跑：受控慢写旧版 **7/9**、相同 NUL JSON 两失败；新版 **9/9**，正常相关四文件 **73/73**。证据 `/private/tmp/margin-AG73-independent-U2di7e/remote1-slow-red.log`、`remote1-slow-green.log`、`remote1-key-green.log`。27文件冻结指纹与当前一致，新原始完整门禁16/16、1286/1286、无阻断/异常退出已核对，同源结果不重复全量运行。

结论：三处修正可公开投影并跑新CI。真实Windows修正后结果仍待；首轮源码包 cleanTree=false 的生成绑定diff尚未核验，不能直接当作无害或完整对应源码验收通过。

## 2026-10-24 修正后独立复验

当前 Codex 核对 `increment-review1.patch` 全部增量及真实 electron-builder 消费者，关闭下面保留的 P1/P2。Windows 专用 `extraMetadata.name` 经真实 Packager/AppInfo/targetUtil 后将卸载删除及缓存限定到本身份；根包名、Mac、显示名/appId 和正式身份守卫未改变。必需3个 `.node` 各自必须为 x64 PE，不能靠其余 PE 的计数掩盖损坏文件。

- 独立探针 `package-review1-probe.test.mjs` **2/2**，日志 `/private/tmp/margin-AG73-independent-U2di7e/probe-review1-green.log`。使用修正后的有效包名并先断言正常包通过，再分别损坏3个绑定，每个只在 `required-native-x64` 失败；删除路径读实际生效配置，验证 temp/local 分离及 Mac 根包名未变。未伪造 CI 放开 release 身份。
- 受影响6文件独立复跑初次 **81/82**：仅已有 icons 的 iconutil 在外层沙箱报 Invalid Iconset。经授权在外层沙箱外、仍用项目隔离入口单独复跑 icons **4/4**，没有改代码或放宽守卫。日志 `review1-key-tests.log` 和 `review1-icons-escalated.log` 保留，不能声称首轮82/82。
- 27个冻结代码文件与当前指纹一致；原始修正门禁16/16、138文件1286/1286，无跳过/取消/隔离阻断/异常退出/未结束文件；四组Electron 21/3/2/17，来源0命中，均核对原始记录。7个Mac合成包的差分顺序/结果一致；同源证据复用，不额外全量重跑。

结论：本票已实施的本地代码/模拟验证范围无剩余阻断，可申请仅代码推送及Windows真实打包CI验证。**不是AG-73整票产物验收完成**：真实Windows NSIS/rcedit产物、安装/升级/卸载、Windows启动与源码包仍未执行；release身份仅静态检查。Windows测试身份、Win10最低build/实机来源、Win11组合仍待用户确认。未提交推送、远端CI、合并或安装。定时检查在本轮本地独立复验后结束。

## 第1轮未通过（保留红色证据）

2026-10-24，当前 Codex 审阅本票增量和直接消费者，未改生产代码。实现者门禁原始 summary 16/16、1285/1285、四组 Electron 21/3/2/17 已核对；26份冻结指纹与当前文件一致。独立隔离复跑 windowsPackage、licenseInventory、packagingTools **65/65**。这些通过未覆盖以下缺陷，不能签收。

## 阻断项

1. **P1 / Spec：NSIS 删除数据分支跨产品。** `package.json:2` 的 name 仍为 natively，当前 builder 配置没有 Windows 包内独立 metadata 覆盖。实际 `NsisTarget.js:170` 将 appInfo.name 转为 APP_PACKAGE_NAME，`uninstaller.nsh:221–243` 在显式 `--delete-app-data` 下（即使 deleteAppDataOnUninstall=false）删除该目录。当前 temp/Margin 包因此也会删除旧 `%APPDATA%\\Natively`。仅证明不同 appId 的 GUID 不同无法证明数据隔离。默认卸载不删，触发条件是显式参数；未实际运行任何卸载。应以最小 Windows 专用打包配置使所有删除目标归属于本身份，不能把旧产品数据安全问题留作用户选择；不改变 Mac、appId/displayName 或替用户决定测试身份。
2. **P2 / Standards+Spec：损坏必需原生绑定可以通过包检查。** `scripts/margin/package-check.cjs:240–253` 仅把识别为 PE 的文件计入 native，未知格式被跳过，而 required-files 只检查存在。将合成包 keytar.node 替换为零字节，native-x64/required-files/总结果全部仍为 true。应要求每个必需 .node 确实识别为 x64 PE，空/非PE/坏签名明确失败，保留现有错误架构/缺文件检查。

## 复现与范围

原始探针 `/private/tmp/margin-AG73-independent-U2di7e/package-review-probe.test.mjs` 复用现有合成包 fixture、调用真实 checkPackage 和安装依赖内 NSIS 名称函数。项目隔离入口运行 `--test --test-name-pattern=REVIEW` 两次，均 **0/2**；红日志 `probe-red.log`、`probe-red-repeat.log` 同目录。第二条是配置/实际模板静态消费证明，不是安装卸载实测；修复若采用 extraMetadata/模板覆盖，复验必须读取实际生效配置/生成目标，不机械坚持根 package.name 必须改动。

Windows runner、真实 NSIS 产物与安装/升级/卸载仍未验；本票未推送、未远端CI、未合并安装。测试包身份、Win10最低build/实机组合仍待用户答复。范围内两项最小修正交原 Claude 后再独立复验，原红证据保留。
