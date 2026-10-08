# Margin AGPL 重建：实验、验收与 Ticket 计划

状态：**阶段 2 部分完成；AG-20–24 实现及本地/CI 门禁通过，S17 不分发包清单诊断已完成；回到 AG-26 按实包补齐许可，完整 AG-25 打包验收和 Claude 只读复查仍待完成**。已确认决策见第 2 节；当前验收及复查记录见第 8、9 节。最初的草案状态已由后续用户决策和执行记录替代。

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
| S7 | 应用身份为 `Margin` / `io.github.xbz123.margin`，数据目录 `~/Library/Application Support/Margin`；不读取旧 Natively 或 ai assistant 的数据。开发和测试期间用临时身份，见 S15 | 旧 Margin 计划第 2 节 |
| S8 | 测试不得读写真实用户数据或真实密钥，不得调用付费服务，不得采集真实会议 | 用户初始任务 |
| S9 | 阶段 1–2 不做实机验收：不授予屏幕录制或麦克风权限，不用真实 key，不访问真实钥匙串 | 由 S8 推出 |
| S10 | D2–D4 按第 3 节的建议执行；D1 由 X3 的结果决定 | 用户，2026-10-07 |
| S11 | D5 定案：本机不装 Xcode。<br>1. 阶段 1 出口第 1 条（干净安装）以 CI 为准：装有 Xcode 的干净 macOS 上执行 `npm ci` → `setup:native` → 全部门禁。证据必须是当前提交上一次不使用缓存的运行，日志里能看到 `Compiling cidre`，且门禁全部通过。<br>2. 原生模块在 CI 上从零编译，作为 workflow 产物保存（不是 Release，不发布）。本机开发下载这个产物使用，不再依赖 X3 复制来的旧 cargo 缓存。<br>3. AG-25 的打包改为在 CI 上进行，产出 workflow 产物；本机只验证下载下来的 `Margin.app`（开发期按 S15 只启动临时身份的变体）。<br>4. 进入阶段 2 的条件：Astra 复查通过，且第 1 条有不使用缓存的 CI 证据。决定 1 当时仍等用户，同日已定案（S12）。<br>5. 过渡（AG-25 的下载脚本完成之前）：本机继续使用现有的原生模块（由 X3 复制来的 cargo 缓存构建），不再为原生模块运行 `setup:native`；本机门禁照常使用这个模块。CI 产物是唯一的从零构建证据；AG-25 之后改为下载 CI 产物并核对 sha256 | 用户，2026-10-08（在另一个会话中做出，由该会话转达） |
| S12 | 决定 1 定案：默认回答提示词（`DEFAULT_ANSWER_PROMPT_SUFFIX`，`electron/llm/prompts.ts`）暂时保留。阶段 3 能用真实模型评估时（按 D2 授权）再决定是否删除，评估放在 AG-33。按决定 1 暂留的其他提示词文字（`prompts.ts` 中 Profile Intelligence 的描述、`tinyPrompts.ts` 中关于本地模型的一句）一并留到那时处理 | 用户，2026-10-08 |
| S13 | 阶段 2 的启动条件（第 7 节）已满足。"阶段 1 出口的 Astra 只读复查通过"按以下两项视为满足：Astra 对第八轮修复源码的只读审查没有未处理的发现（`AG-17-review8/checks/source-review.md`，所审差异的指纹与 `c43b10e9` 一致）；Claude 第九轮独立验收通过（`AG-17-review9/`）。出口第 1 条的 CI 证据为 `37709440574` | 用户，2026-10-08 |
| S14 | 分工：第八轮复查起，复查发现的问题由 Codex 修复；阶段 2 起，ticket 由 Codex 派发 `gpt-6.1-sol` 执行。Claude 只读复查，不改代码（用户明确要求时只改文档） | 用户，2026-10-08 |
| S15 | 开发和测试期间应用名用临时名 `temp`，不用正式身份 `Margin`，避免与本机已安装的 Margin 冲突。细则见下 | 用户，2026-10-08 |
| S16 | Google STT 仅接受经过校验的 `service_account` JSON，明确拒绝其他凭据类型。校验必需字段，并通过显式凭据/项目配置避免通用凭据分派、ADC、gcloud 和 metadata 猜测；认证与请求的出站边界仍需行为验证。用户已同意这一兼容范围收窄，不作为授权读取真实凭据或调用真实服务 | 用户，2026-10-08，本会话明确回复“同意” |
| S17 | 同意提前做 AG-25 的不分发 CI 包清单核对，再按实际包含的组件补齐许可。CI 诊断只保存清单和文本日志，不上传或分发应用包；常规许可门禁保持失败即拒绝。为 CI 检出一致源码使用诊断检查点提交，不把检查点或诊断成功记为 AG-26、AG-25 或阶段出口验收通过。不能据此删除依赖、改变保留功能、放宽许可或启动本机正式身份。实现和诊断仍串行进行 | 用户，2026-10-08，本会话对上述顺序调整明确回复“同意” |
| S18 | 批准针对 `tap`、`sqlite3`、`screenshot-desktop` 的有限依赖清理，按下列七条执行；这是 S17 之外的专项批准，不扩大到其他依赖或功能 | 用户，2026-10-08，本会话明确回复“批准” |

**S18 细则**：

1. 先核实调用链、构建/开发/测试脚本和 CI，包括计算式 `require`/`import`。确认无人使用才删除；只有找到具体开发使用者并记录后才允许移到开发依赖。
2. 只移除三项根依赖及其失去引用的节点/边，保留共享依赖；其他包的版本、integrity 和来源不得改变。必要的分类标记变化单独说明，提交附机器核对的 lockfile 差异统计。
3. 单独记录计算式导入的检查范围、具体目标和剩余盲区，不把搜索无命中等同于完整可达性证明。
4. 由收集脚本重新生成 `licenses/manifest.json` 和 README/NOTICE 的当前库存条目，不手工删除缺口。预期仅去除五个缺口（ansi-tokenize、npmcli/agent、once 1.1.2、screenshot-desktop、err-code），15 降至 10；eastasianwidth 仍保留。任何偏差必须解释。
5. 在 PROVENANCE 或 ADAPTATION 登记偏离上游声明依赖的地方，改动单独提交供只读复查；不混入其他许可资料或依赖替换。
6. 当前实现提交必须有不使用缓存的 CI 干净安装、原生模块构建、全部门禁、AG-09，以及一次 S17 式不分发包清单诊断；确认三个根包及失去生产可达性的相关条目确实不在包内。CI 只保存文本清单和日志，不发布应用或项目 native artifact。
7. 一旦发现保留功能依赖它们，立即停止相关改动，交回用户决定，不换库。其他许可缺口、原生嵌套声明/源码义务和阶段出口复查要求不变。

**S15 细则**。本机已安装的 Margin 与 S7 的正式身份完全相同：包标识 `io.github.xbz123.margin`，数据目录 `~/Library/Application Support/Margin` 已存在。Electron 按应用名取钥匙串条目 `<应用名> Safe Storage`，按包标识取偏好设置。用正式身份在本机运行，会碰到已安装应用的数据、偏好和钥匙串，也可能打开的是已安装的那个应用。因此：
- 本机所有构建、测试和运行都用临时身份：应用名和 `productName` 为 `temp`，包标识 `io.github.xbz123.temp`，数据目录名 `temp`（测试时在合成 HOME 内），钥匙串条目对应 `temp Safe Storage`（测试时仍用 mock 钥匙串）。
- 身份只在一处定义（AG-20 实现），构建时选择变体，默认是临时身份。正式身份 `Margin` / `io.github.xbz123.margin` 也在那里定义，但本机任何构建和运行都不用它。
- 正式身份只在 CI 上打包和检查，CI 机器上没有已安装的 Margin。本机对正式身份的产物只做只读检查（读 `Info.plist`、列出包内容、`codesign --verify`），不启动、不用 Finder 或 `open` 打开，检查完删除。本机启动冒烟用临时身份的产物，只直接执行包内的可执行文件，带合成 HOME 和 mock 钥匙串。
- 第一次以临时身份运行前，先确认隔离守卫按新应用名把 appData 和 userData 指向合成 HOME（`scripts/margin/isolation/guard.cjs` 按应用名计算 userData）。
- 任何时候发现读写了真实的 `~/Library/Application Support/Margin`、`io.github.xbz123.margin` 的偏好设置或 `Margin Safe Storage` 钥匙串条目，立即停止并报告，不自行清理或还原。
- 何时在本机改用正式身份，留到发布前（AG-62）由用户决定。在此之前不安装、不覆盖、不启动已安装的 Margin。

## 3. 待定决策

| # | 问题 | 阻塞范围 | 建议 |
| --- | --- | --- | --- |
| D1 | Electron 留在 33，还是升到旧 Margin 使用的 43 | 只阻塞 AG-17 的版本处理一步 | 按 X2 的结果定。判断依据是 Electron 的官方支持状态、原生依赖能否加载、运行有无回归；改动行数不作主要依据 |
| D2 | 真实服务和实机验收由谁做、何时授权：真实 API 调用、屏幕录制权限、系统截图对照 | 阶段 3 起的实机项 | 每项实机验收前单独请求授权 |
| D3 | Windows 的范围 | 平台分支代码 | 保留平台分支并保证能编译，不做 Windows 构建验收 |
| D4 | `package.json` 的 `license` 字段写 `AGPL-3.0-only` 还是 `AGPL-3.0-or-later` | AG-26 | 设计建议：`AGPL-3.0-only`。上游没有声明 "or later"，选 `-only` 不会扩大授权范围 |
| D5 | 本机没有完整的 Xcode，Rust 原生模块无法从零构建（X3）。是安装 Xcode，还是接受"使用已有 cargo 缓存"作为阶段 1 出口第 1 条的例外 | 阶段 1 出口第 1 条、AG-25 打包 | **已定（2026-10-08），见第 2 节 S11**：不装 Xcode，第 1 条以不使用缓存的 CI 运行为准，原生模块和打包都在 CI 上产出 workflow 产物 |

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
- **结果（2026-10-07）：完成。**
  - **实现**：全部在 `scripts/margin/isolation/` 下。
    - `guard.cjs`：通过 `--require` 或 `NODE_OPTIONS` 加载。
    - `env.mjs`：构造干净的环境变量和临时 HOME。
    - `run-node.mjs`、`run-electron.mjs`：在隔离环境中运行 Node 测试或 Electron，后者还会在运行前后对比真实目录的快照。
    - 两份自测：`__tests__/guard.node.test.mjs` 和 `selftest/electron-main.cjs`。
  - **Node 层**：自测 10/10 通过。
    - 拦截范围：`fetch`、`https`、原始 TCP、DNS、`ws`、UDP，以及不在白名单内的子进程。白名单只放行本机的 node、`echo` 一类无害程序，以及沙盒内的测试替身。`sh -c`、`shell:true` 和带 shell 语法的命令行一律拦截。
    - 找不到的命令照常因 ENOENT 失败。
    - `keytar` 被替换为内存替身。
    - 回环地址正常可用。
  - **Electron 层**：自测通过。
    - 被拦截的请求：主进程的 Node `fetch` 和 `net.fetch`、子进程、渲染层的 `fetch`、图片、WebSocket。
    - 回环正常；`safeStorage` 使用 mock 钥匙串，可以正常加解密。
    - 自测程序的 `appData`、`documents` 等全部路径都落在沙盒内；运行前后，真实目录的快照没有变化。
  - **基线测试对比**（`electron/{services,llm,audio}/__tests__`，加守卫，每个测试限时 120 秒）：
    - 总计 991，通过 928，失败 33，跳过 30。
    - 拦截日志里只有两个测试文件触发过守卫。修正规则后再跑：
      - `ImeDetectorCache` 全部通过（它调用的 `defaults` 会读取真实系统偏好，仍被拦截）；
      - `CodexCliService` 还剩 1 个失败：自动探测找到了本机真实的 `/opt/homebrew/bin/codex` 并尝试执行。这一拦截是有意的，因为它会用到真实的登录凭据。
    - 其余失败所在的测试文件，守卫一次都没有触发，属于基线原有的失败：许可证校验 `LicenseVerifyPolicy` 及 premium 缺失、`KnowledgeOrchestrator`、模式上下文、只查源码字符串的测试等。
    - `OpenAIRealtimeGAProtocol.test.mjs` 本来就会挂起：它留下了 100 秒的定时器和重连逻辑，守卫没有记录到它的任何外连，已手动停止。
  - **没有覆盖的部分**（G4 的承诺相应收窄）：
    - 原生插件自己开的网络连接，由 L0 处理；
    - Chromium 的 WebRTC/UDP。基线不用 WebRTC，DNS 由 `--host-resolver-rules` 限制；
    - 原生代码直接读取系统偏好。
    - 因此 G4 只承诺：在 Node 和 Chromium 这两层，无法连接到外部主机；并且应用自己声明的数据路径都在沙盒内。

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
- **构建部分结果（2026-10-07）：完成。**
  - **Electron 33.4.11**（工作区实际使用的版本）：
    - `npm run setup:native` 成功。`better-sqlite3` 12.6.2 用的是官方预编译包，不需要本机编译器。
    - 在隔离的 Electron 主进程里，`better-sqlite3`（SQLite 3.51.2）、`sharp`（libvips 8.17.3）和 Rust 原生模块都能加载，并通过了最简单的调用。拦截记录为零，真实目录没有变化（`selftest/native-load.cjs`）。
  - **Rust 原生模块需要完整的 Xcode**：
    - 原因：第三方依赖 `cidre`（MIT 许可）的构建脚本会调用 `xcodebuild`。本机只装了 CommandLineTools，没有 Xcode，所以从零构建会失败。
    - 本次的做法：把旧 Margin 工作区 `native-module/target` 里的 cargo 构建缓存复制过来，cidre 在 9 月 23 日已用 Xcode 构建过。之后本分支的 `natively-audio` 用本分支自己的源码编译成功。
    - 缓存只含第三方 crate 的编译产物，不引入任何代码，也不提交。
    - **后果**：在没有 Xcode 的干净机器上，阶段 1 出口验收第 1 条无法满足。需要安装 Xcode，或者把这一限制记为验收例外，由用户决定（见第 3 节 D5）。
  - **Electron 43.1.0**（一次性副本，没有合入）：
    - 类型检查仍是基线原有的 33 个错误，没有新增。
    - `better-sqlite3` 12.6.2 和 12.11.1 都没有适配 Electron 43 的预编译包，必须在本机编译。本机直接编译失败：`PATH` 里 anaconda 的 GNU libtool 排在 Apple libtool 前面，而且 CommandLineTools 默认找不到 libc++ 头文件。
    - 解决办法：把 `/usr/bin` 排到 `PATH` 前面，并把 `CXXFLAGS` 指向 SDK 里的 `c++/v1` 头文件，配合 `better-sqlite3` 12.11.1 即可编译成功。之后在隔离的 Electron 43 中，三个原生模块全部能加载。
  - **对 D1 的初步看法**：33 现在就能用，而 43 需要升级 `better-sqlite3`，`setup:native` 也要处理本机编译环境。但 33 是较旧的大版本，长期使用需要升级。最终结论等 L0 之后比较两个版本的启动结果再定。
- **启动部分结果（2026-10-07，L0 满足之后）：完成。**
  - **首次启动发现的问题**：主线程卡在 `natively_audio get_input_devices` → cpal → CoreAudio HAL（`mach_msg`）上，在等待麦克风权限的决定。用独立探针在普通 Node 中、使用真实 HOME 也同样卡住，说明与隔离环境无关。
  - **处理办法**：守卫给原生音频模块加了替身。设备列表返回空，采集对象拒绝启动。阶段 1–2 不授予任何设备权限。
  - **另外两项发现**：
    - 渲染层在启动时会请求 Google Fonts。已改为使用仓库自带的 Inter（`cc8f6379`）。
    - `defaults`（输入法检测）和 `lsof`（Ollama 端口清理，AG-14 删除）会被拒绝，归为本地替身，不算外连。
  - **两个版本对比**（隔离环境，观察 30 秒，受控退出）：

    | | Electron 33.4.11 | Electron 43.1.0 |
    | --- | --- | --- |
    | 就绪时间（`loadURL success`） | 2.3 秒 | 5.5 秒 |
    | 外连拦截 | 0 | 0 |
    | 未捕获异常 | 0 | 0 |
    | 受控退出 | 是，exitCode 0 | 是，exitCode 0 |
    | 应用日志里的 ERROR/WARN | 与 43 相同 | 只多一条 Node 的 `punycode` 弃用提示 |

  - **真实目录**：本次运行的日志只写在沙盒内。真实的 `~/Library/Logs/Margin` 和 `~/Documents/natively_debug.log` 有变化，但这是正在运行的已安装 Margin 和 Natively Local 写入的；真实日志中找不到任何本沙盒的路径。
- **D1 结论**：升级到 Electron 43，由 AG-17 执行。
  - **理由**：43 在构建、加载、启动三方面都与 33 等效；33 是较旧的大版本。
  - **升级时需要同时处理**：`better-sqlite3` 升到 12.11.1；`setup:native` 在需要本机编译时，要把 Apple 工具链放在 `PATH` 前面，并设置 SDK 的 `CXXFLAGS`。
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
   - 按 S11，本条在 CI 上验证：当前提交上手动触发 `margin-gates.yml`，`no_cache` 设为 true（跳过 Electron 和 cargo 缓存），日志里能看到 `Compiling cidre`，全部门禁通过。
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

1. **身份**：打包产物 `Info.plist` 中，`CFBundleName` 和 `CFBundleDisplayName` 为 `Margin`，`CFBundleIdentifier` 为 `io.github.xbz123.margin`。这是正式身份的变体，在 CI 上检查；临时身份的变体对应为 `temp` 和 `io.github.xbz123.temp`，两个变体都要检查（S15）。
2. **数据隔离**：在合成 HOME 中预先放好 `Natively`、`natively`、`natively-local`、`ai assistant`、`Margin`（代表已安装的 Margin，S15）这几个目录。验证：
   - 用一个文件访问守卫证明，进程对这些目录**没有任何读写**（只看内容和 mtime 不变不够）；
   - 新版只创建自己身份的目录（开发期为 `temp`，S15）；
   - 重启后设置能恢复；
   - 凭据路径是在导入时就固定的（`electron/services/CredentialsManager.ts:10`），要证明名称和路径在这个模块加载之前已设定好。
   - 两个身份变体都要验证（S15）：CI 上分别检查初始化顺序，以及应用名、userData、日志路径和凭据路径都指向该变体自己的目录；受保护目录按变体区分（临时身份时包含 `Margin`，正式身份时包含 `temp`）。可以用假的 Electron app 做契约测试。正式身份的运行检查只在 CI 上做，本机仍不启动正式包。
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
   - 日志只写在应用自己的数据目录下（开发期为 `temp`，S15）。
5. **出站**：
   - 出站地址清单测试通过；
   - 自动发起的请求只到用户已配置的服务商官方地址或用户填写的地址；
   - 数据权限拒绝时，即使目标是官方地址，也零请求；
   - 用户点击的外部链接与自动加载的资源分开统计。
6. **打包**（按 S11 在 CI 上进行）：
   - `publish` 为 `null`，构建配置和 CI 中没有上游发布目标；CI 只上传 workflow 产物，不建 Release；
   - CI 从干净的输出目录构建 arm64 的 `.app`，并做 ad hoc 签名，作为 workflow 产物保存；
   - 以下检查在 CI 上做，并在本机对下载下来的产物再做一遍：
   - 逐一检查 asar、`asar.unpacked` 和 `Resources`：没有模型文件、`sqlite-vec`、`onnx`、`premium`；
   - 所有原生库的架构正确；
   - `codesign --verify --deep --strict` 通过；
   - 本机只对下载下来的临时身份产物做启动冒烟，不安装；正式身份的 `Margin.app` 在本机只做只读检查，不启动（S15）。
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
  - 按 S15 把应用身份集中在一处定义：开发期的临时身份 `temp` / `io.github.xbz123.temp`（默认）和正式身份 `Margin` / `io.github.xbz123.margin`，构建时选择。
- **验证**：启动顺序测试；合成 HOME 加文件访问守卫的测试。两个身份变体都要测，正式身份只在 CI 上测（阶段 2 出口第 2 条）。`Info.plist` 与 AG-25 一起验证。

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
  - `ok` 只描述持久化结果。已保存但运行时应用失败时，成功分支可附安全的 `warning`，界面分别显示保存与应用状态，不谎报 `write_failed`。文件选择保留独立的取消分支和成功的 `path`；取消不当作写入失败。
- **停止条件**：如果拒绝明文回退会让某项保留功能无法使用，交回决定。

**AG-23 日志出口全面脱敏**

- **结果**：满足阶段 2 出口验收第 4 条。
- **范围**：
  - `electron/main.ts` 的日志包装（`:89`、`:351` 附近）；
  - `electron/utils/redactForLog`、`verboseLog.ts`；
  - `RedactForLog`、`SensitiveLogRedaction`、`SttApiKeyRedaction` 三组测试。
  - 本票采用用户允许的默认规则：不记录用户内容（转写、提问、回答），只记录类型和字符串长度。普通日志的任意参数均不信任，不保留对象键、错误消息/堆栈或原始值；受控事件标签保留用于异常检测。

**AG-24 出站边界**

- **结果**：满足阶段 2 出口验收第 5 条。
- **范围**：
  - 列出所有出站入口：各服务商 SDK、`fetch`、STT 的 WebSocket、渲染层资源加载、`shell.openExternal`、Codex CLI 子进程；
  - Google STT 按 S16 只接受经校验的 `service_account` JSON；选择文件、环境路径、已保存路径和实际客户端构造均经过同一校验，不能只验证设置界面。拒绝无效输入时保留原有持久化状态，不触发新的认证/发送；测试仅使用合成凭据。
  - `SsrfProtection` 和 `ProviderGatewayPolicy` 两组测试改为在 mock 服务上做行为验证；
  - 新建出站地址清单测试；
  - 回答里的远程 Markdown 图片：`NativelyInterface.tsx` 等 Markdown 渲染入口没有禁用图片，`index.html` 的 CSP 允许任意 `https:` 图片，回答中的 `![](https://…)` 会触发请求（Astra 第三轮复查第 4 条）。
  - 每个发送用户内容的入口都要有行为测试：请求等待期间（限流、重试、退避）关闭数据范围后不再发送，同 `ScopeLocalFallback.test.mjs` 的 m20 用例。`LLMHelper.ts` 的发送语法检查只是辅助，不能代替（阶段 1 出口遗留事项）。
  - Codex CLI 子进程拿到内容后的自身重试不受数据范围约束：定下处理方式，例如关闭范围时结束进程，或写明为已知限制（阶段 1 出口遗留事项）。
- **说明**：基线的 Codex 是启动 CLI 子进程来生成回答（`CodexCliService.ts:312`），不是目标里的只读直连方式。在 AG-34 之前，Codex 不算已达标的保留功能，也不进入安全冒烟。

**AG-25 构建与打包（在 CI 上，按 S11）**

