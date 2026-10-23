# S48 · 官方模型能力表与统一推理选择

状态：用户 2026-10-22 批准本地实现；2026-10-23 首次执行因额度中断（记录保留于[证据](evidence/S48/README.md)），恢复后两票本地实现完成；当前 Codex 首次审阅发现的 P2 修复后，独立复验通过（[独立报告](evidence/S48/independent-review.md)）。实际接口与结果见文末“实施结果”和 [PLAN §8 S48](PLAN.md#8-执行与恢复记录)。

产品权威仍为 [product.md](../product.md)；本文件是本次变更的 Ticket/Spec，实施时同步替换 S44/S47 中被本决定取代的产品描述。基线为 `94824398` 加现有未提交 S47。保留 S47 多候选、一个 Key、选择及使用中删除保护，不重做该任务。

## 授权及非目标

- Claude 是本工作树唯一实现写入者，按 S48-01 → S48-02 串行；当前 Codex 随后独立验收。不得继续委派。
- 只限本地源码、相关文档及隔离 mock 测试。本轮先不提交、不推送、不远端 CI、不安装、不启动真实用户应用，不读真实凭据/用户会议/截图、不调用真实服务、不改全局配置或系统权限。
- 原未跟踪 AG-51/gates 与 audio-monitor-cleanup/checks,gates,mutations 保留，不纳入任务。
- 不改 STT、网关/Codex 来源的配置协议、生成生命周期、超时预算、数据范围、请求次数、认证或权限。无新依赖、后台能力同步服务、通用调度框架。

## 已确认产品契约

### C1：共享的精确模型能力记录

官方 Gemini/OpenAI/Claude/DeepSeek 依据官方资料维护同一份能力记录，包含完整模型 ID、图片输入 true/false/unknown、原生推理选项及其合法参数组合、来源和核实日期。在现有 modelReasoning/modelImageSupport 基础上整理，两个消费者不能维护重复且会漂移的独立事实。可以增加一个小型纯数据文件，不建注册框架。

- 按 provider + 实际 endpoint + protocol + 精确 model ID 匹配；不按前缀或名称猜测。只有官方明确说明的别名才可登记。
- 获取模型列表仍只是可选 ID/名称，不代表能力核验或调用权限；不把所有列表结果自动加入候选。
- 初始覆盖下表和现有已核实记录；实现时查看四家官方当前回答模型目录，能明确核实的补表，列出覆盖及未收录边界。无需穷举音频、embedding、图像生成等非本应用回答模型。没有可靠资料就 unknown，不编造支持。
- 官方来源支持图片则自动放行；明确不支持则发送前拒绝并保留附件；未知则显示“图片能力暂未核实”，不允许图片请求但保留文字功能。不再提供官方模型图片手动确认，不允许旧 imageSupportConfirmedFor 绕过 unknown/false。
- 官方备用模型同样查表，不保留官方备用图片手动确认入口。网关/Codex 保持既有确认机制，不能把同名模型当官方模型。开发 loopback override 也不获得官方认证，mock 测试须保持这个信任边界。
- 能力记录不是可用性保证。新 Gemini 配置使用正式 Flash-Lite 预设；已有 Preview 选择不静默替换或删除，展示官方停用提示即可。

最低已核实记录（实施者必须核对引用正文，不猜未列的 capacity 数值）：

| 模型 | 图片输入 | 原生 effort | 说明 |
| --- | --- | --- | --- |
| gemini-3.1-flash-lite | 支持 | minimal, low, medium, high | minimal 不等于关闭 |
| gemini-3.1-pro-preview | 支持 | low, medium, high | 精确 ID |
| gpt-5.4 | 支持 | none, low, medium, high, xhigh | 无 max |
| gpt-6-astra | 支持 | low, medium, high, xhigh, max | 无 none |
| gpt-6.1-sol | 支持 | low, medium, high, xhigh, max | 无 none |
| gpt-6-luna | 支持 | none, low, medium, high, xhigh, max | none 与默认不同 |
| claude-opus-5-5 | 支持 | low, medium, high, xhigh, max | 推理常开，不支持 disabled |
| claude-sonnet-4-6 | 保留已核实图片记录并核对来源 | low, medium, high, max | 显式推理档位配 adaptive |
| deepseek-flash | 支持 | low, high, max | thinking enabled/disabled |
| deepseek-v4-pro | 不支持 | low, high, max | 不可继承 Flash 图片能力 |

官方来源：
- https://ai.google.dev/gemini-api/docs/models/gemini-3.1-flash-lite
- https://ai.google.dev/gemini-api/docs/models/gemini-3.1-flash-lite-preview （页面声明已停用，不以列表存在证明可调用）
- https://ai.google.dev/gemini-api/docs/generate-content/thinking （本项目 generateContent，不混用 Interactions 字段）
- https://ai.google.dev/gemini-api/docs/gemini-3
- https://developers.openai.com/api/docs/models/gpt-5.4
- https://developers.openai.com/api/docs/models/gpt-6-astra
- https://developers.openai.com/api/docs/models/gpt-6.1-sol
- https://developers.openai.com/api/docs/models/gpt-6-luna
- https://platform.claude.com/docs/en/models/overview
- https://platform.claude.com/docs/en/build-with-claude/effort
- https://platform.claude.com/docs/en/build-with-claude/thinking
- https://api-docs.deepseek.com/quick_start/pricing/
- https://api-docs.deepseek.com/guides/thinking_mode/

### C2：一个控件，按当前模型显示原生选项

- 官方 ProviderCard 删除逐候选 reasoning/thinking 控件及图片确认框，不增加服务商级强度。候选添加、选择、删除、保存/测试、Key 等保持。
- 设置页主模型旁放默认推理控件；会中模型按钮旁放临时推理控件。复用同一小组件和能力表。不能只藏在设置页，或为了添加控件重构全部设置布局。
- 所有模型有“服务商默认”，表示不发送覆盖字段；未知或仅预算型旧模型不提供未经验证的档位。Gemini 2.5 不硬套 thinkingLevel，不新增预算编辑器。
- xhigh 是一个档位；不把五档归一化为三档，不进行计算量的跨厂商换算。
- “关闭推理”仅在对应模型支持时提供。显式档位要生成完整合法组合：例如 Sonnet 4.6 用 adaptive + effort；DeepSeek 用 enabled + effort；Opus 5.5 不发 disabled。默认省略相关字段，不伪装成 medium/none。
- 切换模型/协议/端点时原生选择仍合法则保留；不合法则改为服务商默认并明确提示，不偷偷映射，不在切回时恢复隐藏的逐模型记忆。
- 网关/Codex 在统一控件显示由来源配置控制，保持其已有专用设置；不改变其参数。

### C3：持久默认与会中覆盖只有两层

- 设置保存一份共享默认偏好，不建立 model → effort map。实际模型和强度必须一致保存，复用现有事务，保存失败 runtime 不变；保存成功应用失败沿用 saved + warning。
- 会中临时覆盖可为“明确使用服务商默认”，与“尚未覆盖、继承保存值”区分。按完整目标校验每次更新，拒绝旧窗口对已切换目标的迟到写入；所有相关窗口从主进程得到有效值，不各自在 localStorage 发明真相。
- 保存默认强度不切当前模型、不覆盖已存在的会中临时值；完整会议成功结束/放弃结束后清除会中覆盖，下次会议和进程重启恢复保存默认。会议保存失败而仍留在未结束会话时不得提前清除。
- 在 LLMHelper.beginGenerationTask 的共享边界产生快照，之后修改强度不更改、不取消在途任务，影响下一次任务。Answer 开始时已创建的任务遵守同样规则，不在 Stop/实际 HTTP 发出时重新读取。
- 同任务自动重试保持快照；用户原输入重试创建新任务，读取当时有效配置。主模型、备用模型、测试请求区分：官方备用和 ProviderCard 连接测试都使用服务商默认，不泄漏主/会中强度；网关/Codex 原规则不变。
- S47 第二候选显示第一项 effort 的已复现缺陷，通过删除旧控件与新控件正确绑定一起解决；保留真实切换 A→B 的回归，不只以旧控件消失证明正确。

### C4：窄兼容，不操作本机用户数据

代码需能读取 S47 已有单/多模型结构，不能因删 UI 就让隐藏旧 reasoning 继续覆盖新选择。没有新字段时仅以已保存默认模型的合法旧设置作为共享初值，不选候选第一项或会中临时模型；无法无损表达的旧组合显示“旧设置待确认”，用户确定前保留原行为，不默默降档。首次保存新策略后旧官方 reasoning 字段不再生效，可留作兼容字段，不新增恢复框架或主动迁移/清空本机文件。这个窄契约优先于历史“不新增兼容流程”的一般描述；不扩展到旧 Key、旧网关或别的版本迁移。

## Ticket 分解与依赖

### S48-01 官方能力表及自动图片判定

- Outcome：正式 Flash-Lite 自动支持图片；明确不支持/未知官方模型不能被手动确认绕过；推理选项来自可追溯精确表。
- Scope：共享类型能力文件、LLM_PRESETS/对应默认常量、ProviderCard 图片提示、官方备用图片 UI 和主进程图片守卫；相关既有能力/协议/挂载测试。网关/Codex不变。
- Steps：读实际消费者 → 核对官方资料并记录覆盖 → 共享纯数据 → 替换官方能力检查/移除手动入口 → 针对性测试。保留附件及错误语义，不改变数据发送授权。
- Validation：真实校验函数覆盖 true/false/unknown、同名 gateway/非官方 endpoint、旧确认绕过失败、准确 model/protocol，设置实际挂载覆盖正式/Preview及未知提示；请求拒绝前零出站且附件保留。测试仍使用合成数据，官方文档查询不使用用户 Key。
- Stop：必须改变网关规则、读真实配置或新增动态服务才可实现时报告，不扩范围。

### S48-02 统一默认/会中推理控件及请求快照

- Depends：01能力契约固定；同一写入者串行。
- Outcome：两个位置选项跟随准确模型，值显示与实际发送一致；保存/会中/在途任务隔离。
- Scope：ProviderCard、AIProvidersSettings、NativelyInterface及必要ModelSelectorWindow/窗口尺寸、共享小控件、CredentialsManager、ProcessingHelper、LLMHelper、IPC/preload/types/i18n、既有事务/多协议/生命周期与挂载测试。只改直接需要的消费者。
- Interfaces：复用现有 IPC 能扩展则扩展，必要的读/写/通知最少新增；实现前在本票补实际签名、默认偏好与临时状态字段、expected target校验和错误返回，不能用模糊字符串或 renderer 直接改存储。
- Steps：状态/原子保存与窄兼容 → 主进程共享快照 → 控件与跨窗口同步 → 删除旧官方控件 → 测试。
- Validation：旧结构读取；保存→冷启动一致；写失败零副作用、apply失败warning；A→B→A真实控件值/选项正确（含禁用状态、默认、三/四/五档）；非法/陈旧IPC拒绝；mock wire字段精确，默认字段不存在；在途旧值/新任务新值；重试、备用、测试隔离；会议成功结束清除/保存失败保留。补中英文可访问名称，窄屏不遮挡模型/Stop按钮。
- Stop：新产品选择、需要新存储系统/调度器/付费实测时报告。普通失败继续定界修复。

## 合并验收与交付

- Claude 整合两票，更新产品现行条款和 PLAN/Wayfinder，历史 S47 报告仍保留并注明已被 S48 部分取代且独立复查发现过 UI 缺陷，不能仍称已验收。
- 先窄测，再现有完整门禁 16/16，运行 git diff --check。所有测试经项目隔离入口；mock模型发现、钥匙串、设备，不读真实资料。完整门禁期间不改代码。失败日志保留；既有 MeetingPersistence 时钟 fixture 若再次波动，定位并最小修正，不无限重跑。
- 不新增测试框架、不强制变异矩阵；重点是真实消费者和会失败的关键反例。若官方地址 mock 可能出网，先做明确拦截，不能靠真实连接验证。
- 来源核查只对具体通用命中逐条登记，不扩大路径豁免、不抄后期上游源码。新增官方事实不是复制 SDK 实现。
- 用一份小型 evidence/S48/README.md 记录变化、实际命令/退出码、源码状态、未验证项；原始日志放任务临时目录。独立审阅前交还唯一写入权，Claude 不自报独立验收通过。
- Codex 检查完整 S47+S48 diff、原始 gates/隔离记录，独立复跑关键新测试；必要修正继续由 Claude 实施，之后再验收。无需重复可信、同源且未改变的全量门禁。
- Windows 仅静态审查。未运行真实模型、未验证真实服务采用强度/图片质量/费用、未安装，不关闭阶段6。

## 实施结果（Claude，2026-10-23，独立验收通过）

**实际接口**：字段、签名、expected target 校验与错误返回见 [PLAN §8 S48 最终数据/IPC 契约](PLAN.md#8-执行与恢复记录)，不在此重复。

**官方能力覆盖**（`src/types/modelCapabilities.ts`，每条记录带来源 URL，核实日 2026-10-22，读取公开官方页面，未使用任何 Key）：

| 记录 | 图片 | 推理选项（“服务商默认”之外） | 容量（上下文/输出） |
| --- | --- | --- | --- |
| gemini-3.1-flash-lite | 支持 | minimal, low, medium, high（minimal 不是关闭） | 1,048,576 / 65,536 |
| gemini-3.1-flash-lite-preview | 支持 | 无已核实档位；显示停用提示（2026-05-25） | 1,048,576 / 65,536 |
| gemini-3.1-pro-preview | 支持 | low, medium, high | 1,048,576 / 65,536 |
| gpt-5.4 | 支持 | none, low, medium, high, xhigh | 1,050,000 / 128,000 |
| gpt-6-astra、gpt-6.1-sol | 支持 | low, medium, high, xhigh, max | 1,050,000 / 128,000 |
| gpt-6-luna | 支持 | none, low, medium, high, xhigh, max | 1,050,000 / 128,000 |
| claude-opus-5-5、claude-sonnet-5-5、claude-fable-5-1 | 支持 | low, medium, high, xhigh, max（不可关闭） | 1M / 128K |
| claude-haiku-5-5 | 支持 | 关闭（disabled）, low, medium, high, xhigh, max | 1M / 128K |
| claude-sonnet-4-6 | 支持 | 关闭（disabled）, low, medium, high, max；显式档位配 adaptive | 1M / 128K |
| deepseek-flash、deepseek-v4-flash（官方说明的旧名，由 V4.1-Flash 提供） | 支持 | 关闭（disabled）, low, high, max；显式档位配 enabled | 1M / 384K |
| deepseek-v4-pro | 不支持 | 关闭（disabled）, low, high, max；显式档位配 enabled | 1M / 384K |
| groq llama-3.3-70b-versatile | 不支持 | 无（仅供语音提供商参考，Groq 不作回答模型） | 131,072 / 32,768 |

来源：本文 C1 所列官方页面，另加 Claude Sonnet 4.6 概览 https://platform.claude.com/docs/en/models/sonnet-4-6/overview 与 Groq 模型页 https://console.groq.com/docs/models。能力记录不证明账号可调用该模型。

**未收录边界**：上表以外的官方模型 ID（例如 Gemini 2.5 全系、未列出的 Gemini 3 变体、OpenAI 其他 GPT/o 系列及 mini/nano、Claude 其他旧版本、DeepSeek 未在官方页说明为别名的其他名称）一律为 unknown：图片发送前拒绝、推理只有“服务商默认”。不按前缀或名称推断，大小写或后缀不同的 ID 不匹配。网关、开发用本地地址（`MARGIN_DEV_*`）即使模型同名也为 unknown。

**实现中定下的细节**（未超出本 Spec，供验收确认）：

- 主模型换成网关或 Codex 时，保存的共享默认值不被它使用也不被重置；之后换回官方模型时，若该模型支持此档位就再次生效。
- 会中临时值只在明确设定后参与“换模型时不合法则改为服务商默认并提示”；仍继承保存值时，每个模型分别判断是否适用，因此 A→B→A 回到 A 时保存值重新生效，不会因中途经过 B 被改写。
- 会中控件放在模型按钮右侧，宽 96px（可缩到 64px），左侧组可换行；会中窗口最窄为折叠时的 600px 外壳。
