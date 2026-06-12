// "Preserve login" apply mode — the cc-switch v3.16 OAuth-retention trick.
//
// The default applyCodex() (see state.ts) OVERWRITES ~/.codex/auth.json with a
// sentinel ({"OPENAI_API_KEY":"mimo2codex-local"}) every time. That logs you out
// of any real "Sign in with ChatGPT" session, which is exactly what a user who
// wants OpenAI's official Codex *mobile/remote* feature must keep alive.
//
// This module is the surgical alternative: it NEVER clobbers an existing
// auth.json. It only writes a sentinel when no auth.json exists at all (so
// Codex's `requires_openai_auth = true` still has something to read). The
// config.toml is written through the exact same patch path applyCodex uses, so
// the model backend still routes to the local mimo2codex proxy. Codex then
// attaches whatever auth.json holds (your real ChatGPT OAuth token) as the
// bearer to the proxy, which ignores inbound credentials and forwards upstream.
//
// Kept in its own file so the existing applyCodex path is untouched — the route
// picks between the two and nothing about the legacy behavior changes.

import { atomicWrite, backupFile, detectAuthJsonOwner, listBackups, pruneBackups, readConfigTomlIfExists, type AuthJsonOwner } from "./files.js";
import { authJsonPath, configTomlPath } from "./paths.js";
import {
  buildCcSwitchFiles,
  buildProviderTomlPatch,
  type HostPort,
  type SnippetTarget,
} from "../setup/snippets.js";
import { mergeCodexProviderToml } from "./tomlMerge.js";

const BACKUP_KEEP = 10;

export interface PreserveApplyResult {
  backupTs: number;
  authBackup: string | null;
  tomlBackup: string | null;
  authJsonOwnerBefore: AuthJsonOwner;
  // True when the backup pair was tagged `.preserve` (exempt from pruning) —
  // same invariant applyCodex uses: fires whenever the prior auth.json was a
  // real foreign login.
  preserved: boolean;
  // True when we left a real (external) ChatGPT login in place rather than
  // writing/replacing auth.json. The UI surfaces this as "登录已保留".
  authPreserved: boolean;
}

// Apply the (provider, model) config WITHOUT disturbing an existing auth.json.
// Symmetric backup contract with applyCodex so state.restoreCodex pairs and
// round-trips correctly:
//   - both live files are backed up under the same ts (preserve-tagged when the
//     prior auth.json was external), even though we only overwrite config.toml
//   - auth.json is left exactly as found, except when it's missing, where we
//     drop the sentinel so requires_openai_auth has a file to read
export function applyCodexPreserveLogin(
  target: SnippetTarget,
  hostPort: HostPort
): PreserveApplyResult {
  const ts = Date.now();
  const ownerBefore = detectAuthJsonOwner();
  // Preserve mode never overwrites the live external auth.json, so its owner
  // stays "external" across every apply. Unlike applyCodex (which flips the
  // owner to the sentinel after the first write), we must NOT re-tag a new
  // un-prunable `.preserve` backup on each call — that would accumulate forever
  // since pruneBackups exempts preserved entries. Tag only the FIRST capture of
  // the original config, matching applyCodex's "exactly one rollback" semantics.
  const alreadyPreserved = listBackups(authJsonPath()).some((e) => e.preserved);
  const preserve = ownerBefore === "external" && !alreadyPreserved;
  // Back up BOTH files (even the untouched auth.json) so the pair is complete:
  // a config-only "half pair" would make restoreCodex delete the live auth.json
  // (its return-to-prior semantics), wiping the very login we set out to keep.
  const authBackup = backupFile(authJsonPath(), ts, { preserve });
  const tomlBackup = backupFile(configTomlPath(), ts, { preserve });

  // Only ever create auth.json when there is none. An existing file — real
  // ChatGPT OAuth or our own sentinel — is left byte-for-byte intact.
  if (ownerBefore === "missing") {
    const { authJson } = buildCcSwitchFiles(hostPort, target);
    atomicWrite(authJsonPath(), authJson);
  }

  // config.toml: same surgical merge applyCodex uses, so the user's other
  // sections survive and the provider block is identical to the normal path.
  const existingToml = readConfigTomlIfExists();
  const tomlOut =
    existingToml == null
      ? buildCcSwitchFiles(hostPort, target).configToml
      : mergeCodexProviderToml(existingToml, buildProviderTomlPatch(hostPort, target));
  atomicWrite(configTomlPath(), tomlOut);

  pruneBackups(authJsonPath(), BACKUP_KEEP);
  pruneBackups(configTomlPath(), BACKUP_KEEP);

  return {
    backupTs: ts,
    authBackup,
    tomlBackup,
    authJsonOwnerBefore: ownerBefore,
    preserved: preserve,
    authPreserved: ownerBefore === "external",
  };
}