- **结果**：满足阶段 2 出口验收第 6 条。CI 产出临时身份和正式身份两个 `.app` 作为 workflow 产物（不是 Release，S15）；本机只验证下载下来的产物。
- **范围**：
  - `package.json` 的 `build` 字段和 `scripts`；
  - 新建 `scripts/build-local.cjs`：清空输出目录 → 构建 → arm64 打包 → ad hoc 签名 → 检查包内容。CI 调用它，本机不打包；
  - `ad-hoc-sign.js`；
  - `.github/workflows/margin-gates.yml` 增加打包步骤，按 S15 产出临时身份和正式身份两个变体，上传两个 `.app` 和检查结果；
  - 新建下载脚本：用 `gh run download` 取某次运行的原生模块产物（`margin-native-<sha>`）或 `.app` 产物，核对 `BUILD-INFO.txt` 中的 sha256 后再使用。本机开发的原生模块从此改用 CI 产物，不再用 X3 复制来的 cargo 缓存；
  - workflow 产物默认保留 30 天，到期后需要重新运行。
- **复核**：阶段 2 出口由本票负责联合验收，再由 Claude 只读复查（S14）。

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
| AG-32 | 重试、时限、备用模型、错误显示。用 mock 服务注入延迟，测 Gemini 顺序备用（第八轮由并行改来）的失败切换耗时；数据范围拒绝只显示一次提示（阶段 1 出口遗留事项） | AG-30 |
| AG-33 | 截图和文字提问、笔试模式、流式显示与取消。按 S12 用真实模型对比保留和删除默认回答提示词的回答质量，决定去留（需 D2 授权）；用真实模型复测失败切换延迟 | AG-31、AG-32 |
| AG-34 | Codex CLI 只读凭据来源（替换基线里的子进程生成方式）；同时解决 CLI 自身重试不受数据范围约束的问题（见 AG-24） | AG-30 |
| AG-40 | 双路音频与会话生命周期（开始、停止、尾段排空） | 阶段 2 |
| AG-41 | 收窄云端 STT 的选择范围；未配置时阻止开始。按核实后的 Realtime 接口改写并恢复 AG-17 跳过的 4 个 `OpenAIRealtimeGAProtocol` 用例（用例自己清理保活定时器） | AG-40 |
| AG-42 | 手动回答 | AG-33、AG-41 |
| AG-43 | 自动回答与 Gemini Flash-Lite 双语 Judge | AG-42 |
| AG-50 | Local Context 全文与预热 | AG-33 |
| AG-51 | 提示词类 Skills | AG-33 |
| AG-52 | 会议记录：会前设置、增量保存、摘要、失败恢复 | AG-41、AG-32 |
| AG-60 | 设置页重组、中英双语界面 | AG-33、AG-43、AG-52 |
| AG-61 | 窗口保护、快捷键、鼠标穿透、伪装（实机部分需 D2 授权）。恢复 AG-17 跳过的 `ActivationPolicyOrdering` 用例，或按定下的激活策略改写后启用 | 阶段 2 |
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
                                   L0 + X4 → AG-09 → AG-13 → AG-14 → AG-15 → AG-16 → AG-17 → 阶段 1 出口 → 复核（S13）→ 阶段 2
X1 → G2（AG-10 起每张 ticket 都要过）
```

**阶段 1**：

- AG-08 → AG-10 → AG-11 → AG-12 → AG-09 → AG-13 → AG-14 → AG-15 → AG-16 → AG-17，严格串行，因为都要改热点文件和 lockfile。
- AG-10、AG-11、AG-12 的验收不需要启动应用，所以它们不依赖 AG-09。
- AG-09 依赖 L0 和 X4。
- AG-13 必须排在 AG-14 之前，因为模式代码依赖 RAG。
- AG-17 中处理 Electron 版本的那一步要等 X3 和 D1。

**阶段 2**：满足以下两条才开始（S11）：阶段 1 出口的 Astra 只读复查通过；出口第 1 条有当前提交上不使用缓存的 CI 证据。**两条均已满足**（S13，2026-10-08）。

阶段 2 的 ticket 默认串行执行。上面允许并行的 ticket，要并行时各用一个工作树，并另外征得用户同意。

2026-10-08 用户要求“持续推进阶段2”。按此前“每张 ticket 完成后，或者到阶段 2 出口时”交回只读复查的安排，继续串行完成实现和门禁，并逐票报告提交号；不把未收到的 Claude 复查计为通过。阶段 2 出口仍需 Claude 复查，AG-22 等明确停止条件保持不变。

阶段 2 内部的顺序：

- AG-20 先做。
- AG-21 和 AG-26 只改图标资源和文档，可以和 AG-20 并行。两者都会改 `package.json`，留给 AG-25 合并。
- AG-22 和 AG-23 在 AG-20 之后可以并行。`main.ts` 的日志段归 AG-23，凭据相关的 handler 归 AG-22。
- AG-24 在 AG-22、AG-23 之后做，因为会碰到相同的服务文件。
- AG-25 最后做，并负责阶段 2 的联合验收。

**验证职责**：

| 谁 | 做什么 |
| --- | --- |
| 实现者（阶段 2 起为 Codex 派发的 `gpt-6.1-sol`，S14） | 跑 G1–G7、本 ticket 的检查和 AG-09 回归；每张 ticket 提交前确认原工作区 `git status --short` 为空、分支仍是 `codex/ai-assistant-refactor` |
| Codex | 派发和集成 ticket，阶段末组织出口验收；修复复查发现的问题（S14） |
| Claude | 每张 ticket 完成后和阶段出口时只读复查：读 diff 和原始证据，逐条核对，只报告不改代码；对来源有疑问的引入项做抽查。阶段 1 及以前由 Claude 实现、Astra 复核，见第 8、9 节 |

真实服务和实机验收要等 D2 授权。

## 8. 执行与恢复记录

| ID | 状态 | 提交 | 证据与未验证项 |
| --- | --- | --- | --- |
| 阶段 0 | 完成 | `e0dc5b40` | BASELINE、PROVENANCE、ADAPTATION |
| 计划评审 | 完成 | `f76fba39` | Astra 只读评审，见第 9 节 |
| 计划修订 | 完成 | `02b3d9fd` | 按用户 2026-10-07 的要求修订：<br>(1) 加入启动闸门 L0，解开 AG-09、AG-10 与 X2 之间的循环；<br>(2) G3 规则逐步启用；<br>(3) 新增 AG-08；<br>(4) BASELINE.md 改为明确写出证据的不确定性，基线不变 |
| 事件记录 | 已处理 | — | 三次运行超出了隔离边界，现已修复，详见下文 |
| X1 来源检查 | 完成 | `8acc530d` | 结果见第 4 节 X1 |
| X2 隔离 | 完成 | `f6b3f2a1` | 结果见第 4 节 X2。<br>**未覆盖**：原生插件自己发起的网络连接、Chromium 的 WebRTC/UDP |
| X3 运行时 | 完成 | `43781a21`、`5c871699` | 构建、加载、启动三方面都已对比；D1 定为升级到 43（AG-17 执行）。详见第 4 节 X3 |
| X4 mock 通道 | 完成（决策） | `02b3d9fd` | 选甲；接口契约见第 4 节 X4。实现放在 AG-09 |
| AG-08 | 完成 | `5ae76a18` | 在全新克隆里运行 `npm ci`：零安装脚本、没有模型文件。<br>没有 Xcode 时，干净机器上 `setup:native` 无法构建 Rust 模块。D5 已定（S11）：干净安装以不使用缓存的 CI 运行为准 |
| AG-10 | 完成 | 见 AG-10 提交 | 见下文 AG-10 记录 |
| AG-11、AG-12 | 完成 | 见 AG-11/12 提交 | 见下文 AG-11、AG-12 记录。两张 ticket 改了同一批热点文件，并且在同一工作区内交替进行，无法干净地拆成两个提交，因此合为一个提交，提交说明里分别列出 |
| L0 | 已满足（2026-10-07） | `88f206e8` 起 | 首次启动见 X3 启动部分 |
| AG-09 | 完成 | 见 AG-09 提交 | 见下文 AG-09 记录。5 项回归在守卫下连续 3 次全部通过 |
| 证据方法 | 已更正 | 见 AG-13 提交 | 门禁统一由 `scripts/margin/run-gates.mjs` 运行，原始输出和退出码存于 `docs/margin/evidence/`。发现并修正了两处会让测试结果失真的问题（构建不清理旧产物；`--test-force-exit` 漏报测试），详见下文 AG-13 记录 |
| AG-13 | 完成 | 见 AG-13 提交 | 见下文 AG-13 记录。证据：`docs/margin/evidence/AG-13/summary.json`，对照 `pre-AG-13/`。决定 1（是否保留默认回答提示词）已定：暂时保留，阶段 3 评估（S12） |
| AG-14 | 完成 | `93fa62fe` 及 AG-14 (2/2) 提交 | 见下文 AG-14 记录。证据：`docs/margin/evidence/AG-14/summary.json`，对照 `AG-13/`；守卫记录到对 `11434` 端口零请求 |
| CI 门禁 | 完成 | `516815f4` | `.github/workflows/margin-gates.yml`，见下文 CI 门禁记录。首次运行（对照 AG-14）只有来源检查多出 1 处命中，已解释；AG-15 收尾运行的回归失败是时序差异，不是新增失败，已在 AG-16 中加大余量。D5 定案前只作参考；定案后（S11），当前提交上不使用缓存的运行是出口第 1 条的证据，见下文 CI 门禁记录中"D5 定案后的修改" |
| AG-15 | 完成 | 见 AG-15 提交 | 见下文 AG-15 记录。证据：`docs/margin/evidence/AG-15/summary.json`，对照 `AG-14/`；`install-check.log` 为 `npm ci` 后的模型与依赖检查 |
| AG-16 | 完成 | 见 AG-16 提交 | 见下文 AG-16 记录。证据：`docs/margin/evidence/AG-16/summary.json`，对照 `AG-15/`；另有 `install-check.log`、`validateImagePath.log` |
| AG-17 | 完成 | 见 AG-17 提交 | 见下文 AG-17 记录。Electron 43.1.0；两个 `tsc` 退出 0；基线遗留的 20 条测试失败全部处理（5 个用例跳过并写明原因）；证据：`docs/margin/evidence/AG-17/summary.json`，对照 `AG-16/` |
| 阶段 1 出口 / 复核 | 通过（2026-10-08） | `2e71066b`、`94a10fb1`、`02d4cb2e`、`4523c762`、`4bd2eb00`、`d26a9937`、`fa70efc8`、`9a7dcf1c`、`c43b10e9` | 第一轮复核（`e9b25ec3`）结论"修复后可接受"；第二轮到第八轮复查（`2e71066b`、`c8365b63`、`8f7ceda2`、`5c30ec84`、`b80c9440`、`fb058c35`、`987fd6ef`）结论都是"仍需进一步修复"，发现均已处理（见第 9 节；远程 Markdown 图片按复查意见转入 AG-24）。第八轮修复后（`c43b10e9`）在干净树上重新验收：第 2–7 条通过，证据 `docs/margin/evidence/AG-17-review8/gates/summary.json`（0 个未提交路径）；第 1 条按 S11 以不使用缓存的 CI 运行 `37709440574` 为准，通过。Claude 第九轮独立验收通过（`AG-17-review9/`）；阶段 2 的启动条件按 S13 满足。未验证的事项及去向见"阶段 1 出口验收"下的表 |
| AG-20 | 实现和门禁通过；待 Claude 复查 | `83123434` | 单源身份、bootstrap、数据和日志路径、界面名称、隔离守卫及双身份契约检查已实现。本地及干净 CI 均 15 步全退出 0，773 测试（768 通过、5 既有跳过），AG-09 6/6、存储 5/5、启动 1/1；CI 正式身份契约 6/6。证据 `evidence/AG-20/`、`evidence/CI-37756383369/`；未本机运行正式身份。Claude 只读复查待完成，打包 Info.plist 留 AG-25 |
| AG-21 | 实现和门禁通过；待 Claude 复查 | `0f289314` | 四项旧 Margin 图标源码引入前已审查并按精确路径登记，15 项资产由 SVG 生成，23 个旧图标删除可 Git 恢复。本地及 CI 15 步退出 0，777 测试（772 通过、5 既有跳过）；图标 4/4、AG-09 6/6、存储 5/5、启动 1/1，CI 正式身份契约 6/6。证据 `evidence/AG-21/`、`evidence/CI-37762841891/` |
| AG-22 | 实现和门禁通过；待 Claude 复查 | `2db88817` | 22 个 setter 事务保存、保存 IPC/preload/界面统一结果契约和故障行为检查完成。本地及 CI 均 15 步退出 0，799 测试（794 通过、5 既有跳过）；AG-09 6/6、存储 5/5、启动 1/1，CI 正式身份契约 6/6。证据 `evidence/AG-22/`、`evidence/CI-37767107984/` 保留首轮 harness 契约失败及完整复跑。未发现现行明文文件回退依赖，未触发停止条件；真实钥匙串未验 |
| AG-23 | 实现和门禁通过；待 Claude 复查 | `ca7ff686` | 启动前共享脱敏、main/preload/renderer 出口、身份日志路径、原始 PCM 旁路删除、受控 native 日志完成。本地及 CI 均 15 步退出 0，812 测试（807 通过、5 既有跳过）；AG-09 6/6、存储 5/5、启动及真实窗口 canary 1/1，CI 正式身份契约 6/6。证据 `evidence/AG-23/`、`evidence/CI-37789252078/` 保留失败与最终成功。CI 已编译新 natively-audio；本机仍用旧 native，AG-25 下载验证待完成，Windows 仅解析未编译，不声称 OS/第三方日志全拦截 |
| AG-24 | 实现和门禁通过；待 Claude 复查 | `a623e3f7` | 地址/重定向、cache scope、远程资源、STT 撤销和 S16 service_account 边界完成。本地及 CI 均 16 步退出 0，864 测试（859 通过、5 既有跳过）；AG-09 6/6、存储 5/5、启动 1/1、新 renderer 1/1，CI 正式身份契约 6/6。证据 `evidence/AG-24/`、`evidence/CI-37811351032/` 保留失败和最终通过；bootstrap 导入顺序及 AG-09 慢采样反例均有红绿证据，mock gate 不改生产流式。installed SDK 合成 JWT 本地签名零 auth HTTP/ADC/gcloud/metadata；无真实 OAuth/服务验收。库存与 CLI/已发送数据等限制见 `OUTBOUND.md` |
| AG-26 | 部分实现完成；许可闭环受阻；S18 实现及验证通过，待只读复查 | `c49fb86d`、`45b11c5b`、`3ac02ece`；S18 `44377a01` | 元数据、文档、NOTICE、库存、字节校验及原定清理已实现。两批许可资料补齐曾达到 506 正文、15 缺口；S18 精确移除三项无使用者根依赖后自动得到 726 候选、382 正文、10 缺口。保留版本/integrity 不变。当前提交本地及无缓存 CI `37838491368` 的 16 步均 exit 0（884 测试，878 通过、6 跳过），AG-09 6/6；CI npm ci/native 从零构建通过，新实包未观察到三根包及五项被移出的缺口，共享依赖保留。证据 `evidence/AG-26/S18/`、`evidence/CI-37838491368/`。正常许可校验仍拒绝剩余 7 npm、3 Cargo；原生嵌套许可及源码/替换义务未闭环，不作为本票或阶段出口通过 |
| AG-25 | S17/S18 不分发诊断通过；完整验收未完成 | `c49fb86d`、`a7168997`、`f8c2dec0`、`44377a01`（诊断/依赖检查点） | 原 S17 失败及最终 CI `37829181248` 证据保留。S18 无缓存 CI `37838491368` 的干净源码 16 步 exit 0、正式身份契约 6/6；实包 40,482 条目、609 包元数据记录，23 个 Mach-O 均 arm64，项目 native 哈希与该次编译一致。正常许可校验拒绝 10 项，acceptance=false；7 npm 正向包含，3 Cargo unknown，1,412 map 输出未观察到。仅两个文本 workflow artifacts，无应用或项目 native artifact，摘要及大清单哈希见 `evidence/CI-37838491368/`。双身份正式打包、签名、下载和隔离启动尚未验收 |

### AG-10 记录（2026-10-07）

- **范围调整**：以下三项原本归在 AG-16 或未单列，因为全部依赖 premium 或 natively-api，提前到本票删除：
  - **画像（Profile Intelligence）**：handler、界面和 Launcher 入口。它只能运行在 premium 的 `KnowledgeOrchestrator` 上。
  - **日历**：OAuth 令牌通过 natively-api 代理（`api.natively.software`）交换。
  - **谈判辅导**：数据只来自 premium 编排器，卡片组件也来自 premium。
  - 另外，Launcher 的模式入口按钮也已删除：它打开的 premium 模式设置在免费构建里是空组件。模式系统的后端仍按原计划由 AG-13 删除。
- **删除内容**：
  - **原生模块**：`license.rs` 及其专属依赖 reqwest、machine-uid、sha2、serde_json，并重新生成导出；
  - **子模块**：两个 gitlink 和 `.gitmodules`；
  - **主进程**：许可证、试用、Natively API、画像、日历的 IPC 和 preload；`LLMHelper` 中的 Natively 提供方和知识拦截；`CredentialsManager` 中的 Natively key 和试用字段；NativelyProSTT；
  - **渲染层**：试用、广告和升级入口；Natively API 和 Pro 两个设置页；帮助页中的 Pro 和 Modes Manager 两节；约 2,900 行只服务于 premium 定价的 CSS；
  - **测试**：14 个只测已删模块的测试文件。另外修改了 10 个测试中引用已删内容的部分。
- **检查结果**（不启动应用）：
  - **G1**：渲染层 `tsc` 0 个错误；Electron `tsc` 与基线相比没有新增诊断；`build-electron` 和 `vite build` 都成功。
  - **G2**：来源检查对新增行零命中。新增一条白名单，内容为本分支自写的 `native-load.cjs` 中的一行。
  - **G3**：AG-10 的 30 条规则零命中。
  - **G6**：
    - 相关测试在守卫下运行，74 个中 69 个通过。失败的 5 个在基线上本来就失败：两个检查 `sendModelChanged`（上游并不存在这个函数），三个是模式相关测试，交给 AG-13 和 AG-17 处理。
    - 全量测试（`electron/{services,llm,audio}/__tests__`，守卫下，每个测试限时 60 秒）：929 个，通过 881，失败 18，跳过 30。
    - 与基线对比只多出一个失败：`ProfileIntelligenceClickGate`，它测试的组件已被删除，所以这个测试一并删除。其余失败都是基线原有的。
    - 守卫拦截了 3 次，与基线相同：本机真实 Codex CLI 一次、`defaults` 两次。
    - `OpenAIRealtimeGAProtocol` 依旧挂起（基线原有问题），已手动停止。
  - **新增的两个契约检查**：
    - `scripts/margin/preload-contract-check.mjs`：检查渲染层类型里声明的成员，preload 是否都真正提供。结果只剩 4 个基线原有的不一致（`closeAdvancedSettings`、`closeSettingsWindow`、`stealthTapRefreshIme`、`path`），放到 AG-17 处理。正是这个检查发现了日历在渲染层的残留，已一并删除。
    - `scripts/margin/ipc-channel-check.mjs`：检查被调用的 IPC 通道是否都有主进程处理函数。结果为零缺口；另有 2 个基线原有的缺口记在 `docs/margin/ipc-baseline-gaps.txt`，也放到 AG-17。
  - **原生模块**：在守卫下的 Node 进程中加载正常，不再有许可证导出（`native-exports.node.test.mjs`）。
- **未验证**：应用启动（等 L0）；渲染层改动后的实际界面（等 L0 和 AG-09）。

### AG-11 记录（2026-10-07）

- **删除内容**：
  - `TelemetryService`：用量事件写入本地 JSONL，并预留了 PostHog/Axiom/Sentry 的接收端配置。这些是用量统计，不是诊断日志，因此整体删除，同时删掉全部埋点和 `telemetryEnabled` 设置；
  - `InstallPingManager`：首启时向 `divine-sun-927d.natively.workers.dev` 发送安装计数；
  - `DonationManager` 及其 IPC；
  - 渲染层 GA4（`src/lib/analytics`），共删掉 20 处调用；
  - 捐赠和支持入口：`SupportToaster`、`FeatureSpotlight`（Launcher 顶部的"捐赠 + 即将推出"卡片），以及 About 页的捐赠卡片；
  - `.github/FUNDING.yml`；
  - `index.html` 的 CSP 中删掉 GA、GTM，以及 premium 远程广告服务器 `campaign-sand.vercel.app`。G3 新增了这个广告主机和 FUNDING 文件的规则。
- **保留**：
  - `ErrorBoundary` 写本地主进程日志；
  - `VisionProviderFallbackChain` 内部的事件回调，它不联网。
- **转给 AG-24**：渲染层仍会加载 Google Fonts 和 `cdn.simpleicons.org` 的提供方图标，这是第三方运行时请求。

### AG-12 记录（2026-10-07）

- **删除内容**：
  - `electron-updater` 及全部自动更新代码：签名构建判断、安装后重启、手动版本检查、GitHub release notes 拉取（`electron/update/`）；
  - 更新相关的 IPC、preload 和类型；`UpdateBanner`、`UpdateModal`；设置页的"检查更新"按钮。版本号显示保留；
  - Developer ID 签名和公证链路：`electron-builder.signed.cjs`、`notarize.js`、`staple-with-retry.js`、`afterAllArtifactBuild.cjs`、`@electron/notarize`、`app:build:signed`、`dist:signed`；
  - CI：删除 `release-macos.yml`；`build-smoke.yml` 去掉 Natively API 测试任务；
  - `docs/RELEASE.md`。
- **修改**：`build.publish` 改为 `null`；删除 `generateUpdatesFilesForAllChannels`；lockfile 同步（`--package-lock-only --ignore-scripts`）。
- **G3 规则调整**：依赖规则只检查直接依赖。`@electron/notarize` 仍作为 electron-builder 自身的嵌套依赖留在 lockfile 中，不属于本项目引入的依赖。
- **说明**：`ad-hoc-sign.js` 中按环境变量跳过 ad hoc 签名的保护逻辑原样保留，由 AG-25 统一处理打包。

### AG-11、AG-12 联合检查（不启动应用）

- **G1**：两个 `tsc`，渲染层 0 个错误；Electron 与基线相比没有新增诊断，而且随更新代码一起少了 1 个基线原有错误（`UpdateDownloadedEvent.filePath`）。构建见下面全量测试那一行。
- **G2**：零命中。
- **G3**：AG-10 到 AG-12 共 56 条规则，零命中。
- **契约检查**：preload 只剩 4 个基线原有的不一致；IPC 零缺口。
- **G6**：全量测试结果见第 8 节。

### AG-09 记录（2026-10-07）

- **实现**（按第 4 节 X4 契约，做法甲）：
  - `electron/margin/devOverrides.ts`：`devOpenAIBaseUrl()`、`devScreenshotFixture()`。判断打包状态时"失败即关闭"：拿不到 `electron.app` 时按已打包处理，开关无效。
  - `electron/LLMHelper.ts` 两处创建 OpenAI 客户端时传入 `baseURL: devOpenAIBaseUrl()`；未设置时为 `undefined`，与原行为相同。
  - `electron/ScreenshotHelper.ts` 把全屏截图的两处重复分支合成 `captureFullScreen()`，开关有效时复制夹具图片，不调用系统截图。
  - `tests/margin/mock-openai.mjs`：只监听 127.0.0.1 的 OpenAI 兼容流式 mock，记录每个请求、是否被客户端提前断开、已发送的分块数；可设置分块间延迟和注入 HTTP 错误。
  - `tests/margin/answer-regression.test.mjs`：用 Playwright 启动真实应用，经 renderer、preload、IPC、`LLMHelper` 打到 mock。
  - 守卫：原生模块匹配改为先解析成真实文件名再判断，避免相对路径加载时漏掉音频设备替身；`run-node.mjs` 新增 `--allow-exec`，只放行测试需要启动的 Electron。
- **覆盖的行为**（5 项）：
  1. 输入问题后逐段显示回答（先看到部分文本，再看到完整文本）；每个问题恰好一次请求，模型、`stream: true` 和问题内容正确。
  2. `cancelChatStream` 后迟到的分块不进界面，HTTP 流被客户端断开。
  3. 流式回答进行中，界面不接受第二个输入的问题（基线行为）；主进程收到同一窗口的新 `gemini-chat-stream` 时中止旧流，旧流后续分块不进界面。
  4. 走真实快捷键路径（主进程发 `global-shortcut` → 渲染层经 IPC 截图并附加）发出的截图问题，请求中带有夹具图片。
  5. 提供方返回 400 时，界面显示错误，没有重试；下一个问题正常回答。
- **证明开关在打包构建里无效**：单元测试 `electron/margin/__tests__/devOverrides.test.mjs`（`isPackaged: true` 时忽略、非回环地址忽略、夹具文件不存在时忽略、在 Electron 之外失败即关闭）。打包产物本身的验证留到 AG-25。
- **检查结果**：
  - 回归：守卫下连续 3 次 5/5 通过；结束后守卫日志中除本地替身（权限、设备、`defaults`、`lsof`）外没有拦截记录。
  - **G1**：渲染层 `tsc` 0 个错误；Electron `tsc` 31 个，全部是基线原有的（基线 33 个，没有新增）；`build-electron` 成功。
  - **G2**：零命中。新增 22 条白名单，都是本分支自写的通用写法（计时、循环、HTTP 响应、SSE 分帧等）。其中 `env.mjs` 和 `guard.cjs` 的两条在 `5c871699` 已提交，当时没有跑 G2，这次补上。
  - **G3**：56 条规则零命中。
  - **契约检查**：preload 仍是 4 个基线原有的不一致；IPC 仍是 2 个基线缺口。
  - **G6**：调用 `LLMHelper` 或 `ScreenshotHelper` 的 10 个测试文件共 122 个测试，119 个通过；失败的 3 个都是基线原有的模式上下文测试（交给 AG-13）。`devOverrides` 6 个、守卫自测 10 个全部通过。
- **观察到的基线问题**（不在本票修，记给后续 ticket）：
  - `set-model` 报错 `appState.sendModelChanged is not a function`，模型实际已切换（`getCurrentLlmConfig` 返回 gpt-5.4），但悬浮窗的模型标签仍显示 Gemini 3.1 Flash。交给 AG-17。
  - 启动时 `LLMHelper` 会用 `lsof -i:11434` 尝试重启 Ollama，并尝试启动 `ollama` 进程（隔离环境里找不到，`ENOENT`）。交给 AG-14。
  - Playwright 的第一次主进程 `evaluate` 偶尔与应用启动竞争（"Execution context was destroyed"），测试在进程仍存活时重试；进程退出时打印它的输出后失败。
- **使用方法**：先 `node scripts/build-electron.js` 和 `npx vite build`，再运行
  `node scripts/margin/isolation/run-node.mjs --allow-exec Electron --test --test-timeout=180000 tests/margin/answer-regression.test.mjs`。
  AG-17 会把 `electron/margin` 和 `tests/margin` 加进 `npm test`。

### AG-13 记录（2026-10-07）

**1. 先追踪：模式如何影响普通回答和会议摘要**

- **基线的默认状态**：数据库迁移 v11 新建 `General` 模式并设为激活，v12 给它写入三个摘要小节。其余模式（以及创建模式、上传参考文件、切换到非 General 模式）都要求 Pro；Pro 判断在 AG-10 之后恒为假，渲染层也没有任何编辑模式的界面。所以在 Margin 上能到达的状态只有一种：**General 激活，自定义内容为空，没有参考文件**。
- **受影响的路径**（按 General 激活的默认状态）：

  | 路径 | 默认时注入的内容 |
  | --- | --- |
  | 输入框提问（`gemini-chat-stream`，`CHAT_MODE_PROMPT`） | 无（这类提示词本来就跳过注入） |
  | 回答、回顾、追问、追问建议（`UNIVERSAL_*`、`TINY_*`） | 无（同上） |
  | 实时"该怎么答"（`WhatToAnswerLLM`）、头脑风暴、澄清、代码提示、`generateSuggestion`、`chat()` 的其他调用 | 在系统提示词后追加 `## ACTIVE MODE` 和 General 提示词去掉共享前缀后的部分（7,139 字符） |
  | 会议摘要（`MeetingPersistence`） | 使用 General 的三个小节（Summary / Action items / Key points）；模式上下文块为空 |
  | 后续建议（`PostCallWorkflow`） | 模板类型为 `general`：不产生教练建议，邮件草稿以 "Hi team," 开头 |

  参考上下文块在默认状态下始终为空：检索器在没有自定义内容和文件时返回空字符串。
