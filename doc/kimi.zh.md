# 接入 Kimi (Moonshot)

> English: [kimi.md](./kimi.md)

[Kimi API 平台](https://platform.kimi.com/docs)（Moonshot AI）走 OpenAI Chat Completions 协议，完全兼容标准字段。mimo2codex 通过 generic provider 接入，admin UI 输入 `https://api.moonshot.cn/v1` 会被自动识别并套上推荐 features。

## 推荐配置 — admin UI 一键

Admin UI → Providers → **+ 添加 Provider** → 输入：

- baseUrl：`https://api.moonshot.cn/v1`（国内访问，国际用 `https://api.moonshot.ai/v1`）

UI 会自动识别为「Kimi (Moonshot)」并套用：

- `dropReasoningEffort: true` —— Kimi 不识别 `reasoning_effort` 字段，靠 `thinking: {enabled/disabled}` 控制思考。如果 admin UI「Codex 启用」页开了"强制高强度思考"，本开关让 mimo2codex 把 reasoning_effort 字段从发给 Kimi 的请求里删掉，避免风险。

补齐 id / envKey / defaultModel 保存即可。

## 推荐配置 — providers.json

```json
{
  "providers": [
    {
      "id": "kimi",
      "displayName": "Kimi (Moonshot)",
      "baseUrl": "https://api.moonshot.cn/v1",
      "envKey": "MOONSHOT_API_KEY",
      "defaultModel": "kimi-k2.6",
      "models": [
        { "id": "kimi-k2.6", "contextWindow": 262144, "maxOutputTokens": 32768, "supportsReasoning": true },
        { "id": "kimi-k2.5", "contextWindow": 262144, "maxOutputTokens": 32768, "supportsReasoning": true },
        { "id": "kimi-k2-thinking", "contextWindow": 262144, "maxOutputTokens": 32768, "supportsReasoning": true },
        { "id": "kimi-k2-thinking-turbo", "contextWindow": 262144, "supportsReasoning": true },
        { "id": "moonshot-v1-128k", "contextWindow": 131072 },
        { "id": "moonshot-v1-32k", "contextWindow": 32768 },
        { "id": "moonshot-v1-8k", "contextWindow": 8192 }
      ],
      "features": {
        "dropReasoningEffort": true
      },
      "docsUrl": "https://platform.kimi.com/docs"
    }
  ]
}
```

```powershell
$env:MOONSHOT_API_KEY = "sk-xxxxx"   # 在 https://platform.kimi.com/console/api-keys 申请
mimo2codex
```

## 模型一览

来源：[Kimi API docs](https://platform.kimi.com/docs)

| Model ID | 说明 | 默认思考 | 备注 |
|---|---|---|---|
| `kimi-k2.6` | 最新推荐，多模态智能体 | 开（可关）| temperature 固定 1.0；max_tokens 建议 ≥ 16K |
| `kimi-k2.5` | k2.6 之前的版本 | 开 | |
| `kimi-k2-thinking` | 思考模式专用 | **强制开**，不可关 | 推理过程明显，token 消耗大 |
| `kimi-k2-thinking-turbo` | 思考模式 turbo 版 | 强制开 | |
| `moonshot-v1-8k/32k/128k` | 经典 chat 模型 | 不主动思考 | |

## 思考机制对比

Kimi 用 `thinking: {type: "enabled"|"disabled"}` 字段控制思考（与 mimo / deepseek 一致），**不识别** `reasoning_effort`：

| 字段 | Kimi 行为 |
|---|---|
| `thinking: {type: "enabled"}` | 触发思考 |
| `thinking: {type: "disabled"}` | 关思考（kimi-k2-thinking 例外，强制开） |
| `reasoning_effort: "high"` 等 | **不识别**，多数情况忽略；保守起见用 dropReasoningEffort strip 掉 |

响应里 `reasoning_content` 字段在 `content` 之前以流式 delta 形式出现，mimo2codex 的 streamToSse 已经正确翻译给 Codex（在 Codex 终端会看到思考摘要）。

## 注意事项

- **temperature**：kimi-k2.6 文档说 temperature 固定 1.0，客户端传的其他值会被 fallback。mimo2codex 透传客户端 temperature，但 Kimi 上游会自己 fix。
- **max_tokens**：Kimi 文档建议 ≥ 16K（特别是 thinking 模型，因为 reasoning_content 计入 token 数）。Codex 默认 max_output_tokens 一般够。
- **Admin UI 的"强制高强度思考"开关**：对 Kimi **无意义** —— Kimi 不认 reasoning_effort，开了反而会被 `dropReasoningEffort` 删掉。Kimi 思考由 `thinking` 字段控制，kimi-k2.6 / kimi-k2-thinking 默认就开思考，无需额外强制。

## 升级须知

本特性以 generic provider 方式接入，不占用 builtin id。已有 id="kimi" 的 generic provider 配置可继续使用；建议在 admin UI 里编辑后，输入 moonshot baseUrl 触发智能默认，自动套上 `dropReasoningEffort: true`（如果之前 features 全空）。
