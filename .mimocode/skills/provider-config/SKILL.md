---
name: provider-config
description: Configure and integrate new AI providers into mimo2codex. Use when the user wants to add a new provider, configure existing ones, or troubleshoot provider connectivity issues.
---

# Provider Configuration Skill

Configure and integrate AI providers into the mimo2codex proxy.

## When to use

Trigger this skill when:
- User wants to add a new provider (e.g., "接入MiniMax", "add a new provider")
- User provides provider configuration JSON
- User asks to configure a provider (e.g., "按要求配置")
- User has provider connectivity issues
- User asks about provider compatibility

## Workflow

### 1. Understand Provider Requirements

Gather from user:
- **Base URL**: API endpoint (e.g., `https://api.example.com/v1`)
- **API Key**: Authentication method
- **Models**: Which models to expose
- **Wire API**: OpenAI-compatible? Custom format?
- **Special features**: Vision, tools, streaming, etc.

### 2. Check Existing Provider Patterns

Look at `src/providers/` for examples:
- `mimo.ts` - MiMo provider (built-in)
- `deepseek.ts` - DeepSeek provider (built-in)
- `registry.ts` - Provider registration
- `types.ts` - Provider type definitions

### 3. Create Provider Configuration

For generic OpenAI-compatible providers:

```typescript
// In src/providers/registry.ts or config
{
  id: "provider-name",
  shortcut: "provider-name",
  displayName: "Provider Display Name",
  baseUrl: "https://api.example.com/v1",
  models: ["model-1", "model-2"],
  wireApi: "openai-chat", // or "custom"
  apiKeyEnv: "PROVIDER_API_KEY",
}
```

### 4. Handle Provider Quirks

Common compatibility issues:
- **`max_tokens` vs `max_completion_tokens`**: Some providers use different field names
- **Image input**: Not all providers support vision
- **Tool calling**: Some providers have limited tool support
- **Streaming**: Check SSE format compatibility
- **Rate limiting**: Implement retry logic if needed

### 5. Test Provider Integration

```bash
# Test with direct API call
curl -X POST "$BASE_URL/chat/completions" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"model-name","messages":[{"role":"user","content":"Hello"}]}'

# Test through mimo2codex
curl -X POST http://localhost:8788/v1/chat/completions \
  -H "Authorization: Bearer your-key" \
  -H "Content-Type: application/json" \
  -d '{"model":"provider-name/model-name","messages":[{"role":"user","content":"Hello"}]}'
```

### 6. Document Provider

Add to provider documentation:
- Base URL and auth method
- Supported models and capabilities
- Known quirks or limitations
- Example configuration

## Example Usage

```
User: 按要求配置：{ "providers": [ { "id": "sensenova", "shortcut": "sensenova", "displayName": "商汤日日新", "baseUrl": "..." } ] }

Agent workflow:
1. Parse the provider configuration JSON
2. Check if provider needs special handling
3. Add to registry.ts or config
4. Test the integration
5. Document any quirks found
```

## Provider Compatibility Matrix

| Provider | Wire API | Vision | Tools | Streaming | Notes |
|----------|----------|--------|-------|-----------|-------|
| MiMo | openai-chat | ✅ | ✅ | ✅ | Built-in, `max_completion_tokens` |
| DeepSeek | openai-chat | ❌ | ✅ | ✅ | Built-in, `reasoning_content` |
| MiniMax | openai-chat | ✅ | ✅ | ✅ | May need `dropResponseFormat` |
| Generic | openai-chat | ? | ? | ? | Depends on implementation |

## Common Configuration Patterns

### For OpenAI-Compatible APIs

```json
{
  "id": "my-provider",
  "shortcut": "my-provider",
  "displayName": "My AI Provider",
  "baseUrl": "https://api.my-provider.com/v1",
  "models": ["gpt-4", "gpt-3.5-turbo"],
  "wireApi": "openai-chat",
  "apiKeyEnv": "MY_PROVIDER_API_KEY"
}
```

### For Custom APIs

```json
{
  "id": "custom-ai",
  "shortcut": "custom-ai",
  "displayName": "Custom AI",
  "baseUrl": "https://custom-ai.example.com/api",
  "models": ["custom-model-v1"],
  "wireApi": "custom",
  "apiKeyEnv": "CUSTOM_AI_KEY",
  "transformRequest": "custom-transform.ts",
  "transformResponse": "custom-transform.ts"
}
```

## Troubleshooting

### "Unauthorized" / 401 Errors
- Check API key is correct
- Verify API key has proper permissions
- Check if key needs specific header format

### "Model Not Found" / 404 Errors
- Verify model name matches provider's expected format
- Check if model is available in your region
- Confirm model is enabled in your account

### Streaming Issues
- Check if provider supports SSE format
- Verify `stream: true` in request
- Look for newline-delimited JSON issues

### Tool Calling Issues
- Verify provider supports function calling
- Check tool schema format compatibility
- Look for `tool_choice` support

## Key Commands Reference

```bash
# Print current config
node dist/cli.js print-config

# Print cc-switch config
node dist/cli.js print-cc-switch

# Test provider directly
curl -X POST "$BASE_URL/chat/completions" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"model-name","messages":[{"role":"user","content":"test"}]}'

# Check mimo2codex logs
tail -f ~/.mimo2codex/logs/proxy.log
```

## Don't Use This Skill For

- General API calls (use mimo_chat.py from mimoskill)
- PR review (use pr-review skill)
- Issue investigation (use issue-investigation skill)
- Codebase analysis (use codebase-analysis skill)
