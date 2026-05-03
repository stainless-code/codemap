import { findImpact } from "../application/impact-engine";
import type {
  ImpactBackend,
  ImpactDirection,
  ImpactResult,
} from "../application/impact-engine";
import { loadUserConfig, resolveCodemapConfig } from "../config";
import { closeDb, openDb } from "../db";
import { configureResolver } from "../resolver";
import { getProjectRoot, getTsconfigPath, initCodemap } from "../runtime";

interface ImpactOpts {
  root: string;
  configFile: string | undefined;
  target: string;
  direction: ImpactDirection;
  via: ImpactBackend;
  depth: number;
  limit: number;
  summary: boolean;
  json: boolean;
}

const DIRECTIONS: ReadonlySet<ImpactDirection> = new Set([
  "up",
  "down",
  "both",
]);
const BACKENDS: ReadonlySet<ImpactBackend> = new Set([
  "dependencies",
  "calls",
  "imports",
  "all",
]);

/**
 * Print `codemap impact` usage.
 */
export function printImpactCmdHelp(): void {
  console.log(`Usage: codemap impact <target> [--direction <d>] [--depth <N>] [--via <b>] [--limit <N>] [--summary] [--json]

Walk the dependency / calls / imports graph from <target> and return the
blast radius — every symbol or file reachable in N hops. Replaces composing
\`WITH RECURSIVE\` queries by hand.

Args:
  <target>            Symbol name (exact, case-sensitive) OR project-relative
                      file path (auto-detected by '/' or by matching an
                      indexed files.path row).

Flags:
  --direction <d>     up=callers/dependents, down=callees/dependencies,
                      both (default).
  --depth <N>         Max hops. Default 3. 0 = unbounded (still cycle-detected
                      and limit-capped).
  --via <b>           Graph backend: dependencies | calls | imports | all
                      (default). Symbol targets default to calls; file
                      targets default to dependencies + imports. Mismatched
                      explicit choices land in skipped_backends.
  --limit <N>         Cap total result rows. Default 500. Truncation reports
                      \`terminated_by: "limit"\` in summary.
  --summary           Return only target + summary (skip per-node matches).
  --json              Emit the JSON envelope. Required for --summary
                      consumption in CI.
  --help, -h          Show this help.

Output (JSON, all cases):
  { "target": {...}, "direction": "...", "via": [...], "depth_limit": N,
    "matches": [ {depth, direction, edge, kind, name?, file_path, ...}, ... ],
    "summary": { "nodes": N, "max_depth_reached": N, "by_kind": {...},
                 "terminated_by": "depth|limit|exhausted" },
    "skipped_backends"?: [ {backend, reason}, ... ] }

Examples:
  codemap impact handleQuery
  codemap impact src/db.ts --direction up
  codemap impact handleAudit --depth 1 --via calls
  codemap impact runWatchLoop --json --summary
`);
}

/**
 * Parse `argv` after the bootstrap split: `rest[0]` must be `"impact"`.
 */
