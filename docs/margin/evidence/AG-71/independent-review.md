# AG-71 修复后 Codex 独立复验

2026-10-23。基线 `db992097`，审阅未提交代码及全部新增代码文件。Claude 原会话已 done/idle 后才复跑。**结论：前轮两项 P2 关闭，本轮本地整改与验证通过；不等于 AG-71 Windows 目标平台或实机验收完成。** 没有发现新的本轮代码阻断项，AG-72/73 未放行。

## 关闭依据

- P2-1：六个 audio 测试改用 createRequire 加载编译后的 CommonJS 文件，断言保持不变，不再把盘符传入 ESM URL 解析。检查其余纳入 workflow 的加载方式，未见同类残留。Mac 复跑证明这些路径仍加载并执行；Windows实际加载仍待目标runner。
- P2-2：读取错误移到本轮最终drain之前。producer返回并释放ring写端后才经Mutex发布错误；DSP读到该错误再排空，排除“排空见空→最后push→发布错误→直接退出”造成的漏读。已完整转换/门控的帧先flush再报错；不足20ms的帧仍按原stop语义丢弃，不承诺送达。另修正producer同一轮读取错误前的样本未推入ring问题。
- 核对确定性交错与读错后保留样本的测试被生产路径实际调用；独立编译并运行两个旧行为变体，各exit101、各一条对应断言失败。原正确实现分别2/2、10/10。没有依赖仅靠线程调度概率的压力测试来关闭问题。
- workflow将原生导出加载的已知device替身记录单列为allow-blocked，其余音频/隔离测试仍严格。该方式与既有守卫自测一致；目标Windows结果未执行。

## 独立运行与原始证据

本轮日志 `/private/tmp/margin-AG71-review1-independent-iIlGUB/`：

- `node scripts/build-electron.js`：exit0，重新构建。
- `node scripts/margin/isolation/run-node.mjs --test scripts/margin/isolation/__tests__/windows-isolation.node.test.mjs 'electron/audio/__tests__/*.test.mjs'`：exit0、196/196、零skip/cancel（192音频＋4隔离）。
- `rustc --edition 2021 --test -D warnings` 分别编译capture_tail.rs、loopback.rs并运行：exit0、2/2和10/10，仅Mac纯函数执行。
- 两个旧行为变体独立编译并运行：exit101，失败点与原审阅一致，`old-order.log`、`old-discard.log`。生产文件未作变异。
- 隔离挂载 `--test-name-pattern='AG34 native launcher'`：1/1、exit0，`ag34-renderer.log`；合成凭据，不使用真实用户数据。
- `git diff --check`：通过。

复用并核对实现者同源完整门禁：`/private/tmp/margin-windows-wchdTl/gates-AG71-review1/rerun-full/summary.json`，16项exit0、allPassed=true，136文件1249/1249、零skip/cancel、无隔离阻断/不明退出；回答21/21、存储3/3、启动2/2、挂载17/17、来源0命中。源码指纹（tracked非docs差异＋排序后的untracked非docs正文）独立重算为 `157cf3adad035780c154ac1ea6621233d2f34d51924e860d30748e74d7af7a2d`，与门禁前记录一致；本次后续仅写文档，未再重跑同一全量。

首次完整门禁15/16的原始失败保留：AG34挂载遇到Playwright Execution context was destroyed；随后相同代码全量通过，本次该用例独立单跑也通过。涉及代码未由本票改动，按已有启动竞态记录，不宣称永久消除；再次复发应修fixture，不靠连续重跑掩盖。

## 尚未完成、不能扩大结论

- Windows runner尚未执行：MSVC真实链接、Node/Electron加载、Windows路径/隔离及原生行为仍无目标平台运行结果。
- Mac完整门禁使用旧的已验证原生二进制。新lib.rs及模块接线尚无Mac原生编译/运行证据；Windows/Linux跨目标cargo check含C环境存根，只能当类型检查。双平台原生构建证据在合并前仍需补齐。
- Win10/Win11真实音频、设备失效/切换、静音补零、共享和安装未测试。Win10最低build、Win10测试来源、Win11 build/共享组合以及通信默认输出角色的产品决定仍待确认；未发送草稿不作为批准。
- 本轮仅关闭两项整改及本地验证缺口，不提交、推送、远端CI、合并、安装或进入AG-72。下一步应单独确认目标平台CI与实机安排。
