# AG-71 原生音频与 Windows 验证基础

**最新结论（Codex，2026-10-23）**：两项P2已独立复验关闭，本地整改/验证通过；Windows runner及双平台新原生构建、实机验收未完成，AG-72不放行。见[独立复验](independent-review.md)。下文保留实现者各轮历史报告。

2026-10-23，Claude 会话 `68357856-1194-4334-b15d-76528cc6501e`，分支 `codex/windows-parity`（基线 `db992097`），未提交。原始日志在 `/private/tmp/margin-windows-wchdTl/`（`checks-AG71/`、`gates-AG71/`），完整报告 `result-AG71.txt`。本页只是摘要，**不是独立验收**。

## 调用链与缺口

WASAPI 回采（`native-module/src/speaker/windows.rs`）→ `lib.rs` 的 `SystemAudioCapture` DSP 线程（静音抑制、批量回调）→ `electron/audio/SystemAudioCapture.ts` → `MeetingAudioPipeline`（恢复、路由轮询）→ STT。麦克风走 CPAL（`microphone.rs`）→ `MicrophoneCapture` 同一管线。

| 缺口 | 处理 |
| --- | --- |
| 回采线程和设备枚举从不初始化 COM（wasapi crate 不代做），纯 Node 或未初始化线程会失败或枚举为空 | 每个线程用 `ComScope`：MTA，已是 STA 时沿用 |
| 每次事件只读一个包；`AUDCLNT_BUFFERFLAGS_SILENT` 被忽略 | 循环取完所有排队包；静音包按 0 处理 |
| 无声时回采不产生数据，Mac tap 则连续给 0；静音保活和 12 s 无数据看门狗因此失效或误报 | 空闲 100 ms 后按经过时间补 0（单次最多 1 s） |
| 停止要等 3 s 超时；读取出错时无限重试，端点失效后 JS 永远不知道 | 等待 100 ms；运行中出错结束线程，DSP 报错一次后退出，交由管线既有恢复 |
| JS 包装层在原生回调报错后只把 `isRecording` 设为 false，后续 `stop()/destroy()` 不再停原生，线程残留到 GC（Mac 同样存在） | 报错时走既有延迟 teardown；麦克风不对故障设备预热 |
| 隔离入口在 Windows 不改 `USERPROFILE/APPDATA/TEMP`，命令查找不认 `.exe`/PATHEXT（`curl` 可绕过） | 补 Windows 环境、Roaming 存储根和扩展名查找；Mac 分支不变 |
| AG-70 workflow 只编译 | 加入不需要设备的检查（未运行） |

不改的语义：默认设备仍只跟随多媒体/控制台角色，不自动跟随“通信”角色（需用户决定）；指定设备找不到时仍按原规则回退默认设备。

## 检查结果（本机 macOS arm64）

- Windows x64 MSVC `cargo check`（lib 与 `--tests`）：exit 0，0 警告；基线同样 0。使用 `/private/tmp` 下的官方 rust-std 1.98.1 sysroot；webrtc-vad 的 C 头和 `lib.exe` 用存根，只做类型检查，不产出可加载二进制。
- WASAPI 辅助模块单元测试 7/7；4 个变异（忽略静音标志、不封顶、不累积余数、信任帧数）均被测出。
- 新测试 `CaptureNativeErrorReleasesHandle` 修复前 4/4 失败，修复后 4/4 通过。Windows 隔离测试 4/4；去掉扩展名查找后 2 项失败。
- 本地门禁（跳过 4 个需要 Electron 二进制的步骤）：12 步中 11 步 exit 0，provenance 0 命中。`tests` 共 136 个文件 1249/1249 通过、0 失败，但被判失败：10 个文件在缺少 Electron 二进制时尝试 `Downloading Electron binary`，访问 github.com:443 被隔离拦截。属环境原因，与 `local-ci-9af26551/gates-first-failed` 相同。
- 全 crate 的 Mac `cargo test` 无法执行（`cidre` 需要 Xcode，D5）。Mac 原生模块精确复制自已验收工作树，sha256 `71f9cf8e…fb2603`。

## Codex 复验第 1 轮的修复（review-1，实现者自报）

Codex 复验（`/private/tmp/margin-AG71-review-0R2jO3/review.md`）结论为暂不通过，提出两项 P2。本节只记录实现者的修复与本机检查，**不是**复验通过。原始日志在 `checks-AG71-review1/`、`gates-AG71-review1/`，报告 `result-AG71-review1.txt`。第 1 轮的失败记录原样保留。

