# Margin AGPL 重建：实验、验收与 Ticket 计划

状态：**草案第 2 版，待用户确认后执行**。实施暂停在阶段 0（`e0dc5b40`）。本版已并入 Codex（gpt-6-astra）的只读评审，采纳情况见第 9 节。

本文件是本分支的执行依据：实验、验收、ticket 和依赖都以这里为准。

- [BASELINE.md](BASELINE.md)：基线证据。
- [PROVENANCE.md](PROVENANCE.md)：来源规则与来源清单。
- [ADAPTATION.md](ADAPTATION.md)：功能对照，状态以本文件的 ticket 为准。
- 产品行为参考旧 Margin 的 `b8ade3f7:docs/fresh-release-implementation-plan.md`，只当需求清单用，不取代码。

## 1. 目标与非目标

**目标**：在 AGPL 基线 `a786910e` 上，按旧 Margin 已确认的产品行为重建 Margin。每处非基线代码都可追溯来源。交付源码和 Mac 本地包。

**非目标**：
- 不复制、不 cherry-pick 2026-06-01（IST）及以后公开的上游代码、测试、提示词或资源。
- 不恢复已退役的功能。
- 不做旧版数据迁移。
- 不创建 PR 或 GitHub Release。
- 不做 Developer ID 签名或 Apple 公证，但允许本地 ad hoc 签名。
- 不安装到 `/Applications`。

## 2. 已定决策

| # | 决策 | 来源 |
| --- | --- | --- |
| S1 | 走 AGPL 路线：整体作品按 AGPLv3 发布，不标 MIT | 用户，2026-10-07 |
| S2 | 基线为 `a786910e` | 用户，2026-10-07；证据见 BASELINE.md |
| S3 | 来源规则见 PROVENANCE.md | 用户初始任务 |
| S4 | 阶段顺序：0 记录 → 1 最小核心 → 2 身份与安全 → 3 回答 → 4 音频 → 5 上下文与会议 → 6 设置与发布资料 | 用户初始任务 |
| S5 | 提交推送到 `origin/codex/margin-agpl-migration`（私有仓库），不建 PR 或 Release | 用户，2026-10-07 |
| S6 | 退役以下功能，删除代码和入口，不只是隐藏：premium、natively-api、遥测、自动更新、RAG/embedding、Ollama、本地 STT 与模型下载、手机镜像、日历、cURL 模板、画像（Profile Intelligence）、premium 模式、动态动作、联网搜索、OCR、跟进邮件、捐赠与支持弹窗 | 用户初始任务；旧 Margin 计划第 1 节 |
| S7 | 应用身份为 `Margin` / `io.github.xbz123.margin`，数据目录 `~/Library/Application Support/Margin`；不读取旧 Natively 或 ai assistant 的数据 | 旧 Margin 计划第 2 节 |
| S8 | 测试不得读写真实用户数据或真实密钥，不得调用付费服务，不得采集真实会议 | 用户初始任务 |
| S9 | 阶段 1–2 不做实机验收：不授予屏幕录制或麦克风权限，不用真实 key，不访问真实钥匙串 | 由 S8 推出 |
| S10 | D2–D4 按第 3 节的建议执行；D1 由 X3 的结果决定 | 用户，2026-10-07 |

## 3. 待定决策

| # | 问题 | 阻塞范围 | 建议 |
| --- | --- | --- | --- |
| D1 | Electron 留在 33，还是升到旧 Margin 使用的 43 | 只阻塞 AG-17 的版本处理一步 | 按 X2 的结果定。判断依据是 Electron 的官方支持状态、原生依赖能否加载、运行有无回归；改动行数不作主要依据 |
| D2 | 真实服务和实机验收由谁做、何时授权：真实 API 调用、屏幕录制权限、系统截图对照 | 阶段 3 起的实机项 | 每项实机验收前单独请求授权 |
| D3 | Windows 的范围 | 平台分支代码 | 保留平台分支并保证能编译，不做 Windows 构建验收 |
| D4 | `package.json` 的 `license` 字段写 `AGPL-3.0-only` 还是 `AGPL-3.0-or-later` | AG-26 | 设计建议：`AGPL-3.0-only`。上游没有声明 "or later"，选 `-only` 不会扩大授权范围 |

## 4. 实验

每个实验都有时限。结论写回本节，再据此更新决策和 ticket。实验代码和记录只放在本节指明的位置。

### X1 来源审计辅助脚本

- **要回答的问题**：能否用脚本找出"本分支相对基线新增的行"中，出自 6 月后上游的部分？这个脚本的漏报边界在哪里？
- **方法**：新建 `scripts/margin/provenance-check.mjs`。
  - **受限池**：6 月后上游各 ref 中的"有效行"（去掉首尾空白后超过 12 个字符），减去批准来源中的有效行。
  - **批准来源**：固定为一个集合，写进 PROVENANCE.md：
    - `a786910e` 及其祖先；
    - free-cluely `0ba93eff`；
    - PROVENANCE.md 中逐项登记过的旧 Margin 提交和文件。
    - 不使用"任何 6 月前的提交"这种宽口径。
  - **比对对象**：本分支相对 `a786910e` 新增的有效行。
  - **输出**：命中的文件、行号和内容。
  - **白名单**：放在 PROVENANCE.md，每条写明理由。
  - **校准**：分母和去重方式与此前的统计保持一致，并写进脚本说明。用两组输入测试：
    - 旧 Margin 中已知的后期上游文件，用来确认能命中；
    - X1 期间手写的样例，用来测误报。
- **成功标准**：
  - 能稳定命中已知的后期上游内容；
  - 误报都能逐条解释；
  - 运行时间不超过 2 分钟；
  - 写清楚漏报边界：改写过的代码、12 字符以下的短行、二进制和图片资产都查不出来。
