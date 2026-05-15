// Banner + snippet formatters for the startup splash. Two concerns:
//
//   1. `printBoxedBanner` wraps the runtime status lines (version, provider,
//      upstream, …) in a rounded box. Width is computed from the longest
//      content line so the right border always aligns.
//
//   2. `colorizeSnippet` paints the `~/.codex/{auth.json,config.toml}` text
//      block in a high-attention yellow (TOML / JSON body) with dim comments,
//      so the user's eye lands on the part they're supposed to copy.
//
// Both helpers degrade to plain text when stdout isn't a TTY (and FORCE_COLOR
// isn't set), so scripted captures stay clean.

const ANSI = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
};

const BORDER_COLOR = "\x1b[38;2;120;144;156m"; // muted slate, doesn't compete
const CODE_COLOR = "\x1b[38;2;255;214;10m"; //   #FFD60A — striking yellow

function colorEnabled(): boolean {
  if (process.env.NO_COLOR) return false;
  if (process.env.FORCE_COLOR === "0") return false;
  if (process.env.FORCE_COLOR) return true;
  return !!process.stdout.isTTY;
}

// Display-width of a string. Banner content is ASCII + box-drawing chars + a
// few CJK glyphs in localized warning messages — all 1-cell or 2-cell. For
// simplicity we treat everything as 1-cell here; CJK in the host-mismatch
// warning may push the right edge out slightly but stays readable.
function visibleWidth(s: string): number {
  // strip ANSI escapes first in case callers pre-color a line
  const stripped = s.replace(/\x1b\[[0-9;]*m/g, "");
  return [...stripped].length;
}

export function printBoxedBanner(lines: string[]): void {
  const color = colorEnabled();
  const innerWidth = Math.max(...lines.map(visibleWidth));
  const horiz = "─".repeat(innerWidth + 2);
  const wrap = (border: string): string =>
    color ? `${BORDER_COLOR}${border}${ANSI.reset}` : border;
  process.stdout.write(wrap(`╭${horiz}╮`) + "\n");
  for (const line of lines) {
    const pad = " ".repeat(innerWidth - visibleWidth(line));
    process.stdout.write(`${wrap("│")} ${line}${pad} ${wrap("│")}\n`);
  }
  process.stdout.write(wrap(`╰${horiz}╯`) + "\n");
}

export function colorizeSnippet(text: string): string {
  if (!colorEnabled()) return text;
  return text
    .split("\n")
    .map((line) => {
      if (line.length === 0) return line;
      const trimmed = line.trimStart();
      // TOML uses `#` comments, JSON has none — but the printed snippets use
      // `#` lines as section headers ("# Step 1 — write …"). Dim those so
      // the eye locks onto the code rows.
      if (trimmed.startsWith("#")) {
        return `${ANSI.dim}${line}${ANSI.reset}`;
      }
      return `${CODE_COLOR}${line}${ANSI.reset}`;
    })
    .join("\n");
}
