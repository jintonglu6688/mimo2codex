// Strip the Windows extended-length path prefix (\\?\ and \\?\UNC\) that Codex
// stores in session `cwd`, so paths display as the familiar D:\... form.
export function cleanWinPath(p: string): string {
  if (!p) return p;
  return p.replace(/^\\\\\?\\(UNC\\)?/, "");
}

// Truncate keeping the start and end, eliding the middle — better than a tail
// ellipsis for paths and long pasted titles where both ends carry meaning.
export function middleEllipsis(s: string, max = 48): string {
  if (!s) return s;
  // Collapse newlines so a multi-line pasted prompt stays on one line.
  const flat = s.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  const keep = max - 1;
  const head = Math.ceil(keep * 0.6);
  const tail = keep - head;
  return flat.slice(0, head) + "…" + flat.slice(flat.length - tail);
}

// Codex's session timestamps are seconds since epoch; our synthetic test data
// uses milliseconds. Anything below ~1e12 is treated as seconds and scaled up.
export function normalizeCodexTs(ts: number): number {
  return ts > 0 && ts < 1e12 ? ts * 1000 : ts;
}