- **定位**：这个脚本只是审计辅助，不能证明有使用权。G2 还要求逐项来源审查，资产另行人工核对。
- **预算**：半天。
- **解锁**：G2。
- **结果（2026-10-07）：完成。**
  - **实现**：`scripts/margin/provenance-check.mjs`，配置在 `docs/margin/provenance-config.json`。
    - 批准池：`a786910e` 及其祖先中所有文本 blob 的有效行，共 128,299 个行键。
    - 受限池：所有 `refs/remotes/upstream/*` 和 `f326de04` 可达、但基线不可达的 blob 中的有效行，再减去批准池，共 587,141 个行键。
    - 缓存放在 `.margin-cache/`（不提交）。首次运行约 28 秒，之后使用缓存。
  - **校准**（以旧 Margin `b8ade3f7` 作为被检目标）：
    - 全部命中 157,496 行。其中非测试源码 68,443 行，与此前统计的约 6.9 万行"6 月后上游独有行"一致。
    - 已知的后期上游文件能稳定命中，例如 `turn-classifier.ts` 命中 1,542 行。
    - Margin 自写的文件命中很少：图标生成脚本 1 行，豆包 STT 23 行，基本都是通用写法。
    - 例外：`src/i18n.zh.ts` 有 94 行与受限上游相同，包括部分界面译文和提示词示例。迁移这个文件前必须逐行复核。
  - **误报**：以本分支新写的 704 行有效代码为样本，最初命中 32 行（每千行 46 行）。
    - 改为把通用写法单独归类：Node 内置模块或包的 import/require（不含相对路径）、`'use strict'`、空初始化、`process.argv.slice(2)`。这类命中单独列出，不再判为失败。
    - 剩余 7 行，逐条审查后加入白名单并写明理由。
    - 结果：每千行约 10 行误报。对旧 Margin，通用写法这一类只吸收了 0.8% 的命中，不影响检出能力。
  - **漏报边界**：
    - 查不出改写过的代码、12 个字符以下的行、二进制和图片资产（改动的二进制文件会单独列出，交人工核对）；
    - 查不出受限池之外的来源，比如不在本地对象库里的上游分支。

### X2 测试与启动的隔离

X2 只交付隔离工具和它们自己的自测程序（`scripts/margin/isolation/selftest/`），**不启动应用本身**。应用的首次启动由启动闸门 L0 控制，见下文。

- **要回答的问题**：能否让自动测试和启动冒烟在不外连、不读真实数据的条件下运行？不能完全覆盖的地方，承诺应缩小到什么程度？
- **要覆盖的层面**：
  - **Node 主进程**：拦截 `net`、`tls`、`http`、`https`、`fetch` 和 `ws` 的非回环连接。
  - **Chromium 渲染层**：用 `session.webRequest` 拦截非回环请求。基线里有一处证据：`src/lib/analytics/analytics.service.ts:123` 会动态加载 GA 脚本。
  - **子进程**：Codex CLI 在 `electron/services/CodexCliService.ts:198` 被拉起。测试时用替身可执行文件，并设一个临时的 `CODEX_HOME`。
  - **原生模块的 HTTP**：守卫覆盖不到 `native-module/src/license.rs:33`。这一层由启动闸门 L0 处理：在 AG-10 把它删掉之前，不启动应用。
- **要覆盖的环境**：
  - `HOME` 和 `--user-data-dir` 都指向临时目录。
  - 测试时禁用 dotenv：`electron/main.ts:6` 在非打包状态下会读 `.env`。
  - 日志路径：`electron/main.ts:69` 写到 Documents，HOME 改到临时目录后它也会随之落到临时目录。
  - 清除继承的凭据类环境变量。例如 `electron/main.ts:4848` 会回退读取 `GOOGLE_APPLICATION_CREDENTIALS`，以及各服务商的 `*_API_KEY`。
  - `safeStorage` 和设备访问换成替身，或者直接不触达。
- **方法**：
  - Node 部分用 `--import` 预加载守卫；
  - Electron 部分用测试专用的启动脚本；
  - 每一层都做一次"故意外连 → 必须失败"的自测。
- **成功标准**：
  - 每层的自测都能拦住外连；
  - 基线保留的测试在加守卫前后结果一致；
  - 覆盖不了的层面明确列出，相应地收窄 G4 的承诺。
- **预算**：一天。
- **解锁**：G4，以及启动闸门 L0 的第一个条件。

### 启动闸门 L0（应用首次启动的前提）

应用本身（`electron .`）在以下条件全部满足后才能第一次启动，包括 X3 的启动部分、AG-09 和任何启动冒烟：

1. X2 完成：隔离工具的自测全部通过。
2. AG-10 已合入：原生模块里的许可证网络代码已删除，这一层守卫覆盖不到。
3. AG-11、AG-12 已合入：启动时会发出的统计上报和更新检查已删除。否则这些请求会被守卫拦下、记作外连，冒烟无法判定通过与否。
4. 第 3 项中三张 ticket 的非启动检查都已通过。

这三张 ticket 不依赖启动来验收，见各自的"验证"项，所以不会形成循环依赖。L0 满足后，第一次启动就作为 X3 的启动部分执行，并记录在第 8 节。

### X3 运行时与工具链

- **要回答的问题**：
  1. 基线的 Rust 原生模块，以及 `better-sqlite3`、`keytar`、`sharp` 这几个原生依赖，能否在当前工具链上为 arm64 构建，并在 Electron 中加载？
  2. Electron 33 和 43 能否在 macOS 26 上、在 X2 的隔离下启动？
  3. 升到 43 需要改什么？
- **方法**：
  - 构建原生模块，重建原生依赖；
  - 在 X2 的启动脚本下分别启动 Electron 33 和 43，记录：就绪信号、观察时长、是否受控退出、主进程有无异常；
  - 升级在一次性的 worktree 里试，不合入。
- **分两部分做**：构建部分（原生模块的构建和加载，不启动应用）现在就可以做；启动部分要等 L0。
- **成功标准**：两个版本各自的构建、加载和启动结论都附命令与输出。
- **预算**：半天。
- **解锁**：D1、AG-17。

