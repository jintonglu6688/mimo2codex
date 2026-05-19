// Per-request BYOK resolution. Wraps the existing provider runtime (which
// carries the shared/global upstream API key from env/.env) and, when the
// caller is a logged-in user with a BYOK entry for that provider, swaps in
// their personally-stored upstream key. Other fields of the runtime
// (baseUrl, flags) stay shared — only the secret changes.
//
// In local mode (user=null) this is a no-op and returns the runtime
// untouched, so single-machine deployments keep their zero-overhead path.

import type { Config } from "../config.js";
import type { ProviderRuntime } from "../providers/types.js";
import type { UserRow } from "../db/users.js";
import { getUpstreamKey } from "../db/upstreamKeys.js";
import { loadMasterKey } from "../security/masterKey.js";

export type ApiKeySource = "shared" | "byok";

export interface ResolvedRuntime {
  runtime: ProviderRuntime;
  source: ApiKeySource;
}

export function resolveRuntimeForUser(
  baseRuntime: ProviderRuntime,
  providerId: string,
  user: UserRow | null,
  cfg: Config
): ResolvedRuntime {
  if (!user) return { runtime: baseRuntime, source: "shared" };
  // Master key is cached after the first load — see security/masterKey.ts —
  // so per-request cost is a single getter chain plus the AES-GCM decrypt
  // when BYOK is actually present.
  try {
    const { key } = loadMasterKey(cfg.dataDir);
    const byok = getUpstreamKey(user.id, providerId, key);
    if (byok) {
      return {
        runtime: { ...baseRuntime, apiKey: byok },
        source: "byok",
      };
    }
  } catch {
    // BYOK resolution must never break the request — fall back to shared.
  }
  return { runtime: baseRuntime, source: "shared" };
}
