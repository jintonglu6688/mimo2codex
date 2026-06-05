// Probe-shape detection for POST /v1/responses (server.ts:isResponsesProbe).
//
// Locks the issue #31 regression: CodeX Desktop sends `{input: "..."}` as a
// raw string per the OpenAI Responses API spec, but the original probe check
// only recognized the array form, misidentifying every string-input request
// as a health-check probe and returning empty output: [] with no upstream
// call. The string-input branch was added by 85339098-afk in PR #31; these
// tests pin that behavior so a future refactor cannot regress it silently.

import { describe, expect, it } from "vitest";
import { isResponsesProbe } from "../src/server.js";
import type { ResponsesRequest } from "../src/translate/types.js";

// Build a minimal ResponsesRequest. The probe predicate only looks at
// `input` + `instructions`, so model / stream are noise but kept for
// completeness so the cast stays honest.
function req(extra: Partial<ResponsesRequest> = {}): ResponsesRequest {
  return { model: "mimo-v2.5-pro", stream: false, ...extra };
}

describe("isResponsesProbe", () => {
  it("true for {model, stream} with no input + no instructions (cc-switch probe)", () => {
    expect(isResponsesProbe(req())).toBe(true);
  });

  it("true when input is an empty array", () => {
    expect(isResponsesProbe(req({ input: [] }))).toBe(true);
  });

  it("true when input is an empty string", () => {
    // Empty string is not a meaningful request — let it fall through to the
    // synthetic probe instead of forwarding messages: [{role:'user', content:''}]
    // which several upstreams (DeepSeek, MiMo) reject as malformed.
    expect(isResponsesProbe(req({ input: "" }))).toBe(true);
  });

  it("true when input is undefined and instructions is empty string", () => {
    expect(isResponsesProbe(req({ instructions: "" }))).toBe(true);
  });

  // ── issue #31 regression — these are the cases that used to misfire ──
  it("FALSE when input is a non-empty string (issue #31 — CodeX Desktop)", () => {
    expect(isResponsesProbe(req({ input: "write hello world" }))).toBe(false);
  });

  it("FALSE when input is a single-char string", () => {
    // Belt-and-suspenders: 'length > 0' must be the check, not just truthy
    // (a string "0" should also count as input — typeof === string && len > 0).
    expect(isResponsesProbe(req({ input: "a" }))).toBe(false);
  });

  // ── Existing well-behaved shapes that must continue to bypass the probe ──
  it("false when input is a non-empty array of items", () => {
    expect(
      isResponsesProbe(
        req({
          input: [
            { type: "message", role: "user", content: [{ type: "input_text", text: "hi" }] },
          ],
        })
      )
    ).toBe(false);
  });

  it("false when only instructions is set (system-prompt-only request)", () => {
    expect(isResponsesProbe(req({ instructions: "You are MiMo." }))).toBe(false);
  });

  it("false when both input string and instructions are set", () => {
    expect(
      isResponsesProbe(req({ input: "hi", instructions: "You are MiMo." }))
    ).toBe(false);
  });
});
