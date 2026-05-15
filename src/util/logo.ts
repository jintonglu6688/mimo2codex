// Startup splash. Designed for an 80-column terminal: 5 rows, ~63 cols wide.
// Renders in cyan when stdout is a TTY (and NO_COLOR isn't set); falls back
// to plain text in pipes / CI / journald so log scrapers see clean output.

// Each line carries a trailing space so neighbouring glyphs don't visually
// touch the right margin on cramped terminals. The escaped backslashes
// reconstruct the standard figlet rendering of the literal string "mimo2codex".
const LOGO_LINES: readonly string[] = [
  "           _                 ____               _           ",
  " _ __ ___ (_)_ __ ___   ___ |___ \\  ___ ___   __| | _____  __",
  "| '_ ` _ \\| | '_ ` _ \\ / _ \\  __) |/ __/ _ \\ / _` |/ _ \\ \\/ /",
  "| | | | | | | | | | | | (_) |/ __/| (_| (_) | (_| |  __/>  < ",
  "|_| |_| |_|_|_| |_| |_|\\___/|_____|\\___\\___/ \\__,_|\\___/_/\\_\\",
];

const REPO_URL = "https://github.com/7as0nch/mimo2codex";
const ISSUES_URL = `${REPO_URL}/issues`;
const TAGLINE = "Local proxy · Codex Responses API ↔ Chat Completions (MiMo / DeepSeek / generic)";

const ANSI = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  cyan: "\x1b[36m",
};

function colorEnabled(): boolean {
  // Respect the de-facto NO_COLOR / FORCE_COLOR conventions before falling
  // back to TTY detection. FORCE_COLOR=0 explicitly disables; any other
  // truthy value enables (useful in CI that's pretending to be a TTY).
  if (process.env.NO_COLOR) return false;
  if (process.env.FORCE_COLOR === "0") return false;
  if (process.env.FORCE_COLOR) return true;
  return !!process.stdout.isTTY;
}

export function printLogo(version: string): void {
  // Logo is purely cosmetic — skip when stdout isn't a TTY (scripted
  // captures stay clean), unless the user explicitly forced color output
  // (FORCE_COLOR is the conventional "I want decoration even in pipes"
  // escape hatch).
  if (!process.stdout.isTTY && !process.env.FORCE_COLOR) return;
  const color = colorEnabled();
  const wrap = (code: string, text: string): string =>
    color ? `${code}${text}${ANSI.reset}` : text;

  for (const line of LOGO_LINES) {
    process.stdout.write(wrap(ANSI.cyan, line) + "\n");
  }
  process.stdout.write("\n");
  // Tagline + GitHub: dim styling so it visually sits "under" the logo
  // without competing with the operational banner that follows.
  process.stdout.write(
    "  " + wrap(ANSI.bold, `v${version}`) + wrap(ANSI.dim, `  ·  ${TAGLINE}`) + "\n"
  );
  process.stdout.write(
    "  " + wrap(ANSI.dim, "GitHub: ") + REPO_URL + wrap(ANSI.dim, "   ·   Issues: ") + ISSUES_URL + "\n"
  );
  process.stdout.write("\n");
}