- **停止条件的判断**：实时回答等路径确实依赖 General 的提示词。如果直接删掉，默认回答会改变，这正是计划中"需要由用户决定是否保留默认提示词"的情形。为了不在等待决定期间阻塞后续 ticket，本票**保留默认行为不变**：把 General 的提示词固定为默认回答提示词，摘要固定为那三个小节。这样默认请求与改动前逐字节相同，以后无论保留还是删除，都只需改一处。

**2. 决定（已由用户确认，2026-10-08，S12）**

- **决定 1：是否保留默认回答提示词**。**已定（2026-10-08，S12）：暂时保留，阶段 3 用真实模型评估后再决定。** 当前做法：保留，作为 `DEFAULT_ANSWER_PROMPT_SUFFIX`（`electron/llm/prompts.ts`）。另一种做法：删除，让上述路径只用各自的基础提示词，回答风格会变化，需要用真实模型评估。本票没有调用真实模型，所以无法评估质量差异。

**3. 改动**

- **固定默认值**：
  - `DEFAULT_ANSWER_PROMPT_SUFFIX` 由 `MODE_GENERAL_PROMPT` 用与原 `ModesManager` 相同的规则去掉共享前缀得到。改动前后的 sha256 都是 `8e6a8da97ab03adedb7b940de1a05e89353491d7f20790340721ac50bf8e1122`，并有单元测试锁定推导规则（`electron/llm/__tests__/defaultAnswerPrompt.test.mjs`）。
  - `LLMHelper.streamChat`、`generateSuggestion` 和 `WhatToAnswerLLM` 改为直接追加这个后缀，标题沿用 `## ACTIVE MODE` 以保持请求不变。
  - `MeetingPersistence` 使用 `DEFAULT_SUMMARY_SECTIONS`；摘要提示词中原模式块所在的位置保留一个空行，与改动前相同。
  - `PostCallWorkflow` 去掉模板类型参数，只保留 `general` 的行为；教练建议生成器只服务于付费模式，连同详情页的"Coaching"区块一起删除。
- **删除**：
  - `ModesManager`、`ModeContextRetriever`、`ModeHybridRetriever`；
  - 6 个只供模式使用的提示词模板和 7 个 `TINY_MODE_*` 提示词；
  - 15 个 `modes:*` IPC 和测试专用的 `test-get-mode-context`；preload 和渲染层类型中的对应成员（含 `onModeChanged`、`onModesActiveCleared`、`testGetModeContext`）；
  - 悬浮窗的"Mode: General"标签；启动时的 `ensureSeeded`；AG-10 留下的 `isProOrTrialActive` 桩；
  - 只在切换模式时使用的 `clearSessionContext`；
  - `reference_files` 数据范围（只保护模式参考文件，已无数据来源），包括设置项、IPC 白名单和设置界面开关；
  - `PromptAssembler` 中的模式参数、参考文件块，以及随之不再使用的 `escapePromptInjection`；
  - `package.json` 中的 5 个 `test:modes*` 脚本。
- **数据表**：迁移 v11–v13 保留版本号但不再建表；新增 v16，删除 `modes`、`mode_reference_files`、`mode_note_sections`、`mode_reference_index_state`（早期构建创建过的数据库会被清理）。
- **会议开始时的动态动作绑定**：沿用 General 的触发包（`modeId: 'mode_general_default'`、`modeTemplateType: 'general'`），引擎本身在 AG-16 删除。
- **测试**：
  - 删除 15 个只测模式的测试文件，以及 `tests/utils` 下 5 个模式测试工具和 `tests/fixtures/modes`；
  - 删除 `electron/test` 下 3 个模式压力和评估脚本，以及 `input-fuzzing`、`evalHarnessPatterns` 中的模式部分；
  - 改写 7 个测试文件中涉及模式的用例，其余用例不变。`suggestionPromptAssembly` 中有一个用例在基线上就失败（断言的调用形式与代码不符，与模式无关），保留其原名，使对照仍能把它识别为继承失败，交给 AG-17。
- **G3**：AG-13 规则从 5 条增加到 25 条（模式的 IPC 名、preload 名、表名、提示词常量、`reference_files`、`isProOrTrialActive` 等），零命中。

**4. 新增的验证**

- `tests/margin/meeting-storage.test.mjs`：在守卫下启动真实应用，使用沙盒中全新的临时 SQLite。流程：开始会议 → 通过 `test-inject-transcript` 写入转写 → 结束会议 → 后台生成标题和结构化摘要（由 mock 返回）→ 读取 → 重启应用后再读取，内容一致 → 删除 → 再次重启后仍不存在 → 检查数据库版本为 16，且没有任何模式表。同时断言摘要请求使用固定的三个小节、不含模式上下文。这也覆盖了阶段 1 出口第 7 条中保存、读取、重启和删除的部分；"不加载向量扩展"由 AG-14 完成后补上。
- 支撑改动：
  - `tests/margin/launch-app.mjs`：两个应用级测试共用的守卫启动函数；
  - mock 增加按请求作答（`respond`），并支持 Groq SDK 的路径；
  - 守卫新增可选的麦克风权限替身 `MARGIN_ISOLATION_MIC=granted`：权限状态和请求都返回"已授权"，不触碰系统；实际采集仍被音频设备替身拦截。默认行为不变。
- **基线问题（记给后续 ticket）**：
  - `generateMeetingSummary` 的回退链是 自定义/cURL → Codex → Groq → Gemini，**从不使用 OpenAI**。只配置 OpenAI 的用户没有会议摘要。这与 Margin 面向 OpenAI 兼容接口的方向直接相关，交给阶段 3（AG-31）。测试中通过 Groq SDK 自带的 `GROQ_BASE_URL` 环境变量把摘要请求指向 mock，应用代码没有为此改动。
  - OpenAI 和 Groq 的 SDK 在打包后的应用里同样会读取 `OPENAI_BASE_URL`、`GROQ_BASE_URL` 环境变量，可以把带着用户 key 的请求转到别处。能设置应用环境变量的本机进程本来就能做更多事，风险低，但打包时应决定是否屏蔽，交给 AG-25。

**5. 证据方法的两处更正**

AG-13 对照时发现，之前的测试结果有两处会失真，已修正，并用修正后的方法重做了对照基准：

1. **构建不清理旧产物**：`build-electron` 不删除 `dist-electron`，在源码中删掉的模块仍留在构建目录，导入它们的测试照常运行。AG-10 到 AG-12 的测试数字是在这种状态下得到的。门禁现在每次先清空 `dist-electron`。
2. **`--test-force-exit` 漏报**：为绕过 `OpenAIRealtimeGAProtocol` 挂起而加的这个参数，会让整套测试提前结束；同一份代码先后报告了 907 和 892 个测试。门禁现在每个测试文件单独起一个守卫进程（4 个并行，180 秒上限），计数来自每个文件自己的 TAP 汇总。没有汇总的文件记为 `<did not finish>`，计入失败；所有进程按进程组结束。同一份代码连续两次运行，结果完全一致（869 个测试，825 通过，14 失败，30 跳过）。

**对 AG-10 到 AG-12 结论的影响**：用修正后的方法，在 `fdf9cd7c`（即 AG-12 之后的代码加门禁脚本）的干净导出上重做了基准（`docs/margin/evidence/pre-AG-13/`）。其中 22 个失败条目，有 21 个与基线 `a786910e` 的失败相同；另 1 个是 `OpenAIRealtimeGAProtocol` 的 `<did not finish>`，是基线已知的挂起，在新方法下才单独列出。所以 AG-10 到 AG-12 没有引入新的失败测试。基线失败列表本身来自 X2 时的运行（当时构建目录与源码一致），没有用新方法重跑。

**6. 检查结果**

命令：`node scripts/margin/run-gates.mjs --out docs/margin/evidence/AG-13 --ref docs/margin/evidence/pre-AG-13`，运行器退出码 0。每一步的命令、退出码和原始输出都在 `docs/margin/evidence/AG-13/` 中。

| 步骤 | 退出码 | 结果 | 原始输出 |
| --- | --- | --- | --- |
| 清空构建目录、`build-electron`、`vite build` | 0、0、0 | 通过 | `clean-dist.log`、`build-electron.log`、`vite-build.log` |
| 渲染层 `tsc` | 0 | 0 个错误 | `tsc-renderer.log` |
| Electron `tsc` | 2 | 9 类诊断全部继承，没有新增；随删除的评估脚本少了 4 类 | `tsc-electron.log`、`tsc-electron.diagnostics.txt` |
| G2 来源检查 | 0 | 零命中。新增 12 条白名单：门禁脚本和存储测试中的通用写法 10 条；v16 迁移的两行，是基线 v1–v15 迁移写法的下一步 | `provenance.log` |
| G3 | 0 | 81 条规则零命中 | `retired.log` |
| preload 契约 / IPC 通道 | 1 / 1 | 各 4 个、2 个缺口，全部继承，没有新增 | `*.gaps.txt` |
| 守卫自测 | 0 | 通过 | `guard-selftest.log` |
| 测试（109 个文件） | 1 | 666 个测试，624 通过，12 失败，30 跳过。失败条目 20 个，**全部继承，新增 0**；2 个继承失败随所测的模式代码一起消失 | `tests.tap`、`tests.files.json`、`test-failures.txt` |
| AG-09 回答回归 | 0 | 5/5 通过 | `regression.log` |
| 会议存储（新增） | 0 | 1/1 通过 | `storage.log` |
| `git diff HEAD --check` | 0 | 无问题 | `diff-check.log` |

- **测试数从 869 降到 666 的来源**：删除的 15 个模式测试文件共 176 个用例；改写的 7 个文件共减少 27 个模式用例。869 − 176 − 27 = 666。
- **继承失败的来源**：全部 20 个失败条目，除 `OpenAIRealtimeGAProtocol` 的 `<did not finish>` 外，都出现在 `baseline-a786910e/test-failures.txt` 中。
- **稳定性**：AG-09 回归和会议存储测试在这次门禁后又各单独运行两次，共三次全部通过。
- **未验证**：
  - 默认回答提示词对回答质量的影响（需要真实模型，未获授权，见决定 1）；
  - 阶段 1 出口第 1 条（干净安装）仍等待 D5。

### AG-14 记录（2026-10-07）

分两个提交：`93fa62fe`（RAG、嵌入和 `sqlite-vec` 向量库）和本提交（Ollama、本地视觉和隐私模式中的"仅本地"）。

**1. 删除 RAG 和向量库（`93fa62fe`）**

- 删除 `electron/rag/`（含 `RAGManager`、实时索引、嵌入管线和各嵌入提供方、向量库及其 worker、`OllamaBootstrap`）、`scripts/VectorStoreRebuild.js`、`scripts/ensure-sqlite-vec.js`，以及 `sqlite-vec` 三个依赖（用 `npm install --package-lock-only --ignore-scripts` 同步 lockfile，不运行安装脚本）。
- `main.ts`、`ProcessingHelper`：不再创建 RAG 管理器、实时索引、会后嵌入和嵌入模型引导；结束会议仍然保存并生成摘要。
- IPC、preload、类型：删除 `rag:*` 通道和 API、更换提供方时的重建索引提示，以及只保护嵌入的 `embeddings` 数据范围。
- 渲染层：输入框提问不再先尝试 RAG；会议内聊天始终用本场会议的转写和笔记回答（即基线已有的回退分支）；全局聊天用普通聊天流；启动页的模型下载状态和 `App` 的重建索引提示删除；关于页和帮助页不再描述本地 RAG。
- `DatabaseManager`：从不加载扩展；新数据库不建 `chunks`、摘要、队列和 vec0 表（v3–v5、v8–v10 只保留版本号）；新增 v17，在旧数据库中删除这些表。vec0 表没有扩展无法删除，记录日志后保留。

**2. 删除 Ollama 和"仅本地"（本提交）**

- `LLMHelper`：删除 Ollama 的字段、探测、启动、保活、模型列表、视觉探测、流式调用、强制重启、切换，以及只为它们使用的 `exec`。构造函数变为 `(apiKey?, groqApiKey?, openaiApiKey?, claudeApiKey?, deepseekApiKey?)`。数据范围被拒绝时，不再"转给本地模型"，只剩"从云端请求中省略该内容"。
- 删除 `OllamaManager`（启动时初始化、退出时停止）、`setupOllamaIpcHandlers` 及其 IPC、未使用的 `src/components/ui/ModelSelector.tsx`。
- `ProviderRouter`、`modelCapabilities`、`visionCapability`：删除 `ollama` 提供方、本地优先规则、`parseOllamaSize` 和 Ollama 视觉判断。
- 截图理解：删除 `private_vision` 模式和 `privacy_blocked` 结果，只剩 `vision_first` 和 `vision_only`。**设置迁移**：旧设置中的 `private` 或 `private_vision` 改为 `vision_first`，同时把 `providerDataScopes.screenshots` 设为 `false`。这样原本"截图不出本机"的用户，截图仍不会发给云端，而不是被悄悄放开。
- 渲染层：模型选择窗口、悬浮窗、AI 提供方设置（Ollama 面板、轮询、cURL 示例中的 Ollama 例子、`private_vision` 选项）和帮助页的 Ollama 部分删除。
- **基线问题（记给后续 ticket）**：
  - `ScreenUnderstandingMode.test.mjs` 是基线上就被跳过的旧文件，仍提到 `ollama/llava`，随 OCR 一起交给 AG-16；
  - `test:e2e:screen-understanding` 脚本仍引用 `natively-api`，交给 AG-17；
  - 在视觉提供方注册表中，Codex 仍被视为"本地"，这一点在阶段 3 重新定义提供方时处理。

**3. 端口 11434 零请求的证明**

- 守卫新增"受监视的本地端口"（`MARGIN_ISOLATION_WATCH_PORTS`，默认 `11434`）。本地回环原本允许，现在对这个端口的连接会被拦截，并记为 `watched-port`；Chromium 中对该端口的 URL 也会被取消。
- 守卫自测新增一个用例：`fetch` 和原始 TCP 连接到 `127.0.0.1:11434` 和 `localhost:11434` 都被拦截并记录（`guard-selftest.log`）。
- AG-09 回归和会议存储测试在结束时断言：守卫记录中没有任何 `watched-port`、`11434`、`ollama` 或 `lsof` 条目。两项测试均通过（`regression.log`、`storage.log`）。AG-09 记录中曾观察到启动时的 `lsof -i:11434` 和 `ollama` 启动尝试，现在已不再出现。
- **限制**：用一个不存在的命令名启动进程时，守卫不会记录（这类进程自己以 `ENOENT` 失败）。对这一点，依靠 G3 的规则保证不存在启动 `ollama` 的代码。

**4. 检查结果**

命令：`node scripts/margin/run-gates.mjs --out docs/margin/evidence/AG-14 --ref docs/margin/evidence/AG-13`，运行器退出码 0。（第一次运行因 `ProviderRouter.test.mjs` 末尾多一个空行，在 `diff-check` 失败；修正后整套重跑，证据为重跑结果。）

| 步骤 | 退出码 | 结果 | 原始输出 |
| --- | --- | --- | --- |
| 清空构建目录、`build-electron`、`vite build` | 0、0、0 | 通过 | `clean-dist.log`、`build-electron.log`、`vite-build.log` |
| 渲染层 `tsc` | 0 | 0 个错误 | `tsc-renderer.log` |
| Electron `tsc` | 2 | 9 类诊断全部继承，没有新增 | `tsc-electron.log`、`tsc-electron.diagnostics.txt` |
| G2 来源检查 | 0 | 零命中。新增 2 条白名单（`return "gemini";` 和 `const options = {`，删除 Ollama 分支后留下的通用写法） | `provenance.log` |
| G3 | 0 | 111 条规则零命中；AG-14 已列入已完成 ticket，规则从 13 条增加到 30 条 | `retired.log` |
| preload 契约 / IPC 通道 | 1 / 1 | 各 4 个、2 个缺口，全部继承，没有新增 | `*.gaps.txt` |
| 守卫自测 | 0 | 通过（含新增的 11434 用例） | `guard-selftest.log` |
| 测试（107 个文件） | 1 | 624 个测试，582 通过，12 失败，30 跳过。失败条目 20 个，**全部继承，新增 0**，与 AG-13 的列表相同 | `tests.tap`、`tests.files.json`、`test-failures.txt` |
| AG-09 回答回归 | 0 | 5/5 通过，无 11434 或 Ollama 记录 | `regression.log` |
| 会议存储 | 0 | 1/1 通过；数据库版本 17，没有模式、RAG 或 vec 表，`sqlite-vec` 未被加载 | `storage.log` |
| `git diff HEAD --check` | 0 | 无问题 | `diff-check.log` |

- **测试数从 666 降到 624 的来源**（按文件对照 `tests.files.json`）：删除两个 RAG 测试文件，共 7 个用例；`VisionCapability` 减少 25 个（Ollama 视觉判断）；`ProviderGatewayPolicy` 减少 3 个、`ScopeLocalFallback` 减少 3 个、`VisionProviderFallbackChain` 减少 2 个、`ProviderRouter` 和 `ProviderRouting` 各减少 1 个（RAG、Ollama 或仅本地相关）。7 + 25 + 3 + 3 + 2 + 1 + 1 = 42。
- **继承失败**：`suggestionPromptAssembly` 中那个基线就失败的用例，删掉了对 Ollama 调用的断言；它仍然在基线就失败的 `streamChat` 调用次数断言上失败，继续交给 AG-17。`OpenAIRealtimeGAProtocol` 仍是 `<did not finish>`，属于基线已知的挂起。
- **未验证**：阶段 1 出口第 1 条（干净安装）仍等待 D5。

