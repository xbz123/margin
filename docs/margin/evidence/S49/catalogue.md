# S49 官方回答模型覆盖与列表过滤

核实日期：2026-10-23。实现基线：`58cd37f2`。本票由当前 Codex 实现，再交 Claude 独立验收；不推送、不远端 CI、不安装、不调用真实服务/凭据。验收结果见 [README](README.md)。

## 范围与覆盖标准

用户最终范围：Gemini ≥3.1、GPT ≥5.4、Claude ≥4.5（含 Opus/Sonnet/Haiku）、DeepSeek Flash（V4/V4.1）与 V4 Pro。以下型号和明确别名逐项登记到同一能力表；没有前缀放行。官网版本目录之外的新型号先不展示，维护表后可展示。已保存旧配置保持，不做用户文件迁移。

官方发现接口先取得完整分页列表，再与能力表、当前协议、未停用且应用能执行的条件求交集；不向返回列表补入账号未列出的型号。Gemini 还须声明 `generateContent`。Groq 转写、网关及开发 loopback 发现不套此过滤。修改协议（含外部配置刷新）会清空以前获取的列表并拒绝迟到结果。界面的原候选不属于新发现列表，不因升级消失。

以下“档位”均另含默认（不发送参数）；“关闭”只发送文档支持的完整组合。不增加预算输入、Pro 执行模式、工具配置或后台同步。

## Gemini：9 个可新增 ID，1 个停用 ID