### X4 mock 回归通道

- **要回答的问题**：基线里，回答请求能指向本地 mock 服务的路径只有两条：cURL 自定义提供方，以及 Ollama（`electron/LLMHelper.ts:4601`）。两者都要退役。退役之后，回归测试怎么把回答请求打到本地 mock 服务？
- **方法**：比较两种做法。
  - **甲**：加一个只在开发构建中生效的测试覆盖项，把一个现有 SDK 客户端的 base URL 指向回环地址。打包构建里，这个开关必须无效，并且要有测试证明这一点。
  - **乙**：把阶段 3 的"OpenAI 兼容地址"用户设置提前做一个最小版。
  - 比较两者的改动量、对阶段 3 的影响，以及安全面。
- **成功标准**：选定一种做法，写成 AG-09 的接口契约。
- **预算**：半天。
- **解锁**：AG-09。
- **结论（2026-10-07）：选甲。**
  - **现状**：OpenAI 客户端在 `electron/LLMHelper.ts:206` 和 `:278` 两处创建，都不带 `baseURL`。DeepSeek（`:220`）已经在用 OpenAI SDK 加固定 `baseURL`，说明加一个 `baseURL` 参数的改动很小。
  - **甲的改动**：只有一个新函数加两处调用，约 15 行。
  - **乙的问题**：要新做设置界面、持久化、校验和 IPC，和阶段 3 的 AG-31（厂商预设加兼容地址）设计重叠，容易返工。
  - **契约**：
    - 新建 `electron/margin/devOverrides.ts`，导出 `devOpenAIBaseUrl(): string | undefined`。它读取环境变量 `MARGIN_DEV_OPENAI_BASE_URL`，只有同时满足两个条件才返回值，否则返回 `undefined`：
      1. `app.isPackaged === false`；
      2. 地址是 `http://127.0.0.1`、`http://localhost` 或 `http://[::1]` 开头。
    - 同一文件导出 `devScreenshotFixture(): string | undefined`。它读取 `MARGIN_DEV_SCREENSHOT_FIXTURE`，条件同上，并且文件必须真实存在。截图流程看到这个值时，直接返回该图片，不调用系统截图。
    - 单元测试覆盖：打包状态被忽略、非回环地址被忽略、正常情况生效。
    - AG-31 实现用户可配置的兼容地址后，再决定这些开关保留为测试专用还是删除。

### X5 重写量校准（阶段 3 开始时做）

AG-30 完成后，对比旧 Margin 中对应模块的行数和用时，用来重估阶段 3–6 的工作量。不阻塞阶段 1–2。

## 5. 验收

### 全局闸门（每个 ticket 合入前）

| # | 检查 | 方式 |
| --- | --- | --- |
| G1 | 构建与类型 | 先清空 `dist` 和 `dist-electron`，再运行 `npm run build:electron` 和 `npx vite build`，都要退出 0。原因：`scripts/build-electron.js` 不会清空输出目录，残留的旧文件会被打包。类型检查记录**诊断差异**：本 ticket 不得引入新的诊断。AG-17 之后，Electron 和渲染层的 `tsc` 都必须退出 0 |
| G2 | 来源 | X1 脚本对本 ticket 新增行的命中都已解释；引入的旧 Margin 代码或资源已在 PROVENANCE.md 登记（提交、路径、审查方式），并经过逐项审查 |
| G3 | 退役清单 | `scripts/margin/retired-check.mjs`（新建）按精确的路径、符号、主机和依赖规则检查。**规则逐步启用**：规则表 `docs/margin/retired-rules.json` 中每条规则都标明所属 ticket，只有已完成 ticket 的规则才参与检查，要求零命中。阶段出口用 `--all` 跑全部规则。检查范围是源码、构建配置和依赖树，不扫 `docs/margin`。不用宽泛的子串去查（如 `Pro`、`premium`） |
| G4 | 隔离 | 所有自动测试和启动冒烟都在 X2 的守卫下运行。覆盖不了的层面按 X2 结论写明 |
| G5 | 格式 | 提交前 `git diff --check` 无输出 |
| G6 | 测试 | 列出实际执行的测试清单、跳过项及原因。改动范围内留下的测试和新增测试都要通过；删掉的测试只能是随退役功能一起删的。注意：现在的 `npm test` 只跑 `electron/{services,llm,audio}/__tests__`（`package.json:25`），渲染层和工具函数的测试要单独列出 |
| G7 | 依赖 | 每张 ticket 删掉依赖后，同步更新 `package-lock.json`；`npm ci` 能成功 |

**行为证据优先**。基线里的 `MeetingPersistenceRace.test.mjs:18`、`CredentialStorage.test.mjs:14` 和 `ProviderGatewayPolicy.test.mjs:64` 只检查源码里的字符串，不能证明运行行为。它们保留，但不单独作为验收依据。各 ticket 要补上对应的行为检查。

G3 的初始规则如下，随 ticket 补充。写入规则表时按 ticket 归属：

- AG-10：许可证与付费类的符号和主机，premium、natively-api 相关路径，许可证专属的 Rust 依赖。
- AG-11：遥测和捐赠类。
- AG-12：`electron-updater`、`ReleaseNotesManager`、`electron/update`。
- AG-13：模式类符号。
- AG-14：RAG、`sqlite-vec`、Ollama 和端口 `11434`。
- AG-15：本地 STT 和模型类。
- AG-16：外围功能类。
- AG-17：仅剩余依赖。

