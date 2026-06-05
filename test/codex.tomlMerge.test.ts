import { describe, it, expect } from "vitest";
import { mergeCodexProviderToml, type ProviderTomlPatch } from "../src/codex/tomlMerge.js";

const patch: ProviderTomlPatch = {
  model: "mimo-v2.5-pro",
  modelProvider: "mimo",
  modelContextWindow: 200000,
  providerKey: "mimo",
  providerBlock: `[model_providers.mimo]
name = "MiMo"
base_url = "http://127.0.0.1:8788/v1"
wire_api = "responses"
requires_openai_auth = true
request_max_retries = 1`,
};

describe("mergeCodexProviderToml", () => {
  it("preserves the user's custom sections and comments", () => {
    const existing = `model = "gpt-5.3-codex"
model_reasoning_effort = "high"

[windows]
sandbox = "elevated"

[mcp_servers.linear]
url = "https://mcp.linear.app/mcp"
enabled = false

[projects.'D:\\workspace']
trust_level = "trusted"

[notice.model_migrations]
"gpt-5.3-codex" = "gpt-5.4"
`;
    const out = mergeCodexProviderToml(existing, patch);

    // Managed keys updated.
    expect(out).toContain(`model = "mimo-v2.5-pro"`);
    expect(out).toContain(`model_provider = "mimo"`);
    expect(out).toContain(`model_context_window = 200000`);
    // Old model value is gone.
    expect(out).not.toContain(`gpt-5.3-codex"\n`);
    expect(out).not.toMatch(/^model = "gpt-5\.3-codex"/m);

    // Everything else preserved.
    expect(out).toContain(`model_reasoning_effort = "high"`);
    expect(out).toContain(`[windows]`);
    expect(out).toContain(`sandbox = "elevated"`);
    expect(out).toContain(`[mcp_servers.linear]`);
    expect(out).toContain(`url = "https://mcp.linear.app/mcp"`);
    expect(out).toContain(`[projects.'D:\\workspace']`);
    expect(out).toContain(`[notice.model_migrations]`);
    expect(out).toContain(`"gpt-5.3-codex" = "gpt-5.4"`);

    // Provider block present exactly once.
    expect(out.match(/\[model_providers\.mimo\]/g)?.length).toBe(1);
  });

  it("replaces an existing [model_providers.<key>] block rather than duplicating", () => {
    const existing = `model = "old"
model_provider = "mimo"

[model_providers.mimo]
name = "Stale"
base_url = "http://127.0.0.1:9999/v1"
wire_api = "chat"
`;
    const out = mergeCodexProviderToml(existing, patch);
    expect(out.match(/\[model_providers\.mimo\]/g)?.length).toBe(1);
    expect(out).toContain(`base_url = "http://127.0.0.1:8788/v1"`);
    expect(out).not.toContain(`name = "Stale"`);
    expect(out).not.toContain(`http://127.0.0.1:9999/v1`);
  });

  it("does not confuse provider key 'mimo' with 'mimo2codex'", () => {
    const existing = `model = "x"

[model_providers.mimo2codex]
name = "DeepSeek (legacy key)"
base_url = "http://127.0.0.1:8788/v1"
`;
    const out = mergeCodexProviderToml(existing, patch);
    // The unrelated deepseek-keyed table must survive.
    expect(out).toContain(`[model_providers.mimo2codex]`);
    expect(out).toContain(`name = "DeepSeek (legacy key)"`);
    // And our mimo block is added.
    expect(out).toContain(`[model_providers.mimo]`);
  });

  it("removes a stale model_context_window when the new model has none", () => {
    const existing = `model = "old"
model_context_window = 999999
model_max_output_tokens = 12345
`;
    const noTuning: ProviderTomlPatch = {
      ...patch,
      modelContextWindow: undefined,
      modelMaxOutputTokens: undefined,
    };
    const out = mergeCodexProviderToml(existing, noTuning);
    expect(out).not.toContain(`999999`);
    expect(out).not.toContain(`12345`);
    expect(out).not.toMatch(/^model_context_window/m);
  });

  it("renders a minimal standalone config when there is no existing file", () => {
    expect(mergeCodexProviderToml(null, patch)).toBe(
      `model = "mimo-v2.5-pro"
model_provider = "mimo"
model_context_window = 200000

[model_providers.mimo]
name = "MiMo"
base_url = "http://127.0.0.1:8788/v1"
wire_api = "responses"
requires_openai_auth = true
request_max_retries = 1
`
    );
    expect(mergeCodexProviderToml("   \n  ", patch)).toContain(`model = "mimo-v2.5-pro"`);
  });
});
