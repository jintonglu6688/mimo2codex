export interface Config {
  host: string;
  port: number;
  baseUrl: string;
  apiKey: string;
  exposeReasoning: boolean;
  verbose: boolean;
  userAgent: string;
}

const DEFAULTS = {
  host: "127.0.0.1",
  port: 8788,
  baseUrl: "https://api.xiaomimimo.com/v1",
};

export interface ParsedArgs {
  host?: string;
  port?: number;
  baseUrl?: string;
  apiKey?: string;
  exposeReasoning?: boolean;
  verbose?: boolean;
  envKey?: boolean;
  positional: string[];
  showHelp: boolean;
  showVersion: boolean;
}

export function parseArgv(argv: string[]): ParsedArgs {
  const out: ParsedArgs = { positional: [], showHelp: false, showVersion: false };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = (): string => {
      const v = argv[i + 1];
      if (v === undefined) throw new Error(`flag ${a} requires a value`);
      i++;
      return v;
    };
    switch (a) {
      case "--port":
      case "-p":
        out.port = Number(next());
        if (Number.isNaN(out.port)) throw new Error("--port must be a number");
        break;
      case "--host":
        out.host = next();
        break;
      case "--base-url":
      case "--baseurl":
        out.baseUrl = next();
        break;
      case "--api-key":
        out.apiKey = next();
        break;
      case "--no-reasoning":
        out.exposeReasoning = false;
        break;
      case "--reasoning":
        out.exposeReasoning = true;
        break;
      case "--verbose":
      case "-v":
        out.verbose = true;
        break;
      case "--env-key":
        out.envKey = true;
        break;
      case "--help":
      case "-h":
        out.showHelp = true;
        break;
      case "--version":
      case "-V":
        out.showVersion = true;
        break;
      default:
        if (a.startsWith("--")) {
          throw new Error(`unknown flag: ${a}`);
        }
        out.positional.push(a);
    }
  }
  return out;
}

export function buildConfig(parsed: ParsedArgs, env: NodeJS.ProcessEnv, version: string): Config {
  const exposeReasoningEnv = env.MIMO2CODEX_NO_REASONING ? false : true;
  const verboseEnv = !!env.MIMO2CODEX_VERBOSE;

  const apiKey = parsed.apiKey ?? env.MIMO_API_KEY ?? "";
  if (!apiKey) {
    throw new Error(
      "missing MiMo API key — set MIMO_API_KEY env var or pass --api-key. " +
        "Get one at https://platform.xiaomimimo.com/#/console/api-keys"
    );
  }

  const portFromEnv = env.MIMO2CODEX_PORT ? Number(env.MIMO2CODEX_PORT) : undefined;
  if (portFromEnv !== undefined && Number.isNaN(portFromEnv)) {
    throw new Error("MIMO2CODEX_PORT must be a number");
  }

  return {
    host: parsed.host ?? env.MIMO2CODEX_HOST ?? DEFAULTS.host,
    port: parsed.port ?? portFromEnv ?? DEFAULTS.port,
    baseUrl: parsed.baseUrl ?? env.MIMO_BASE_URL ?? DEFAULTS.baseUrl,
    apiKey,
    exposeReasoning: parsed.exposeReasoning ?? exposeReasoningEnv,
    verbose: parsed.verbose ?? verboseEnv,
    userAgent: `mimo2codex/${version}`,
  };
}