来源：[模型目录](https://ai.google.dev/gemini-api/docs/models)、[GenerateContent thinking](https://ai.google.dev/gemini-api/docs/generate-content/thinking)、[停用与路由](https://ai.google.dev/gemini-api/docs/deprecations)。每个主 ID 的详情为 `https://ai.google.dev/gemini-api/docs/models/<ID>`，已逐页核对文字输出、图片输入和版本列表。

| 主型号及明确别名 | 图片 | 档位 | 备注 |
| --- | --- | --- | --- |
| gemini-4-argon | 是 | low / medium / high | 容量记录采用默认同步输出上限 65536，不当成已支持 long decode |
| gemini-3.8-flash；gemini-3.7-flash | 是 | low / medium / high | 3.7 官方路由至 3.8，minimal 会报错 |
| gemini-3.6-flash；gemini-3.5-flash | 是 | minimal / low / medium / high | 3.5 官方路由至 3.6 |
| gemini-3.5-flash-lite | 是 | minimal / low / medium / high | 正式型号 |
| gemini-3.1-flash-lite | 是 | minimal / low / medium / high | 官方计划 2027-05-07 停用，当前仍可用，不改预设 |
| gemini-3.1-pro-preview；gemini-3.1-pro-preview-customtools | 是 | low / medium / high | customtools 是详情页明确列出的变体，不按后缀推断 |
| gemini-3.1-flash-lite-preview | 是（历史能力） | 默认 | 已于 2026-05-25 停用；保留旧配置提示，不列入新发现结果 |

排除：3.0 及更早型号（用户明确不查不补）；Live、TTS、Transcribe、Nano Banana/图像生成、视频、embedding、机器人专用模型。`gemini-3.1-flash` 并非以上目录的已核实 ID，不因为显示名相近而认证。

## OpenAI：14 个当前主 ID、6 个日期快照；1 个停用 ID

来源：[完整目录](https://developers.openai.com/api/docs/models/all)、各行链接的模型详情（已核对输入模态、端点、effort、快照）、[停用说明](https://developers.openai.com/api/docs/deprecations)。C = Chat Completions，R = Responses。

| 型号 | 协议 | 图片 | 档位 |
| --- | --- | --- | --- |
| [gpt-5.4](https://developers.openai.com/api/docs/models/gpt-5.4) | C/R | 是 | none / low / medium / high / xhigh |
| [gpt-5.4-mini](https://developers.openai.com/api/docs/models/gpt-5.4-mini)、[gpt-5.4-nano](https://developers.openai.com/api/docs/models/gpt-5.4-nano) | C/R | 是 | none / low / medium / high / xhigh |
| [gpt-5.4-pro](https://developers.openai.com/api/docs/models/gpt-5.4-pro) | R | 是 | medium / high / xhigh |
| [gpt-5.5](https://developers.openai.com/api/docs/models/gpt-5.5) | C/R | 是 | none / low / medium / high / xhigh |
| [gpt-5.5-pro](https://developers.openai.com/api/docs/models/gpt-5.5-pro) | R（非流式，暂不接入） | 是 | medium / high / xhigh（事实保留，不列新增候选） |
| [gpt-5.6-sol](https://developers.openai.com/api/docs/models/gpt-5.6-sol)、[gpt-5.6-terra](https://developers.openai.com/api/docs/models/gpt-5.6-terra)、[gpt-5.6-luna](https://developers.openai.com/api/docs/models/gpt-5.6-luna) | C/R | 是 | none / low / medium / high / xhigh / max |
| [gpt-6-sol](https://developers.openai.com/api/docs/models/gpt-6-sol)、[gpt-6-luna](https://developers.openai.com/api/docs/models/gpt-6-luna) | C/R | 是 | none / low / medium / high / xhigh / max |
| [gpt-6-astra](https://developers.openai.com/api/docs/models/gpt-6-astra)、[gpt-6.1-sol](https://developers.openai.com/api/docs/models/gpt-6.1-sol) | C/R | 是 | low / medium / high / xhigh / max |
| [gpt-5.6-cyber](https://developers.openai.com/api/docs/models/gpt-5.6-cyber) | R | 是 | 仅默认：模型详情未列出专属 effort 集合，不从同代通用型号推断；需账号许可 |
| gpt-5.4-cyber | R | 未核实 | 仅默认：已于 2026-10-01 停用，不列入新发现结果 |

明确快照：`gpt-5.4-2026-03-05`、`gpt-5.4-pro-2026-03-05`、`gpt-5.4-mini-2026-03-17`、`gpt-5.4-nano-2026-03-17`、`gpt-5.5-2026-04-23`、`gpt-5.5-pro-2026-04-23`。其余以上型号在详情页为无日期 ID，不虚构日期版。nano 已 deprecated 但停止服务日期为 2027-04-01，故当前仍列出。

GPT-5.5 Pro 的 HTML 详情 Features 明确为 Streaming Not supported。主 ID 与日期快照均不列入新增结果，旧配置不删除，卡片显示未接入原因；只有该模型实际被尝试时才在网络调用前拒绝，旧的不可用备用不会阻止有效主模型回答，也不会被静默删除。保留事实不等于宣称当前应用已支持这种回答方式；没有为本票添加非流式回退、后台任务或改超时。5.4 Pro 文档明确支持 streaming，仍正常列出。

排除：GPT <5.4、o 系列、历史 Codex 系列、无版本的 Chat/Daybreak 别名、开源自部署 gpt-oss、音频/实时/图像生成/embedding/moderation、单独准入的非 GPT 生命科学型号。API 模型目录不等于 ChatGPT/Codex 订阅型号目录。

## Claude：16 个无日期 ID、3 个日期快照

来源：[目录](https://platform.claude.com/docs/en/models/overview)、[effort](https://platform.claude.com/docs/en/build-with-claude/effort)、[thinking 配置矩阵](https://platform.claude.com/docs/en/build-with-claude/thinking)、[生命周期](https://platform.claude.com/docs/en/about-claude/model-deprecations)、[ID 规则](https://platform.claude.com/docs/en/about-claude/models/model-ids-and-versions)。以下每个型号的 `https://platform.claude.com/docs/en/models/<系列版本>/overview` 详情均已读取：图片输入为是，协议为 Messages。

| 型号 | 档位（另含默认） | 显式档位的参数 |
| --- | --- | --- |
| claude-opus-5-5、claude-sonnet-5-5、claude-fable-5-1、claude-fable-5、claude-mythos-5-1、claude-mythos-5 | low / medium / high / xhigh / max | effort，默认已启用思考；不提供 disabled |
| claude-opus-5、claude-sonnet-5、claude-haiku-5-5 | 关闭、low / medium / high / xhigh / max | 档位为 effort；关闭为 disabled、不附带冲突 effort |
| claude-opus-4-8、claude-opus-4-7 | 关闭、low / medium / high / xhigh / max | adaptive + effort；关闭为 disabled |
| claude-opus-4-6、claude-sonnet-4-6 | 关闭、low / medium / high / max | adaptive + effort，无 xhigh |
| claude-opus-4-5 | 关闭、low / medium / high | effort 本身合法、控制输出，但不凭空添加预算或开启扩展思考 |
| claude-sonnet-4-5、claude-haiku-4-5 | 关闭 | 没有 effort 档位；预算式 extended thinking 本票不新增数值控件 |

明确快照：`claude-opus-4-5-20251101`、`claude-sonnet-4-5-20250929`、`claude-haiku-4-5-20251001`。4.6 起无日期 ID 本身为固定版本，不猜日期后缀。Sonnet 4.5 已 deprecated、计划 2026-11-30 停用；仍展示。Mythos 5/5.1 为受限账号模型，只有账号返回才显示，不承诺可调用。

排除：4.5 前型号、无明确版本的旧 Mythos Preview（邀请制旧预览，详情入口已不存在）、Bedrock/Vertex/Foundry 专用 ID。Sonnet 5.5 的 between_tools 不是关闭全部思考，不冒充 off；本票仍只维护当前默认/effort/off 控件。

## DeepSeek：4 个明确 ID

来源：[模型、图片能力与旧名路由](https://api-docs.deepseek.com/quick_start/pricing/)、[思考参数](https://api-docs.deepseek.com/guides/thinking_mode/)。保持现有官方 Chat Completions 接入，不新增官方协议选择。

| 型号 | 图片 | 档位 |
| --- | --- | --- |
| deepseek-flash；deepseek-v4-flash；deepseek-v4-flash-vision-exp | 是 | 关闭、low / high / max；档位使用 enabled + effort |
| deepseek-v4-pro | 否 | 同上 |

两个旧 Flash ID 官方仍接受、路由至 V4.1 Flash；不是三个不同客户端能力。medium/xhigh 等服务端映射值不列为原生独立档位。`deepseek-chat`、`deepseek-reasoner` 和自行拼写的 `deepseek-v4.1-flash` 不在此表。

## 验收边界

范围内共 54 个 ID（含 2 个停用 ID、2 个非流式暂不接入 ID）；新发现至多 50 个，再受账号与协议限制。额外保留既有 Groq 语音参考记录，不计入官方回答范围。图片和参数均是文档契约，非真实账号/服务测试；未证实的 Cyber effort 明确保持默认。未来新增型号或来源变化需要再次核对，不能以日期过滤推导能力。
