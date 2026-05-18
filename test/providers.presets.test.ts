import { describe, expect, it } from "vitest";
import {
  PROVIDER_PRESETS,
  matchPreset,
  applyEnhanceErrorPreset,
} from "../src/providers/presets.js";

describe("PROVIDER_PRESETS", () => {
  it("contains sensenova and minimax", () => {
    const ids = PROVIDER_PRESETS.map((p) => p.id).sort();
    expect(ids).toEqual(["minimax", "sensenova"]);
  });

  it("sensenova preset has dropResponseFormat + enhanceErrorPreset wired", () => {
    const sn = PROVIDER_PRESETS.find((p) => p.id === "sensenova");
    expect(sn).toBeDefined();
    expect(sn!.recommendedSpec.features.dropResponseFormat).toBe(true);
    expect(sn!.recommendedSpec.features.enhanceErrorPreset).toBe("sensenova");
    expect(sn!.recommendedSpec.baseUrl).toBe("https://token.sensenova.cn/v1");
  });
});

describe("matchPreset", () => {
  it("matches sensenova by baseUrl substring (case-insensitive)", () => {
    expect(matchPreset("https://TOKEN.SenseNova.cn/v1", "")?.id).toBe("sensenova");
  });

  it("matches sensenova by model prefix when baseUrl is empty", () => {
    expect(matchPreset("", "sensenova-6.7-flash-lite")?.id).toBe("sensenova");
    expect(matchPreset("", "deepseek-v4-flash")?.id).toBe("sensenova");
  });

  it("matches minimax by baseUrl", () => {
    expect(matchPreset("https://api.minimaxi.com/v1", "")?.id).toBe("minimax");
  });

  it("matches minimax by model prefix", () => {
    expect(matchPreset("", "MiniMax-M2.7")?.id).toBe("minimax");
    expect(matchPreset("", "abab6.5")?.id).toBe("minimax");
  });

  it("returns null when nothing matches", () => {
    expect(matchPreset("https://api.example.com/v1", "qwen3-max")).toBeNull();
    expect(matchPreset("", "")).toBeNull();
  });

  it("baseUrl match wins over model match (priority order)", () => {
    // sensenova baseUrl 命中即使 model prefix 是 minimax
    expect(
      matchPreset("https://token.sensenova.cn/v1", "MiniMax-M2.7")?.id,
    ).toBe("sensenova");
  });
});

describe("applyEnhanceErrorPreset", () => {
  it("sensenova: 'Errors in message queue response' → diagnostic hint", () => {
    const out = applyEnhanceErrorPreset(
      "sensenova",
      400,
      '{"error":{"message":"Errors in message queue response","type":"invalid_request_error","code":"3"}}',
    );
    expect(out?.code).toBe("sensenova_request_validation_failed");
    expect(out?.message).toMatch(/response_format/);
    expect(out?.message).toMatch(/Errors in message queue response/); // raw 附在末尾
  });

  it("sensenova: invalid temperature → range hint", () => {
    const out = applyEnhanceErrorPreset(
      "sensenova",
      400,
      "invalid temperature, should in [0,2].",
    );
    expect(out?.code).toBe("sensenova_temperature_out_of_range");
    expect(out?.message).toMatch(/\[0,2\]/);
  });

  it("sensenova: max_tokens error → range hint", () => {
    const out = applyEnhanceErrorPreset(
      "sensenova",
      400,
      "max_tokens exceeds upper bound 65536",
    );
    expect(out?.code).toBe("sensenova_max_tokens_out_of_range");
    expect(out?.message).toMatch(/65536/);
  });

  it("sensenova: 401 / 500 / unrelated → null (no false positives)", () => {
    expect(applyEnhanceErrorPreset("sensenova", 401, "unauthorized")).toBeNull();
    expect(applyEnhanceErrorPreset("sensenova", 500, "internal")).toBeNull();
    expect(applyEnhanceErrorPreset("sensenova", 400, "some random body")).toBeNull();
  });

  it("sensenova: empty/undefined snippet → null", () => {
    expect(applyEnhanceErrorPreset("sensenova", 400, undefined)).toBeNull();
    expect(applyEnhanceErrorPreset("sensenova", 400, "")).toBeNull();
  });

  it("minimax preset: no rules yet → null", () => {
    expect(
      applyEnhanceErrorPreset("minimax", 400, "invalid chat setting"),
    ).toBeNull();
  });
});
