import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { assertInsideCodexDir, codexDir } from "./paths.js";

// Parse a Codex rollout JSONL into a readable transcript so the admin UI can
// preview "what was said" in a past session. Rollout lines we care about are
// `response_item` payloads: message (user/assistant), reasoning, function_call
// / function_call_output (e.g. shell), and custom_tool_call / *_output (e.g.
// apply_patch). developer/system messages are pure injected instructions and
// are dropped; injected user-context blocks are flagged so the UI can collapse
// them.

export type TranscriptItem =
  | { kind: "message"; role: "user" | "assistant"; text: string; context: boolean }
  | { kind: "reasoning"; text: string }
  | {
      kind: "tool";
      name: string;
      command: string | null; // shell command, when the tool is a shell call
      input: string | null; // raw args / patch text for non-shell tools
      output: string;
      status: string | null;
    };

export interface Transcript {
  available: boolean;
  rolloutPath: string | null;
  cwd: string | null;
  model: string | null;
  items: TranscriptItem[];
}

const CONTEXT_MARKERS = [
  "# AGENTS.md",
  "<environment_context>",
  "<INSTRUCTIONS>",
  "<user_instructions>",
  "<permissions",
  "<network_access>",
];

function textFromContent(content: unknown): string {
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  return content
    .map((c) => (c && typeof (c as { text?: unknown }).text === "string" ? (c as { text: string }).text : ""))
    .join("")
    .trim();
}

function isContextMsg(text: string): boolean {
  const head = text.trimStart();
  return CONTEXT_MARKERS.some((m) => head.startsWith(m) || head.slice(0, 80).includes(m));
}

function stringifyOutput(output: unknown): string {
  if (typeof output === "string") return output;
  if (output && typeof output === "object") {
    const o = output as { output?: unknown; content?: unknown };
    if (typeof o.output === "string") return o.output;
    if (typeof o.content === "string") return o.content;
    try {
      return JSON.stringify(output);
    } catch {
      return String(output);
    }
  }
  return output == null ? "" : String(output);
}

// Locate a session's rollout file: prefer the stored path; otherwise walk
// ~/.codex/sessions for a file whose name contains the session id.
export function resolveRolloutPath(id: string, storedPath: string | null): string | null {
  if (storedPath && existsSync(storedPath)) return storedPath;
  const root = path.join(codexDir(), "sessions");
  if (!existsSync(root)) return null;
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop()!;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of entries) {
      const full = path.join(dir, name);
      let st;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) stack.push(full);
      else if (name.includes(id) && name.endsWith(".jsonl")) return full;
    }
  }
  return null;
}

export function parseTranscript(rolloutPath: string | null): Transcript {
  if (!rolloutPath || !existsSync(rolloutPath)) {
    return { available: false, rolloutPath, cwd: null, model: null, items: [] };
  }
  try {
    assertInsideCodexDir(rolloutPath);
  } catch {
    return { available: false, rolloutPath, cwd: null, model: null, items: [] };
  }

  const lines = readFileSync(rolloutPath, "utf-8").split("\n").filter(Boolean);
  const items: TranscriptItem[] = [];
  const toolByCall = new Map<string, Extract<TranscriptItem, { kind: "tool" }>>();
  let cwd: string | null = null;
  let model: string | null = null;

  for (const line of lines) {
    let o: { type?: string; payload?: Record<string, unknown> };
    try {
      o = JSON.parse(line);
    } catch {
      continue;
    }
    const p = o.payload ?? {};
    if (o.type === "session_meta") {
      cwd = (p.cwd as string) ?? cwd;
      continue;
    }
    if (o.type === "turn_context") {
      model = (p.model as string) ?? model;
      continue;
    }
    if (o.type !== "response_item") continue;

    const ptype = p.type as string;
    if (ptype === "message") {
      const role = p.role as string;
      if (role !== "user" && role !== "assistant") continue; // drop developer/system
      const text = textFromContent(p.content);
      if (!text) continue;
      items.push({ kind: "message", role, text, context: role === "user" && isContextMsg(text) });
    } else if (ptype === "reasoning") {
      const summary = Array.isArray(p.summary)
        ? (p.summary as Array<{ text?: string }>).map((s) => s?.text ?? "").join("").trim()
        : "";
      if (summary) items.push({ kind: "reasoning", text: summary });
    } else if (ptype === "function_call") {
      let command: string | null = null;
      try {
        const args = JSON.parse((p.arguments as string) || "{}") as { command?: unknown };
        if (typeof args.command === "string") command = args.command;
        else if (Array.isArray(args.command)) command = args.command.join(" ");
      } catch {
        /* leave command null; show raw args instead */
      }
      const item: Extract<TranscriptItem, { kind: "tool" }> = {
        kind: "tool",
        name: (p.name as string) || "tool",
        command,
        input: command ? null : ((p.arguments as string) ?? null),
        output: "",
        status: null,
      };
      if (typeof p.call_id === "string") toolByCall.set(p.call_id, item);
      items.push(item);
    } else if (ptype === "custom_tool_call") {
      const item: Extract<TranscriptItem, { kind: "tool" }> = {
        kind: "tool",
        name: (p.name as string) || "tool",
        command: null,
        input: (p.input as string) ?? null,
        output: "",
        status: (p.status as string) ?? null,
      };
      if (typeof p.call_id === "string") toolByCall.set(p.call_id, item);
      items.push(item);
    } else if (ptype === "function_call_output" || ptype === "custom_tool_call_output") {
      const item = typeof p.call_id === "string" ? toolByCall.get(p.call_id) : undefined;
      if (item) item.output = stringifyOutput(p.output);
    }
  }

  return { available: true, rolloutPath, cwd, model, items };
}
