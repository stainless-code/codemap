import {
  createPrimeIndex,
  createReindexOnChange,
  DEFAULT_DEBOUNCE_MS,
  runWatchLoop,
} from "../application/watcher";
import { getExcludeDirNames, getProjectRoot } from "../runtime";
import { bootstrapCodemap } from "./bootstrap-codemap";

interface WatchOpts {
  root: string;
  configFile: string | undefined;
  stateDir?: string | undefined;
  debounceMs: number;
  quiet: boolean;
}

/**
 * Parse `argv` after the bootstrap split: `rest[0]` must be `"watch"`.
 * `--debounce <ms>` overrides the default; `--quiet` silences per-batch
 * stderr logs. `--root` / `--config` are absorbed by bootstrap. See
 * [`docs/architecture.md` § Watch wiring](../../docs/architecture.md#cli-usage).
 */
export function parseWatchRest(rest: string[]):
  | { kind: "help" }
  | { kind: "error"; message: string }
  | {
      kind: "run";
      debounceMs: number;
      quiet: boolean;
    } {
  if (rest[0] !== "watch") {
    throw new Error("parseWatchRest: expected watch");
  }

  let debounceMs = DEFAULT_DEBOUNCE_MS;
  let quiet = false;

  for (let i = 1; i < rest.length; i++) {
    const a = rest[i]!;
    if (a === "--help" || a === "-h") return { kind: "help" };
    if (a === "--quiet") {
      quiet = true;
      continue;
    }
    if (a === "--debounce" || a.startsWith("--debounce=")) {
      const eq = a.indexOf("=");
      const v = eq !== -1 ? a.slice(eq + 1) : rest[i + 1];
      if (v === undefined || v === "" || v.startsWith("-")) {
        return {
          kind: "error",
          message:
            'codemap watch: "--debounce" requires a non-negative integer (milliseconds).',
        };
      }
      const n = Number(v);
      if (!Number.isInteger(n) || n < 0) {
        return {
          kind: "error",
          message: `codemap watch: "--debounce ${v}" is not a non-negative integer.`,
        };
      }
      debounceMs = n;
      if (eq === -1) i++;
      continue;
    }
    return {
      kind: "error",
      message: `codemap watch: unknown option "${a}". Run \`codemap watch --help\` for usage.`,
    };
  }

  return { kind: "run", debounceMs, quiet };
}

/**
 * Print **`codemap watch`** usage to stdout. Mirrors the `--help` /
 * `-h` path returned by {@link parseWatchRest}; called from `main.ts`
 * when the parser returns `{kind: "help"}`. No side effects beyond
 * stdout. Safe to call before bootstrap.
 */
export function printWatchCmdHelp(): void {
  console.log(`Usage: codemap watch [--debounce <ms>] [--quiet]

Long-running process that re-indexes changed files in real time so every
\`codemap query\` (CLI / MCP / HTTP) reads live data without per-query
prelude. Eliminates the "is the index stale?" friction for AI agents
working in long sessions or multi-step refactors.

For the killer combo, use \`codemap serve --watch\` or \`codemap mcp --watch\`
to boot the transport and the watcher in one process.

Flags:
  --debounce <ms>   Coalesce burst events into one reindex after <ms> of
                    quiet (default: ${DEFAULT_DEBOUNCE_MS}). Lower → snappier; higher →
                    fewer reindex cycles during git checkout / npm install.
  --quiet           Silence per-batch stderr logs (just startup + errors).
  --help, -h        Show this help.

Examples:
  codemap watch
  codemap watch --debounce 500
  codemap watch --quiet                  # for IDE-launched background use

What gets watched: same files the indexer cares about (TS / TSX / JS /
JSX / CSS + project-local recipes under .codemap/recipes/). node_modules
/ .git / dist / build (and the configured excludeDirNames) are skipped.

The process runs until SIGINT/SIGTERM (drains pending edits + closes the
file watcher). Tracer 4 lands an optimization: when watcher is active,
\`codemap mcp audit\` skips its incremental-index prelude.
`);
}

/**
 * Initialize Codemap for `opts.root`, then start the watch loop. Resolves
 * on SIGINT / SIGTERM (drains pending + closes watcher).
 */
export async function runWatchCmd(opts: WatchOpts): Promise<void> {
  try {
    await bootstrapCodemap(opts);

    const root = getProjectRoot();
    if (!opts.quiet) {
      // eslint-disable-next-line no-console -- intentional bootstrap log on stderr
      console.error(
        `codemap watch: watching ${root} (debounce ${opts.debounceMs}ms)`,
      );
    }

    const handle = runWatchLoop({
      root,
      excludeDirNames: getExcludeDirNames(),
      debounceMs: opts.debounceMs,
      onPrime: createPrimeIndex({ quiet: opts.quiet }),
      onChange: createReindexOnChange({ quiet: opts.quiet }),
    });

    await new Promise<void>((resolve) => {
      const shutdown = (signal: string): void => {
        if (!opts.quiet) {
          // eslint-disable-next-line no-console -- intentional shutdown log on stderr
          console.error(
            `codemap watch: ${signal} received, draining + shutting down...`,
          );
        }
        // .finally(resolve) so a stop() rejection still unblocks the
        // outer Promise — caught by CodeRabbit on PR #47 (without the
        // .catch + .finally a watcher tear-down failure would deadlock
        // the process on SIGINT/SIGTERM).
        handle
          .stop()
          .catch((err: unknown) => {
            const msg = err instanceof Error ? err.message : String(err);
            console.error(`codemap watch: stop failed — ${msg}`);
          })
          .finally(() => resolve());
      };
      process.once("SIGINT", () => shutdown("SIGINT"));
      process.once("SIGTERM", () => shutdown("SIGTERM"));
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`codemap watch: ${msg}`);
    process.exitCode = 1;
  }
}