### CI 门禁记录（2026-10-07）

- **文件**：`.github/workflows/margin-gates.yml`。
- **触发**：只在推送到 `codex/margin-agpl-migration`、且推送的最新提交说明含 `[gates]` 时运行；另可手动触发（`workflow_dispatch`）。按用户的额度安排（约 3,000 分钟免费额度，私有仓库 macOS 按 10 倍计费），只在每张 ticket 收尾时跑一次。
- **环境**：`macos-15`，`permissions: contents: read`，单次上限 45 分钟，不使用任何密钥。
- **步骤**：
  1. `actions/checkout`（`fetch-depth: 0`）；
  2. 只读拉取上游仓库的 `refs/heads/*` 到 `refs/remotes/upstream/*`（拉取时清空 checkout 的认证头，令牌不发给上游），再确认 `provenance-config.json` 中 `restrictedExtraRefs` 列出的提交都在，缺的从 origin 拉取；
  3. `setup-node` 26.0.0，打印 node、npm、rustc、cargo、Xcode 版本；
  4. 缓存 `~/Library/Caches/electron` 和 `native-module/target`（后者按 rustc 版本和 `Cargo.lock` 区分）；
  5. `npm ci` → `npm run setup:native`；
  6. `node scripts/margin/run-gates.mjs --out ci-evidence --ref <最新的 docs/margin/evidence/AG-*>`；
  7. 无论成败，`ci-evidence/` 都作为运行产物上传，保留 30 天。
- **定位**：GitHub 的 macOS 镜像装有完整 Xcode，所以 CI 能从零构建 Rust 原生模块。这只能作为"干净安装可行"的参考，**不等于 D5 已通过**：D5 问的是本机没有 Xcode 时怎么办，仍由用户决定。
- **与本机的已知差异**：上游现在有 123 个分支，本机的 `refs/remotes/upstream/*` 是 77 个（本机不重新拉取，以免改动与原工作区共享的引用）。CI 的受限池因此可能更大，来源检查可能多出命中。
- **首次运行对照**（运行 `37639645826`，提交 `516815f4`，对照本机 `AG-14/`；运行产物 `margin-gates-516815f4…`，保留到 2026-11-06）：
  - **耗时**：作业 6 分 9 秒（按 7 分钟计费，乘 10 约 70 分钟额度）。两个缓存都未命中（首次运行；作业失败时 `actions/cache` 不保存），`npm ci` 25 秒，`setup:native` 从零编译 Rust 模块（含 `cidre`）约 35 秒，门禁约 4 分钟。
  - **工具链**：node 26.0.0、npm 11.12.1、rustc / cargo 1.98.1（与本机相同）、Xcode 16.4。
  - **结果**：运行器退出 1，唯一未通过的步骤是来源检查。

    | 步骤 | CI | 本机 AG-14 | 差异说明 |
    | --- | --- | --- | --- |
    | 构建三步、渲染层 `tsc` | 0 | 0 | 相同 |
    | Electron `tsc` | 2，9 类全部继承 | 同 | `tsc-electron.diagnostics.txt` 逐行相同 |
    | G2 来源检查 | **1，1 处命中** | 0 | CI 拉到 123 个上游分支，受限池 606,682 个行键；本机 77 个分支，587,141 个。多出的命中是 `scripts/margin/run-gates.mjs:177` 的 `fs.mkdirSync(out, { recursive: true });`，本分支自写的通用写法，已在 AG-15 中加入白名单并写明理由 |
    | G3、契约、守卫自测 | 通过 | 通过 | 相同 |
    | 测试 | 624 个，583 通过，11 失败 | 624 个，582 通过，12 失败 | 失败条目 19 个，全部继承、新增 0。少的一个是 `CodexCliService` 的"自动探测"用例：本机守卫拦下了真实的 `/opt/homebrew/bin/codex`，CI 机器上没有 codex，用例通过 |
    | AG-09 回归、会议存储 | 5/5、1/1 | 同 | 相同 |
    | `diff-check` | 0 | 0 | 相同 |

  - **结论**：在装有 Xcode 的干净 macOS 上，`npm ci` → `setup:native` → 全部门禁可以跑通，结果与本机一致；差异只来自上游分支更新和本机装有 codex。这仍不算 D5 通过。
  - **之后的做法**：本机不重新拉取上游（引用与原工作区共享），所以 CI 的来源检查覆盖面更大。每张 ticket 收尾时以 CI 的来源检查结果为准补充解释，本机证据照常保留。
- **AG-15 收尾运行**（运行 `37642210048`，提交 `6c2d048e`，对照本机 `AG-15/`；运行产物 `margin-gates-6c2d048e…`，保留到 2026-11-06）：
  - **耗时**：作业 6 分 12 秒，门禁约 4 分 8 秒。
  - **结果**：运行器退出 1，唯一未通过的是 AG-09 回答回归（4/5）。其余与本机 AG-15 一致：
    - 构建、`tsc`（Electron 9 类诊断全部继承）、G2（更大的受限池下零命中，首次运行的那 1 处已在白名单）、G3、契约、守卫自测、会议存储、`diff-check` 都相同。
    - 测试 621 个，580 通过，11 失败，30 跳过；失败条目 19 个，全部继承，新增 0。比本机少的一个仍是 `CodexCliService` 的"自动探测"用例（原因同首次运行）。
    - `OpenAIRealtimeGAProtocol` 在 180 秒时被终止，与本机 AG-14、AG-15 和首次 CI 运行相同，属于继承问题。
  - **失败的用例**：`cancelChatStream stops the stream and late tokens are not shown`。界面显示到 `Cancel test LATE-1 LATE-2 LATE-3`，断言要求不出现 `LATE-3`。
  - **判断：环境时序差异，不是新增失败。** 依据：
    1. 同一提交在本机通过（AG-15 证据，3.72 秒），首次 CI 运行（AG-14 代码）也通过（3.78 秒）。
    2. 取消确实生效了：脚本共 6 段，最后一段 `LATE-4.` 没有出现。
    3. 时间对不上的只有这一段。mock 每 400 毫秒发一段，"Cancel test"出现后约 1.2 秒才发 `LATE-3`。用例总时长减去取消后固定等待的 3 秒，即"提问到发出取消"的时间：本机三次和首次 CI 约 0.72–0.78 秒，这次 1.96 秒，超过了余量。同一次运行里其余 4 个回归用例的耗时与首次 CI 相当（3.28/0.47/1.56 秒对 3.34/0.48/1.60 秒），机器整体并不慢，是这一段偶发的停顿。
    4. AG-15 的改动没有碰取消路径：preload 的 `cancelChatStream` 只发 `gemini-chat-stream-stop`；`LLMHelper`、`NativelyInterface.tsx`、`preload.ts` 中与流和取消相关的行在该提交里都没有变化。
  - **处理**（在 AG-16 中提交）：把这个用例的 mock 段间隔从 400 毫秒改为 800 毫秒，余量从约 1.2 秒增加到约 2.4 秒；取消后的等待从 3 秒改为 4.5 秒，仍长于剩余脚本。断言不变（仍要求不出现 `LATE-3`/`LATE-4`，且客户端中止了 HTTP 流）。改动后的效果以 AG-16 的本机和 CI 结果为准。
- **AG-16 收尾运行**（运行 `37660438244`，提交 `7bcc0ed0`，对照本机 `AG-16/`；运行产物 `margin-gates-7bcc0ed0…`，保留到 2026-11-06）：
  - **耗时**：作业 5 分 45 秒，门禁约 4 分钟。
  - **结果**：运行器退出 0，全部步骤通过。
  - **与本机对比**：
    - 构建、两个 `tsc`（`tsc-electron.diagnostics.txt` 逐行相同）、G2（更大的受限池下零命中）、G3、契约、守卫自测、`diff-check` 都相同。
    - 测试 538 个，527 通过，11 失败，0 跳过；失败条目 19 个，全部继承。与本机的唯一差别仍是 `CodexCliService` 的"自动探测"用例（原因同首次运行），AG-17 已把它改为不依赖本机环境。
    - AG-09 回归 5/5，`cancelChatStream` 用例 5.97 秒通过；会议存储 1/1。
  - **结论**：放宽时序后，AG-15 收尾运行中的回归失败没有再出现；CI 与本机结果一致。
- **AG-17 收尾运行**（运行 `37663136596`，提交 `e9b25ec3`，对照本机 `AG-17/`；运行产物 `margin-gates-e9b25ec3…`，保留到 2026-11-06）：
  - **耗时**：作业 3 分 45 秒。`tests` 步骤不再被挂起的文件拖住 180 秒。
  - **安装**：Xcode 16.4 上 `setup:native` 退出 0。第 3 步在本机编译了 `better-sqlite3`（约 20 秒，`Rebuild Complete`），日志中没有 libc++ 头文件那一行，说明装有 Xcode 时 `nativeCompileEnv()` 不加 `CXXFLAGS`，与设计一致。
  - **结果**：运行器退出 0，全部步骤通过，与本机完全一致：
    - 两个 `tsc` 0 诊断，G2/G3 零命中，契约零缺口；
    - 测试 716 个，711 通过，0 失败，5 跳过；`CodexCliService` 用例改为不依赖本机后，两边不再有差别；
    - 回归 5/5，会议存储 1/1，启动冒烟 1/1（启动器就绪 1.5 秒，退出码 0）。
  - **定位不变**：这说明装有 Xcode 的干净 macOS 上，阶段 1 的安装和门禁可以跑通；**不算出口第 1 条（D5）通过**。
- **复核修复运行**（运行 `37689367795`，提交 `2e71066b`；运行产物 `margin-gates-2e71066b…`，保留到 2026-11-06）：
  - **耗时**：作业 3 分 35 秒。
  - **参照**：工作流只选 `AG-<数字>` 形式的目录，所以参照是 `AG-17/`，不是 `AG-17-review/`。两者的失败清单都为空，对结论没有影响。
  - **结果**：运行器退出 0，15 个步骤全部退出 0，与本机 `AG-17-review/` 一致：
    - 两个 `tsc` 0 诊断，G2/G3 零命中，契约零缺口；
    - 测试 719 个，714 通过，0 失败，5 跳过；没有守卫拦截，也没有"退出码非 0 但没有失败用例"的文件；
    - 回归 5/5，会议存储 2/2，启动冒烟 1/1（启动器就绪 1.0 秒）。
- **第二轮复核修复运行**（运行 `37691910692`，提交 `c8365b63`，代码与 `94a10fb1` 相同；对照 `AG-17/`；运行产物 `margin-gates-c8365b63…`，保留到 2026-11-06）：
  - **耗时**：作业 3 分 28 秒。
  - **结果**：运行器退出 0，15 个步骤全部退出 0，与本机 `AG-17-review2/` 一致：
    - 测试 721 个，716 通过，0 失败，5 跳过；每个文件的隔离日志都没有拦截记录，且有加载记录；
    - 回归 5/5，会议存储 2/2，启动冒烟 1/1（启动器就绪 0.9 秒）。

- **D5 定案后的修改**（2026-10-08，按 S11）：
  - **前提**：此前三次运行（`37663136596`、`37689367795`、`37691910692`）都命中了 cargo-target 和 Electron 缓存，没有从零编译 `cidre`。只有首次运行 `37639645826` 缓存未命中、从零编译了 `cidre`，但那次门禁失败，提交也是旧的。所以第 1 条还没有可用的证据。
  - **工作流修改**：
    - 手动触发增加 `no_cache` 输入，设为 true 时跳过两个缓存步骤；
    - `setup:native` 的输出另存为 `setup-native.log`；`no_cache` 运行中，日志里没有 `Compiling cidre v…` 这一行时，作业失败；
    - 每次运行都把构建出的原生模块（`index.darwin-arm64.node`）、`setup-native.log` 和 `BUILD-INFO.txt`（提交、运行号、是否跳过缓存、rustc 和 Xcode 版本、本次是否编译了 `cidre`、sha256）作为 workflow 产物 `margin-native-<sha>` 上传，保留 30 天，不建 Release；
    - 门禁的 `--note` 记下 `no_cache` 的取值。
  - **证据运行**：见下一条。
- **不使用缓存的运行**（运行 `37694684706`，手动触发，`no_cache: true`，提交 `ac879152`；对照 `AG-17/`；运行产物 `margin-gates-ac879152…` 和 `margin-native-ac879152…`，保留到 2026-11-06）：
  - **耗时**：作业 4 分 18 秒（22:12:45–22:17:03 UTC）。
  - **缓存**：两个 `actions/cache` 步骤都显示为 skipped。`setup-node` 只把下载的 Node 放进它自己的工具缓存，日志里没有恢复 npm 缓存。`setup:native` 走了 `1/5 Electron 43.1.0 binary` 的下载分支。
  - **从零编译**：`setup-native.log` 中有 `Compiling napi v3.8.3`、`Compiling cidre v0.11.10`，cargo `Finished release … in 34.09s`。按 `no_cache` 的要求核对这一行的步骤通过。
  - **原生模块产物**：`BUILD-INFO.txt` 记录了提交 `ac879152`、`no_cache: true`、rustc 1.98.1、Xcode 16.4、本次编译了 `cidre`，以及 sha256 `33e82789…4ed4e4e`（arm64 Mach-O）。当时下载后重算的 sha256 与之相同，但没有留下记录（第六轮复查第 6 条）；2026-10-08 重新下载核对，收据见 `CI-37694684706/native/sha256-recheck.txt`。
  - **结果**：运行器退出 0，15 个步骤全部退出 0，与本机 `AG-17-review3/` 一致：
    - 测试 726 个，721 通过，0 失败，5 跳过；`tests.log` 为空；
    - 回归 6/6，会议存储 2/2，启动冒烟 1/1（启动器就绪 0.9 秒）。
  - **未提交路径为 1**：门禁开始时，工作流刚把 `setup-native.log` 写进检出目录下的 `native-artifact/`，这个目录没有被忽略；前两次运行（`37639645826`、`37691910692`）都是 0。所以这 1 个路径**推断**是 `native-artifact/`。当时的 `summary.json` 只记数量，不记清单，无法直接证实，也无法完全排除已跟踪文件的改动（第四轮复查第 5 条）。之后的修改：门禁在 `summary.json` 中记下未提交路径的清单（`uncommittedPathList`，是门禁开始时的快照，最多 200 项），工作流把这个目录移到 `$RUNNER_TEMP`。
  - **原始证据**：已存入仓库 `docs/margin/evidence/CI-37694684706/`，包括完整作业日志、步骤结论、门禁产物，以及原生模块产物中除二进制以外的文件。
  - **结论**：当时满足 S11 对第 1 条的要求。第四轮修复改了应用代码，所以要在新代码上重跑，见下一条。

- **第四轮修复后的不使用缓存的运行**（运行 `37698721357`，手动触发，`no_cache: true`，提交 `5e2dac07`，代码与 `4bd2eb00` 相同；对照 `AG-17/`；原始证据在 `docs/margin/evidence/CI-37698721357/`；运行产物保留到 2026-11-06）：
  - **耗时**：作业 4 分 25 秒（22:50:51–22:55:16 UTC）。
  - **缓存**：两个 `actions/cache` 步骤都是 skipped（`job-steps.json`）；`setup:native` 走了 `1/5 Electron 43.1.0 binary` 的下载分支。
  - **从零编译**：`Compiling cidre v0.11.10`，cargo `Finished release … in 33.58s`；核对这一行的步骤通过。
  - **原生模块产物**：`BUILD-INFO.txt` 记录提交 `5e2dac07`、`no_cache: true`、本次编译了 `cidre`，sha256 `33e82789…4ed4e4e`，下载后重算一致（当时未留记录；2026-10-08 重新核对的收据见 `CI-37698721357/native/sha256-recheck.txt`）。与 `37694684706` 的产物 sha256 相同：同一工具链、同一源码下从零构建的结果可复现。
  - **结果**：运行器退出 0，15 个步骤全部退出 0，与本机 `AG-17-review4/` 一致：
    - 测试 734 个，729 通过，0 失败，5 跳过；`tests.log` 为空；
    - 回归 6/6，会议存储 3/3，启动冒烟 1/1（启动器就绪 0.95 秒）；
    - `summary.json` 的未提交路径为 0，清单为空。
  - **结论**：满足 S11 对第 1 条的要求。

- **第五轮修复后的不使用缓存的运行**（运行 `37700866188`，手动触发，`no_cache: true`，提交 `fd47de32`，代码与 `d26a9937` 相同；对照 `AG-17/`；原始证据在 `docs/margin/evidence/CI-37700866188/`；运行产物保留到 2026-11-06）：
  - **耗时**：作业 4 分 21 秒（23:12:09–23:16:30 UTC）。
  - **缓存**：两个 `actions/cache` 步骤都是 skipped，其余步骤都是 success（`job-steps.json`）；`setup:native` 走了 `1/5 Electron 43.1.0 binary` 的下载分支。
  - **从零编译**：`Compiling cidre v0.11.10`，cargo `Finished release … in 33.61s`；核对这一行的步骤通过。
  - **原生模块产物**：`BUILD-INFO.txt` 记录提交 `fd47de32`、`no_cache: true`、本次编译了 `cidre`；sha256 `33e82789…4ed4e4e`，下载后重算一致（当时未留记录；2026-10-08 重新核对的收据见 `CI-37700866188/native/sha256-recheck.txt`），与前两次从零构建相同。
  - **结果**：运行器退出 0，15 个步骤全部退出 0，与本机 `AG-17-review5/` 一致：
    - 测试 736 个，731 通过，0 失败，5 跳过；`tests.log` 为空；
    - 回归 6/6，会议存储 3/3，启动冒烟 1/1（启动器就绪 1.0 秒）；
    - `summary.json` 的未提交路径为 0，清单为空。
  - **结论**：满足 S11 对第 1 条的要求（`d26a9937` 的代码）。第六轮修复改了应用代码，要在新代码上重跑，见下一条。

- **第六轮修复后的不使用缓存的运行**（运行 `37703373985`，手动触发，`no_cache: true`，提交 `78015838`，代码与 `fa70efc8` 相同；对照 `AG-17/`；原始证据在 `docs/margin/evidence/CI-37703373985/`；运行产物保留到 2026-11-06）：
  - **耗时**：作业 4 分 36 秒（23:38:14–23:42:50 UTC）。
  - **缓存**：两个 `actions/cache` 步骤都是 skipped，其余步骤都是 success（`job-steps.json`）；`setup:native` 走了 `1/5 Electron 43.1.0 binary` 的下载分支。
  - **从零编译**：`Compiling cidre v0.11.10`，cargo `Finished release … in 35.41s`；核对这一行的步骤通过。
  - **原生模块产物**：`BUILD-INFO.txt` 记录提交 `78015838`、`no_cache: true`、本次编译了 `cidre`；sha256 `33e82789…4ed4e4e`，与前三次从零构建相同。下载后重算一致，收据见 `CI-37703373985/native/sha256-recheck.txt`。
  - **结果**：运行器退出 0，15 个步骤全部退出 0，与本机 `AG-17-review6/` 一致：
    - 测试 737 个，732 通过，0 失败，5 跳过；`tests.log` 为空；
    - 回归 6/6，会议存储 5/5，启动冒烟 1/1（启动器就绪 1.8 秒）；
    - `summary.json` 的未提交路径为 0，清单为空。
  - **结论**：满足 S11 对第 1 条的要求（`fa70efc8` 的代码；第七轮复查第 5 条接受）。第七轮修复改了应用代码，要在新代码上重跑，见下一条。

- **第七轮修复后的不使用缓存的运行**（运行 `37706465030`，手动触发，`no_cache: true`，提交 `d70e585d`，代码与 `9a7dcf1c` 相同；对照 `AG-17/`；原始证据在 `docs/margin/evidence/CI-37706465030/`；运行产物保留到 2026-11-07）：
  - **耗时**：作业 4 分 35 秒（2026-10-08 00:11:55–00:16:30 UTC）。
  - **缓存**：两个 `actions/cache` 步骤都是 skipped，其余步骤都是 success（`job-steps.json`）；`setup:native` 走了 `1/5 Electron 43.1.0 binary` 的下载分支。
  - **从零编译**：`Compiling cidre v0.11.10`，cargo `Finished release … in 33.31s`；核对这一行的步骤通过。
  - **原生模块产物**：`BUILD-INFO.txt` 记录提交 `d70e585d`、`no_cache: true`、本次编译了 `cidre`；sha256 `33e82789…4ed4e4e`，与前四次从零构建相同。下载后重算一致，收据见 `CI-37706465030/native/sha256-recheck.txt`。
  - **结果**：运行器退出 0，15 个步骤全部退出 0，与本机 `AG-17-review7/` 一致：
    - 测试 740 个，735 通过，0 失败，5 跳过；`tests.log` 为空；
    - 回归 6/6，会议存储 5/5，启动冒烟 1/1（启动器就绪 1.1 秒）；
    - `summary.json` 的未提交路径为 0，清单为空。
  - **结论**：满足 S11 对第 1 条的要求。

- **第八轮修复后的不使用缓存的运行**（运行 `37709440574`，手动触发 `no_cache: true`，提交 `c43b10e9`；原始证据在 `docs/margin/evidence/CI-37709440574/`）：
  - 两个 Electron/cargo `actions/cache` 步骤均 skipped，`npm ci`、`setup:native` 及其余步骤 success；日志明确出现 `Compiling cidre v0.11.10`。
  - `BUILD-INFO.txt` 记录同一提交、`no_cache: true`、Xcode 16.4、rustc 1.98.1 和本次编译 cidre；下载原生模块重新计算 sha256 为 `33e827897d1c2a633c2ee885b17a598ec9b259aba7305e528528f25cb4ed4e4e`，与记录一致。两个 ZIP 的 digest 与 GitHub artifact 元数据一致，解压前已检查路径和文件类型；二进制不提交。
  - 15 个门禁步骤全部退出 0，未提交路径 0；104 个测试文件，767 测试、762 通过、0 失败、5 既有跳过；回归 6/6、存储 5/5、启动 1/1。
  - 本机与 CI 都是 G2 零未豁免命中；CI 重新拉取上游 refs，受限池和已豁免命中计数不同，不声称两个池完全相同。
  - **结论**：满足 S11 当前源码的第 1 条要求。独立最终证据复核按用户最新委派模型约定由 `gpt-6.1-sol/high` 完成；历史 Astra 源码审查记录保留，不改称模型。

### AG-15 记录（2026-10-07）

**1. 删除**