- **依赖**：`electron-updater`、`sqlite-vec`、`sqlite-vec-darwin-arm64`、`sqlite-vec-darwin-x64`、`onnxruntime-node`、`@huggingface/transformers`、`tesseract.js`、`@tavily/core`、`three`、`@types/three`、`@google/stitch-sdk`、`qrcode`、`@types/qrcode`、`@bany/curl-to-json`。原生模块里只供许可证代码使用的 Rust 依赖，从 `native-module/Cargo.toml:19` 起核对。
- **主机**：`natively.software`、`api.natively.software`、`natively-api-production.up.railway.app`、`divine-sun-927d.natively.workers.dev`、`checkout.dodopayments.com`、`live.dodopayments.com`、`customer.dodopayments.com`、`api.gumroad.com`、`www.googletagmanager.com`、`buymeacoffee.com`、`ollama.com`、`app.tavily.com`，以及端口 `11434`。
- **符号**：
  - 许可证与付费：`LicenseManager`、`NativelyProSTT`、`KnowledgeOrchestrator`、`getHardwareId`、`validateDodoKey`（见 `native-module/index.d.ts:140,166`）、`VerifyGumroadTask`
  - RAG 与模式：`RAGManager`、`VectorStore`、`EmbeddingPipeline`、`ModeContextRetriever`、`ModeHybridRetriever`、`ModesManager`
  - Ollama、本地 STT、外围功能：`OllamaManager`、`OllamaBootstrap`、`LocalWhisperSTT`、`PhoneMirrorService`、`CalendarManager`、`DynamicActionEngine`、`OcrProviderManager`、`TavilySearchProvider`
  - 遥测、更新、捐赠：`ReleaseNotesManager`、`telemetryService`、`sendAnonymousInstallPing`、`InstallPingManager`、`DonationManager`
  - Tavily 相关的 IPC 通道名和设置字段，在 AG-16 开始时补全。
- **路径**：`.gitmodules`、`premium`、`natively-api`、`src/premium`、`electron/premium`、`electron/rag`、`electron/audio/whisper`、`electron/update`、`electron/services/telemetry`、`resources/models`、`scripts/download-models.js`、`scripts/ensure-sqlite-vec.js`、`eng.traineddata`

### 阶段 1 出口验收

阶段 1 的 ticket 全部完成，并满足以下各项：

1. **干净安装**：全新克隆后，依次运行 `npm ci` 和 AG-08 中审查过的 `npm run setup:native`。结束后没有模型文件，原生模块重建成功。同时确认 `package.json` 里已经没有模型下载脚本：这时可以评估是否撤掉 AG-08 的 `ignore-scripts`，结论记入 AG-17。
2. **构建与类型**：G1 全部满足，两个 `tsc` 都退出 0。
3. **退役清理**：G3 用 `--all` 跑全部规则，零命中。`git ls-tree HEAD` 里没有 `premium`、`natively-api` 和 `.gitmodules`。
4. **测试**：G6 列出的测试在 X2 守卫下全部通过。
5. **启动冒烟**（X2 环境）：
   - 主窗口和设置窗口打开，记录就绪状态和观察时长；
   - 受控退出；
   - 主进程没有未捕获异常；
   - 守卫记录到的外连为零。
6. **行为回归**：用 AG-09 的基座，在真实的 renderer、preload 和 IPC 上，用 mock 服务验证：
   - 文字提问能流式显示；
   - 取消后，迟到的流事件不会被显示；
   - 截图提问使用合成的截图替身，能把图片送进请求。
7. **会议存储**：在临时 SQLite 上完成保存、读取、重启后读取、删除，全部通过；不加载向量扩展。

### 阶段 2 出口验收

1. **身份**：打包产物 `Info.plist` 中，`CFBundleName` 和 `CFBundleDisplayName` 为 `Margin`，`CFBundleIdentifier` 为 `io.github.xbz123.margin`。
2. **数据隔离**：在合成 HOME 中预先放好 `Natively`、`natively`、`natively-local`、`ai assistant` 这几个目录。验证：
   - 用一个文件访问守卫证明，进程对这些目录**没有任何读写**（只看内容和 mtime 不变不够）；
   - 新版只创建 `Margin` 目录；
   - 重启后设置能恢复；
   - 凭据路径是在导入时就固定的（`electron/services/CredentialsManager.ts:10`），要证明名称和路径在这个模块加载之前已设定好。
3. **凭据**：用假的 `safeStorage` 测以下情形：
   - 加密不可用、加密失败、写入失败、重命名失败、解密失败；
   - 以上每种情形下，IPC、preload 和 UI 都不显示"保存成功"；
   - 已有的密文保持不变，重启后仍能恢复；
   - 解密失败后，内存被清空，之后的保存不会覆盖原有密文。
   - 背景：现在的实现会把错误吞掉（`CredentialsManager.ts:556`、`:621`），IPC 照样返回成功（`electron/ipcHandlers.ts:1227`）。
4. **日志**：
   - 文件、stdout、stderr 三个出口都要脱敏；
   - 错误对象和堆栈也要脱敏；
   - 用户内容（转写、提问）按 AG-23 定的规则处理；
   - 脱敏器加载失败时不能退回原文（`electron/main.ts:89`）；
   - 日志只写在 `Margin` 的数据目录下。
5. **出站**：
   - 出站地址清单测试通过；
   - 自动发起的请求只到用户已配置的服务商官方地址或用户填写的地址；
   - 数据权限拒绝时，即使目标是官方地址，也零请求；
   - 用户点击的外部链接与自动加载的资源分开统计。
6. **本地包**：
   - `publish` 为 `null`，构建配置和 CI 中没有上游发布目标；
   - 从干净的输出目录构建 arm64 的 `.app`，并做 ad hoc 签名；
   - 逐一检查 asar、`asar.unpacked` 和 `Resources`：没有模型文件、`sqlite-vec`、`onnx`、`premium`；
   - 所有原生库的架构正确；
   - `codesign --verify --deep --strict` 通过；
   - 只做启动冒烟，不安装。
7. **许可与声明**：
   - `LICENSE` 保持 AGPLv3；
   - `package.json` 的 `license` 字段按 D4 设定，lockfile 的元数据同步；
   - `NOTICE` 写明：Natively 版权、free-cluely 的署名并附 Apache-2.0 全文、Margin 的修改说明、第三方组件；
   - 第三方许可证文本随包提供，用户能在包内找到；
   - README 里没有未经核实的 MIT 授权说法。

## 6. Ticket

