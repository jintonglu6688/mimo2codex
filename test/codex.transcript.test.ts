import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import os from "node:os";
import path from "node:path";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";

let fakeHome: string;
let homedirSpy: ReturnType<typeof vi.spyOn>;
let originalCodexHome: string | undefined;

beforeEach(() => {
  fakeHome = mkdtempSync(path.join(tmpdir(), "m2c-transcript-test-"));
  homedirSpy = vi.spyOn(os, "homedir").mockReturnValue(fakeHome);
  originalCodexHome = process.env.CODEX_HOME;
  delete process.env.CODEX_HOME;
});

afterEach(() => {
  homedirSpy.mockRestore();
  if (originalCodexHome !== undefined) process.env.CODEX_HOME = originalCodexHome;
  rmSync(fakeHome, { recursive: true, force: true });
});

function writeRollout(name: string, lines: object[]): string {
  const dir = path.join(fakeHome, ".codex", "sessions", "2026", "03", "10");
  mkdirSync(dir, { recursive: true });
  const p = path.join(dir, name);
  writeFileSync(p, lines.map((l) => JSON.stringify(l)).join("\n") + "\n", "utf-8");
  return p;
}

describe("codex/transcript", () => {
  it("parses messages, tool calls (with paired output) and skips developer/instruction blocks", async () => {
    const { parseTranscript } = await import("../src/codex/transcript.js");
    const p = writeRollout("rollout-x.jsonl", [
      { type: "session_meta", payload: { cwd: "D:/proj" } },
      { type: "turn_context", payload: { model: "mimo-v2.5-pro" } },
      { type: "response_item", payload: { type: "message", role: "developer", content: [{ type: "input_text", text: "<permissions> ... </permissions>" }] } },
      { type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "# AGENTS.md instructions for D:/proj\n..." }] } },
      { type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "分析一下该项目" }] } },
      { type: "response_item", payload: { type: "reasoning", summary: [], encrypted_content: "xxx" } },
      { type: "response_item", payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: "好的，我先看结构。" }] } },
      { type: "response_item", payload: { type: "function_call", name: "shell_command", arguments: '{"command":"ls -la"}', call_id: "c1" } },
      { type: "event_msg", payload: { type: "some_delta" } },
      { type: "response_item", payload: { type: "function_call_output", call_id: "c1", output: "total 0\nfoo" } },
      { type: "response_item", payload: { type: "custom_tool_call", name: "apply_patch", input: "*** Begin Patch\n...", call_id: "c2", status: "completed" } },
      { type: "response_item", payload: { type: "custom_tool_call_output", call_id: "c2", output: "done" } },
    ]);

    const tr = parseTranscript(p);
    expect(tr.available).toBe(true);
    expect(tr.model).toBe("mimo-v2.5-pro");

    // developer message dropped; reasoning w/o summary dropped.
    expect(tr.items.filter((i) => i.kind === "message").length).toBe(3); // 2 user + 1 assistant
    expect(tr.items.some((i) => i.kind === "reasoning")).toBe(false);

    const ctxMsg = tr.items.find((i) => i.kind === "message" && i.context);
    expect(ctxMsg && ctxMsg.kind === "message" && ctxMsg.text).toContain("AGENTS.md");
    const realUser = tr.items.find((i) => i.kind === "message" && i.role === "user" && !i.context);
    expect(realUser && realUser.kind === "message" && realUser.text).toBe("分析一下该项目");

    // shell tool: command extracted, output paired.
    const shell = tr.items.find((i) => i.kind === "tool" && i.name === "shell_command");
    expect(shell && shell.kind === "tool" && shell.command).toBe("ls -la");
    expect(shell && shell.kind === "tool" && shell.output).toContain("foo");

    // apply_patch: input + output paired.
    const patch = tr.items.find((i) => i.kind === "tool" && i.name === "apply_patch");
    expect(patch && patch.kind === "tool" && patch.input).toContain("Begin Patch");
    expect(patch && patch.kind === "tool" && patch.output).toBe("done");
  });

  it("returns unavailable for a missing file", async () => {
    const { parseTranscript } = await import("../src/codex/transcript.js");
    const tr = parseTranscript(path.join(fakeHome, ".codex", "sessions", "nope.jsonl"));
    expect(tr.available).toBe(false);
    expect(tr.items).toHaveLength(0);
  });

  it("refuses files outside the codex dir", async () => {
    const { parseTranscript } = await import("../src/codex/transcript.js");
    const outside = path.join(fakeHome, "evil.jsonl");
    writeFileSync(outside, JSON.stringify({ type: "session_meta", payload: {} }) + "\n");
    expect(parseTranscript(outside).available).toBe(false);
  });
});