- 本地 STT：`electron/audio/whisper/`（模型管理、预加载、硬件检测、VAD、worker 等 10 个文件）、`electron/audio/LocalWhisperSTT.ts`、`src/components/LocalWhisperModelPanel.tsx` 及其专用的 `whisper-dl` 动画样式；`main.ts` 中启动时的模型预加载和 `local-whisper` 分支；9 个 `local-whisper-*` IPC 和事件，preload 与类型中的 9 个对应成员；`SettingsManager` 中 4 个 `localWhisper*` 设置项；设置界面中的"Local Whisper"选项和模型面板。
- 模型和下载：`scripts/download-models.js`、仓库中提交的 `resources/models/`（`Xenova/all-MiniLM-L6-v2` 和 `Xenova/mobilebert-uncased-mnli`，含 4 个 `.onnx` 文件）、`docs/LOCAL_STT_NATIVELY_SETUP.md`。
- `package.json`：`postinstall`（AG-08 起已因 `ignore-scripts` 不执行，现删除）、`extraResources` 中的 `resources/models/`、`@huggingface/transformers` 和 `onnxruntime-node` 依赖及 `overrides`。lockfile 用 `npm install --package-lock-only --ignore-scripts` 同步，其余变动只是若干包改标为 `dev`/`optional`。
- 测试：`LocalWhisperStopFlush`（2 个用例，只查源码字符串）和 `WhisperWorkerPathResolver`（3 个）随功能删除；`SensitiveLogRedaction` 删掉对已删除的模型分类日志的断言，其余断言不变。
- `scripts/patch-electron-plist.js` 的注释改为由 `setup:native` 调用。

**2. 意图分类的本地模型（行为变化）**

- `IntentClassifier` 原有三级：正则 → 本地零样本模型（`mobilebert-uncased-mnli`，经 `@huggingface/transformers`；打包版用随包模型，开发版从 `resources/models` 读取）→ 按上下文推断。删除依赖后只剩第一和第三级，即基线在模型加载失败时本来就走的路径；启动时的 `warmupIntentClassifier` 一并删除。
- **影响**：正则没有命中的提问，原先可能被模型分到某个意图，现在按上下文推断（多为 `general`），回答结构提示可能不同。这属于本票"依赖树里没有 transformers、安装和打包不涉及模型"的范围，但没有用真实模型评估质量差异（未获授权），记为未验证。
- `all-MiniLM-L6-v2` 是 RAG 的嵌入模型，代码已在 AG-14 删除，本票删掉模型文件。

**3. 已保存的 `local-whisper` 设置**

- `CredentialsManager.getSttProvider()` 把已保存的 `local-whisper` 读作 `none`（不转写）；`get-stored-credentials` 也改用这个方法。否则 `createSTTProvider` 会落到最后的 Google 分支，把音频发给用户没有选的云端服务。
- 新增行为测试 `electron/services/__tests__/SttProviderLocalWhisperRetired.test.mjs`：用替身 `electron` 模块加载构建后的 `CredentialsManager`，凭据文件在临时目录。验证读回为 `none`，之后选择 `groq` 能正常保存和读回。去掉映射后该测试失败（已手动验证）。
- 首版测试用的是上游常见的 `Module._load` 替身写法，与受限上游的 12 行逐字相同；改为预置 `require.cache` 的写法后剩 4 行通用写法，已加入白名单。

**4. 检查结果**

命令：`node scripts/margin/run-gates.mjs --out docs/margin/evidence/AG-15 --ref docs/margin/evidence/AG-14`，运行器退出码 0。（首次运行时还没有新测试和白名单补充；补上后整套重跑，证据为重跑结果。）

| 步骤 | 退出码 | 结果 | 原始输出 |
| --- | --- | --- | --- |
| 清空构建目录、`build-electron`、`vite build` | 0、0、0 | 通过 | `clean-dist.log`、`build-electron.log`、`vite-build.log` |
| 渲染层 `tsc` | 0 | 0 个错误 | `tsc-renderer.log` |
| Electron `tsc` | 2 | 9 类诊断全部继承，没有新增 | `tsc-electron.log`、`tsc-electron.diagnostics.txt` |
| G2 来源检查 | 0 | 零命中。新增 5 条白名单：CI 首次运行发现的 1 条，新测试的 4 条 | `provenance.log` |
| G3 | 0 | 137 条规则零命中；AG-15 列入已完成 ticket，规则从 9 条增加到 26 条（IPC 名、preload 名、设置项、模型 ID 等） | `retired.log` |
| preload 契约 / IPC 通道 | 1 / 1 | 各 4 个、2 个缺口，全部继承，没有新增 | `*.gaps.txt` |
| 守卫自测 | 0 | 通过 | `guard-selftest.log` |
| 测试（106 个文件） | 1 | 621 个测试，579 通过，12 失败，30 跳过。失败条目 20 个，**全部继承，新增 0**，与 AG-14 相同 | `tests.tap`、`tests.files.json`、`test-failures.txt` |
| AG-09 回答回归 | 0 | 5/5 通过 | `regression.log` |
| 会议存储 | 0 | 1/1 通过 | `storage.log` |
| `git diff HEAD --check` | 0 | 无问题 | `diff-check.log` |

- **测试数**：624 − 2（`LocalWhisperStopFlush`）− 3（`WhisperWorkerPathResolver`）+ 2（新增）= 621。
- **安装检查**（`install-check.log`）：在本工作树运行 `npm ci`（退出 0）后，`resources/` 不存在，仓库中没有 `.onnx`、`.gguf`、`.bin` 文件；`npm ls onnxruntime-node @huggingface/transformers` 输出 `(empty)`（找不到包时 npm 退出 1）；随后 `npm run setup:native` 退出 0，门禁在这套依赖上运行。
- **未验证**：意图分类去掉模型后的回答质量（见第 2 条）；阶段 1 出口第 1 条（干净安装）仍等待 D5。

### AG-16 记录（2026-10-07）

**1. 删除**

- **手机镜像**：`PhoneMirrorService.ts`、`phoneMirrorClient.ts`、`PhoneMirrorSettings.tsx`。另外删除：
  - `ipcHandlers` 中各处向手机推送的代码块，以及 8 个 `phone-mirror:*` IPC 和事件；
  - `main.ts` 中的自动启动和退出清理；
  - 设置项 `phoneMirrorEnabled`、`phoneMirrorExposeOnLan`，preload 的 8 个成员和类型，`NativelyInterface` 中接收手机消息的监听；
  - 设置页的"手机镜像"标签；依赖 `qrcode`、`@types/qrcode`。
- **动态动作**：`electron/services/dynamic-actions/`、`src/components/dynamic-actions/`。另外删除：
  - `IntelligenceEngine` 中的引擎状态、接口和事件，`IntelligenceManager` 的转发；
  - `main.ts` 中会议开始时的 `setDynamicActionContext` 和事件转发；
  - 3 个 `dynamic-action:*` IPC、`intelligence-dynamic-action` 事件、preload 成员和类型；
  - 整条 `promptInstruction` 参数链：`WhatToAnswerLLM` → `IntelligenceEngine`/`Manager` → `generate-what-to-say` 的第三个参数 → preload 和类型 → `NativelyInterface`。
  - 按背景说明，`IntelligenceEngine` 本身保留。
  - Recap/Brainstorm 快捷键的 id `dynamicAction4` 和"Dynamic Action Button Mode"（Recap 与 Brainstorm 切换）是另一个功能，保留。
- **联网搜索（Tavily）**：`CredentialsManager` 的 `tavilyApiKey`、`set-tavily-api-key` IPC、`hasTavilyKey`、preload 和类型成员、设置页中未使用的删除按钮处理函数；依赖 `@tavily/core`。服务代码在更早的票里已经不存在，这里删的是剩下的存储和接口。
- **OCR**：
  - 删除 `eng.traineddata`、`tests/fixtures/screen/`、`OcrProvider.ts`、`OcrProviderManager.ts`；依赖 `tesseract.js`。
  - `ScreenContextService.ts` 只保留 `ScreenContext` 接口，回答链仍在用；其中 `ocrText` 现在由视觉识别填写。
  - 截图、`ImageOptimizer` 和视觉回答保留。
- **cURL / 自定义提供方**：
  - 删除 `curlUtils.ts`、`src/lib/curl-validator.ts`、`visionCapability.ts`；依赖 `@bany/curl-to-json`。
  - `LLMHelper` 中的 `chatWithCurl`、`executeCustomProvider`、`streamWithCustom`、`switchToCurl`、`switchToCustom` 等，以及聊天、流式、视觉回退、会议摘要中的全部自定义分支。`setModel()` 不再接收自定义列表，`getCurrentProvider()` 只返回 `gemini` 或 `codex-cli`。
  - `prompts.ts` 中 7 个 `CUSTOM_*` 提示词；`VisionProviderRegistry` 的 `custom()`。
  - `CredentialsManager` 的两类存储（`customProviders`、`curlProviders`）和增删查方法。
  - 8 个 IPC（`get/save/delete/switch-to-custom-provider`、`get/save/delete/switch-to-curl-provider`），preload 的 3 个成员和类型。
  - 设置页的"Custom Providers"一节，模型选择器和默认模型下拉中的自定义项，帮助页中的对应一节。
  - `ProcessingHelper`、`main.ts`（结束会议时恢复默认模型）中合并自定义列表的代码。
  - `validateImagePath` 原放在 `curlUtils.ts`，截图 IPC 和 `ScreenUnderstandingService` 仍在用，原样移到 `electron/utils/imagePathValidation.ts`。
- **跟进邮件**：
  - 删除 `FollowUpEmailModal.tsx`（没有任何地方引用）、`emailUtils.ts`；3 个 IPC（`generate-followup-email`、`extract-emails-from-transcript`、`open-mailto`）及 preload 和类型成员；`FOLLOWUP_EMAIL_PROMPT`、`GROQ_FOLLOWUP_EMAIL_PROMPT`、`TINY_FOLLOWUP_EMAIL_PROMPT`。
  - 会后流程里按模板拼出的邮件草稿（`buildFollowUpDraft`、`followUpDraft` 字段和会议详情页的"Follow-up Draft"一节）也是跟进邮件，一并删除。结构化的下一步事项（`actionItemsStructured`）保留。
  - 旧会议在数据库 JSON 里存的 `followUpDraft` 不迁移，只是不再显示。
- **日历残留**（主体已在 AG-10 删除）：`SessionTracker`/`MeetingPersistence` 的会议元数据只剩 `title`，保存时 `source` 固定为 `manual`。数据库的 `calendar_event_id` 列和 `Meeting` 类型中的两个字段保留，以便读取旧版本保存的会议，代码中有注释说明。
- **画像残留**：AG-10 已删除画像本身。这次只改了 `LLMHelper` 中提到它的一处注释。
  - `prompts.ts` 中仍有一段描述简历注入块（`<candidate_experience>` 等）的提示词。改提示词会改变回答行为，与决定 1 同属提示词范围，这次不动，留到阶段 2/3 重写提示词时处理（这是 AG-16 当时的安排；现由 S12 接替：阶段 3 在 AG-33 中用真实模型评估后一并处理）。
  - 自定义备注和 persona（`profile_custom_notes`、`profile_persona`）以及数据范围 `profile_history` 是保留的功能。

**2. 随功能删除或修改的测试**

- **删除的测试文件**（10 个，共 77 个用例）：
  - `DynamicActionEngine`（15）、`DynamicActionPromptInstructionWiring`（3）、`IntelligenceEngineDynamicActions`（8）；
  - `VisionCapability`（15）、`CurlProviderPayloadValidation`（1）、`SsrfProtection`（5，见下文）；
  - `OcrRealFixtures`（6）、`ScreenContextService`（7）、`ScreenUnderstandingMode`（13）、`ScreenUnderstandingService`（4）。最后四个在基线上就整体跳过（共 30 个），所以跳过数从 30 降到 0。
- **修改的测试**（删除 6 个用例，其余断言不变）：
  - `suggestionPromptAssembly` 的动态动作用例；
  - `IntelligenceEngineScreenContext` 的 `promptInstruction` 用例；
  - `IdentityGuard` 的 `CUSTOM_ANSWER_PROMPT` 用例；
  - `PostCallWorkflow` 的 `buildFollowUpDraft` 用例，另有两处 `followUpDraft` 断言；
  - `GlobalShortcutTargeting` 的手机镜像用例（它检查的代码已删除）；
  - `VisionProviderFallbackChain` 的"OCR 模块未被导入"用例。这项检查由 G3 接替：两个 OCR 文件的路径规则、符号 `OcrProvider`/`OcrProviderManager`、依赖 `tesseract.js`，范围是全仓库而不只三个文件。
  - 只删断言、不删用例的：`ScopeLocalFallback` 中 `chatWithCurl` 和自定义分支省略上下文的两条；`ProviderGatewayPolicy` 中 `custom_curl`、`custom_provider` 两个守卫点；`SensitiveLogRedaction` 中 5 条 Custom Provider 日志断言；`E2EParityEvidence` 中的动态动作断言。
- **SSRF 与 URL 校验**：`SsrfProtection` 只检查 `chatWithCurl` 在请求前是否校验地址。cURL 提供方删除后，没有任何代码再向用户填写的地址发请求，所以整文件删除。这会影响后面两项：
  - **AG-24** 原计划的 SSRF 检查；
  - **AG-31** 的 URL 校验。
  - 阶段 3 加回兼容地址时，需要重新写这类测试（行为测试，不再查源码字符串）。
- **AG-09 回归**：`cancelChatStream` 用例的 mock 间隔从 400 毫秒改为 800 毫秒，原因见上文 CI 门禁记录中的"AG-15 收尾运行"。本机改后耗时 5.6 秒，通过。

**3. 界面文字更正**

- 删除自定义提供方后，已经没有任何本地模型。设置页"Cloud provider data scopes"原来写的是"Disabled types are handled locally"和"falls back to the best available local model"，与实际行为不符。
- 实际行为见 `LLMHelper` 的 `[ScopeFallback]` 日志：被禁用的数据类型直接从请求中省略。两句已改为如实描述。

**4. G3 盘点**

新增 90 条 AG-16 规则，加上原有 12 条，共 102 条，零命中。AG-16 已列入已完成的 ticket，现在共启用 239 条（137 + 102）。新增规则覆盖：
- 上述删除文件的路径；
- 全部删除的 IPC 名、preload 成员、设置字段（含 Tavily 的 `tavilyApiKey`、`hasTavilyKey`、`set-tavily-api-key`）；
- `chatWithCurl` 等方法名、`CUSTOM_*` 和跟进邮件提示词名、`promptInstruction`、`followUpDraft`；
- 主机 `api.tavily.com`。

`ScreenContextService` 文件保留，所以没有为它设符号规则。

**5. 检查结果**

命令：`node scripts/margin/run-gates.mjs --out docs/margin/evidence/AG-16 --ref docs/margin/evidence/AG-15`。

第一次运行中，测试多出 1 个新失败：`ScopeLocalFallback` 的 `shouldOmitContext ? "" : context` 断言，它只对应已删除的自定义分支。删掉这条断言后整套重跑，证据为重跑结果。

运行器退出码 0。

| 步骤 | 退出码 | 结果 | 原始输出 |
| --- | --- | --- | --- |
| 清空构建目录、`build-electron`、`vite build` | 0、0、0 | 通过 | `clean-dist.log`、`build-electron.log`、`vite-build.log` |
| 渲染层 `tsc` | 0 | 0 个错误 | `tsc-renderer.log` |
| Electron `tsc` | 2 | 剩 8 类诊断，全部继承，没有新增；减少的 1 类是 `ipcHandlers.ts` 中 cURL 校验函数返回值的 `error` 属性错误（×2），随代码删除 | `tsc-electron.log`、`tsc-electron.diagnostics.txt` |
| G2 来源检查 | 0 | 零命中，没有新增白名单 | `provenance.log` |
| G3 | 0 | 239 条规则零命中 | `retired.log` |
| preload 契约 / IPC 通道 | 1 / 1 | 各 4 个、2 个缺口，全部继承，没有新增 | `*.gaps.txt` |
| 守卫自测 | 0 | 通过 | `guard-selftest.log` |
| 测试（96 个文件） | 1 | 538 个测试，526 通过，12 失败，0 跳过。失败条目 20 个，**全部继承，新增 0**，与 AG-15 相同 | `tests.tap`、`tests.files.json`、`test-failures.txt` |
| AG-09 回答回归 | 0 | 5/5 通过 | `regression.log` |
| 会议存储 | 0 | 1/1 通过 | `storage.log` |
| `git diff HEAD --check` | 0 | 无问题 | `diff-check.log` |

- **测试数**：621 − 77（删除的文件）− 6（删除的用例）= 538。
- **安装检查**（`install-check.log`）：
  - `npm ci` 退出 0；
  - `npm ls` 查 5 个已删依赖，输出 `(empty)`（npm 找不到包时退出 1）；
  - `node_modules` 中没有 `tesseract.js`、`tesseract.js-core`、`@tavily/core`、`qrcode`、`@types/qrcode`、`@bany/curl-to-json`；
  - 仓库中不再有 `eng.traineddata` 和 OCR 图片；
  - `setup:native` 退出 0。
- **lockfile**：用 `npm install --package-lock-only --ignore-scripts` 同步，只删除条目（共 29 个包），其余几行只是 `optional`/`devOptional` 标记变化。
- **`electron/utils` 测试**：`validateImagePath.test.mjs` 不在门禁的测试范围内。手动在守卫下运行，10/10 通过，见 `validateImagePath.log`；AG-17 会把 `utils` 测试纳入门禁。
- **未验证**：
  - 实际界面：设置页去掉两节，模型选择器只剩云端模型和 Codex CLI；只做了构建和类型检查，没有截图核对；
  - 用户的旧凭据文件中已有的 `customProviders`/`curlProviders`/`tavilyApiKey` 字段：代码不再读取，但下次保存时仍会原样写回（加密存储），没有主动清除。

### AG-17 记录（2026-10-07）

**1. 类型错误（两个 `tsc` 都退出 0）**

AG-16 结束时 Electron `tsc` 还剩 8 类诊断，处理如下：

- `sendModelChanged` 不存在（×2）：这是运行时错误，AG-09 已记录（`set-model` 报 `appState.sendModelChanged is not a function`，悬浮窗的模型标签不更新）。在 `AppState` 中新增 `sendModelChanged()`，写法与同文件的 `sendToMeetingSurfaces` 一致，只发给悬浮窗和模型选择窗口；结束会议时恢复默认模型也改用它，不再广播给所有窗口。
- `ModelSelectorWindowHelper.setIgnoreBlur` 不存在（×2）：切换隐身模式且模型选择窗口可见时，这两处调用会抛出 TypeError。模型选择窗口本身没有失焦关闭的处理，这两处调用删除。
- `preparedTranscriptContext.ts`（×2）和 `IntelligenceEngine.ts`（×1）：接口把 `role` 写成 `string`、把回答历史写成 `string[]`，实际传入的是 `ContextItem` 和 `AssistantResponse[]`，`buildTemporalContext` 也按后者使用。改为引用这两个类型；运行时行为不变。
- `LLMHelper.ts` 的隐式 `any`：给 `.catch(() => undefined)` 加上返回类型。
- `electron/test/` 下两个手动脚本：`erp-1hour-real.test.ts` 比较了不可能相等的值，改为按是否有 key 判断；`input-fuzzing.test.ts` 补上缺少的 `sqlInjection` 字段。这两个脚本不在任何测试命令里，其中前者需要真实 key，不运行。

**2. Electron 43（D1）**

- `electron` 固定为 43.1.0（X3 测试过的版本），`better-sqlite3` 升到 12.11.1。lockfile 中其余变化是 Electron 自身的依赖，以及删除 `three`、`@types/three`、`@google/stitch-sdk` 后去掉的包。
- `better-sqlite3` 没有适配 Electron 43 的预编译包，`setup:native` 第 3 步会在本机编译。X3 发现的两个问题现在由脚本处理（`nativeCompileEnv()`）：
  - 把 `/usr/bin` 放到 `PATH` 前面，避开 anaconda 的 GNU libtool；
  - 先试编译一行 `#include <cstdio>`；只有失败时（只装了 CommandLineTools），才把 `CXXFLAGS` 指向 SDK 的 libc++ 头文件。装有完整 Xcode 的机器（如 CI）编译成功，不加任何参数。
- 本机结果见 `AG-17/install-check.log`：`npm ci` 退出 0，`setup:native` 退出 0，日志显示走了 libc++ 头文件的分支，`Rebuild Complete`。之后整套门禁（含三个启动应用的测试）都在 Electron 43 上运行。
- 启动时间：新增的启动冒烟测试中，`setup:native` 之后的第一次启动约 5.6 秒，与 X3 中 43.1.0 的 5.5 秒相近；门禁中的那次约 1.1 秒（缓存已热）。两次都是从启动到启动器窗口有内容，不是严格的性能测量。

**3. 剩余依赖（G3 中 AG-17 的规则）**

删除没有任何引用的 `three`、`@types/three`、`@google/stitch-sdk`。AG-17 列入已完成的 ticket，G3 现在启用 242 条规则；`--all` 同样是 242 条、零命中。

**4. 基线遗留的测试失败（20 条，全部处理）**

分三类处理：修代码、改测试，或标为跳过并写明原因和负责的 ticket。

- **修代码**：
  - `ModelChangedTargeting`（2）：见第 1 条。
  - `TokenBatchFlushNoTrailing`（1）：令牌批量发送改为保存 `setImmediate` 句柄。在最终答案之前同步发送时取消排队中的那次，保证排队的令牌不会晚于最终答案到达。
  - `AudioTestSystemAudioLevelMeter`（4）：主进程、preload 和类型早已在音频测试时探测系统音频并发送电平，只差设置页的显示。设置页现在订阅这两个事件，在输出设备下面显示"System Audio Level"电平条；探测失败时显示主进程给出的提示。
- **改测试**（断言与基线代码本身不符，或依赖本机环境）：
  - `Issue252WindowsAudioBanner`（1）：基线横幅在 macOS 上分别深链到"屏幕录制"和"麦克风"两个面板，非 macOS 时回到应用内设置，这正是 #252 要求的行为。原断言"整个文件最多出现一次 `x-apple.systempreferences`"写在麦克风分支加入之前。改为：每个面板的地址最多出现一次，且非 macOS 时深链为 `null`。
  - `suggestionPromptAssembly`（1）：原用例断言的调用形式（`streamChat(..., undefined, undefined, ...)` 两次，`generateWithCodexCli(...)`）基线代码里从来没有。改为行为测试：用替身运行构建后的 `generateSuggestion`，确认自定义备注和会议上下文作为 `context` 进入用户消息（`streamChat` 把 `context` 放进用户内容）、系统提示词等于固定的回答提示词；Codex CLI 路径同样检查。用例改名为 `generateSuggestion sends custom notes and the transcript as user content, not in the system prompt`。
  - `CodexCliService`（1）：结果取决于本机是否装有 codex，本机的守卫又会拦下真实的 codex。改为替换候选路径列表，一次指向临时的 mock 程序（应当找到并通过），一次只有不存在的路径（应当失败）。
  - `NativeAbiGuardStartupOrder`（2）：要求有 `ensureNativeModuleAbi()`，即运行时发现原生模块 ABI 不符时自动重建或重启。基线没有这个功能，Margin 也不打算加（原生模块只由审查过的 `setup:native` 构建，见 AG-08）。文件改写并改名为 `SingleInstanceLockStartup.test.mjs`，检查剩下的有意义部分：单实例锁只申请一次，在启动的第一个 `await` 之前申请，失败的实例立即 `app.exit(0)`。