| 发现 | 修复 | 红 / 绿 |
| --- | --- | --- |
| P2-1：`import(path.join(...))` 在 Windows 盘符路径上报 `ERR_UNSUPPORTED_ESM_URL_SCHEME`；音频测试中共 6 个文件有此写法（本票新增 1 个，既有 5 个），都会被 Windows workflow 运行 | 改为 `createRequire(import.meta.url)` 按文件路径加载，断言不变。`pathToFileURL(...).href` 写法与受限后期上游同一文件的一行完全相同（只列出了文件名，未读取其内容），按逐行规则改用 createRequire | Windows 路径探针：旧写法报 `ERR_UNSUPPORTED_ESM_URL_SCHEME`，新写法进入文件查找（`MODULE_NOT_FOUND`）；受影响测试在 Mac 上 23/23 通过 |
| P2-2：DSP 先排空 ring 再读错误；若 producer 在两步之间推入最后一批并发布错误，这批样本会丢失。另发现生产端同类问题：同一轮先读到的包在后续读取失败时随 `?` 返回丢弃 | `capture_tail::failure_then_drain`：先读错误，再排空，然后过门控，最后 flush 并报错。producer 先 drop 再发布错误，构成 happens-before。`loopback::drain_packets`：读取失败时保留已读样本，先推入 ring 再返回错误。不足 20 ms 的尾帧与停止时一样丢弃、不补零，不承诺送达 | 确定性交错测试：旧顺序失败，新顺序通过；旧的“读错即丢弃”变体失败，新实现通过。线程压力测试在旧顺序下也通过（依赖时序），仅作补充 |
| 自查：第 1 轮 workflow 中 `native-exports` 加载原生模块，被守卫记为 device 替身，`run-node` 因此 exit 1 | 该文件单独以 `--allow-blocked` 运行，与 `guard-selftest` 门禁一致，其余测试保持严格 | 在 Mac 上复现两条命令：exit 0 / 1/1，exit 0 / 196/196 |

本机结果：

- 完整 16 步门禁第一次运行时 `outbound-renderer` 中 AG34 一项报 Playwright “Execution context was destroyed”，为 [PLAN](../../PLAN.md) 已记录的启动竞态，所涉代码本票未改动。原样完整重跑 **16/16 exit 0，`allPassed: true`**：单元测试 136 个文件 1249/1249、0 拦截；regression 21/21，storage 3/3，startup 2/2，outbound-renderer 17/17，guard-selftest 12/12，provenance 0 命中。两次运行的日志均保留。
- 本地依赖：Electron 43.1.0 取自本机缓存 zip，其 sha256 与 `electron/checksums.json` 一致，解压到本工作树自己的 `node_modules`。dev Info.plist 只做 setup:native 第 4 步的本地补丁。`better-sqlite3`、`keytar` 和 `native-module` 为 Mac 工作树文件的精确复制，sha256 一致。没有链接共享目录，没有运行完整 setup:native，没有重新编译。
- 原生代码：Windows x64 MSVC 与 Linux fallback 的跨目标 `cargo check`（lib 与 `--tests`）均 0 警告，C 头和归档器用存根，只做类型检查；`capture_tail` 2/2，`loopback` 10/10。门禁使用的是**未重编的**旧 Mac 原生模块（本机无 Xcode）。本票对 Mac 原生代码的改动（lib.rs 的读取顺序、mod.rs 的非 Windows 分支）只经过 Linux fallback 类型检查，没有 Mac 编译或运行证据。

## 未验证

- Windows runner：AG-70 尚未运行，Windows 上的原生编译、加载和测试均无结果。
- Win10/Win11 实机：没有任何真实回采、设备切换、拔出或静音补零的实测。Mac 上的 mock 不算 WASAPI 实测。

## Windows 10 下限建议

- 事件驱动的回采需要 Windows 10 1703 及以上（[Microsoft: Loopback Recording](https://learn.microsoft.com/en-us/windows/win32/coreaudio/loopback-recording)），这是代码的技术下限。
- Electron 支持 Windows 10 及以上（[Electron README](https://github.com/electron/electron/blob/main/README.md)）；Rust `x86_64-pc-windows-msvc` 支持 Windows 10+ 和 Server 2016+（[rustc platform support](https://doc.rust-lang.org/rustc/platform-support.html)）。
- Windows 10 Home/Pro 的最后版本是 22H2（build 19045），2025-10-14 结束支持（[Microsoft Lifecycle](https://learn.microsoft.com/en-us/lifecycle/products/windows-10-home-and-pro)）。
- 建议：承诺并测试 Windows 10 22H2（19045）和 Windows 11；1703 至 21H2 只作为技术下限，不承诺、不测试。最终由用户决定。
