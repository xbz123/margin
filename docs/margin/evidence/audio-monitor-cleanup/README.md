# 音频监测清理接口重构（2026-10-18）

基线 `7217c23c`，分支 `codex/margin-agpl-migration`，本地验收通过。对应 [审阅 2026-10-15 第 3 项](../../REVIEW-2026-10-15.md)。这是接口重构，不是已复现缺陷的修复；停止、设备切换、初始化中止原本都经 `MeetingAudioPipeline.destroy`。

## 改动

- `electron/audio/MeetingAudioPipeline.ts`：`monitorCapture?(capture, channel): () => void`。`wire` 在回调存在时把返回的清理函数存入 `WeakMap<Capture, () => void>`；`destroy` 同步取出并删除该实例的清理函数，在 `try` 中调用，`finally` 中 `await capture.destroy()`，错误传播不变。
- `electron/main.ts`：`wireSystemCapture`、`wireMicCapture` 返回既有 `disarmStuckWatchdog`；`monitorCapture` 两个分支显式 `return`；删除两处 `__disarmStuckWatchdog`。`stop` 监听、阈值、平台分支和防误报判断未改。
- `electron/audio/__tests__/StuckWatchdogDisarmOnEndAndAbort.test.mjs`：从 `main.ts` 编译生产 `monitorCapture` 回调及两个 wire 方法；覆盖停止、重复停止、设备替换、替换等待权限时中止，逐实例断言“清理一次且先于自身 native destroy”，另测清理抛错仍 destroy 并报错、无回调正常释放。
- `electron/services/__tests__/StuckWatchdogTwelveSeconds.test.mjs`：签名正则从 `: void {` 改为 `: () => void {`（该测试直接按返回类型定位方法体）。

## 验证

| 项 | 结果 | 证据 |
| --- | --- | --- |
| 目标测试 + 相关回归（`electron/audio/__tests__/**`、StuckWatchdogTwelveSeconds、ZerofillDetectorPeakToPeak） | 203/203，exit 0 | `checks/related-tests.log` |
| `tsc -p electron/tsconfig.json --noEmit` | exit 0，无诊断 | `checks/tsc-electron.log` |
| 完整本地 gates（temp 身份，`--ref S45/native-quit/final-gates`） | 16/16；单元 1199/1199，回答 21/21，存储 3/3，启动 2/2，renderer 14/14 | `gates/summary.json` |
| 内存变异（磁盘文件不改，前后 sha256 一致） | 对照通过；9 个变异全部失败 | `mutations/summary.txt` |

变异通过预加载在测试读取源码时替换文本（`mutations/harness/`），覆盖：`monitorCapture` 任一分支去掉 `return`（M1/M2；M1 去掉后落入系统分支，给麦克风多挂一个看门狗）、任一 wire 方法不返回（M3/M4）、destroy 不调用清理（M5）、wire 不保存清理（M6）、单槽位代替按实例保存（M7）、清理放到 destroy 之后（M8）、去掉 try/finally（M9）。

## 未验证

只在 macOS 用合成数据和假 capture 运行；未接触真实设备、权限、钥匙串或模型服务。Windows 仅静态审阅（改动不涉及平台分支），未编译、未运行。fake native destroy 立即完成；延迟 destroy 由“清理在调用 destroy 前同步执行”的顺序断言间接覆盖，未单独构造。未推送、未安装、未触发 CI。

## 独立验收（2026-10-18）

Claude 已实际调用 Codex CLI 汇报，但指定模型不受该 CLI 账户支持，退出码 1，未生成接收回执。用户随后明确授权当前 Codex 对话独立验收，不把失败调用当成审查通过。

独立核对生产 diff、全部监测回调消费者、清理实例归属、同步清理先于 destroy、异常释放、测试与门禁原始记录后，无阻断发现。直接受影响的 TwelveSeconds 签名正则修改属于范围内适配。变异日志的 `applied 0 of 1` 中 `0` 是已应用变异的索引，不是零次命中；harness 会对未命中退出 3。

独立运行 `node scripts/margin/isolation/run-node.mjs --test electron/audio/__tests__/StuckWatchdogDisarmOnEndAndAbort.test.mjs electron/services/__tests__/StuckWatchdogTwelveSeconds.test.mjs electron/services/__tests__/ZerofillDetectorPeakToPeak.test.mjs`：22/22，exit 0。`git diff --check`：exit 0。完整门禁复用上述未变化代码的 16/16 证据，不重复启动应用。原始 checks、gates、mutations 日志留在本机，不随本次提交分发。