- **跳过并写明原因**（G6 允许，原因写在测试里）：
  - `ActivationPolicyOrdering`（1）：要求非隐身启动时先设为 `accessory`，窗口创建后再设为 `regular`。基线没有这个顺序。改动 macOS 程序坞和激活策略属于 AG-61（窗口保护与伪装），实机检查需要 D2 授权，所以交给 AG-61。
  - `OpenAIRealtimeGAProtocol` 中 4 个用例（另有 1 条 `<did not finish>` 和 2 个父项随之消失）：
    - 这些用例要求发送 `transcription_session.update` 和 `input_audio_format`。基线代码发送的是 `session.update` 加 `audio.input`，并把 `session.created` 当作就绪。
    - 哪一种符合 OpenAI 现在的 Realtime 转写接口，要查官方文档并做一次真实调用（D2），所以由 AG-40/AG-41 决定。
    - 这个文件此前始终"未完成"的原因也查清了：`session.created` 用例在现有代码上会启动一个 20 秒的保活定时器，没有清理，进程无法退出（用定时器追踪定位到 `_startKeepAlive`）。跳过后整个文件 38 个用例正常结束，其余 34 个通过。
  - 这 5 个跳过是延期，不是修复，不能说明现有协议或激活顺序正确（Astra 复核第 6 条）。恢复这些检查已写进第 6 节 AG-41 和 AG-61 的范围。

**5. 测试脚本和覆盖范围**

- `npm test` 改为在守卫下运行，范围加上 `electron/margin`、`electron/utils`、`electron/test` 和 `src/lib` 的测试；门禁的 `tests` 步骤范围相同（新增 8 个文件，140 个用例）。
- 新增 `npm run test:margin`（构建后在守卫下运行回答回归、会议存储和启动冒烟三个启动应用的测试），以及 `npm run gates`。
- 删除引用已删除 `natively-api` 的 `test:e2e:screen-understanding`。`tests/e2e` 的 Playwright 脚本（对着 Vite 开发服务器）保留不动，不属于 G6。

**6. 启动冒烟（出口第 5 条）**

新增 `tests/margin/startup-smoke.test.mjs`，并作为门禁的 `startup` 步骤。在守卫和全新沙盒中启动构建后的应用，检查：
- 启动器窗口和设置窗口打开并可见（记录就绪时间）；
- 观察 15 秒，主进程仍在运行；
- `app.quit()` 后主进程以退出码 0 结束；
- 沙盒中 `natively_debug.log` 和主进程输出里没有 `[CRITICAL]`、未捕获异常或未处理的 rejection（`main.ts` 把这两类都写进该日志）；
- 守卫记录的外连为零。

**7. 契约检查清零**

- preload 契约原有 4 个缺口：
  - `stealthTapRefreshIme`：主进程已有 `stealth-tap:refresh-ime` 处理函数，渲染层在窗口获得焦点时调用，只是 preload 没有提供，补上桥接；
  - `closeSettingsWindow`、`closeAdvancedSettings`：类型中声明，但没有任何地方提供或使用，删除；
  - `path`：检查脚本的误报，原因是 `deleteScreenshot` 的参数分行书写，改为一行。
- IPC 通道原有 2 个缺口：`toggle-advanced-settings` 从来没有处理函数，渲染层也不用，删除对应的 preload 成员；`native-audio-connect` 只出现在一行注释掉的代码里，连同空的 `try` 一起删除。
- 两项检查现在都是零缺口。`docs/margin/ipc-baseline-gaps.txt` 已清空，故删除；`SkillsIpcWiring` 中"已知无处理函数"的名单也清空。

**8. `.npmrc`（出口第 1 条要求评估）**

- 保留 `ignore-scripts=true`。`package.json` 已经没有任何安装生命周期脚本，但依赖中仍有 13 个包带安装脚本：`@google/genai`、`better-sqlite3`、`core-js`、`electron-winstaller`、`esbuild`、`fsevents`（两份）、`keytar`、`lzma-native`、`msgpackr-extract`、`protobufjs`、`sharp`、`sqlite3`。
- 撤掉这一行，`npm ci` 就会执行这些未经审查的脚本，包括下载二进制和本机编译。保留它，原生部分只经过 `setup:native` 这一条审查过的路径。

**9. 来源检查**

第一次运行门禁时 G2 命中 15 行（13 种不同的行），全部来自本票新写的代码：
- 设置页电平条的 10 行。标识符 `onAudioTestSystemLevel`、`onAudioTestSystemError`、`systemAudioLevel` 和 `width: `${systemAudioLevel}%`` 都是基线测试逐字要求的，每行写法照搬旁边基线的麦克风电平条；
- `public sendModelChanged(modelId: string): void {` 和 `this.sendModelChanged(defaultModel);`。名称由基线 `ipcHandlers.ts` 的调用和基线测试决定；
- `let pendingFlushHandle: NodeJS.Immediate | null = null;`。这正是基线测试的正则；
- preload 的 `stealthTapRefreshIme: () => Promise<boolean>;`。即基线类型声明；
- `const KNOWN_STALE = new Set([]);`。通用写法。

这些行与受限的上游池一致，原因是名称和形状由基线测试和基线代码决定。实现是按基线测试描述的行为为本分支写的，没有参照上游实现。13 行逐条加入白名单并写明理由，重跑后零命中。

**10. 检查结果**

命令：`node scripts/margin/run-gates.mjs --out docs/margin/evidence/AG-17 --ref docs/margin/evidence/AG-16`。

第一次运行只有 G2 未通过（见第 9 条）。补上白名单后整套重跑，证据为重跑结果。

运行器退出码 0。

| 步骤 | 退出码 | 结果 | 原始输出 |
| --- | --- | --- | --- |
| 清空构建目录、`build-electron`、`vite build` | 0、0、0 | 通过 | `clean-dist.log`、`build-electron.log`、`vite-build.log` |
| 渲染层 `tsc` | 0 | 0 个错误 | `tsc-renderer.log` |
| Electron `tsc` | **0** | 0 个诊断；AG-16 的 8 类全部消除 | `tsc-electron.log` |
| G2 来源检查 | 0 | 零命中；新增 13 条白名单（见第 9 条） | `provenance.log` |
| G3 | 0 | 242 条规则零命中 | `retired.log` |
| preload 契约 / IPC 通道 | **0 / 0** | 零缺口；原有 4 个、2 个全部消除 | `*.log`、`*.gaps.txt` |
| 守卫自测 | 0 | 通过，12/12（含在 Node 下加载 Rust 原生模块的导出检查；Electron 43 中的加载由三个启动应用的测试覆盖） | `guard-selftest.log` |
| 测试（104 个文件） | 1 | 716 个测试，711 通过，**0 失败**，5 跳过。AG-16 的 20 条失败全部消除，新增 0。退出码 1 的原因见下 | `tests.tap`、`tests.files.json`、`test-failures.txt`（空） |
| AG-09 回答回归 | 0 | 5/5 通过 | `regression.log` |
| 会议存储 | 0 | 1/1 通过 | `storage.log` |
| 启动冒烟（新增） | 0 | 1/1 通过：启动器就绪 1.1 秒，设置窗口可见，观察 15 秒，退出码 0 | `startup.log` |
| `git diff HEAD --check` | 0 | 无问题 | `diff-check.log` |

- **测试数**：538 + 140（新纳入的 8 个文件）+ 38（`OpenAIRealtimeGAProtocol` 现在能结束，38 个用例全部计入；此前没有结束，不计数）= 716。锁测试改名前后都是 2 个，不影响总数。
- **`tests` 步骤的退出码 1**：所有测试通过，退出码 1 来自 `ImeDetectorCache.test.mjs`。守卫拦下了它的 2 次 `defaults` 本地调用（输入法检测），按守卫规则返回 1。这是本地替身，不是外连，AG-16 时同样如此；门禁按测试结果判定通过。
- **未验证**：
  - Electron 43 下的实际界面没有截图核对（启动冒烟只检查窗口可见、无异常、无外连）；
  - 设置页新电平条在真实系统音频下的表现（需要屏幕录制权限，阶段 1–2 不授予）；
  - 干净机器上的编译分支：本机只有 CommandLineTools，走的是 libc++ 头文件的分支；装有 Xcode 的分支由 CI 运行。

### 阶段 1 出口验收（2026-10-08 更新）

逐条对照第 5 节。历次验收及当前复验如下：
- **第一次**（`AG-17/`，提交 `e9b25ec3`）：结论"第 2–7 条通过"。Astra 第一轮复核指出第 3、5、6 条证据不足，还有一个隐私范围缺陷，结论作废。
- **第二次**（`AG-17-review/`，`e9b25ec3` 上未提交的修复）：Astra 第二轮复查指出，隐私修复漏了 Codex 路径，取消后立即开始新流仍可能显示旧流的事件，帮助页仍有本地运行的说法，守卫日志写入失败和提前结束的文件仍能让检查漏报。结论再次作废。
- **第三次**（`AG-17-review2/`，提交 `94a10fb1`，干净的工作树）：Astra 第三轮复查指出，Claude 和 Groq 多模态的非流式发送仍没有范围检查，Codex 仍被标为本地／私有处理，请求在开始流之前失败会留下旧的事件监听。结论再次作废。
- **第四次**（`AG-17-review3/`，提交 `02d4cb2e`，干净的工作树）：Astra 第四轮复查指出，拒绝 `profile_history` 时历史回答仍会随 `message` 发出，会议对话的摘要没有被识别为 `post_call_summary`。结论再次作废。
- **第五次**（`AG-17-review4/`，提交 `4bd2eb00`，干净的工作树；第 1 条以 CI 运行 `37698721357` 为准）：门禁第一次在 `4523c762` 上运行时 `tests` 步骤失败，修复后重跑通过（见第 9 节第四轮复查记录）。Astra 第五轮复查指出，在已保存的会议里提问时，`profile_history` 被拒绝也照样发送会议内容；会议的数据范围只靠渲染层声明。结论再次作废。
- **第六次**（`AG-17-review5/`，提交 `d26a9937`，干净的工作树；第 1 条以 CI 运行 `37700866188` 为准）：Astra 第六轮复查接受了会议对话的修复和 CI 证据，但指出启动时恢复未处理完的会议不检查 `profile_history`，会议详情页的编辑保存失败时界面不回滚。结论再次作废。
- **第七次**（`AG-17-review6/`，提交 `fa70efc8`，干净的工作树；第 1 条以 CI 运行 `37703373985` 为准）：第一次门禁运行漏了 `--ref`，在同一提交的干净树上加上参照重跑，两次都全部通过。Astra 第七轮复查接受了常规路径的修复、CI 证据和 S12 的同步，但指出：请求等待期间关闭数据范围，后面的发送仍会带出旧会议内容；会议详情页的回滚会干扰其他正在编辑的内容，也不总能真正回滚。结论再次作废。
- **第八次**（`AG-17-review7/`，提交 `9a7dcf1c`）：本机和 CI 门禁通过，但第八轮复查发现 SDK 隐式重试、拒绝传播和静态扫描声明问题；此时不能验收。
- **本次第八轮修复后的复验**（`AG-17-review8/gates/`，提交 `c43b10e9`，干净工作树）：下表证据均在该目录，除非另行注明；定向检查在 `AG-17-review8/checks/`，中断与重试记录在 `sol61-retry/`。本机与 CI 15 步均实际退出 0，不依赖"相比参照没有新增"来判通过。源码曾由 Astra 独立只读审查；按用户最新统一委派模型指令，重试、固定门禁与 CI 核验由 `gpt-6.1-sol` 执行，另一个 `gpt-6.1-sol/high` 独立复核原始证据和固定版本映射。

| # | 条目 | 结论 | 证据 |
| --- | --- | --- | --- |
| 1 | 干净安装 | 通过（按 S11 以 CI 为准） | D5 已定（S11）：本机不装 Xcode；本机本轮没有运行 `setup:native`，沿用过渡模块，不作从零构建证据。<br>当前证据：CI `37709440574`（`c43b10e9`），跳过 Electron 和 cargo 缓存，`npm ci` → `setup:native` 从零编译 `cidre` → 15 步全部退出 0，未提交路径为 0；原始证据在 `CI-37709440574/`。下载后的原生模块 sha256 已重新核对。<br>安装无模型下载脚本；`.npmrc` 评估见 AG-17 第 8 条。|
| 2 | 构建与类型 | 通过 | 清空构建目录后 `build-electron`、`vite build` 退出 0；两个 `tsc` 都退出 0，0 诊断 |
| 3 | 退役清理 | 通过 | `retired-check.mjs`：257 条全部已启用规则零命中（当前默认范围与 `--all` 等价）。三轮复核共新增 15 条规则，覆盖复核找到的残留：主机 `natively.software`（整个域名）、`src/lib/featureFlags.ts` 与 `PREMIUM_ENABLED`、`Phone Mirror`、`Modes Manager`、`In-App Updates`、`entirely on-device`、`fully custom endpoints`、`Autonomous Registry Sync`，帮助页曾加载的远程图标主机 `cdn.simpleicons.org`、`groq.com/favicon.svg`，以及把 Codex 说成本地处理的 `Local/private route`、`Local Provider`、`selectable local backend`、`locally authenticated Codex`。每条规则在加入前的提交上都有命中。`git ls-tree -r HEAD` 中没有 `premium`、`natively-api`、`.gitmodules`，也没有 gitlink。G3 只能证明这些规则零命中，不能证明全部清理完毕；复核中逐页检查过设置、帮助、关于和启动页 |
| 4 | 测试 | 通过（5 个既有跳过，原因见 AG-17 第 4 条，恢复要求见 AG-41、AG-61） | 守卫下 104 个文件，767 个测试，762 通过，0 失败，5 跳过；本机与 CI 原始 TAP 独立汇总一致。`test-failures.txt`、`tests.log` 为空；每文件均正常结束、退出 0，没有超时或 footer 后强制结束。门禁按 PID/ppid 和脚本路径确认守卫加载，隔离拦截、无法解释退出均为空 |
| 5 | 启动冒烟 | 通过 | `startup.log`：启动器和设置窗口可见，观察 15 秒，`app.quit()` 后退出码 0。<br>异常检查有两条独立通道：一是在应用代码之前用 `-r` 加载的 `record-main-errors.cjs`，二是应用自己的 `natively_debug.log`。两份文件都必须存在。退出前在主进程里故意抛出一个异常和一个未处理的 rejection，两条通道都必须记到；除此之外不能有任何其他异常记录。<br>守卫日志必须有主进程 PID 的加载记录；守卫写不进记录时会结束进程。外连为零 |
| 6 | 行为回归 | 通过 | `regression.log`：6/6。新增用例：启动器的对话请求在开始流之前失败（在主进程注入一次 setup 异常），重试后回答恰好显示一次，完成事件之后仍在。<br>取消用例在页面里通过同一个 preload 接口记录实际送达的事件，依次检查四种情况：<br>- 取消后的空档，旧流的 token 和完成事件不送达；<br>- 立即开始新流后，旧流的 token、完成和错误事件不送达；<br>- 不带流标识的事件不送达；<br>- 新流自己的事件照常送达，新流以恰好一次完成事件正常结束。<br>流标识由主进程的发送监听取得，事件经真实的 main → preload → renderer 通道注入 |
| 7 | 会议存储 | 通过 | `storage.log`：5/5。临时 SQLite 上保存、读取、重启后读取、删除；关闭 Transcripts 数据范围时，会议照常保存，但不为标题和摘要发出任何请求。会议对话只发送会议 ID，由主进程读取已保存的会议并组装上下文：`profile_history` 被拒绝时不发任何请求；`post_call_summary` 被拒绝时不带摘要、要点和行动项；窗口自己拼出的带会议标题的上下文会被剔除；未知的会议 ID 被拒绝。<br>启动时恢复上次未处理完的会议：`profile_history` 被拒绝时不发任何请求，会议照常保存（没有生成的标题）；允许时照常发送。会议对话的问答不进入下一场会议的转写。<br>会议详情页的编辑保存失败时：只有该字段最新一次编辑的结果起作用；只恢复失败的字段（来自数据库；读不到会议时恢复为编辑前的值），其他字段和列表行不动；会议已不存在时提示说明；提示只在同一字段之后保存成功时消失。<br>不加载向量扩展（AG-14 已删除 `sqlite-vec`） |

**当前结论**：源码 `c43b10e9` 的阶段 1 第 1–7 条验收通过；本机 15 步、S11 无缓存 CI `37709440574` 及独立只读证据复核对应同一源码。文档/证据后续提交不改变该源码版本。阶段 2 尚未开始。一次本机存储重启卡住的原因未定，保留为中断记录；随后独立重试、固定提交完整门禁和干净 CI 均通过，不把旧中断当成功，也不外推真实模型、设备权限或性能验收。

**未验证、转入后续的事项**（第九轮验收复查，2026-10-08）。以下各项不在第 5 节阶段 1 出口的范围内，不影响上面的结论，但都没有被验证，不能写成已通过：

| 事项 | 为什么不在阶段 1 | 转入 |
| --- | --- | --- |
| 真实模型、真实 key、真实语音转写 | S8、S9 | 阶段 3 起按 D2 授权：AG-33（回答）、AG-41（语音转写） |
| 屏幕录制、麦克风权限和真实钥匙串 | S9 | 按 D2 授权的实机验收；窗口保护的实机部分在 AG-61 |
| 本机从零构建原生模块 | S11 以 CI 为准，CI `37709440574` 已证明 | 打包同样在 CI 上产出（AG-25） |
| 5 个推迟的测试 | 延期，不是修复（AG-17 第 4 条） | AG-41（4 个）、AG-61（1 个） |
| Gemini 失败切换的延迟：第八轮把 Flash 和 Pro 并行改为顺序，每个模型最多等 30 秒，最坏情况多等约 30 秒，没有测过 | 出口不含性能 | AG-32 用 mock 服务注入延迟测切换耗时；AG-33 用真实模型复测 |
| WhatToSay 被拒绝时界面可能显示两次相同提示：主进程的 `intelligence-error` 事件一行（`NativelyInterface.tsx:1935`），IPC 返回 `answer: null` 的 `error` 又一行（`NativelyInterface.tsx:2027`）；没有界面测试 | 只影响显示，不发送数据 | AG-32（错误显示） |
| 发送语法检查的限制：只覆盖列出的 SDK 调用，发现不了别名、被调函数内部的等待和以后新加的入口 | 出口不要求整个程序的安全证明 | AG-24：新的发送入口都要有"等待期间关闭范围"的行为测试（同 m20），不能只靠语法检查 |
| Codex CLI 子进程自己的重试：范围在启动 CLI 之前检查，CLI 拿到内容后自己重试时，用户已关闭的范围拦不住 | AG-34 之前 Codex 不算达标的保留功能（AG-24 说明） | AG-24 列入出站入口并定处理方式（如关闭范围时结束 CLI 进程，或写明为已知限制）；AG-34 替换子进程方式时一并解决 |
| 一次本机存储重启卡住，原因未定 | 之后门禁、CI 和复查时连跑 3 次都通过（`AG-17-review9/`，另含会议删除分支的变异检查 m25） | 再次出现时保留日志并定位，不重跑了事 |
| 已经交给服务商或 CLI 的数据无法撤回 | 任何发送前检查都有这个限制 | 无需处理 |

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
3. **AG-09 开发中，有几次应用启动没有加载守卫。**
   - **经过**：Playwright 启动 Electron 时会删掉 `NODE_OPTIONS`，换成自己的 `-r loader.js`，所以通过 `NODE_OPTIONS` 注入的守卫没有生效。这几次运行的 `HOME` 和 Electron 路径仍是沙盒，但 Electron 自己的路径重定向、网络拦截和设备替身都不在。
   - **影响**：
     - Chromium 配置写进了真实的 `~/Library/Application Support/Electron`（修改时间 04:38:56），与事件 1 是同一个共用开发目录，没有 Margin 或 Natively 的用户数据，未删除；
     - 应用卡在音频设备枚举上，没有到就绪阶段：真实的 `~/Documents/natively_debug.log` 在这段时间没有新行，真实的 `natively` 应用数据目录不存在；
     - 枚举音频设备时，系统**可能**为 Electron 弹出过麦克风权限请求。
   - **未能证明**：无法证明这几次运行没有发起外连；但应用没有到就绪阶段，也没有配置任何 key。
   - **修复**：守卫改为通过 `-r` 参数传入（与 Playwright 自己的加载方式相同）；测试启动后先确认主进程里 `MARGIN_ISOLATION_ACTIVE === '1'`，否则立即中止。
   - **复验**：之后所有回归运行都确认了守卫生效，并且只有本地替身记录。
4. **启动冒烟测试有一次外层进程没有加守卫。**
   - **经过**：修复复核第 4 条时，本想只检查新测试文件的语法，却用 `node -e "import(...)"` 直接加载了它，于是测试真的运行了一次。外层 node 进程没有通过 `run-node.mjs` 启动，所以没有守卫。
   - **影响**：被启动的应用本身仍然隔离：`launchApp` 使用沙盒 `HOME`、`-r` 加载守卫，并在守卫未生效时中止。外层进程运行的是测试代码和 Playwright；测试代码里没有发起外部请求的调用。
   - **未能证明**：外层进程没有守卫，无法证明它在这段时间没有外连。这次运行没有留下单独的日志，只有会话里的命令输出（测试通过，启动器就绪 2.3 秒）。
   - **之后**：测试文件只通过 `run-node.mjs` 运行，语法检查只用 `node --check`。
5. **一次加了守卫的启动冒烟运行失败，原因未查明。**
   - **经过**：同一轮里，守卫下的启动冒烟有一次在 15 秒观察窗口内失败：主进程以退出码 0 提前结束。这次运行和随后的变异检查发生在用户中断那条命令的同时。中断后 `launch-app.mjs` 停在变异状态（去掉了异常记录器的 `-r`），已从运行前的备份恢复，并核对了恢复后的内容。
   - **复验**：之后单独重跑一次，以及两次完整门禁中的 `startup` 步骤，都通过。
   - **原始输出**：`docs/margin/evidence/AG-17-review2/checks/` 中的 `incident5-*.log`（失败的运行、被中断的变异运行、随后的重跑）。备份恢复只核对了启动参数一行（恢复后又有 `-r`、记录器），没有保存逐行比对。
   - **未能证明**：提前退出的原因没有查明。时间上与中断吻合，可能是应用被从外部退出，但没有证据。如果再次出现，要先查明原因。
6. **用户提供了真实的服务商 key（2026-10-08）。**
   - **经过**：第四轮修复期间，用户在对话里贴出 Groq 和 Gemini 的 key，说明是测试用、之后会撤销，并同意用它们测试。
   - **处理**：没有使用。这些 key 会把请求发往外部服务商，不符合 S8、S9（阶段 1–2 不用真实 key）和本会话的操作规则。本记录不含 key 的值。已建议用户立即撤销。真实服务的验收按 D2 在阶段 3 起单独安排，由用户自己在应用设置里填写 key。
   - **证据限制**：这是过程陈述，没有独立的审计证据能证明 key 从未被使用或写入（第五轮复查第 6 条）。可核对的部分：2026-10-08 用两个 key 的开头字符搜索，本仓库所有分支的提交历史、工作区（不含 `node_modules`）和会话记忆目录里都没有；所有测试都在隔离守卫下运行，守卫拦截外连。key 仍留在用户的对话记录里。

