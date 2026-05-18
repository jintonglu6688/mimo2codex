# 接入商汤日日新 (SenseNova)

> English: [sensenova.md](./sensenova.md)

[商汤日日新 SenseNova](https://platform.sensenova.cn/docs)（baseUrl `https://token.sensenova.cn/v1`）兼容 OpenAI Chat Completions 规范，但 6.7 Flash-Lite 等模型的网关 schema 比 OpenAI 自家更严：**官方请求参数表里未列出的字段一律拒收**，并且具体校验失败原因经常被网关替换成无信息量的 `Errors in message queue response`。本文档说明如何用 v0.2.9+ 的 sensenova 预设一键解决。

## 症状（修复前）

把 SenseNova 当成普通 generic provider 配上去，使用 Claude Code / Codex 一发请求就 400：

```
upstream returned 400: {"error":{"message":"Errors in message queue response",
                                  "type":"invalid_request_error","code":"3"}}
```

报错 message 不告诉你**哪个字段**有问题。

## 根因

SenseNova 6.7 Flash-Lite [官方请求参数表](https://platform.sensenova.cn/docs)只列以下字段：

`model / messages / stream / stream_options / temperature / top_p / max_tokens / n / stop / frequency_penalty / presence_penalty / reasoning_effort / tools / tool_choice / parallel_tool_calls / seed`

**没列出**：

| 字段 | OpenAI / DeepSeek | SenseNova 6.7 Flash-Lite |
|---|---|---|
| `response_format` | 接受 | **拒绝**（未列出） |
| `thinking` / `enable_thinking` | / | **拒绝**（同平台 DeepSeek V4 Flash 列了，6.7 没列） |
| `tools[*].function.strict: true` | 接受 | **不在 schema 里**（防御性删） |
| `assistant.content: null`（同消息带 tool_calls） | 接受 | **不明示** |
| 多条 `role: "system"` 消息 | 接受 | **不明示** |

外加边界约束：

- `temperature ∈ [0, 2]`
- `max_tokens ∈ [1, 65536]`
- 上下文 256K（输入 ≤ 252K，输出 ≤ 64K）

错误码 `"code": "3"` 对应 `invalid_request_error`，message 字段才是真实原因（[文档错误码示例](https://platform.sensenova.cn/docs)给的是 `"invalid temperature, should in [0,2]."`）。但网关有时会把具体说明替换成 `Errors in message queue response`，导致排查困难。

## 推荐配置 — admin UI 一键

打开 mimo2codex admin UI → Providers → **+ 添加 Provider** → 输入：

- baseUrl：`https://token.sensenova.cn/v1`

UI 会自动识别为「商汤日日新」并应用以下 features（你可以点 Alert 上的「清除并自定义」改回手动控制）：

- `dropNullStrict`：删 `tools[*].function.strict === null`
- `dropNullContent`：删 assistant `content === null`
- `dropToolChoiceAuto`：删 `tool_choice === "auto"`（auto 即默认值）
- `mergeSystemMessages`：合并多条 system 消息为单条前置
- `dropResponseFormat`：删 `response_format` 字段（SenseNova 不接受）
- `enhanceErrorPreset: "sensenova"`：把 `Errors in message queue response` 翻成中文诊断 hint

补齐其他必填项（id、envKey、defaultModel）保存即可，重启 mimo2codex 让运行时注册。

## 推荐配置 — providers.json

```json
{
  "providers": [
    {
      "id": "sensenova",
      "displayName": "商汤日日新",
      "baseUrl": "https://token.sensenova.cn/v1",
      "envKey": "SENSENOVA_API_KEY",
      "defaultModel": "sensenova-6.7-flash-lite",
      "models": [
        { "id": "sensenova-6.7-flash-lite", "contextWindow": 262144, "maxOutputTokens": 65536, "supportsImages": true },
        { "id": "deepseek-v4-flash",       "contextWindow": 262144, "maxOutputTokens": 65536, "supportsReasoning": true }
      ],
      "features": {
        "dropNullStrict": true,
        "dropNullContent": true,
        "dropToolChoiceAuto": true,
        "mergeSystemMessages": true,
        "dropResponseFormat": true,
        "enhanceErrorPreset": "sensenova"
      },
      "docsUrl": "https://platform.sensenova.cn/docs"
    }
  ]
}
```

设置环境变量并启动：

```powershell
$env:SENSENOVA_API_KEY = "sk-xxxxx"   # 在 https://platform.sensenova.cn/console/keys 申请
mimo2codex
```

## 模型列表

来源：[https://platform.sensenova.cn/docs](https://platform.sensenova.cn/docs)（"模型总览"节）

| Model ID | 说明 | 限额 | 多模态 | 推理模式 | 备注 |
|---|---|---|---|---|---|
| `sensenova-6.7-flash-lite` | 轻量多模态智能体 | 1500 次 / 5h | 文本 + 图像 | reasoning_effort | 默认推荐 |
| `deepseek-v4-flash` | DeepSeek 高性能对话 | 150 次 / 5h | 文本 | thinking 模式 | 走 SenseNova 网关时，`thinking` 字段不能发（generic provider 会 strip） |
| `sensenova-u1-fast` | 信息图生成 | 1500 次 / 5h | / | / | **图像生成专用**，走 `/v1/images/generations`，与 chat completions 路径不兼容，mimo2codex 暂不支持 |

## 常见 400 排查

如果套上以上 features 后还是 400，按顺序排查：

1. **开 mimo2codex debug 日志看真实请求体**：
   ```powershell
   $env:LOG_LEVEL = "debug"
   ```
   启动后命中报错请求时，日志里会有 `incoming POST /v1/chat/completions raw body { ... }`，把它复制出来。
2. **直发 SenseNova 复现**：用同一份请求体 + `Authorization: Bearer $env:SENSENOVA_API_KEY` 直接 curl `https://token.sensenova.cn/v1/chat/completions`。能复现 → 与 mimo2codex 无关，是请求体某字段被拒。
3. **二分定位**：把请求体里的字段一个一个删掉看哪个是元凶。先删 `tools`（测纯文本是否能过），再删可疑字段。
4. **检查边界值**：`max_tokens` 不能超 65536；`temperature` 必须在 [0,2] 闭区间。
5. **如果定位到的字段没有现成 sanitizer 子开关**：在 mimo2codex 仓库开 issue，附上字段名和最小复现。

## 升级须知

本特性以 generic provider 方式接入，**不占用 builtin id**。如果你之前已经用 `id="sensenova"` 配过 generic provider：

- 仍可继续使用，无任何冲突。
- 建议在 admin UI 打开编辑弹窗 → 输入 baseUrl 触发智能默认，它会自动套上推荐 features（前提是你之前 features 全空）。
- 若你之前手动勾过 features，会受到"已自定义 → 不覆盖"保护；可手动按需勾选新的 `dropResponseFormat` / `enhanceErrorPreset` 子开关，或点击 Alert 上的「清除并自定义」从头来过。