所有 ticket 都遵守第 5 节的全局闸门。

**热点文件**：`electron/main.ts`、`electron/ipcHandlers.ts`、`electron/preload.ts`、`electron/LLMHelper.ts`、`electron/IntelligenceEngine.ts`、`src/components/NativelyInterface.tsx`、`src/components/SettingsOverlay.tsx`、`src/App.tsx`、`src/types/electron.d.ts`、`package.json`、`package-lock.json`。阶段 1 的退役 ticket 几乎都要改这些文件，所以**全部串行**。

### 阶段 1

**AG-08 禁止安装脚本自动执行**

- **结果**：普通的 `npm ci` / `npm install` 不再自动执行任何安装脚本，包括本仓库的 `postinstall`（含 `download-models.js`）和所有依赖包的 install 脚本。真正需要的原生准备步骤收进一个审查过的命令 `npm run setup:native`，由人显式调用。
- **范围**：
  - 新建仓库根目录 `.npmrc`，写入 `ignore-scripts=true`；
  - 新建 `scripts/margin/setup-native.mjs`，只做三件事：下载 Electron 二进制、重建 Electron 用的原生依赖、构建 `native-module`。不下载模型，也不执行 `postinstall` 里的其他步骤；
  - 在 `package.json` 中加入 `setup:native` 脚本；
  - CI 的 `build-smoke.yml` 不用改：它只构建、不加载原生模块。它的 API smoke 任务由 AG-10 删除。
- **验证**：
  - 在临时克隆里运行 `npm ci`：没有任何 install 脚本执行；`resources/models` 下没有新增文件；Electron 二进制不存在。
  - 运行 `npm run setup:native`：成功，原生模块能够加载；仍然没有模型文件。
- **说明**：
  - `npm run <脚本>` 不受 `ignore-scripts` 影响，`npm test` 照常可用；但脚本的 pre/post 钩子不会执行。
  - 模型下载链路本身由 AG-15 删除。
  - AG-17 评估是否保留 `.npmrc`。

**AG-09 最小回答回归基座**

- **依赖**：X2、X4 和启动闸门 L0。也就是说，AG-09 排在 AG-10、AG-11、AG-12 之后。
- **结果**：在 X2 隔离下，从真实的 renderer 经 preload、IPC 到 mock 服务，跑通一个可重复的回归，覆盖：文字流式显示、取消、迟到事件、截图替身。
- **范围**：
  - 新建 `tests/margin/`；
  - X4 选定的 mock 接入方式（应用代码只改契约规定的最小部分）；
  - 新建 `scripts/margin/` 下的启动和测试脚本；
  - 新建一个 mock 服务，模拟 OpenAI 兼容的流式接口。
- **接口**：
  - mock 服务：本地回环端口，模拟一个兼容接口；能记录收到的请求次数和请求内容；能注入延迟和错误。
  - 测试开关的形式按 X4 结论定，并要证明它在打包构建里无效。
- **验证**：在 AG-12 之后的代码上首次运行，结果作为对照。AG-13 起的每张退役 ticket 都重跑这个回归。
- **停止条件**：如果 X4 的两种做法都不可行，交回决定。

**AG-10 移除 premium、natively-api 和许可证代码**

- **结果**：
  - 删除子模块和加载器；
  - 删除公共替身（stub）、导出和调用点（不只是让界面不显示）；
  - 删除所有 License、Pro、试用、广告、Natively API 的界面和通道；
  - 原生模块中删除许可证代码及其专属依赖。
- **范围**：
  - 删除：`.gitmodules` 及 `premium`、`natively-api` 两个 gitlink，`src/premium/`，`electron/premium/`，`src/components/trial/`，`NativelyApiSettings.tsx`，`NativelyProSettings.tsx`，`NativelyQuotaBanner.tsx`，`electron/audio/NativelyProSTT.ts`，`native-module/src/license.rs`，以及对应的测试。
  - 修改：热点文件、`native-module/src/lib.rs`、`index.d.ts`、`Cargo.toml`、`scripts/build-electron.js`（去掉 premium 入口）、`tsconfig.json` 的 include。
- **步骤**：
  1. 删除各模块；
  2. 按构建和类型错误逐处去掉调用点；
  3. 凡是依赖许可证判断的地方，一律保留免费版行为，不把 Pro 功能变成默认开启。
- **验证**：不需要启动应用。
  - G1：构建通过，没有新增的类型诊断；
  - G3：启用 AG-10 的规则，零命中；
  - 原生模块重新构建成功，并能在 X2 守卫下的 Node 进程中加载；
  - 涉及的单元测试在 X2 守卫下通过。
- **停止条件**：某项要保留的功能只有 Pro 分支的实现。

**AG-11 移除遥测、安装统计和捐赠提示**

- **结果**：主进程和渲染层都没有统计上报，没有捐赠提示和支持提示。
- **范围**：`electron/services/telemetry/`、`InstallPingManager`、`DonationManager`、`src/lib/analytics/`、`SupportToaster`，以及它们在热点文件中的调用点。
- **验证**：不需要启动应用。
  - G1；
  - G3：启用 AG-11 的规则，零命中；
  - 把应用源码里出现的主机地址列出来，确认不含统计类主机。
  - L0 之后的首次启动冒烟时，再确认守卫没有记录到统计请求。

**AG-12 移除自动更新与上游发布**

- **结果**：
  - 应用内不再检查更新；
  - `publish` 改为 `null`；
  - CI 里没有发布和签名流程；
  - 不再做 Developer ID 签名和公证。
- **范围**：
  - `electron/update/`、`UpdateModal`、`UpdateBanner`、`electron-updater`；
  - 删除 `.github/workflows/release-macos.yml`；
  - `build-smoke.yml` 中去掉 Natively API 测试那一步；
  - `electron-builder.signed.cjs`、`scripts/notarize.js`、`staple-with-retry.js`、`afterAllArtifactBuild.cjs`；
  - `docs/RELEASE.md`。
  - `ad-hoc-sign.js` 保留。