export function parseImpactRest(rest: string[]):
  | { kind: "help" }
  | { kind: "error"; message: string }
  | {
      kind: "run";
      target: string;
      direction: ImpactDirection;
      via: ImpactBackend;
      depth: number;
      limit: number;
      summary: boolean;
      json: boolean;
    } {
  if (rest[0] !== "impact") {
    throw new Error("parseImpactRest: expected impact");
  }

  let target: string | undefined;
  let direction: ImpactDirection = "both";
  let via: ImpactBackend = "all";
  let depth = 3;
  let limit = 500;
  let summary = false;
  let json = false;

  for (let i = 1; i < rest.length; i++) {
    const a = rest[i]!;
    if (a === "--help" || a === "-h") return { kind: "help" };
    if (a === "--json") {
      json = true;
      continue;
    }
    if (a === "--summary") {
      summary = true;
      continue;
    }
    if (a === "--direction") {
      const next = rest[i + 1];
      if (next === undefined || next.startsWith("-")) {
        return {
          kind: "error",
          message: `codemap impact: "--direction" requires a value (up|down|both).`,
        };
      }
      if (!DIRECTIONS.has(next as ImpactDirection)) {
        return {
          kind: "error",
          message: `codemap impact: unknown --direction "${next}". Expected: up | down | both.`,
        };
      }
      direction = next as ImpactDirection;
      i++;
      continue;
    }
    if (a === "--via") {
      const next = rest[i + 1];
      if (next === undefined || next.startsWith("-")) {
        return {
          kind: "error",
          message: `codemap impact: "--via" requires a value (dependencies|calls|imports|all).`,
        };
      }
      if (!BACKENDS.has(next as ImpactBackend)) {
        return {
          kind: "error",
          message: `codemap impact: unknown --via "${next}". Expected: dependencies | calls | imports | all.`,
        };
      }
      via = next as ImpactBackend;
      i++;
      continue;
    }
    if (a === "--depth") {
      const next = rest[i + 1];
      if (next === undefined) {
        return {
          kind: "error",
          message: `codemap impact: "--depth" requires a non-negative integer (0 = unbounded).`,
        };
      }
      const n = Number(next);
      if (!Number.isInteger(n) || n < 0) {
        return {
          kind: "error",
          message: `codemap impact: "--depth ${next}" must be a non-negative integer.`,
        };
      }
      depth = n;
      i++;
      continue;
    }
    if (a === "--limit") {
      const next = rest[i + 1];
      if (next === undefined) {
        return {
          kind: "error",
          message: `codemap impact: "--limit" requires a positive integer.`,
        };
      }
      const n = Number(next);
      if (!Number.isInteger(n) || n <= 0) {
        return {
          kind: "error",
          message: `codemap impact: "--limit ${next}" must be a positive integer.`,
        };
      }
      limit = n;
      i++;
      continue;
    }
    if (a.startsWith("-")) {
      return {
        kind: "error",
        message: `codemap impact: unknown option "${a}". Run \`codemap impact --help\` for usage.`,
      };
    }
    if (target !== undefined) {
      return {
        kind: "error",
        message: `codemap impact: unexpected extra argument "${a}". Pass exactly one target (symbol name or file path).`,
      };
    }
    target = a;
  }

  if (target === undefined) {
    return {
      kind: "error",
      message: `codemap impact: missing <target>. Run \`codemap impact --help\` for usage.`,
    };
  }

  return { kind: "run", target, direction, via, depth, limit, summary, json };
}

/**
 * Run `codemap impact <target>`. Bootstraps, opens db, walks, renders.
 * Sets `process.exitCode` (no `process.exit`) so piped stdout isn't
 * truncated. Errors emit `{"error":"…"}` on stdout under `--json`,
 * plain message on stderr otherwise.
 */
export async function runImpactCmd(opts: ImpactOpts): Promise<void> {
  try {
    const user = await loadUserConfig(opts.root, opts.configFile);
    initCodemap(resolveCodemapConfig(opts.root, user));
    configureResolver(getProjectRoot(), getTsconfigPath());

    const db = openDb();
    let result: ImpactResult;
    try {
      result = findImpact(db, {
        target: opts.target,
        direction: opts.direction,
        via: opts.via,
        depth: opts.depth,
        limit: opts.limit,
      });
    } finally {
      closeDb(db, { readonly: true });
    }

    // --summary trims the per-node `matches` array but always keeps the
    // `summary` block — the JSON-CI consumption pattern is
    // `codemap impact X --json --summary | jq '.summary.nodes'`.
    const payload = opts.summary
      ? { ...result, matches: [] as typeof result.matches }
      : result;

    if (opts.json) {
      console.log(JSON.stringify(payload));
      return;
    }
    renderTerminal(payload, opts.summary);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    emitErrorMaybeJson(msg, opts.json);
  }
}

function renderTerminal(result: ImpactResult, summaryOnly: boolean): void {
  const { target, direction, via, depth_limit, summary } = result;
  console.log(
    `# impact ${target.kind}:${target.name} direction=${direction} via=${via.join("+") || "(none)"} depth=${depth_limit}`,
  );
  if (target.kind === "symbol" && target.matched_in.length === 0) {
    console.error(`# no symbol named "${target.name}" found in symbols table.`);
  }
  if (result.skipped_backends !== undefined) {
    for (const s of result.skipped_backends) {
      console.error(`# skipped backend "${s.backend}": ${s.reason}`);
    }
  }
  if (!summaryOnly) {
    for (const m of result.matches) {
      const label =
        m.kind === "symbol" ? `${m.name} (${m.file_path || "?"})` : m.file_path;
      console.log(`  [${m.depth}] ${m.direction} ${m.edge} ${label}`);
    }
  }
  console.log(
    `# nodes=${summary.nodes} max_depth=${summary.max_depth_reached} terminated_by=${summary.terminated_by}`,
  );
}

function emitErrorMaybeJson(message: string, json: boolean): void {
  if (json) {
    console.log(JSON.stringify({ error: message }));
  } else {
    console.error(message);
  }
  process.exitCode = 1;
}
