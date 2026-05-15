// Startup splash. ANSI Shadow figlet rendering of "MIMO2CODEX" — solid
// block characters (filled with █) instead of the thin hollow strokes of
// the standard font, then painted with a left-to-right truecolor gradient.
//
// Width: ~83 columns. Most modern terminals are 100+ cols wide; users on
// strict 80-col terminals may see one wrap, still readable.
// Rows: 6.
const LOGO_LINES: readonly string[] = [
  "███╗   ███╗██╗███╗   ███╗ ██████╗ ██████╗  ██████╗  ██████╗ ██████╗ ███████╗██╗  ██╗",
  "████╗ ████║██║████╗ ████║██╔═══██╗╚════██╗██╔════╝ ██╔═══██╗██╔══██╗██╔════╝╚██╗██╔╝",
  "██╔████╔██║██║██╔████╔██║██║   ██║ █████╔╝██║      ██║   ██║██║  ██║█████╗   ╚███╔╝ ",
  "██║╚██╔╝██║██║██║╚██╔╝██║██║   ██║██╔═══╝ ██║      ██║   ██║██║  ██║██╔══╝   ██╔██╗ ",
  "██║ ╚═╝ ██║██║██║ ╚═╝ ██║╚██████╔╝███████╗╚██████╗ ╚██████╔╝██████╔╝███████╗██╔╝ ██╗",
  "╚═╝     ╚═╝╚═╝╚═╝     ╚═╝ ╚═════╝ ╚══════╝ ╚═════╝  ╚═════╝ ╚═════╝ ╚══════╝╚═╝  ╚═╝",
];

const REPO_URL = "https://github.com/7as0nch/mimo2codex";
const ISSUES_URL = `${REPO_URL}/issues`;
const TAGLINE = "Local proxy · Codex Responses API ↔ Chat Completions (MiMo / DeepSeek / generic)";

const ANSI = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
};

// Three-stop horizontal gradient. "Deep ocean" — bright surface cyan
// fading through a mid-blue into near-black abyssal blue. Conveys depth
// and seriousness; contrasts with the bright-yellow config snippet below.
const GRAD_START = { r: 0x00, g: 0xb4, b: 0xd8 }; // #00B4D8
const GRAD_MID = { r: 0x00, g: 0x77, b: 0xb6 }; //   #0077B6
const GRAD_END = { r: 0x03, g: 0x04, b: 0x5e }; //   #03045E

function lerp(a: number, b: number, t: number): number {
  return Math.round(a + (b - a) * t);
}

function gradientAt(t: number): { r: number; g: number; b: number } {
  const clamped = t < 0 ? 0 : t > 1 ? 1 : t;
  if (clamped <= 0.5) {
    const t2 = clamped * 2;
    return {
      r: lerp(GRAD_START.r, GRAD_MID.r, t2),
      g: lerp(GRAD_START.g, GRAD_MID.g, t2),
      b: lerp(GRAD_START.b, GRAD_MID.b, t2),
    };
  }
  const t2 = (clamped - 0.5) * 2;
  return {
    r: lerp(GRAD_MID.r, GRAD_END.r, t2),
    g: lerp(GRAD_MID.g, GRAD_END.g, t2),
    b: lerp(GRAD_MID.b, GRAD_END.b, t2),
  };
}

function colorEnabled(): boolean {
  // Respect the de-facto NO_COLOR / FORCE_COLOR conventions before falling
  // back to TTY detection. FORCE_COLOR=0 explicitly disables; any other
  // truthy value enables (useful in CI that's pretending to be a TTY).
  if (process.env.NO_COLOR) return false;
  if (process.env.FORCE_COLOR === "0") return false;
  if (process.env.FORCE_COLOR) return true;
  return !!process.stdout.isTTY;
}

// Paint one line of the logo with the column-indexed truecolor gradient.
// Spaces aren't colored (saves escape codes; spaces don't render color
// anyway). Emits one SGR per character but coalesces consecutive identical
// colors — for an 83-col line this means roughly one escape per cell, which
// is fine; xterm-class terminals handle this trivially.
function colorLine(line: string, totalCols: number, color: boolean): string {
  if (!color) return line;
  const chars = [...line];
  let out = "";
  let lastCode = "";
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    if (ch === " ") {
      out += ch;
      continue;
    }
    const t = totalCols > 1 ? i / (totalCols - 1) : 0;
    const { r, g, b } = gradientAt(t);
    const code = `\x1b[38;2;${r};${g};${b}m`;
    if (code !== lastCode) {
      out += code;
      lastCode = code;
    }
    out += ch;
  }
  return out + ANSI.reset;
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

  const totalCols = Math.max(...LOGO_LINES.map((l) => [...l].length));
  for (const line of LOGO_LINES) {
    process.stdout.write(colorLine(line, totalCols, color) + "\n");
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
