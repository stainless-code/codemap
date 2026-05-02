import { runHttpServer } from "../application/http-server";
import { CODEMAP_VERSION } from "../version";

/**
 * Default loopback bind. Per [docs/plans/codemap-serve.md § D3](../../docs/plans/codemap-serve.md):
 * 127.0.0.1 default; user must explicitly pass `--host 0.0.0.0` to expose.
 */
export const DEFAULT_HOST = "127.0.0.1";
export const DEFAULT_PORT = 7878;

export interface ServeRunOpts {
  host: string;
  port: number;
  /** Bearer token; if undefined the server skips auth. */
  token: string | undefined;
}

/**
 * Parse `argv` after the global bootstrap: `rest[0]` must be `"serve"`.
 * Flags: `--port <n>`, `--host <ip>`, `--token <secret>`. `--root` /
 * `--config` are absorbed by bootstrap.
 */
export function parseServeRest(rest: string[]):
  | { kind: "help" }
  | { kind: "error"; message: string }
  | {
      kind: "run";
      host: string;
      port: number;
      token: string | undefined;
    } {
  if (rest[0] !== "serve") {
    throw new Error("parseServeRest: expected serve");
  }

  let host: string = DEFAULT_HOST;
  let port: number = DEFAULT_PORT;
  let token: string | undefined;

  for (let i = 1; i < rest.length; i++) {
    const a = rest[i]!;
    if (a === "--help" || a === "-h") return { kind: "help" };

    if (a === "--port" || a.startsWith("--port=")) {
      const eq = a.indexOf("=");
      const v = eq !== -1 ? a.slice(eq + 1) : rest[i + 1];
      if (v === undefined || v === "" || v.startsWith("-")) {
        return {
          kind: "error",
          message: 'codemap serve: "--port" requires a number (1-65535).',
        };
      }
      const n = Number(v);
      if (!Number.isInteger(n) || n < 1 || n > 65535) {
        return {
          kind: "error",
          message: `codemap serve: "--port ${v}" is not a valid port (1-65535).`,
        };
      }
      port = n;
      if (eq === -1) i++;
      continue;
    }

    if (a === "--host" || a.startsWith("--host=")) {
      const eq = a.indexOf("=");
      const v = eq !== -1 ? a.slice(eq + 1) : rest[i + 1];
      if (v === undefined || v === "" || v.startsWith("-")) {
        return {
          kind: "error",
          message:
            'codemap serve: "--host" requires an IP or hostname (default 127.0.0.1).',
        };
      }
      host = v;
      if (eq === -1) i++;
      continue;
    }

    if (a === "--token" || a.startsWith("--token=")) {
      const eq = a.indexOf("=");
      const v = eq !== -1 ? a.slice(eq + 1) : rest[i + 1];
      if (v === undefined || v === "" || v.startsWith("-")) {
        return {
          kind: "error",
          message:
            'codemap serve: "--token" requires a non-empty secret (use a long random string).',
        };
      }
      token = v;
      if (eq === -1) i++;
      continue;
    }

    return {
      kind: "error",
      message: `codemap serve: unknown option "${a}". Run \`codemap serve --help\` for usage.`,
    };
  }

  return { kind: "run", host, port, token };
}

export function printServeCmdHelp(): void {
  console.log(`Usage: codemap serve [--host <ip>] [--port <n>] [--token <secret>]

Spawn an HTTP server exposing the same tool taxonomy as \`codemap mcp\` over
\`POST /tool/{name}\` for non-MCP consumers (CI scripts, simple curl, IDE
plugins that don't speak MCP). Single project root per server (set via
--root / CODEMAP_ROOT).

Default bind: 127.0.0.1:${DEFAULT_PORT} (loopback only — refuse 0.0.0.0 unless
explicitly opted in via --host 0.0.0.0).

Flags:
  --host <ip>     Bind address (default: ${DEFAULT_HOST}).
  --port <n>      Bind port (default: ${DEFAULT_PORT}).
  --token <secret>
                  Require Authorization: Bearer <secret> on every request.
                  GET /health is exempt so liveness probes work without
                  leaking the token. Use a long random string.
  --help, -h      Show this help.

Routes (every MCP tool maps to POST /tool/<name>; output shape matches
\`codemap query --json\` envelope, NOT the MCP {content: [...]} wrapper):
  POST /tool/query
  POST /tool/query_batch
  POST /tool/query_recipe
  POST /tool/audit
  POST /tool/context
  POST /tool/validate
  POST /tool/show
  POST /tool/snippet
  POST /tool/save_baseline
  POST /tool/list_baselines
  POST /tool/drop_baseline
  GET  /health                        Liveness probe.
  GET  /tools                         Tool catalog.
  GET  /resources/{encoded-uri}       Mirror of MCP resources
                                      (codemap://recipes, schema, skill, ...).

Errors are JSON: {"error": "<msg>"} with HTTP status 400 / 401 / 404 / 500.
Every response carries X-Codemap-Version: <semver>.

Examples:
  codemap serve
  codemap serve --port 9000 --token $(openssl rand -hex 32)
  curl -s -X POST http://127.0.0.1:${DEFAULT_PORT}/tool/query \\
    -H 'Content-Type: application/json' \\
    -d '{"sql":"SELECT name, file_path FROM symbols LIMIT 5"}'

The server runs until SIGINT/SIGTERM (drains in-flight + closes listener).
`);
}

/**
 * Entry-point for `codemap serve`. Bootstraps codemap once, starts the
 * HTTP listener, awaits SIGINT/SIGTERM. Errors propagate as exit code 1
 * via main.
 */
export async function runServeCmd(opts: {
  root: string;
  configFile: string | undefined;
  host: string;
  port: number;
  token: string | undefined;
}): Promise<void> {
  await runHttpServer({
    version: CODEMAP_VERSION,
    root: opts.root,
    configFile: opts.configFile,
    host: opts.host,
    port: opts.port,
    token: opts.token,
  });
}
