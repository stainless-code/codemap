import { runAudit } from "../application/audit-engine";
import type { AuditEnvelope } from "../application/audit-engine";
import { runCodemapIndex } from "../application/run-index";
import { loadUserConfig, resolveCodemapConfig } from "../config";
import { closeDb, openDb } from "../db";
import { configureResolver } from "../resolver";
import { getProjectRoot, getTsconfigPath, initCodemap } from "../runtime";

/**
 * Parse `argv` after the global bootstrap: `rest[0]` must be `"audit"`.
 * v1 supports `--baseline <name>`, `--json`, `--summary`, `--no-index`.
 */
export function parseAuditRest(rest: string[]):
  | { kind: "help" }
  | { kind: "error"; message: string }
  | {
      kind: "run";
      baselineName: string;
      json: boolean;
      summary: boolean;
      noIndex: boolean;
    } {
  if (rest[0] !== "audit") {
    throw new Error("parseAuditRest: expected audit");
  }

  let i = 1;
  let json = false;
  let summary = false;
  let noIndex = false;
  let baselineName: string | undefined;

  while (i < rest.length) {
    const a = rest[i];
    if (a === "--help" || a === "-h") return { kind: "help" };
    if (a === "--json") {
      json = true;
      i++;
      continue;
    }
    if (a === "--summary") {
      summary = true;
      i++;
      continue;
    }
    if (a === "--no-index") {
      noIndex = true;
      i++;
      continue;
    }
    if (a === "--baseline" || a.startsWith("--baseline=")) {
      const eq = a.indexOf("=");
      if (eq !== -1) {
        const v = a.slice(eq + 1);
        if (!v) {
          return {
            kind: "error",
            message:
              'codemap audit: "--baseline=<name>" requires a non-empty name.',
          };
        }
        baselineName = v;
        i++;
        continue;
      }
      const next = rest[i + 1];
      if (next === undefined || next.startsWith("-")) {
        return {
          kind: "error",
          message:
            'codemap audit: "--baseline" requires a name. Example: codemap audit --baseline pre-refactor',
        };
      }
      baselineName = next;
      i += 2;
      continue;
    }
    return {
      kind: "error",
      message: `codemap audit: unknown option "${a}". Run \`codemap audit --help\` for usage.`,
    };
  }

  if (baselineName === undefined) {
    return {
      kind: "error",
      message:
        "codemap audit: missing snapshot source. v1 requires --baseline <name>; --base <ref> ships in v1.x. Example: codemap audit --baseline pre-refactor",
    };
  }

  return { kind: "run", baselineName, json, summary, noIndex };
}

/**
 * Print **`codemap audit`** usage + flags to stdout.
 */
export function printAuditCmdHelp(): void {
  console.log(`Usage: codemap audit --baseline <name> [--json] [--summary] [--no-index]

Diff the current .codemap.db against a saved baseline (B.6) and emit the structural deltas
as a {base, head, deltas} envelope. v1 ships three deltas: files, dependencies, deprecated.
No verdict / threshold / non-zero exit codes in v1 — compose --json + jq for CI exit codes.

Flags:
  --baseline <name>   Required. Name must exist in query_baselines (saved by
                      \`codemap query --save-baseline\`). The baseline's recorded SQL
                      must satisfy each delta's required columns; mismatches surface
                      a clean error pointing at the right re-save command.
  --json              Emit the {base, head, deltas} envelope as JSON to stdout
                      (default for agents). On error: {"error":"<message>"}.
  --summary           Collapse rows to counts. With --json: deltas.<key>.{added: N, removed: N}.
                      Without: a single line "drift: files +1/-0, dependencies +3/-2, ...".
  --no-index          Skip the auto-incremental-index prelude. Default: re-index first
                      so 'head' reflects the current source tree.
  --help, -h          Show this help.

Examples:
  # Save a baseline before a refactor, then audit after
  codemap query --save-baseline=pre-refactor "SELECT path FROM files"
  codemap audit --baseline pre-refactor

  # Recipe-saved baseline (uses recipe id as default name)
  codemap query --save-baseline -r deprecated-symbols
  codemap audit --baseline deprecated-symbols

  # Counts-only summary — useful for CI dashboards
  codemap audit --json --summary --baseline pre-refactor

  # Audit a frozen DB without re-indexing first (e.g. CI fetched a prebuilt artifact)
  codemap audit --baseline pre-refactor --no-index
`);
}

/**
 * Initialize Codemap, run the auto-incremental-index prelude (unless `--no-index`),
 * then call `runAudit` and render. Sets `process.exitCode` on failure.
 */
export async function runAuditCmd(opts: {
  root: string;
  configFile: string | undefined;
  baselineName: string;
  json: boolean;
  summary: boolean;
  noIndex: boolean;
}): Promise<void> {
  try {
    const user = await loadUserConfig(opts.root, opts.configFile);
    initCodemap(resolveCodemapConfig(opts.root, user));
    configureResolver(getProjectRoot(), getTsconfigPath());

    const db = openDb();
    try {
      // Auto-incremental-index prelude — same code path as a bare `codemap`
      // invocation. Sub-second when no source changed since last index.
      // Default behaviour per the codemap rule's "re-index after editing source"
      // discipline; --no-index is the escape hatch for frozen-DB CI scenarios.
      if (!opts.noIndex) {
        await runCodemapIndex(db, { mode: "incremental", quiet: true });
      }

      const result = runAudit({ db, baselineName: opts.baselineName });
      if ("error" in result) {
        emitAuditError(result.error, opts.json);
        return;
      }
      renderAudit(result, { json: opts.json, summary: opts.summary });
    } finally {
      closeDb(db, { readonly: opts.noIndex });
    }
  } catch (err) {
    emitAuditError(err instanceof Error ? err.message : String(err), opts.json);
  }
}

function emitAuditError(message: string, json: boolean) {
  if (json) {
    console.log(JSON.stringify({ error: message }));
  } else {
    console.error(message);
  }
  process.exitCode = 1;
}

// Tracer 1: stub renderer — emits the envelope as-is. Tracer 5 ships the
// terminal-mode polish (no-drift / drift sections / --summary one-liner per §7.1).
function renderAudit(
  envelope: AuditEnvelope,
  opts: { json: boolean; summary: boolean },
): void {
  if (opts.json) {
    if (opts.summary) {
      const counts: Record<string, { added: number; removed: number }> = {};
      for (const [key, delta] of Object.entries(envelope.deltas)) {
        counts[key] = {
          added: delta.added.length,
          removed: delta.removed.length,
        };
      }
      console.log(
        JSON.stringify({
          base: envelope.base,
          head: envelope.head,
          deltas: counts,
        }),
      );
    } else {
      console.log(JSON.stringify(envelope));
    }
    return;
  }
  // Terminal stub — Tracer 5 replaces with the §7.1 layout.
  console.log(
    `audit "${envelope.base.name}" (${Object.keys(envelope.deltas).length} deltas)`,
  );
}