**下一步**：S18 的实现提交 `44377a01` 已通过本地及无缓存 CI `37838491368`、native 从零构建和新实包诊断，独立改动及证据可交只读复查。继续 AG-26 剩余 10 项许可缺口、原生静态组成、libvips/Skia 等嵌套许可及对应源码/替换义务；format 的精确原声明、Oboe 精确 vendor 许可存在进一步补料线索，尚未引入本提交。正常许可检查仍失败，不得把本次依赖验证替代完整 AG-26、AG-25 或阶段出口验收；不扩大依赖删除/替换范围。许可闭环后再完成双身份正式打包、签名、下载和 temp 隔离启动。AG-20 起的 Claude 复查仍待完成；S14、S15、S16 和明确停止条件保持不变。

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

**2026-10-07，Codex gpt-6-astra，只读模式，复核阶段 1 出口（提交 `e9b25ec3`）**。命令：`codex exec -m gpt-6-astra -s read-only`。结论：**修复后可接受**。D5 继续阻塞第 1 条的记录正确；原始计数可信（直接汇总 `AG-17/tests.tap` 得到 104 个文件、716 个测试、711 通过、0 失败、5 跳过）。但"第 2–7 条全部通过"不能成立。全部采纳，均已修复（`2e71066b`）。其中第 1、2、3、4、5 条的修复在第二轮复查中被发现不完整，补充修复见下一条记录：

1. **阻塞：隐私范围承诺不成立。** 会议摘要只检查 `post_call_summary`，关闭 Transcripts、保留摘要时，转写仍会发给 Groq。
   - **修复**：`LLMHelper.generateMeetingSummary` 同时检查 `transcript` 和 `post_call_summary`，任一被拒就不发送（这条路径上全是云端提供商）。
   - **测试**：`ScopeLocalFallback` 用构建后的 `LLMHelper` 和替身 Groq 客户端检查实际请求体，替换了原来的源码正则用例；`meeting-storage` 新增端到端用例：关闭 Transcripts 后会议照常保存，但没有任何请求发出。
   - **变异检查**：还原修复后，两个用例都失败（端到端用例报 `no generated title`）。
2. **阻塞：G3 零命中不代表退役完成。**
   - **修复**：删除"关于"页的官网链接，以及"Modes Manager""In-App Updates"两条宣传；删除启动页指向 `natively.software` 条款和隐私页的同意文案；删除帮助页的 Phone Mirror 一节（后续小节重新编号）；删除未使用的 `src/lib/featureFlags.ts`。
   - **规则**：G3 新增 6 条精确规则（见出口第 3 条），在修复前的提交上全部有命中。
   - **不在本次范围**：`prompts.ts` 中描述简历注入块的提示词提到 Profile Intelligence。这属于决定 1 的提示词范围，未改动（见 AG-16 记录）。
3. **阻塞：第 6 条没有真正验证"迟到事件不显示"。** 原用例取消后 mock 立即停止发送，过滤即使失效测试也会通过。
   - **修复**：preload 在 `cancelChatStream()` 后丢弃本窗口的流事件，直到下一次 `streamGeminiChat()`。
   - **测试**：回归用例在取消后注入迟到 token 和完成事件，并在取消前做一次注入的正向对照。
   - **变异检查**：去掉 preload 的过滤后，用例失败。
4. **应修：启动冒烟会把缺失的日志当成"无异常"。**
   - **修复**：守卫启动时写一条 `guard-loaded` 记录，`readGuardLog()` 在日志缺失时报错，不再返回空列表。新增 `tests/margin/record-main-errors.cjs`，由 `launchApp` 用 `-r` 在应用代码之前加载，独立记录主进程的未捕获异常和未处理的 rejection；`launchApp` 启动后立即确认它已加载。启动冒烟要求三份证据都存在，并用一次主动抛出的异常和 rejection 证明两条异常通道都有效。回归和存储测试结束时同样检查记录器。
   - **验证**：
     - `launchApp` 在记录器没有写入时拒绝继续，并关闭应用（在守卫下用临时测试确认）；
     - `readGuardLog()` 对不存在的日志报错。
5. **应修：门禁会吞掉隔离失败。**
   - **修复**：`run-gates.mjs` 的 `tests` 步骤解析每个文件的守卫拦截记录，任何一条都直接判失败，不与参照比较。退出码非 0 而 TAP 中没有失败用例的文件，同样直接判失败。原来唯一被拦截的是 `ImeDetectorCache` 调用 `defaults`，现在由测试提供明确替身：固定的输入源输出，并记录调用。原来只断言返回布尔值的 macOS 用例，改为 4 个确定性用例（无输入法、有输入法、探测失败、缓存与刷新）；非 macOS 用例由计时判断改为检查没有调用 `defaults`。
   - **验证**：把 `refreshImeDetection` 改成空操作后，2 个用例失败；新的解析规则在 `AG-17/tests.log` 上能识别出原来的 `local-exec execFileSync defaults`。
6. **说明：5 个跳过是延期，不是修复。** 恢复要求已写进 AG-41 和 AG-61。
7. **说明：Native setup、来源检查和其余修复未发现阻塞问题。** 本机证据只覆盖 CommandLineTools 分支；装有 Xcode 的分支见 CI 记录（AG-17 收尾运行）。

修复后的全部门禁：`node scripts/margin/run-gates.mjs --out docs/margin/evidence/AG-17-review --ref docs/margin/evidence/AG-17`，15 个步骤全部退出 0。G2 新增 1 条白名单：`ScopeLocalFallback` 替身里的 `codexCliConfig: { enabled: false },`，这是基线 `LLMHelper` 的字段。

**2026-10-07，Codex gpt-6-astra，只读模式，复查第一轮修复（提交 `2e71066b`）**。命令：`codex exec -m gpt-6-astra -s read-only`。结论：**仍需进一步修复后才可接受**。复查确认：
- 标题和会后摘要的修复成立；
- 第一轮新增的 6 条 G3 规则覆盖了上次指出的残留；
- 门禁能识别原来 `defaults` 的拦截，`ImeDetectorCache` 的替身有效；
- 直接汇总 `AG-17-review/tests.tap` 得到 104 个文件、719 个测试、714 通过、5 跳过；
- D5 和 5 个跳过的定位正确。

同意 `prompts.ts` 中 Profile Intelligence 的描述按决定 1 暂留。以下发现全部采纳并已修复（`94a10fb1`），一次性检查的原始输出在 `docs/margin/evidence/AG-17-review2/checks/`：

1. **阻塞：隐私修复没有覆盖 Codex 路径。** 会中 Recap 和自动压缩把转写放在 `message` 里，拒绝时只清掉了 `context`。路由到 Codex CLI 时，发送前没有数据范围检查。
   - **修复**：`generateWithCodexCli` 和 `streamWithCodexCli` 在启动 CLI 之前检查数据范围，与其他云端提供商相同。`CodexCliService.run/stream` 只在这两个函数里调用，所以覆盖了所有经过 Codex 的路径。
   - **测试**：在 `ScopeLocalFallback` 中替换 `spawn`。允许时调用到达替身；关闭 Transcripts 时抛出 `ProviderScopeError`，且没有启动 CLI。
   - **变异检查**：从构建产物中删掉这两行检查后，两个用例失败（`checks/codex-scope-check-removed.log`）。
2. **阻塞：取消后立即开始新流，旧流的事件仍可能送达。** 第一轮的布尔标记在新流开始时就被清除，而事件不带流标识。
   - **修复**：preload 为每次请求分配标识，主进程在每个 token、完成和错误事件里带回这个标识。preload 只送达当前流的事件：取消后不送达，新流开始后不送达旧流的，不带标识的也不送达。
   - **测试**：回归用例按出口第 6 条所述检查四种情况。
   - **变异检查**：把 preload 改成忽略标识（等同第一轮的布尔标记）后，用例在旧流的完成事件处失败（送达 2 次）；改成全部送达后，用例在取消后的空档失败（`checks/preload-*.log`）。
3. **阻塞：退役文案仍未清完。**
   - **修复**：帮助页删掉"entirely on-device"、"local models / fully custom endpoints"，以及并不存在的"模型列表每 14 天自动同步"。
   - **复核中的额外发现**：帮助页的两个提供商图标从 groq.com 和 cdn.simpleicons.org 远程加载（CSP 允许任意 `https:` 图片），打开帮助页就会外连。已改用打包内的图标。
   - **规则**：G3 新增 5 条规则。
   - **未改动**：`tinyPrompts.ts` 中关于本地模型的一句属于提示词，按决定 1 暂留。OpenAI STT 的自定义地址是现有的 STT 设置，不在 S6 的退役清单里，由 AG-41 收窄 STT 时处理。
4. **应修：守卫日志检查还没有完全 fail-closed。**
   - **修复**：
     - 守卫写不进记录时以退出码 70 结束进程；
     - 日志为空或没有加载记录时，`readGuardLog()` 报错；
     - 可以要求某个 PID 的加载记录。`run-node.mjs` 用它检查测试进程，`launchApp` 用它检查应用主进程。
   - **验证**：`checks/guard-unwritable-log.log`、`checks/guard-log-reader.log`。
5. **应修：被提前结束的文件能藏住拦截记录。**
   - **修复**：`run-gates.mjs` 为每个测试文件的 `run-node.mjs` 指定隔离日志路径，在进程结束后（包括被结束的情况）直接读取。没有加载记录的文件同样判失败。
   - **验证**：临时探针测试做一次被拦截的 DNS 查询，然后保持句柄不退出。它被进程组强制结束（这次是 180 秒时限；"footer 之后结束"用的是同一个结束方式），`run-node.mjs` 没有输出汇总，门禁仍从日志中报出拦截并判失败（`checks/gates-footer-probe.*`）。
6. **说明：记录器并非完全不改变行为。** `unhandledRejection` 监听会让 `main.ts` 安装处理器之前的 rejection 被记录，而不走 Node 的默认处理。文件注释已改为如实说明。
7. **说明：证据来自未提交的工作树，事件缺少原始记录。**
   - 本次先提交 `94a10fb1`，在干净的工作树上运行门禁（`summary.json` 中未提交路径为 0），证据单独提交。
   - 事件 5 的三份原始输出已归档。
   - 事件 4 没有单独的日志，影响描述已改为限定说法。
   - 第一轮修复的变异检查只记在会话里，没有归档。本轮的都已归档。
8. **说明：延期与出口边界记录正确。** 无需改动。

修复后的全部门禁：`node scripts/margin/run-gates.mjs --out docs/margin/evidence/AG-17-review2 --ref docs/margin/evidence/AG-17-review`，在 `94a10fb1` 上 15 个步骤全部退出 0。G2 新增 3 条白名单：两条通用写法；另一条是 Codex 的范围检查 `this.assertOutboundScopes('codex', userContent, imagePaths);`。这一行是基线已有的调用写法（`a786910e` `LLMHelper.ts:2076`）配上基线的参数名，受限的后期上游代码里有同样的一行，但不是从那里取的。

**2026-10-08，Codex gpt-6-astra，只读模式，复查第二轮修复（提交 `c8365b63`，代码与 `94a10fb1` 相同）**。命令：`codex exec -m gpt-6-astra -s read-only`。结论：**仍需进一步修复后才可接受**，不能认可"第 2–7 条全部通过"。复查确认：
- Codex 两个发送入口的范围检查及其变异证据成立；
- 流标识在正常流、identity-probe 和流内错误上的传递，按 sender 隔离，以及不先取消时的替换逻辑成立；取消用例确实检查了旧流的 token、完成和错误事件；
- 守卫写失败退出 70、空日志拒绝、正常路径的 PID 检查和门禁直接读取拦截记录均已实现；
- 直接汇总 `AG-17-review2/tests.tap` 得到 104 个文件、721 个测试、716 通过、0 失败、5 跳过；
- D5 记为受阻正确；事件 4、5 的限定说法如实。

以下发现全部采纳。第 1–3、5、6 条已修复（`02d4cb2e`），第 4 条按复查意见转入 AG-24。一次性检查和变异检查的原始输出在 `docs/margin/evidence/AG-17-review3/checks/`：

1. **阻塞：非流式云端发送仍能绕过 Transcripts 限制。** `generateWithClaude` 和 `generateWithGroqMultimodal` 没有范围检查。选中 Claude 时，`generateSuggestion` 把转写放在 `message` 里，拒绝只清掉 `context`，`message` 仍会送到 Claude。
   - **修复**：逐个检查 `LLMHelper.ts` 中所有发往云端的调用，补上缺的检查。除复查指出的两处，还有：`generateWithPro`、`generateWithFlash`、`generateContentStructured` 中直接调用 Gemini 的两处、`getGeminiClient()` 返回的代理所用的 `generateWithFallback`、`streamWithGroqOrGemini` 的 Groq 流。另外，Gemini 请求里的图片是内联数据而不是路径，原来不算 screenshots 范围；现在由 `assertGeminiContents()` 从请求内容判断。其中 `generateWithPro`、`generateContentStructured`、`streamWithGroqOrGemini` 和 `getGeminiClient()` 目前没有调用方，一并补上。
   - **测试**：`ScopeLocalFallback` 新增 5 个用例。Claude、Groq 多模态和 Gemini 内容三种发送：允许时到达替身，关闭 Transcripts 或 Screenshots 时抛出 `ProviderScopeError` 且没有发出请求。复查给出的路径：选中 Claude、转写在 `message` 里、关闭 Transcripts 时，`chatWithGemini` 不向 Claude 发请求。另有一个静态检查：`LLMHelper.ts` 中每个云端发送调用之前，同一方法里必须有范围检查。
   - **变异检查**：从构建产物中删掉 Claude、Groq 多模态的检查，并让内联图片不再算 screenshots，4 个用例失败（`checks/scope-checks-removed.log`）。对源文件的副本删掉 Claude 的检查，静态检查报出这一处（`checks/sweep-claude-check-removed.*`）。
2. **阻塞：Codex 仍被说成本地／私有处理。** 会中界面对 Codex 显示带盾牌的"Local/private route"，设置页写着"Local Provider"和"local backend"，而 Codex CLI 会把请求发给 OpenAI。
   - **修复**：删掉会中界面的这个标签（它只对 Codex 显示）。设置页改为"Codex CLI"，说明 CLI 会把提示词、转写上下文和截图发给 OpenAI 处理。屏幕理解的提供商登记里，Codex 的 `isLocal` 改为 `false`（该字段目前不影响行为）。
   - **规则**：G3 新增 4 条规则：`Local/private route`、`Local Provider`、`selectable local backend`、`locally authenticated Codex`。在 `c8365b63` 上每条都有命中（`checks/g3-new-rules-at-c8365b63.log`）。
3. **应修：请求在开始流之前失败，会留下旧的事件监听。** 主进程 setup 阶段抛错时只让 invoke 失败，不发带标识的错误事件。启动器对话（`GlobalChatOverlay`）和会议对话（`MeetingChatOverlay`）的 catch 不清理已注册的三个监听，下一次请求时旧监听也会收到新流的事件，旧的完成回调还会清空共享缓冲。会中界面（`NativelyInterface`）的监听是常驻的，不受影响。
   - **修复**：两个对话框在 catch 中释放监听并清空缓冲。
   - **测试**：回归新增用例，在主进程里让下一次 `gemini-chat-stream` 的 setup 抛错一次，然后在启动器对话里重试，回答必须恰好显示一次，完成事件之后仍在。会议对话的修复与此相同，没有单独的用例。
   - **变异检查**：从构建后的渲染层删掉释放调用，新用例在等待完整回答处失败（`checks/regression-release-removed.log`）。新用例第一次运行时没有先跳过首次启动画面，找不到搜索框，这是测试自身的问题，已修正（`checks/regression-first-attempt.log`）。
4. **应修：回答里的远程 Markdown 图片会发出请求。** 复查认定这属于既有的 AG-24 范围，不单独作为阶段 1 的阻塞。已写进 AG-24 的范围，本轮没有修改。复查也确认，按现有 CSS 顺序和 CSP，`StartupSequence.tsx` 的 Google Fonts 引用不能认定为实际外连。该项已在 AG-24 的转交记录里。
5. **说明：被强制结束的文件，门禁只核对"有加载记录"，不核对进程。**
   - **修复**：守卫的加载记录增加 `ppid`。门禁只接受 `ppid` 等于它所启动的 `run-node.mjs` 进程的加载记录，所以即使文件被强制结束、`run-node.mjs` 没来得及核对，也能确认守卫在测试进程里加载过。
   - **验证**：把 `isolationRecords()` 复制出来，用构造的日志检查 5 种情况：加载记录来自本次的测试进程、只来自孙进程、没有 `ppid`、有拦截记录、没有日志（`checks/ppid-match.*`）。正式运行中 104 个文件都满足新的核对。
   - **更正**：上一轮的 footer 探针是在 180 秒时限被强制结束的（`filesEndedAfterFooter` 为空），只证明了强制结束后仍能读出拦截，不算覆盖了"footer 之后结束"这个分支。
6. **说明：证据说明有一处不准确。** `AG-17-review2/checks/README.md` 泛称变异检查"从不改源码"，但事件 5 记录过 `launch-app.mjs` 曾处于变异状态。已改为只说 Codex 和 preload 的变异，并指向事件 5。

修复后的全部门禁：`node scripts/margin/run-gates.mjs --out docs/margin/evidence/AG-17-review3 --ref docs/margin/evidence/AG-17-review2`，在 `02d4cb2e`（干净的工作树）上 15 个步骤全部退出 0。G2 新增 4 条白名单：
- `this.assertOutboundScopes('gemini', message);`：基线已有的调用写法（`a786910e` `LLMHelper.ts:4105`）配上 `generateContentStructured` 的参数名；
- `let releaseStream = () => {};` 和 `releaseStream();`：通用写法；
- 测试替身里的 `groqFastTextMode: false,`：基线 `LLMHelper` 的字段（`a786910e` `LLMHelper.ts:100`）。

**2026-10-08，Codex gpt-6-astra，只读模式，复查第三轮修复和 D5 的计划修改（提交 `8f7ceda2`）**。命令：`codex exec -m gpt-6-astra -s read-only`。结论：**仍需进一步修复后才可接受**，暂不能进入阶段 2。复查确认：
- Claude、Groq 多模态的非流式检查，Gemini 内联图片按 screenshots 判断，及其变异证据成立；
- Codex 的本地／私有文案已删除，没有发现同类的用户可见说法；
- 两个对话框的 catch 都释放监听，启动器重试用例和删除释放调用的变异成立（只覆盖 invoke 被拒绝，不是 setup 内部的真实故障；会议对话没有单独用例，PLAN 已注明）；
- `ppid` 核对排除了无关记录；
- 仓库内的原始证据与记录一致（104 个文件、726 个测试、721 通过、0 失败、5 跳过；回归 6/6、存储 2/2）；
- D5 的方案本身可接受，`ac879152 → 8f7ceda2` 只改了 PLAN，不需要为记录提交重跑。

以下发现全部采纳并已处理（`4523c762`、`4bd2eb00`），一次性检查和变异检查的原始输出在 `docs/margin/evidence/AG-17-review4/checks/`：

1. **阻塞：拒绝 `profile_history` 后，历史回答仍会发送。** WhatToAnswer 把之前的回答拼进 `message`，并声明 `profile_history`；`streamChat` 拒绝这个范围时只清掉 `context`。另外，`scopesForPayload` 在有声明范围时不再把文本算作 transcript，下游只按 transcript 检查。
   - **修复**：
     - 调用方声明的范围（`extraDataScopes`）表示这些数据可能就在 `message` 里，无法在这里剔除，所以只要其中有被拒绝的，`streamChat` 就在发送前抛出 `ProviderScopeError`；
     - 文本总是算作 transcript，声明的范围是附加的，不替代 transcript；
     - 由调用方事先剔除：WhatToAnswer 在 `profile_history` 被拒绝时不带之前的回答，也不声明这个范围。
   - **同类问题**：`buildPreparedTranscriptContext` 会附上 `[RECENT ASSISTANT RESPONSES]` 区块，追问、澄清和后续问题三条路径都用它，其中有的把它作为 `message` 发送。现在 `profile_history` 被拒绝时不附这个区块，`inferContextScopes` 也能识别这个标题。
   - **范围的划分**：沿用基线的声明，单独附上的"之前的回答"区块、persona、历史会议属于 `profile_history`。本场会话里助手的回答作为 `[ASSISTANT]` 轮次出现在对话中，按转写（transcript）处理，不随 `profile_history` 剔除。请复查评估这个划分。
   - **测试**：`streamChat` 在声明的范围被拒绝时（`profile_history` 或 transcript）不发请求；WhatToAnswer 和预备上下文在拒绝时不带之前的回答。
   - **变异检查**：删掉 `streamChat` 的拒绝（`checks/m1-*`）、让 WhatToAnswer 忽略拒绝（`m2-*`）、让预备上下文忽略参数（`m3-*`），对应用例都失败。
2. **阻塞：会议对话的摘要没有被识别为 `post_call_summary`。** 会议对话用 `SUMMARY:` 等标题把摘要、要点和行动项放进 `context`，关键词识别不匹配。
   - **修复**：
     - 由调用方明确声明，而不靠关键词。`streamGeminiChat` 的选项增加 `dataScopes`，主进程只接受 `profile_history` 和 `post_call_summary`，并作为声明的范围传给 `streamChat`；
     - 会议对话先读取数据范围设置：`post_call_summary` 被拒绝时不带摘要、要点和行动项；带上时声明这个范围。设置读不到时照常带上并声明，由主进程决定。
   - **测试**：存储基座新增用例：真实界面里打开会议、提问，允许时请求里有摘要；拒绝后请求里有转写但没有摘要的任何内容；在拒绝状态下直接用 IPC 发出声明 `post_call_summary` 的请求，被拒绝且没有请求到达 mock。
   - **变异检查**：主进程不再拒绝时，IPC 那一步失败（`m1-*.storage.log`）；会议对话总是带上摘要时，主进程按声明拒绝，用例失败（`m4-*`）。
3. **应修：静态检查不能保证每个发送分支都受保护。** 它只检查同一方法里发送之前是否出现过检查，不看控制流和参数。
   - **修复**：对剩下的每个发送分支补行为用例，拒绝 transcript 时数请求数：`generateContentStructured` 的两个 Gemini 分支（允许时 2 × 3 次请求）、`generateWithPro`、`generateWithFlash`、`generateWithFallback`、`streamWithGroqOrGemini` 的 Groq 分支。
   - **说法收窄**：静态检查只能发现"某个方法里有发送却完全没有检查"，不证明每个分支都有检查，也不覆盖别名调用。`GeminiPromptCache` 的 `caches.create` 只上传固定的系统提示词，不含用户内容，不在检查范围内。
   - **变异检查**：删掉 `generateContentStructured` 第二个 Gemini 分支的检查后，静态检查仍通过，分支用例失败（`m5-*`）。
