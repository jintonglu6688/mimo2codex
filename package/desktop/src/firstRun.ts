import { readEnv, hasUsableKey } from "./envFile.js";
import { PROVIDER_KEYS } from "../shared/types.js";

export function needsFirstRunSetup(userDataDir: string): boolean {
  const env = readEnv(userDataDir);
  return !PROVIDER_KEYS.some(({ envKey }) => hasUsableKey(env, envKey));
}
