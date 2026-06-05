import { execFile } from "node:child_process";
import { promisify } from "node:util";

const pexecFile = promisify(execFile);

// Restart the Codex Desktop app so it picks up a freshly-applied config.toml /
// auth.json. "Restart" = kill the running desktop app, then relaunch it; if it
// isn't running, it just launches. Only the Codex *Desktop* processes are
// targeted (matched by executable path), never the lowercase `codex` engine
// processes used by the VS Code / CLI integrations.
//
// Local mode only (the sidecar runs on the user's own machine). In a server
// deployment this can't and shouldn't touch the operator's desktop.

export interface CodexRestartResult {
  supported: boolean;
  platform: NodeJS.Platform;
  wasRunning: boolean;
  killed: number;
  relaunched: boolean;
}

// Windows: Codex Desktop ships as an MSIX/Store app
// (C:\Program Files\WindowsApps\OpenAI.Codex_*\app\Codex.exe). Store apps must
// be relaunched via their AppUserModelID (shell:AppsFolder\<AUMID>), not by
// running the exe directly. We discover both the running processes and the
// AUMID at runtime so nothing is hard-coded to a version/publisher hash.
// (`$procId` deliberately, not the reserved automatic `$pid`.)
const WIN_SCRIPT = `
$ErrorActionPreference = 'SilentlyContinue'
$desktop = Get-Process -Name Codex | Where-Object { $_.Path -like '*\\WindowsApps\\*OpenAI.Codex*\\app\\Codex.exe' }
$killed = 0
if ($desktop) {
  foreach ($procId in ($desktop | Select-Object -ExpandProperty Id -Unique)) {
    Stop-Process -Id $procId -Force
    $killed++
  }
  Start-Sleep -Milliseconds 1200
}
$aumid = (Get-StartApps | Where-Object { $_.AppID -like 'OpenAI.Codex*' } | Select-Object -First 1).AppID
$relaunched = $false
if ($aumid) {
  Start-Process ('shell:AppsFolder\\' + $aumid)
  $relaunched = $true
}
$out = @{ wasRunning = [bool]$desktop; killed = $killed; relaunched = $relaunched } | ConvertTo-Json -Compress
[Console]::Out.Write($out)
`;

async function runWinPwsh(script: string, timeoutMs = 20_000): Promise<string> {
  const encoded = Buffer.from(script, "utf16le").toString("base64");
  const { stdout } = await pexecFile(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded],
    { windowsHide: true, timeout: timeoutMs }
  );
  return stdout;
}

// Detect whether the Codex Desktop app is currently running (the desktop
// Codex.exe processes only, by executable path — not the lowercase `codex`
// engine used by the CLI / VS Code integration).
export async function isCodexRunning(): Promise<{ supported: boolean; running: boolean }> {
  const platform = process.platform;
  if (platform === "win32") {
    const script = `
$ErrorActionPreference = 'SilentlyContinue'
$p = Get-Process -Name Codex | Where-Object { $_.Path -like '*\\WindowsApps\\*OpenAI.Codex*\\app\\Codex.exe' }
[Console]::Out.Write((@{ running = [bool]$p } | ConvertTo-Json -Compress))
`;
    try {
      const out = await runWinPwsh(script, 10_000);
      const parsed = JSON.parse(out.trim() || "{}") as { running?: boolean };
      return { supported: true, running: !!parsed.running };
    } catch {
      return { supported: true, running: false };
    }
  }
  if (platform === "darwin") {
    try {
      await pexecFile("pgrep", ["-x", "Codex"]);
      return { supported: true, running: true };
    } catch {
      return { supported: true, running: false };
    }
  }
  return { supported: false, running: false };
}

// Launch Codex Desktop (without killing anything). Used by the desktop app's
// "Codex isn't running — open it?" prompt.
export async function launchCodex(): Promise<{ supported: boolean; launched: boolean }> {
  const platform = process.platform;
  if (platform === "win32") {
    const script = `
$ErrorActionPreference = 'SilentlyContinue'
$aumid = (Get-StartApps | Where-Object { $_.AppID -like 'OpenAI.Codex*' } | Select-Object -First 1).AppID
$launched = $false
if ($aumid) { Start-Process ('shell:AppsFolder\\' + $aumid); $launched = $true }
[Console]::Out.Write((@{ launched = $launched } | ConvertTo-Json -Compress))
`;
    try {
      const out = await runWinPwsh(script, 15_000);
      const parsed = JSON.parse(out.trim() || "{}") as { launched?: boolean };
      return { supported: true, launched: !!parsed.launched };
    } catch {
      return { supported: true, launched: false };
    }
  }
  if (platform === "darwin") {
    try {
      await pexecFile("open", ["-a", "Codex"]);
      return { supported: true, launched: true };
    } catch {
      return { supported: true, launched: false };
    }
  }
  return { supported: false, launched: false };
}

export async function restartCodex(): Promise<CodexRestartResult> {
  const platform = process.platform;

  if (platform === "win32") {
    // -EncodedCommand (UTF-16LE base64) sidesteps all shell-quoting hazards.
    const encoded = Buffer.from(WIN_SCRIPT, "utf16le").toString("base64");
    const { stdout } = await pexecFile(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded],
      { windowsHide: true, timeout: 25_000 }
    );
    let parsed: { wasRunning?: boolean; killed?: number; relaunched?: boolean } = {};
    try {
      parsed = JSON.parse(stdout.trim() || "{}");
    } catch {
      /* leave defaults */
    }
    return {
      supported: true,
      platform,
      wasRunning: !!parsed.wasRunning,
      killed: Number(parsed.killed ?? 0),
      relaunched: !!parsed.relaunched,
    };
  }

  if (platform === "darwin") {
    let wasRunning = false;
    try {
      await pexecFile("pkill", ["-x", "Codex"]);
      wasRunning = true;
      await new Promise((r) => setTimeout(r, 1000));
    } catch {
      /* not running */
    }
    let relaunched = false;
    try {
      await pexecFile("open", ["-a", "Codex"]);
      relaunched = true;
    } catch {
      /* app not found by that name */
    }
    return { supported: true, platform, wasRunning, killed: wasRunning ? 1 : 0, relaunched };
  }

  return { supported: false, platform, wasRunning: false, killed: 0, relaunched: false };
}