4. **说明：`ppid` 核对只绑定到直接子进程。** 直接子进程是 `node --test` 运行器，不是执行测试文件的进程。
   - **修复**：门禁要求一条完整的链：`run-node.mjs` 启动的运行器（`ppid` 等于 run-node 的 pid）下，有一个加载了守卫、脚本路径就是该测试文件的子进程。
   - **验证**：`checks/ppid-worker-match.*`，用构造的日志和一次真实运行的日志检查 8 种情况；正式运行中 104 个文件都满足。
5. **应修："唯一路径就是 native-artifact"超过了证据。**
   - **修复**：PLAN 改为推断的说法；门禁在 `summary.json` 中记下未提交路径的清单；工作流把产物目录移到 `$RUNNER_TEMP`；运行 `37694684706` 的原始证据存入 `docs/margin/evidence/CI-37694684706/`。
6. **说明：D5 一致，但本机的过渡办法没有写明。** 已写进 S11 第 5 点：AG-25 的下载脚本完成之前，本机继续用现有的原生模块，不为原生模块运行 `setup:native`。

**门禁第一次运行失败。** 在 `4523c762` 上第一次跑全部门禁时，`tests` 步骤失败：`suggestionPromptAssembly.test.mjs` 中 WhatToAnswer 的替身没有新增的 `deniedDataScopes()`，回答走进了兜底文本。这是本轮引入的新失败。原因是提交前只运行了受影响的几个测试文件，没有运行全部测试。替身补上这个方法后（`4bd2eb00`），在干净的树上重跑，15 个步骤全部退出 0。失败那次的汇总和失败用例在 `checks/gates-first-run-failed/`。

修复后的全部门禁：`node scripts/margin/run-gates.mjs --out docs/margin/evidence/AG-17-review4 --ref docs/margin/evidence/AG-17-review3`，在 `4bd2eb00` 上 15 个步骤全部退出 0：734 个测试，729 通过，0 失败，5 跳过；回归 6/6，存储 3/3，启动 1/1；`uncommittedPathList` 为空。G2 新增 4 条白名单：测试替身里基线的两个方法名（`fitContextForCurrentModel`、`getPromptTier`），以及两条通用写法。

**2026-10-08，Codex gpt-6-astra，只读模式，复查第四轮修复和 CI 证据（提交 `5c30ec84`）**。命令：`codex exec -m gpt-6-astra -s read-only`。结论：**第四轮修复基本接受，阶段 1 出口仍需进一步修复**，暂不能进入阶段 2。复查确认：
- WhatToAnswer、预备上下文的过滤和 `streamChat` 对声明范围的拒绝成立，文本不再因附加声明而失去 transcript 检查；`m1`–`m5` 的变异结论成立，但不证明所有入口、所有策略组合都安全；
- 本场对话中助手的回答按 transcript 处理，与 `SessionTracker` 一致，可以接受；
- 守卫的进程链核对成立，缺少执行文件的进程的加载记录就会失败；
- 出口第 1 条的 CI 证据（`37698721357`）可以接受：`5e2dac07 → 5c30ec84` 只改文档和证据，覆盖当前实现；
- 首次失败的门禁运行与记录一致。

以下发现全部采纳并已处理（`d26a9937`），一次性检查和变异检查的原始输出在 `docs/margin/evidence/AG-17-review5/checks/`：

1. **阻塞：在已保存的会议里提问，绕过 `profile_history`。** 会议对话总是带上会议标题和转写，只声明 `post_call_summary`。按 PLAN 的划分，历史会议属于 `profile_history`。
   - **修复**：会议对话只发送会议 ID。主进程从数据库读取这场会议并组装上下文（`electron/services/meetingChatContext.ts`）：整场会议声明为 `profile_history`，被拒绝时 `streamChat` 拒绝请求；`post_call_summary` 被拒绝时不带摘要、要点和行动项，带上时一并声明。会议对话中窗口传来的上下文被忽略。
   - **测试**：存储基座的会议对话用例增加"关闭 `profile_history` 后在旧会议里提问"：没有任何请求到达 mock，界面收到拒绝。
   - **变异检查**：会议上下文不声明 `profile_history` 时，用例在等待拒绝处失败（`checks/m7-*`）；主进程总是组装摘要时，请求因声明而被拒绝，用例失败（`m6-*`）。
2. **应修：`dataScopes` 只是调用约定。** 窗口省略声明时，主进程认不出 `SUMMARY:` 这类内容。
   - **修复**：
     - 渲染层的 `dataScopes` 选项已删除，会议数据改由主进程按会议 ID 读取，不再依赖窗口声明；
     - 窗口自己传来的上下文仍可能含有会议内容，作为兜底，关键词识别增加会议上下文的标题（`MEETING:` → `profile_history`；`SUMMARY:`、`KEY POINTS:`、`ACTION ITEMS:` → `post_call_summary`）。
   - **测试**：窗口自己拼出带摘要的上下文、不经会议 ID 发送，在 `post_call_summary` 被拒绝时，发出的请求里没有摘要；未知的会议 ID 被拒绝，不发请求。
   - **变异检查**：去掉标题识别后，窗口自拼上下文那一步失败（`m8-*`）。
   - **限制**：关键词识别只能兜住带这些标题的内容。主进程不能判断窗口传来的任意文本出自哪里，所以会议数据的正常路径只走会议 ID。
3. **说明：设置页应说明 `profile_history` 的边界。** 数据范围一节增加说明：Profile history 包括 persona 和备注、已保存的会议（包括在旧会议里提问）、单独附上的之前回答；本场对话里的回答属于这场对话的转写。
4. **说明：未提交路径清单是门禁开始时的快照，最多 200 项。** CI 记录中已改为这样表述。
5. **说明：出口第 1 条的 CI 证据被接受。** 第五轮修复改了应用代码，按 S11 要在当前代码上重跑一次。
6. **说明：事件 6 只是过程陈述。** 已加上证据限制，并补充可核对的部分。

本轮提交前先运行了全部单元测试（`checks/pre-commit-tests.summary.json`，736 个测试，731 通过，0 失败，5 跳过），没有重复第四轮"只跑受影响文件"的问题。

修复后的全部门禁：`node scripts/margin/run-gates.mjs --out docs/margin/evidence/AG-17-review5 --ref docs/margin/evidence/AG-17-review4`，在 `d26a9937` 上 15 个步骤全部退出 0：736 个测试，731 通过，0 失败，5 跳过；回归 6/6，存储 3/3，启动 1/1；未提交路径为 0。G2 零命中，没有新增白名单。

决定 1 已由用户定案（S12）：默认回答提示词暂时保留，阶段 3 在 AG-33 中用真实模型评估后再决定。

**2026-10-08，Codex gpt-6-astra，只读模式，复查第五轮修复和 CI 证据（提交 `b80c9440`）**。命令：`codex exec -m gpt-6-astra -s read-only`。结论：**第五轮会议对话修复基本接受，阶段 1 出口仍需进一步修复**，暂不能进入阶段 2。复查确认：
- 会议对话按 ID 读取会议成立：ID 类型校验、参数绑定查询、未知 ID 报错、窗口传来的上下文被覆盖；整场会议声明 `profile_history`，摘要按策略剔除；
- 已读的启动器、悬浮窗和 IntelligenceEngine 路径中，没有发现另一条直接读取已保存会议的发送入口；关键词兜底的限制已如实写明；
- `m6`–`m8` 的变异结论与 PLAN 一致；本机和 CI 的 TAP 都是 104 个文件、736 个测试、731 通过、0 失败、5 跳过；
- 出口第 1 条的 CI 证据（`37700866188`）可以接受：`fd47de32 → b80c9440` 只改文档和证据。

以下发现全部采纳并已处理（`fa70efc8` 和本次证据提交），一次性检查和变异检查的原始输出在 `docs/margin/evidence/AG-17-review6/checks/`：

1. **阻塞：启动时恢复的会议不检查 `profile_history`。** 应用启动时恢复上次未处理完的会议（`main.ts` → `MeetingPersistence.recoverUnprocessedMeetings`），为它生成标题和摘要。`generateMeetingSummary` 只检查 `transcript` 和 `post_call_summary`，所以 `profile_history` 被拒绝时，旧会议的转写仍会发出。
   - **修复**：`generateMeetingSummary` 接受附加的数据范围；恢复路径声明 `profile_history`。被拒绝时不发任何请求，会议照常保存，没有生成的标题和摘要（与关闭 Transcripts 时的当前会议一致）。刚结束的当前会议不带这个声明，行为不变。
   - **测试**：
     - 单元用例：声明 `profile_history` 且被拒绝时零请求；允许时照常发送；不声明时（当前会议）不受它影响。
     - 存储基座新用例：mock 挂起标题请求，会议停在未处理状态时关闭应用；关闭 `profile_history` 后重启，恢复不发任何请求，会议保存为 "Untitled Session"、转写保留；再造一场，允许时重启，恢复照常发送。mock 为此增加了"挂起请求"选项。
   - **变异检查**：恢复不声明 `profile_history`（`m9-*`），或 `generateMeetingSummary` 忽略附加范围（`m10-*`，单元用例和存储用例都失败）。
   - **同时发现并修复**：新用例第一次运行失败，恢复出的会议转写有 11 条而不是 4 条（`checks/storage-attempt1..3.log`）。原因是 `gemini-chat-stream` 把每次对话的问答都加进当前会话，在旧会议里的提问和回答因此进入了下一场会议的转写、用量记录和摘要。会议对话（带会议 ID）的问答现在不加进当前会话；启动器的普通对话仍属于当前会话，行为不变。新用例检查这一点；变异检查 `m12-*`。
2. **应修：会议详情页的编辑保存失败时，界面仍显示未保存的内容。** 标题、概要、要点和行动项的编辑先更新界面，忽略更新 IPC 返回的 `false`；而会议对话从数据库读取内容，界面和实际发送的内容可能不一致。
   - **修复**：每次保存都检查结果。失败（返回 `false` 或抛错）时，页面显示 "This change could not be saved."，并从数据库重新读取这场会议，界面恢复为已保存的内容；下一次保存成功时提示消失。
   - **测试**：存储基座新用例在主进程里让标题更新返回一次 `false`：提示出现，标题恢复为数据库里的值；再改一次，保存成功，提示消失。
   - **变异检查**：页面把每次保存都当成功（`m11-*`），用例在等待提示时超时。
   - **限制**：输入时的保存有 600 毫秒防抖，这段时间内界面上的文字尚未保存，此时提问用的是数据库里的内容。
3. **应修：S12 没有完全同步。** S11 第 4 点改为"决定 1 当时仍等用户，同日已定案（S12）"；AG-13 记录的"决定（待用户确认）"改为已确认；AG-16 记录中"留到阶段 2/3"注明是当时的安排，现由 S12 和 AG-33 接替。
4. **说明：会议对话的修复成立，但不是任意文本的来源识别。** 与第五轮记录的限制一致，不需要改动。
5. **说明：新测试支持所列场景，不能证明全部路径安全。** 本轮的变异检查只证明所列用例能发现对应的错误。
6. **说明："下载后重算一致"无法独立核对。** 三次 CI 运行的原生模块产物在 2026-10-08 重新下载，重算 sha256，并与仓库中存档的 `BUILD-INFO.txt`、`setup-native.log` 逐字节比较。收据在各自的 `CI-*/native/sha256-recheck.txt`：三次的 sha256 都与 `BUILD-INFO.txt` 相同，存档文件与下载的一致。CI 记录中原来的说法已注明当时没有留下记录。

本轮提交前先运行了类型检查、来源、退役、preload 和 IPC 检查以及全部单元测试（`checks/pre-commit-gates.summary.json`：737 个测试，732 通过，0 失败，5 跳过）。

修复后的全部门禁：`node scripts/margin/run-gates.mjs --out docs/margin/evidence/AG-17-review6 --ref docs/margin/evidence/AG-17-review5`，在 `fa70efc8` 上 15 个步骤全部退出 0：737 个测试，732 通过，0 失败，5 跳过；回归 6/6，存储 5/5，启动 1/1；未提交路径为 0。G2 零命中，没有新增白名单。出口第 1 条在当前代码上重跑了不使用缓存的 CI（运行 `37703373985`，通过），见 CI 门禁记录。

**2026-10-08，Codex gpt-6-astra，只读模式，复查第六轮修复和 CI 证据（提交 `fb058c35`）**。命令：`codex exec -m gpt-6-astra -s read-only`。结论：**第六轮的常规路径修复、CI 证据和 S12 同步可以接受，阶段 1 出口仍需进一步修复**，暂不能进入阶段 2。复查确认：
- 恢复路径为标题和摘要声明 `profile_history`，当前会议不带这个声明，区分合理；会议对话的问答（普通问答、身份探测和用量）不再进入当前会话；启动器和普通悬浮窗不带会议 ID，行为不变；
- `m9`–`m12` 的变异结论与 PLAN 一致；
- 出口第 1 条的 CI 证据（`37703373985`）可以接受：`78015838 → fb058c35` 只改文档和证据；四次 CI 的 `sha256-recheck.txt` 都与对应的 `BUILD-INFO.txt` 一致；
- S12 已在 S11、AG-13、AG-16 和 AG-33 中一致记录。

以下发现全部采纳并已处理（`9a7dcf1c` 和本次证据提交），一次性检查和变异检查的原始输出在 `docs/margin/evidence/AG-17-review7/checks/`：

1. **阻塞：请求等待期间关闭数据范围，后面的发送照样进行。** 范围只在入口检查一次。例如会议摘要先试 Codex，Codex 失败前用户关闭了 `profile_history`，接下来的 Groq 请求仍会发出旧会议的转写；Gemini 的后备也没有再查全部范围。会议对话声明的范围同样只在 `streamChat` 入口检查，下游的发送不知道这些范围。
   - **修复**：
     - 请求的数据范围在它的所有发送中都有效：调用方声明的范围，加上入口时在保留下来的上下文里识别出的范围，存在 `AsyncLocalStorage` 中（`streamChat`、`chatWithGemini`、`streamChatWithGemini`、会议摘要）。生成器每一步都在这个存储里恢复执行，所以下游方法的发送也能读到。
     - 每个云端发送前都按当前设置重新检查一次，检查和发送之间没有任何等待（限流、读图片、缓存、重试闭包）。
     - 被拒绝时整条后备链停止，不再当作服务商失败继续重试。
   - **测试**：
     - 当时的文本扫描仅识别部分 `await`、`yield` 和箭头函数形态，漏掉普通函数闭包、参数内等待及 SDK 隐式重试；不能据此证明发送前没有等待。第八轮改为下述有限语法检查并补行为证据。
     - 三个行为用例在请求进行中关闭范围：会议摘要（Codex 失败时关闭三种范围之一，Groq 不被调用；Gemini 第一次尝试后关闭，不再发送，链立刻结束）、`streamChat`（限流等待时关闭，声明的范围和上下文标题识别出的范围都被拒绝；快速模式下 Codex 失败后 Groq 不被调用）、`chatWithGemini`（上下文的 `SUMMARY:` 在入口时允许，发送前被关闭）。
   - **变异检查**：发送读不到请求的范围（`m13-*`，三个用例都失败）；去掉 `streamWithGroq` 发送前的再次检查（`m14-*`）；摘要的 Flash 尝试把拒绝当作失败（`m15-*`：不会多发请求，但会走完重试和退避，用例在耗时上失败）。`m15` 前两次运行一次无效（脚本没有真正改动文件）、一次用例阈值过宽没能发现，记录在 `checks/README.md`。
   - **限制**：已经发出的数据无法撤回，不在此列。
2. **应修：回滚会干扰其他正在编辑的内容，也不总能真正回滚。** 第六轮的做法是任何一次保存失败都替换整场会议、重建两个列表的全部 key，正在编辑的其他行会被卸载；输入的防抖定时器在卸载后仍会触发，带着旧状态保存；重新读取返回空或出错时，界面保留未保存的内容；任何一次成功保存都会清掉提示。
   - **修复**：
     - 每个字段有自己的编辑版本，只有最新一次编辑的结果起作用；
     - 失败时只恢复这个字段：先读数据库，读不到会议时恢复为编辑前的值；会议已不存在时提示 "the meeting no longer exists"；
     - 列表只在长度变化时才重建 key，其他行保持不动；
     - 编辑基于最新状态（`meetingRef`），不用旧闭包里的会议；
     - 提示记下所属字段，只有同一字段之后保存成功才清除；
     - `EditableTextBlock` 卸载时取消尚未触发的防抖保存。
   - **测试**：存储基座的保存失败用例扩展为 7 步：标题失败后恢复；另一个字段保存成功不清除标题的提示；标题保存成功后提示消失；要点保存失败只恢复要点列表，另一行的 DOM 节点不变；保存失败且读不到会议时恢复为编辑前的值；会议已不存在时提示说明；较早的一次编辑的失败结果在较新的编辑保存成功之后才到达，不起作用。
   - **变异检查**：`m16-*`（所有结果都起作用）、`m17-*`（任何成功都清除提示）、`m18-*`（读不到会议时保留编辑）、`m19-*`（恢复整场会议并重建 key）各让对应一步失败。
3. **说明：初始权限检查和会议对话的隔离成立。** 无需改动。
4. **说明：新测试只支持所列场景。** 本轮补了运行中关闭范围和多种保存失败的用例，仍不证明全部路径安全。
5. **说明：出口第 1 条的 S11 证据被接受。** 第七轮修复改了应用代码，按 S11 要在当前代码上重跑一次。
6. **说明：PLAN 的结论需要保留条件。** 出口表第 7 条已改为本轮的回滚规则，结论改为等 CI 重跑和下一次复查。

本轮提交前先运行了类型检查、来源、退役、preload 和 IPC 检查以及全部单元测试。第一次运行失败：基线的源码测试要求 `streamChat` 直接遍历 `this._streamChatInner(`，于是把范围的包装移进 `_streamChatInner`，原来的函数体改名为 `_streamChatBody`；G2 命中新测试中两行通用写法，已改写，没有新增白名单。修正后重跑通过（`checks/pre-commit-gates.summary.json`：740 个测试，735 通过，0 失败，5 跳过）；第一次运行的输出被重跑覆盖，没有保留。

修复后的全部门禁：`node scripts/margin/run-gates.mjs --out docs/margin/evidence/AG-17-review7 --ref docs/margin/evidence/AG-17-review6`，在 `9a7dcf1c` 上 15 个步骤全部退出 0：740 个测试，735 通过，0 失败，5 跳过；回归 6/6，存储 5/5，启动 1/1；未提交路径为 0。G2 零命中，没有新增白名单。出口第 1 条在当前代码上重跑了不使用缓存的 CI（运行 `37706465030`，通过），见 CI 门禁记录。

### 第八轮修复与复验（2026-10-08）

用户提供第八轮复查结论：CI `37706465030` 被接受，但阶段 1 出口未验收。原始 `scratchpad/astra-run8.log` 未在本工作树找到；以下以用户转交结论、源码和本轮可复跑证据为准。仍不进入阶段 2。

- **SDK 隐式重试**：Groq、OpenAI、Anthropic、DeepSeek 的构造和更新 key 共八处均设置 `maxRetries: 0`。保留现有应用层重试，每次发送重新检查范围。测试不替换 SDK 方法，只替换 HTTP fetch：第一次 500 响应关闭范围并带短 retry-after，断言始终只有一次 HTTP 请求。恢复 SDK 重试后八个用例均失败（m20）。当前锁定的 Google GenAI models API 未配置 retryOptions，不自动重试；未调用 interactions API。
- **拒绝传播**：共用一个很小的拒绝重抛函数，保留原错误对象并识别 AggregateError；跨独立打包入口按 Error.name 识别。视觉链、文本链、结构化链、缓存重试和九个提示词包装层都不把拒绝当服务商故障或回答。WhatToSay 最外层仍发原有 error 事件、恢复 idle，再把拒绝交给 IPC；显示 `Data scope denied`，不写入假回答。会议摘要继续按既有约定返回空摘要、保留本地会议。默认 Gemini 路由使用剔除上下文后的实际范围，既不把拒绝误报为“未配置服务商”，也不阻断可发送的净化文本。
- **最小并发简化**：两处 Promise.any 改为顺序备用。否则单个拒绝会被另一请求成功覆盖，或等待另一个请求结束。流式 Gemini 按 Flash→Pro，每模型等待上限 30 秒；缓存等待后再次检查取消，防止过期尝试晚发。普通服务商失败仍备用，外部取消仍结束。代价：不再并行抢答，失败切换延迟可能增加；不声称性能等价。已发送的 HTTP 数据无法撤回。
- **静态检查边界**：使用已有 TypeScript 解析器，只检查列举的 SDK 调用是否紧接同块内范围检查，以及该语句中的函数边界和显式 await/yield；补普通函数、箭头函数、参数内/多行 await 和条件块反例。它不是全程序数据流证明，不覆盖别名、被调函数内部等待、任意文本来源、SDK 内部或未来新入口。SDK 重试由上面的行为测试单独验证。
- **会议删除分支**：保存失败后读取为 null，也恢复该字段编辑前的值，并保留“会议不存在”的提示。真实 renderer 存储基座补标题恢复断言，其余字段回滚规则不变。
- **来源**：参考旧 Margin 的行为与已有“最后发送边界”限制，没有拷贝旧分支实现。四条标准 JS/合成测试短句的扫描误报逐条登记于 PROVENANCE 和配置，不改写代码规避扫描。

**最终验证**：修复提交 `c43b10e9` 已推送。WIP Astra 独立源码审查无未处理发现，固定版本的源码/测试差异指纹与所审 WIP 一致。用户随后指定测试用 `gpt-6.1-sol`，最新通用约定也将子 Agent 统一到该模型；固定证据由另一名 `gpt-6.1-sol/high` 只读复核，没有改称历史审查模型。

- m20–m24 均被指定断言检出，退出 1、非超时，并逐字节恢复生成文件；见 `checks/`。其中 m22/m24 是多个 bundle 调用点一同改变，不宣称逐个源代码位置都已独立变异。
- 本机首次 GUI 门禁在沙箱内无法启动 Electron；授权后回答回归通过，但存储第二次启动卡住。用户要求重试；先保留日志，再只终止本测试进程树，退出 143/SIGTERM、无遗留进程，明确标为 interrupted。随后新临时环境直接存储测试 5/5、退出 0（约 24 秒），隔离无外连、主进程无异常；见 `sol61-retry/`。
- 固定提交干净树上完整门禁（`gates/summary.json`）15 步全部退出 0，未提交路径 0；104 文件，767 测试、762 通过、0 失败、5 既有跳过；回归 6/6、存储 5/5、启动 1/1。全部原始日志保留。
- CI `37709440574` 的同提交无缓存构建和 15 步门禁通过，原生模块重算 hash 与 BUILD-INFO 一致；见 `CI-37709440574/`。阶段 1 出口通过，阶段 2 未开始。首次 GUI 卡住原因未定，顺序备用可能增加失败切换延迟，真实模型与设备行为未验；这些边界未被消除或改写为已验证。