- **验证**：不需要启动应用。
  - G1；
  - G3：启用 AG-12 的规则，零命中；
  - 确认 `build.publish` 为 `null`；
  - 确认 `.github/workflows` 下不再有发布步骤。

**AG-13 去除模式系统，接好保留路径**

- **结果**：
  - 普通回答和会议摘要不再依赖 `ModesManager`；
  - 启动时不再写入预置模式（`electron/main.ts:4821`）；
  - 模式相关的设置、通道和数据表全部删除。
- **背景**：
  - `ModesManager` 构造 `ModeContextRetriever`（`electron/services/ModesManager.ts:181`），而后者导入了 RAG（`electron/services/ModeContextRetriever.ts:3`），所以必须先于 AG-14 去掉模式。
  - 回答提示词里注入了模式（`electron/LLMHelper.ts:3310`），会议摘要也用到了模式（`electron/MeetingPersistence.ts:190`）。
- **步骤**：
  1. 先验证现有的"跳过模式注入"路径（`LLMHelper.ts:3308`）能否承接普通回答；
  2. 会议摘要改用固定的默认小节；
  3. 删除模式代码和对应的表。
- **验证**：AG-09 回归通过；用临时 SQLite 做会议保存和摘要的行为测试（摘要用 mock 服务）。
- **停止条件**：普通回答的质量明显依赖某个模式提示词（需要由用户决定是否保留默认提示词）。

**AG-14 移除 RAG、向量库和 Ollama**

- **结果**：
  - 数据库不加载 `sqlite-vec`；
  - 不创建向量表和 `chunks` 表（`electron/db/DatabaseManager.ts:166`）；
  - 会议、转写、AI 交互这几张普通表（`:1021`）不受影响；
  - 不再有 Ollama 的探测、启动或保活。
- **范围**：
  - 删除：`electron/rag/`、`OllamaManager`、`OllamaBootstrap`、`scripts/VectorStoreRebuild.js`、`ensure-sqlite-vec.js`、相关测试，以及 `DatabaseManager` 中的向量部分。
  - 修改：热点文件。
- **验证**：G3；临时 SQLite 的保存、读取、重启、删除行为测试通过；守卫记录到对 `11434` 端口零请求。

**AG-15 移除本地 STT 和模型下载**

- **结果**：
  - 只剩云端 STT；
  - 安装和打包都不涉及任何模型；
  - 依赖树里没有 `onnxruntime` 和 `transformers`。
- **范围**：
  - `electron/audio/whisper/`、`LocalWhisperSTT.ts`、`LocalWhisperModelPanel.tsx`；
  - `scripts/download-models.js`、`resources/models/`；
  - `package.json` 中的 `postinstall`、`asarUnpack`、`extraResources`；
  - `docs/LOCAL_STT_NATIVELY_SETUP.md`；
  - 相关测试。
- **验证**：G3；`npm ci` 后没有模型文件；`npm ls onnxruntime-node` 为空。

**AG-16 移除外围功能**

- **结果**：删除手机镜像、日历、cURL 提供方、画像、动态动作、联网搜索（Tavily）、OCR（含 `eng.traineddata`）、跟进邮件。
- **背景**：`IntelligenceEngine` 不能整体删除。它同时持有要删除的 `DynamicActionEngine`（`electron/IntelligenceEngine.ts:14`）和要保留的回答、上下文压缩用到的 LLM（`:158`）。
- **范围**：上述功能对应的服务、组件、设置页、IPC 和测试。截图、`ImageOptimizer` 和视觉回答保留。
- **步骤**：
  1. 盘点并补全 G3 中联网搜索和 OCR 的规则；
  2. 逐项删除，可以分多个提交。
- **验证**：G3 全量；AG-09 回归通过。
- **说明**：cURL 提供方删除后，到阶段 3 之前，用户不能配置自定义地址。这一点与旧 Margin 的目标一致，因为兼容地址会在阶段 3 加回来。

**AG-17 依赖、类型和测试收口**

- **结果**：满足阶段 1 出口验收。
- **步骤**：
  1. 修完 Electron 的类型错误，两个 `tsc` 都退出 0；
  2. 按 D1 处理 Electron 版本；
  3. 精简测试脚本，让 G6 的清单可以直接运行；
  4. 补齐阶段 1 出口验收中第 5、7 条要求的行为测试；
  5. 跑完整的出口验收。
- **复核**：由 Astra 只读复核，见第 7 节。

### 阶段 2

**AG-20 应用身份与数据目录**

- **结果**：满足阶段 2 出口验收第 1、2 条。
- **范围**：
  - `package.json` 的 `build` 字段；
  - `electron/main.ts` 的启动部分（`setName`、`userData`、日志路径）。这里必须在任何存储或凭据模块加载之前完成。
  - 托盘提示、伪装（disguise）恢复名、窗口标题、logo 的 alt 文本，以及界面上能看到的 "Natively" 字样。
  - 内部类名和环境变量前缀不改。
- **验证**：启动顺序测试；合成 HOME 加文件访问守卫的测试。`Info.plist` 与 AG-25 一起验证。

**AG-21 图标**

- **结果**：应用、托盘和界面中使用 Margin 的双线图标。
- **范围**：
  - 引入旧 Margin `cbb92b8a` 的 `scripts/icons/*.svg` 和 `generate.mjs`（自写，引入前再审查一次）；
  - 生成 `assets/margin.icns` 等图标文件；
  - 在 PROVENANCE.md 中登记；
  - 删除旧的 Natively 图标资源。

**AG-22 凭据保存失败的处理**

- **结果**：满足阶段 2 出口验收第 3 条。
- **范围**：`CredentialsManager.ts`、`ipcHandlers.ts` 中凭据相关的 handler、`preload.ts` 的返回契约、设置界面的提示。
- **接口**：保存类 IPC 统一返回 `{ ok: true } | { ok: false, code: 'encryption_unavailable' | 'write_failed' | 'decrypt_failed', message }`。所有调用方都必须处理 `ok: false`。
- **停止条件**：如果拒绝明文回退会让某项保留功能无法使用，交回决定。

