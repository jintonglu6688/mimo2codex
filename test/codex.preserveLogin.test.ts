import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import os from "node:os";
import path from "node:path";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";

// Mirrors test/codex.state.test.ts: sandbox os.homedir() to a temp dir and
// clear CODEX_HOME so codexDir() resolves under the sandbox.
let fakeHome: string;
let homedirSpy: ReturnType<typeof vi.spyOn>;
let originalCodexHome: string | undefined;

beforeEach(() => {
  fakeHome = mkdtempSync(path.join(tmpdir(), "m2c-codex-preserve-"));
  homedirSpy = vi.spyOn(os, "homedir").mockReturnValue(fakeHome);
  originalCodexHome = process.env.CODEX_HOME;
  delete process.env.CODEX_HOME;
});

afterEach(() => {
  homedirSpy.mockRestore();
  if (originalCodexHome !== undefined) process.env.CODEX_HOME = originalCodexHome;
  rmSync(fakeHome, { recursive: true, force: true });
});

async function loadModules() {
  const preserve = await import("../src/codex/preserveLogin.js");
  const state = await import("../src/codex/state.js");
  const snippets = await import("../src/setup/snippets.js");
  const paths = await import("../src/codex/paths.js");
  return { preserve, state, snippets, paths };
}

const host = { host: "127.0.0.1", port: 8788 };

// An OAuth-style auth.json — what `codex login` (Sign in with ChatGPT) writes.
// Has no top-level OPENAI_API_KEY sentinel, so detectAuthJsonOwner() => "external".
const OAUTH_AUTH = JSON.stringify(
  {
    OPENAI_API_KEY: null,
    tokens: {
      id_token: "id.jwt.token",
      access_token: "access-token-abc",
      refresh_token: "refresh-token-xyz",
      account_id: "acct_123",
    },
    last_refresh: "2026-06-12T00:00:00Z",
  },
  null,
  2
);

