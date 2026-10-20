# 生成入口显式注册验收（2026-10-20）

基线 `30ea5557`，Claude 实现，范围见 PLAN §8 同名条目。只改变注册方式，不改变生成行为。

## 改动

- `safeHandle` 只做注册，保留 `async (event, ...args) => listener(event, ...args)` 转发；删除按 9 个频道名判断是否包装的分支。
- 新增 `registerGenerationHandler`，内部经 `safeHandle` 注册；原生成包装整块移入，内容和顺序未改（`git diff --color-moved` 核对，包装体无差异行）。
- 9 个频道改为 `registerGenerationHandler` 注册，listener 不变：`generate-assist`、`submit-manual-question`、`generate-what-to-say`（多行写法）、`generate-clarify`、`generate-follow-up`、`generate-recap`、`generate-follow-up-questions`、`generate-code-hint`、`generate-brainstorm`。`SPEECH_ACTION_CHANNELS` 不变。
- `ipc-channel-check.mjs`、`IpcInvokeCoverage.test.mjs` 识别新函数名，无白名单；`sliceSafeHandleBlock` 结束边界同时识别两个函数名。

## 测试

`SpeechActions.test.mjs` 新增两条：

- 用 TypeScript AST 只统计实际注册调用，9 个频道各恰好一处，且为 `registerGenerationHandler`。
- `generate-assist` 经真实注册回调运行：替换 `IntelligenceManager.runAssistMode` 返回合成结果，断言只建一个任务、`rendererOwner` 为调用方、返回 `requestId` 对应该任务、`close()` 至少调用一次（记录后继续调用原实现）。不加生产钩子。

现有语音测试不变，继续经真实注册回调覆盖 7 个语音频道。

## 变异

把 `submit-manual-question` 临时改回 `safeHandle`，只运行 SpeechActions 与 IpcInvokeCoverage：新增的注册测试失败并指出该频道（72 通过、1 失败），其余通过。随后恢复到变异前的正确重构版本，SHA-256 `1a49b5bb…75b6` 与变异前一致。

## 门禁

针对性测试 77/77；频道检查 invoked 150、缺失 0。本地完整门禁 16/16，全部 exit 0：单元 134 个文件 1207/1207（零失败、零跳过，比上次多 2 条新增测试）、回答 21/21、存储 3/3、启动 2/2、挂载界面 14/14；来源检查无命中。原始日志留在本机任务目录，不随提交分发。

## 边界

状态只标为"生成入口显式注册完成"，不代表所有生成生命周期已统一；新入口若直接用 `safeHandle` 注册，仍会绕过包装。`gemini-chat-stream`、`generation:retry`、截图和引擎内部任务未动。未使用真实服务或设备，未安装、推送或触发远端 CI；Windows 仅静态审查，改动不涉及平台分支。