**AG-23 日志出口全面脱敏**

- **结果**：满足阶段 2 出口验收第 4 条。
- **范围**：
  - `electron/main.ts` 的日志包装（`:89`、`:351` 附近）；
  - `electron/utils/redactForLog`、`verboseLog.ts`；
  - `RedactForLog`、`SensitiveLogRedaction`、`SttApiKeyRedaction` 三组测试。
  - 本票要定下用户内容（转写、提问、回答）在日志里的规则。默认建议：不记录内容，只记录长度和类型。

**AG-24 出站边界**

- **结果**：满足阶段 2 出口验收第 5 条。
- **范围**：
  - 列出所有出站入口：各服务商 SDK、`fetch`、STT 的 WebSocket、渲染层资源加载、`shell.openExternal`、Codex CLI 子进程；
  - `SsrfProtection` 和 `ProviderGatewayPolicy` 两组测试改为在 mock 服务上做行为验证；
  - 新建出站地址清单测试。
- **说明**：基线的 Codex 是启动 CLI 子进程来生成回答（`CodexCliService.ts:312`），不是目标里的只读直连方式。在 AG-34 之前，Codex 不算已达标的保留功能，也不进入安全冒烟。

**AG-25 本地构建与打包**

- **结果**：满足阶段 2 出口验收第 6 条，产出 `release/mac-arm64/Margin.app`。
- **范围**：
  - `package.json` 的 `build` 字段和 `scripts`；
  - 新建 `scripts/build-local.cjs`：清空输出目录 → 构建 → arm64 打包 → ad hoc 签名 → 检查包内容；
  - `ad-hoc-sign.js`。
- **复核**：阶段 2 出口由本票负责联合验收，再由 Astra 只读复核。

**AG-26 许可证、声明和文档**

- **结果**：满足阶段 2 出口验收第 7 条。
- **范围**：
  - 修改：`package.json` 的 `license` 字段，`README.md`、`PRIVACY.md`、`SECURITY.md`、`CONTRIBUTING.md`。
  - 新建：`NOTICE`、`licenses/` 目录（Apache-2.0 全文和第三方许可证），并让这些文件随包分发。
  - 删除以下文件：`AUDIO_RELIABILITY_REPORT.md`、`AUDIT.md`、`CROSS_PLATFORM_AUDIT.md`、`CROSS_PLATFORM_REVIEW.md`、`QA_REPORT.md`、`QAautomationprompt.md`、`TOFIX.MD`、`apple-signing-report.md`、`changes.md`、`cluelyresearch.md`、`comparisonreport.md`、`fixreport.md`、`promptfix.md`、`report.md`、`tinypromptsreport.md`、`visionpipelineresearch.md`、`visionupgrade.md`、`refund.md`、`termsandcondition.md`、`ROADMAP.md`、`.mcp.json`。
  - `CHANGELOG.md` 保留，作为上游历史。
  - 文档只写已经实现的功能。

### 阶段 3–6（概要，X5 之后细化）

| ID | 内容 | 依赖 |
| --- | --- | --- |
| AG-30 | 统一的生成入口，先接 Gemini 一个协议；同时做 X5 校准 | 阶段 2 |
| AG-31 | OpenAI Chat、OpenAI Responses、Anthropic Messages 三个协议，厂商预设，用户可填兼容地址 | AG-30 |
| AG-32 | 重试、时限、备用模型、错误显示 | AG-30 |
| AG-33 | 截图和文字提问、笔试模式、流式显示与取消 | AG-31、AG-32 |
| AG-34 | Codex CLI 只读凭据来源（替换基线里的子进程生成方式） | AG-30 |
| AG-40 | 双路音频与会话生命周期（开始、停止、尾段排空） | 阶段 2 |
| AG-41 | 收窄云端 STT 的选择范围；未配置时阻止开始 | AG-40 |
| AG-42 | 手动回答 | AG-33、AG-41 |
| AG-43 | 自动回答与 Gemini Flash-Lite 双语 Judge | AG-42 |
| AG-50 | Local Context 全文与预热 | AG-33 |
| AG-51 | 提示词类 Skills | AG-33 |
| AG-52 | 会议记录：会前设置、增量保存、摘要、失败恢复 | AG-41、AG-32 |
| AG-60 | 设置页重组、中英双语界面 | AG-33、AG-43、AG-52 |
| AG-61 | 窗口保护、快捷键、鼠标穿透、伪装（实机部分需 D2 授权） | 阶段 2 |
| AG-62 | 首次启动引导；README 和 PRIVACY 最终版；Mac 包 | 全部 |

## 7. 依赖与并行

| 现在可开始 | 可以并行 | 等待什么 |
| --- | --- | --- |
| X1、X2、X4 | 三者写入的文件不重叠：X1 写 `scripts/margin/provenance-check.mjs`；X2 写 `scripts/margin/isolation/`；X4 只做比较和记录 | — |
| AG-08 | 只改 `.npmrc`、`package.json` 的 scripts、`scripts/margin/setup-native.mjs` 和 CI，和 X1、X2、X4 不冲突 | — |
| X3 的构建部分（不启动应用） | 在 AG-08 的 `setup:native` 上执行；升级 Electron 的尝试只在一次性 worktree 里做 | 启动部分要等 L0 |

**依赖图**（不存在循环）：

```
X2 ─────────────┐
AG-08 → AG-10 → AG-11 → AG-12 ─┴→ L0 → X3 启动部分
                                   L0 + X4 → AG-09 → AG-13 → AG-14 → AG-15 → AG-16 → AG-17 → 阶段 1 出口 → Astra 复核 → 阶段 2
X1 → G2（AG-10 起每张 ticket 都要过）
```

**阶段 1**：

