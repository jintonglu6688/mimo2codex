// Surgical merge of mimo2codex's provider settings into an existing
// ~/.codex/config.toml — WITHOUT reserializing the whole file.
//
// Why not a real TOML parser? Codex's config schema is wide and full of
// user content we must not touch (`[projects]` trust levels, `[mcp_servers]`,
// `[windows]`, `model_reasoning_effort`, `[notice.model_migrations]`, inline
// comments …). Parse → mutate → re-emit with any TOML library would drop
// comments and reorder/normalize the user's file. So we do line-level edits:
// we only ever touch the four keys we manage plus our own
// `[model_providers.<key>]` table, and leave every other byte in place.

// The subset of config.toml that mimo2codex owns. Everything else in the
// file is the user's and is preserved verbatim.
export interface ProviderTomlPatch {
  // Top-level `model = "..."`.
  model: string;
  // Top-level `model_provider = "..."` (the toml [model_providers.<key>] name).
  modelProvider: string;
  // Optional top-level tuning keys; omitted when the model has no known value.
  modelContextWindow?: number;
  modelMaxOutputTokens?: number;
  // Bare provider key used to locate/replace the [model_providers.<key>] table.
  providerKey: string;
  // Full `[model_providers.<key>]` table text (header + body, no trailing NL).
  providerBlock: string;
}

// Top-level keys mimo2codex sets on every apply. We strip any prior occurrence
// of these from the root section and re-emit them from the patch, so switching
// models never leaves a stale `model_context_window` behind.
const MANAGED_ROOT_KEYS = [
  "model",
  "model_provider",
  "model_context_window",
  "model_max_output_tokens",
];

function trimBlankEdges(lines: string[]): string[] {
  let start = 0;
  let end = lines.length;
  while (start < end && lines[start].trim() === "") start++;
  while (end > start && lines[end - 1].trim() === "") end--;
  return lines.slice(start, end);
}

// Drop the `[model_providers.<key>]` table (and any `[model_providers.<key>.*]`
// subtables) from a list of section lines. The trailing `.` in the subtable
// check is load-bearing: it stops key "mimo" from also matching the unrelated
// table "mimo2codex".
function removeProviderTable(lines: string[], providerKey: string): string[] {
  const exact = `[model_providers.${providerKey}]`;
  const subPrefix = `[model_providers.${providerKey}.`;
  const out: string[] = [];
  let skipping = false;
  for (const line of lines) {
    const isHeader = /^\s*\[/.test(line);
    if (isHeader) {
      const norm = line.trim().replace(/\s+/g, "");
      skipping = norm === exact || norm.startsWith(subPrefix);
    }
    if (!skipping) out.push(line);
  }
  return out;
}

function managedBlock(patch: ProviderTomlPatch): string[] {
  const block = [`model = "${patch.model}"`, `model_provider = "${patch.modelProvider}"`];
  if (patch.modelContextWindow != null) {
    block.push(`model_context_window = ${patch.modelContextWindow}`);
  }
  if (patch.modelMaxOutputTokens != null) {
    block.push(`model_max_output_tokens = ${patch.modelMaxOutputTokens}`);
  }
  return block;
}

// Merge `patch` into `existing` config.toml content. When `existing` is null
// or blank, returns a minimal standalone config (no helpful comment block —
// callers that want the rich first-run snippet pass that path themselves).
export function mergeCodexProviderToml(existing: string | null, patch: ProviderTomlPatch): string {
  const managed = managedBlock(patch);

  if (existing == null || existing.trim() === "") {
    return [...managed, "", patch.providerBlock.trimEnd()].join("\n") + "\n";
  }

  const lines = existing.replace(/\r\n/g, "\n").split("\n");

  // Root section = everything before the first table header. TOML requires
  // bare top-level keys to precede any [table], so this split is sound.
  let firstHeader = lines.findIndex((l) => /^\s*\[/.test(l));
  if (firstHeader === -1) firstHeader = lines.length;
  const rootLines = lines.slice(0, firstHeader);
  const sectionLines = lines.slice(firstHeader);

  const managedRe = new RegExp(`^\\s*(${MANAGED_ROOT_KEYS.join("|")})\\s*=`);
  const keptRoot = trimBlankEdges(rootLines.filter((l) => !managedRe.test(l)));
  const cleanedSections = trimBlankEdges(removeProviderTable(sectionLines, patch.providerKey));

  const out: string[] = [...managed];
  if (keptRoot.length) out.push("", ...keptRoot);
  if (cleanedSections.length) out.push("", ...cleanedSections);
  out.push("", patch.providerBlock.trimEnd());

  // Collapse any runs of 3+ blank lines the assembly may have produced.
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}
