import { describe, expect, it } from "vitest";
import { configSnippetPreserveLogin } from "../src/setup/preserveLoginSnippet.js";
import { resolveSnippetTarget } from "../src/setup/snippets.js";

const cfg = { host: "127.0.0.1", port: 8788 };

describe("setup/preserveLoginSnippet — configSnippetPreserveLogin", () => {
  it("emits the same provider block as the default snippet (proxy + requires_openai_auth)", () => {
    const out = configSnippetPreserveLogin(cfg, resolveSnippetTarget("mimo"));
    expect(out).toContain('model = "mimo-v2.5-pro"');
    expect(out).toContain('model_provider = "mimo"');
    expect(out).toContain("[model_providers.mimo]");
    expect(out).toContain('base_url = "http://127.0.0.1:8788/v1"');
    expect(out).toContain("requires_openai_auth = true");
  });

  it("does NOT tell the user to write the mimo2codex-local sentinel into auth.json", () => {
    const out = configSnippetPreserveLogin(cfg, resolveSnippetTarget("mimo"));
    // The whole point of this variant: keep the real login. It must not ship
    // the sentinel auth.json the default snippet does.
    expect(out).not.toContain('"OPENAI_API_KEY": "mimo2codex-local"');
  });

  it("explains that the existing ChatGPT login is preserved", () => {
    const out = configSnippetPreserveLogin(cfg, resolveSnippetTarget("ds"));
    expect(out.toLowerCase()).toContain("auth.json");
    // Mentions the login is kept — guards against a future edit silently
    // turning this back into an overwrite snippet.
    expect(/keep|preserv|保留/i.test(out)).toBe(true);
  });
});