- AG-08 → AG-10 → AG-11 → AG-12 → AG-09 → AG-13 → AG-14 → AG-15 → AG-16 → AG-17，严格串行，因为都要改热点文件和 lockfile。
- AG-10、AG-11、AG-12 的验收不需要启动应用，所以它们不依赖 AG-09。
- AG-09 依赖 L0 和 X4。
- AG-13 必须排在 AG-14 之前，因为模式代码依赖 RAG。
- AG-17 中处理 Electron 版本的那一步要等 X3 和 D1。

**阶段 2**：阶段 1 的出口验收通过、Astra 只读复核完成后才开始。

阶段 2 内部的顺序：

- AG-20 先做。
- AG-21 和 AG-26 只改图标资源和文档，可以和 AG-20 并行。两者都会改 `package.json`，留给 AG-25 合并。
- AG-22 和 AG-23 在 AG-20 之后可以并行。`main.ts` 的日志段归 AG-23，凭据相关的 handler 归 AG-22。
- AG-24 在 AG-22、AG-23 之后做，因为会碰到相同的服务文件。
- AG-25 最后做，并负责阶段 2 的联合验收。

**验证职责**：

| 谁 | 做什么 |
| --- | --- |
| 实现者 | 跑 G1–G7 和本 ticket 的检查 |
| 主线程（Claude） | AG-09 就绪后，每张 ticket 集成后跑 AG-09 回归；阶段末跑出口验收 |
| Codex（gpt-6-astra） | 阶段出口时只读复核：读 diff，逐条核对出口验收，只报告不改代码；对来源有疑问的引入项做抽查 |

真实服务和实机验收要等 D2 授权。

## 8. 执行与恢复记录

| ID | 状态 | 提交 | 证据与未验证项 |
| --- | --- | --- | --- |
| 阶段 0 | 完成 | `e0dc5b40` | BASELINE、PROVENANCE、ADAPTATION |
| 计划评审 | 完成 | `f76fba39` | Astra 只读评审，见第 9 节 |
| 计划修订 | 完成 | — | 按用户 2026-10-07 的要求修订：<br>(1) 加入启动闸门 L0，解开 AG-09、AG-10 与 X2 之间的循环；<br>(2) G3 规则逐步启用；<br>(3) 新增 AG-08；<br>(4) BASELINE.md 改为明确写出证据的不确定性，基线不变 |
| 事件记录 | 已处理 | — | 两次运行超出了隔离边界，现已修复，详见下文 |
| X1–X4 | 待开始 | | |
| AG-09–17 | 待开始 | | |
| AG-20–26 | 待开始 | | |

### 事件记录（2026-10-07）

1. **X2 第一版自测写入了真实目录。**
   - **经过**：macOS 版 Electron 从系统账户而不是 `$HOME` 解析 `appData`，所以只改 `HOME` 拦不住。X2 第一版的 Electron 自测（`selftest/electron-main.cjs`，不是应用本身）把 Chromium 的缓存、Cookie 和会话存储写进了真实的 `~/Library/Application Support/Electron`，修改时间为 01:57:49。
   - **影响**：这个目录 9 月 27 日就已存在，是本机 Electron 开发运行共用的默认配置目录，里面没有 Margin 或 Natively 的用户数据。目录未删除，保持原样。
   - **修复**：守卫在应用第一次加载 `electron` 模块时，就把 `appData`、`userData`、`documents` 等全部路径改到沙盒内。启动脚本在运行前后检查一组真实目录的快照，任何变化都判为失败。
   - **复验**：再次运行后，真实目录的修改时间没有变化，配置文件落在沙盒内。
2. **基线测试曾在未加守卫的状态下运行了一部分。**
   - **经过**：在修订指令到达前，启动了一次未加守卫的基线测试运行，用的是真实 `HOME`。共产出 397 个测试结果后被手动停止。
   - **核查**：输出里没有外网错误。`~/.codex/auth.json` 的修改时间仍是 10 月 6 日，没有被改动。
   - **未能证明**：这不能证明这段时间内没有发生外连。
   - **之后**：所有测试只在守卫下运行。

**下一步**：完成 X2 的测试对比和 X3 的构建部分，然后提交；接着按依赖图从 AG-08 开始执行阶段 1。

## 9. 评审记录

**2026-10-07，Codex gpt-6-astra，只读模式**。结论：阶段划分合理，S1–S8 不需要重开；有几处验收会出现"检查通过，但目标没有达成"。主线程抽查了以下引用，确认属实：`ModeContextRetriever.ts:3`、`LLMHelper.ts:3304-3314`、`MeetingPersistence.ts:190`、`CredentialsManager.ts:556`、`main.ts:6/69/89/351/4821`、`scripts/build-electron.js:41`、`package.json:157`、`native-module/index.d.ts`。

已采纳：

1. 隔离实验（X2）排在任何应用启动之前，并覆盖渲染层、子进程、原生模块、dotenv、Documents 日志和环境变量凭据。
2. 新增 AG-13"去除模式系统"，排在删除 RAG 之前。
3. 凭据处理改为覆盖失败传播：manager、IPC、preload 和 UI 都要正确处理，并防止覆盖已有密文。
4. 用行为测试替代只查源码字符串的测试作为验收依据。
5. 数据隔离要证明"没有读取"，并加入 `ai assistant` 目录。
6. 日志的所有出口都要脱敏，脱敏器加载失败时不能退回原文。
7. 打包从干净的输出目录开始，并逐一检查 asar、`asar.unpacked` 和 `Resources`。
8. 许可证元数据和完整许可证文本都要随包提供。
9. 补全 G3 的规则，并改用精确匹配。
10. 每张 ticket 各自维护 lockfile。
11. 统一签名的说法：不做 Developer ID 签名和公证，允许 ad hoc 签名。
12. AG-26 的删除范围改为明确的文件清单。
13. Electron 版本的选择不以改动行数为主要依据。

本轮新增：X4 mock 回归通道。退役之后，基线里没有任何能把回答请求打到本地 mock 服务的路径。这是主线程核对时发现的。