describe("codex/preserveLogin — applyCodexPreserveLogin", () => {
  it("leaves a real ChatGPT login auth.json byte-for-byte untouched", async () => {
    const { preserve, snippets, paths } = await loadModules();
    mkdirSync(paths.codexDir(), { recursive: true });
    writeFileSync(path.join(paths.codexDir(), "auth.json"), OAUTH_AUTH);
    writeFileSync(path.join(paths.codexDir(), "config.toml"), 'model = "gpt-5"\n');

    const result = preserve.applyCodexPreserveLogin(
      snippets.resolveSnippetTarget("mimo"),
      host
    );

    // The crux of the whole feature: the OAuth login is NOT clobbered.
    expect(readFileSync(path.join(paths.codexDir(), "auth.json"), "utf-8")).toBe(
      OAUTH_AUTH
    );
    expect(result.authPreserved).toBe(true);
    expect(result.authJsonOwnerBefore).toBe("external");
  });

  it("still points config.toml at the mimo2codex proxy with requires_openai_auth", async () => {
    const { preserve, snippets, paths } = await loadModules();
    mkdirSync(paths.codexDir(), { recursive: true });
    writeFileSync(path.join(paths.codexDir(), "auth.json"), OAUTH_AUTH);

    preserve.applyCodexPreserveLogin(snippets.resolveSnippetTarget("mimo"), host);

    const toml = readFileSync(path.join(paths.codexDir(), "config.toml"), "utf-8");
    expect(toml).toContain('model = "mimo-v2.5-pro"');
    expect(toml).toContain('model_provider = "mimo"');
    expect(toml).toContain('base_url = "http://127.0.0.1:8788/v1"');
    expect(toml).toContain("requires_openai_auth = true");
  });

  it("backs up both files preserve-tagged so restore round-trips the real login", async () => {
    const { preserve, state, snippets, paths } = await loadModules();
    mkdirSync(paths.codexDir(), { recursive: true });
    writeFileSync(path.join(paths.codexDir(), "auth.json"), OAUTH_AUTH);
    writeFileSync(path.join(paths.codexDir(), "config.toml"), 'model = "gpt-5"\n');

    const result = preserve.applyCodexPreserveLogin(
      snippets.resolveSnippetTarget("mimo"),
      host
    );
    expect(result.preserved).toBe(true);
    expect(result.authBackup).toMatch(/\.preserve$/);
    expect(result.tomlBackup).toMatch(/\.preserve$/);
    // Paired backup: same ts so state.restoreCodex can pair them.
    const authTs = /\.bak\.(\d+)\./.exec(result.authBackup!)![1];
    const tomlTs = /\.bak\.(\d+)\./.exec(result.tomlBackup!)![1];
    expect(authTs).toBe(tomlTs);

    // Restore must keep the real login intact (it was never overwritten) and
    // bring the user's original config.toml back.
    state.restoreCodex(result.backupTs);
    expect(readFileSync(path.join(paths.codexDir(), "auth.json"), "utf-8")).toBe(
      OAUTH_AUTH
    );
    expect(readFileSync(path.join(paths.codexDir(), "config.toml"), "utf-8")).toBe(
      'model = "gpt-5"\n'
    );
  });

  it("writes a sentinel auth.json only when none exists (so requires_openai_auth has something to read)", async () => {
    const { preserve, snippets, paths } = await loadModules();
    // Fresh machine: no ~/.codex at all.
    const result = preserve.applyCodexPreserveLogin(
      snippets.resolveSnippetTarget("mimo"),
      host
    );
    const auth = JSON.parse(
      readFileSync(path.join(paths.codexDir(), "auth.json"), "utf-8")
    );
    expect(auth.OPENAI_API_KEY).toBe("mimo2codex-local");
    expect(result.authPreserved).toBe(false);
    expect(result.authJsonOwnerBefore).toBe("missing");
    expect(result.authBackup).toBeNull();
  });

  it("only preserve-tags the FIRST capture; later preserve applies stay prunable (no unbounded growth)", async () => {
    const { preserve, state, snippets, paths } = await loadModules();
    mkdirSync(paths.codexDir(), { recursive: true });
    // A real login that preserve mode never overwrites → detectAuthJsonOwner()
    // stays "external" across every apply.
    writeFileSync(path.join(paths.codexDir(), "auth.json"), OAUTH_AUTH);

    for (let i = 0; i < 13; i++) {
      preserve.applyCodexPreserveLogin(snippets.resolveSnippetTarget("mimo"), host);
      await new Promise((r) => setTimeout(r, 2));
    }

    const pairs = state.listBackupPairs();
    // Exactly ONE un-prunable (🔒) pair — the original capture — matching the
    // legacy applyCodex semantics. The rest must age out under BACKUP_KEEP=10.
    expect(pairs.filter((p) => p.preserved).length).toBe(1);
    expect(pairs.filter((p) => !p.preserved).length).toBeLessThanOrEqual(10);
    // The real login is still intact after all those applies.
    expect(readFileSync(path.join(paths.codexDir(), "auth.json"), "utf-8")).toBe(
      OAUTH_AUTH
    );
  });

  it("leaves an existing mimo2codex sentinel auth.json untouched (no real login to preserve)", async () => {
    const { preserve, snippets, paths } = await loadModules();
    mkdirSync(paths.codexDir(), { recursive: true });
    const sentinel = JSON.stringify({ OPENAI_API_KEY: "mimo2codex-local" }, null, 2);
    writeFileSync(path.join(paths.codexDir(), "auth.json"), sentinel);

    const result = preserve.applyCodexPreserveLogin(
      snippets.resolveSnippetTarget("ds"),
      host
    );
    expect(readFileSync(path.join(paths.codexDir(), "auth.json"), "utf-8")).toBe(
      sentinel
    );
    expect(result.authPreserved).toBe(false);
    expect(result.authJsonOwnerBefore).toBe("mimo2codex");
  });
});
