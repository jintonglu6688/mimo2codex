import { describe, expect, it } from "vitest";
import { buildConfig, parseArgv } from "../src/config.js";

const VERSION = "test";

function build(args: string[], env: Record<string, string | undefined>) {
  return buildConfig(parseArgv(args), env as NodeJS.ProcessEnv, VERSION);
}

describe("buildConfig: baseUrl resolution priority", () => {
  it("tp-* key auto-switches to the token-plan host", () => {
    const cfg = build(["--no-admin"], { MIMO_API_KEY: "tp-abc" });
    expect(cfg.providers.mimo!.baseUrl).toBe("https://token-plan-cn.xiaomimimo.com/v1");
    expect(cfg.providers.mimo!.flags.isTokenPlan).toBe(true);
    expect(cfg.isTokenPlan).toBe(true);
  });

  it("sk-* key uses the pay-as-you-go host", () => {
    const cfg = build(["--no-admin"], { MIMO_API_KEY: "sk-abc" });
    expect(cfg.providers.mimo!.baseUrl).toBe("https://api.xiaomimimo.com/v1");
    expect(cfg.providers.mimo!.flags.isTokenPlan).toBe(false);
  });

  it("explicit --base-url beats key-based inference", () => {
    const cfg = build(
      ["--no-admin", "--base-url", "https://custom.example.com/v1"],
      { MIMO_API_KEY: "tp-abc" }
    );
    expect(cfg.providers.mimo!.baseUrl).toBe("https://custom.example.com/v1");
  });

  it("MIMO_BASE_URL env beats key-based inference but loses to CLI", () => {
    const cfg = build(["--no-admin"], {
      MIMO_API_KEY: "tp-abc",
      MIMO_BASE_URL: "https://envset.example.com/v1",
    });
    expect(cfg.providers.mimo!.baseUrl).toBe("https://envset.example.com/v1");
  });

  it("empty MIMO_BASE_URL falls back to key-based inference (desktop blank field)", () => {
    // The desktop Settings writes MIMO_BASE_URL= (empty) when the Base URL field
    // is left blank. An empty override must mean "use default", not "no host".
    const cfg = build(["--no-admin"], { MIMO_API_KEY: "tp-abc", MIMO_BASE_URL: "" });
    expect(cfg.providers.mimo!.baseUrl).toBe("https://token-plan-cn.xiaomimimo.com/v1");
    expect(cfg.isTokenPlan).toBe(true);
  });

  it("whitespace-only MIMO_BASE_URL also falls back to inference", () => {
    const cfg = build(["--no-admin"], { MIMO_API_KEY: "sk-abc", MIMO_BASE_URL: "   " });
    expect(cfg.providers.mimo!.baseUrl).toBe("https://api.xiaomimimo.com/v1");
  });

  it("empty --base-url falls back to the default host (not an empty upstream)", () => {
    const cfg = build(["--no-admin", "--base-url", ""], { MIMO_API_KEY: "sk-abc" });
    expect(cfg.providers.mimo!.baseUrl).toBe("https://api.xiaomimimo.com/v1");
  });

  it("explicit token-plan base-url with sk- key still flags isTokenPlan", () => {
    const cfg = build(
      ["--no-admin", "--base-url", "https://token-plan-cn.xiaomimimo.com/v1"],
      { MIMO_API_KEY: "sk-abc" }
    );
    expect(cfg.providers.mimo!.flags.isTokenPlan).toBe(true);
  });

  it("DeepSeek default uses its own host, no MiMo inference leak", () => {
    const cfg = build(["--no-admin", "--model", "ds"], { DS_API_KEY: "sk-ds" });
    expect(cfg.providers.deepseek!.baseUrl).toBe("https://api.deepseek.com/v1");
  });
});
