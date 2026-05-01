import { runAudit, V1_DELTAS } from "../application/audit-engine";
import type {
  AuditBaselineMap,
  AuditEnvelope,
} from "../application/audit-engine";
import { runCodemapIndex } from "../application/run-index";
import { loadUserConfig, resolveCodemapConfig } from "../config";
import { closeDb, getQueryBaseline, openDb } from "../db";
import type { CodemapDatabase } from "../db";
import { configureResolver } from "../resolver";
import { getProjectRoot, getTsconfigPath, initCodemap } from "../runtime";

// Per-delta CLI flag → delta key. Generated from V1_DELTAS so adding a delta
// in the engine surfaces a `--<key>-baseline` flag automatically.
const PER_DELTA_FLAGS: Record<string, string> = Object.fromEntries(
  V1_DELTAS.map((d) => [`--${d.key}-baseline`, d.key]),
);

/**
 * Parse `argv` after the global bootstrap: `rest[0]` must be `"audit"`.
 * v1 supports `--baseline <prefix>` (auto-resolve sugar), per-delta
 * `--<key>-baseline <name>` flags (explicit), `--json`, `--summary`,
 * `--no-index`.
 */
export function parseAuditRest(rest: string[]):
  | { kind: "help" }
  | { kind: "error"; message: string }
  | {
      kind: "run";
      baselinePrefix: string | undefined;
      perDelta: Record<string, string>;
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
  let baselinePrefix: string | undefined;
  const perDelta: Record<string, string> = {};

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

    // `--baseline <prefix>` (auto-resolve sugar) — must be checked BEFORE the
    // per-delta loop because `--baseline` is a prefix of `--baseline-…` flags
    // (which don't exist today, but the explicit-match guard keeps it safe).
    if (a === "--baseline" || a.startsWith("--baseline=")) {
      const value = consumeFlagValue(rest, i, "--baseline");
      if (value.kind === "error") return value;
      baselinePrefix = value.value;
      i = value.next;
      continue;
    }

    // Per-delta `--<key>-baseline <name>` (explicit).
    let matchedPerDelta = false;
    for (const [flag, key] of Object.entries(PER_DELTA_FLAGS)) {
      if (a === flag || a.startsWith(`${flag}=`)) {
        const value = consumeFlagValue(rest, i, flag);
        if (value.kind === "error") return value;
        perDelta[key] = value.value;
        i = value.next;
        matchedPerDelta = true;
        break;
      }
    }
    if (matchedPerDelta) continue;

    return {
      kind: "error",
      message: `codemap audit: unknown option "${a}". Run \`codemap audit --help\` for usage.`,
    };
  }

  if (baselinePrefix === undefined && Object.keys(perDelta).length === 0) {
    return {
      kind: "error",
      message:
        "codemap audit: missing snapshot source. Pass --baseline <prefix> (auto-resolves <prefix>-files / <prefix>-dependencies / <prefix>-deprecated) or --<delta>-baseline <name> per delta. v1.x adds --base <ref>.",
    };
  }

  return { kind: "run", baselinePrefix, perDelta, json, summary, noIndex };
}

// Eat either `--flag value` (two tokens) or `--flag=value` (one). Returns the
// value + the next index to advance to, or an error if value is empty / starts
// with a dash (would be the next flag).
function consumeFlagValue(
  rest: string[],
  i: number,
  flagName: string,
):
  | { kind: "value"; value: string; next: number }
  | { kind: "error"; message: string } {
  const a = rest[i];
  const eq = a.indexOf("=");
  if (eq !== -1) {
    const v = a.slice(eq + 1);
    if (!v) {
      return {
        kind: "error",
        message: `codemap audit: "${flagName}=<value>" requires a non-empty value.`,
      };
    }
    return { kind: "value", value: v, next: i + 1 };
  }
  const next = rest[i + 1];
  // `next === ""` catches the two-token empty-string case (`--flag ""`); the
  // `--flag=` case is already caught above. Trim-zero check covers whitespace-
  // only values (`--flag " "`) — those would silently sneak through to a
  // baseline lookup that fails further downstream with a less clear error.
  if (
    next === undefined ||
    next === "" ||
    next.trim().length === 0 ||
    next.startsWith("-")
  ) {
    return {
      kind: "error",
      message: `codemap audit: "${flagName}" requires a value.`,
    };
  }
  return { kind: "value", value: next, next: i + 2 };
}

/**
 * Compose the `AuditBaselineMap` from a CLI parse result. Per-delta explicit
 * flags override auto-resolved slots. Auto-resolved slots that don't exist in
 * `query_baselines` are silently absent (the slot just has no baseline → the
 * delta doesn't run).
 */
export function resolveAuditBaselines(opts: {
  db: CodemapDatabase;
  baselinePrefix: string | undefined;
  perDelta: Record<string, string>;
}): AuditBaselineMap {
  const map: AuditBaselineMap = {};
  for (const spec of V1_DELTAS) {
    if (opts.baselinePrefix !== undefined) {
      const candidate = `${opts.baselinePrefix}-${spec.key}`;
      if (getQueryBaseline(opts.db, candidate) !== undefined) {
        map[spec.key] = candidate;
      }
    }
  }
  // Per-delta flags override the auto-resolved slot for that key.
  for (const [key, name] of Object.entries(opts.perDelta)) {
    map[key] = name;
  }
  return map;
}

/**
 * Print **`codemap audit`** usage + flags to stdout.
 */
export function printAuditCmdHelp(): void {
  const perDeltaLines = V1_DELTAS.map(
    (d) =>
      `  --${d.key}-baseline <name>  Explicit baseline for the ${d.key} delta.`,
  ).join("\n");

  console.log(`Usage: codemap audit [--baseline <prefix>] [--<delta>-baseline <name>]... [--json] [--summary] [--no-index]

Diff the current .codemap.db against per-delta baselines (saved by \`codemap query --save-baseline\`)
and emit the structural deltas as a {head, deltas} envelope. Each delta carries its own \`base\`
metadata. v1 ships three deltas: files, dependencies, deprecated. No verdict / threshold / non-zero
exit codes in v1 — compose --json + jq for CI exit codes.

Snapshot sources (at least one delta-baseline must resolve):

  --baseline <prefix>          Auto-resolve sugar — looks up <prefix>-files,
                               <prefix>-dependencies, <prefix>-deprecated in
                               query_baselines. Slots that don't exist are
                               silently absent (no error per missing slot).

${perDeltaLines}
                               Each per-delta flag overrides the auto-resolved
                               slot for that delta. Names must exist in
                               query_baselines or audit exits 1.

Other flags:
  --json              Emit the {head, deltas} envelope as JSON to stdout
                      (default for agents). On error: {"error":"<message>"}.
  --summary           Collapse rows to counts. With --json: deltas.<key>.{added: N, removed: N}.
                      Without: a single line "drift: files +1/-0, dependencies +3/-2, ...".
  --no-index          Skip the auto-incremental-index prelude. Default: re-index first
                      so 'head' reflects the current source tree.
  --help, -h          Show this help.

Examples:

  # Convention: save with the <prefix>-<delta> naming, then audit by prefix
  codemap query --save-baseline=base-files "SELECT path FROM files"
  codemap query --save-baseline=base-dependencies "SELECT from_path, to_path FROM dependencies"
  codemap query --save-baseline=base-deprecated -r deprecated-symbols
  codemap audit --baseline base

  # Explicit per-delta — mix-and-match across saved snapshots
  codemap audit \\
    --files-baseline pre-refactor-files \\
    --dependencies-baseline yesterday-deps \\
    --deprecated-baseline release-deprecated

  # Mixed — auto-resolve files + deprecated, override dependencies
  codemap audit --baseline base --dependencies-baseline experimental-deps

  # Counts-only summary — useful for CI dashboards
  codemap audit --json --summary --baseline base

  # Audit a frozen DB without re-indexing first
  codemap audit --baseline base --no-index
`);
}

/**
 * Initialize Codemap, run the auto-incremental-index prelude (unless `--no-index`),
 * then call `runAudit` and render. Sets `process.exitCode` on failure.
 */
export async function runAuditCmd(opts: {
  root: string;
  configFile: string | undefined;
  baselinePrefix: string | undefined;
  perDelta: Record<string, string>;
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

      const baselines = resolveAuditBaselines({
        db,
        baselinePrefix: opts.baselinePrefix,
        perDelta: opts.perDelta,
      });

      const result = runAudit({ db, baselines });
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

function renderAudit(
  envelope: AuditEnvelope,
  opts: { json: boolean; summary: boolean },
): void {
  if (opts.json) {
    if (opts.summary) {
      const counts: Record<
        string,
        {
          base: AuditEnvelope["deltas"][string]["base"];
          added: number;
          removed: number;
        }
      > = {};
      for (const [key, delta] of Object.entries(envelope.deltas)) {
        counts[key] = {
          base: delta.base,
          added: delta.added.length,
          removed: delta.removed.length,
        };
      }
      console.log(JSON.stringify({ head: envelope.head, deltas: counts }));
    } else {
      console.log(JSON.stringify(envelope));
    }
    return;
  }
  renderAuditTerminal(envelope, opts.summary);
}

// Terminal-mode renderer per plan §7.1, adapted for per-delta `base`:
// - Header line summarises how many deltas ran and how many drifted
// - One line per delta with its baseline name + sha + counts
// - --summary stops there
// - Without --summary, drifting deltas get added / removed `console.table` blocks
function renderAuditTerminal(envelope: AuditEnvelope, summary: boolean): void {
  const entries = Object.entries(envelope.deltas);
  if (entries.length === 0) {
    console.log("audit: no deltas requested.");
    return;
  }

  const driftCount = entries.filter(
    ([, d]) => d.added.length > 0 || d.removed.length > 0,
  ).length;
  const totalAdded = entries.reduce((n, [, d]) => n + d.added.length, 0);
  const totalRemoved = entries.reduce((n, [, d]) => n + d.removed.length, 0);

  if (driftCount === 0) {
    console.log(
      `audit: ${entries.length} delta(s), no drift across ${entries.map(([k]) => k).join(" / ")}.`,
    );
  } else {
    console.log(
      `audit: ${entries.length} delta(s), drift in ${driftCount} (+${totalAdded} / -${totalRemoved})`,
    );
  }

  const keyWidth = entries.reduce((n, [k]) => Math.max(n, k.length), 0);
  for (const [key, delta] of entries) {
    const sha = delta.base.sha ? ` @ ${delta.base.sha.slice(0, 8)}` : "";
    const provenance = `← ${delta.base.name}${sha}`;
    const counts =
      delta.added.length === 0 && delta.removed.length === 0
        ? "(no drift)"
        : `(+${delta.added.length} / -${delta.removed.length})`;
    console.log(`  ${key.padEnd(keyWidth)}  ${provenance}  ${counts}`);
  }

  if (summary) return;

  for (const [key, delta] of entries) {
    if (delta.added.length === 0 && delta.removed.length === 0) continue;
    if (delta.added.length > 0) {
      console.log(`\n  ${key} added (+${delta.added.length}):`);
      console.table(delta.added);
    }
    if (delta.removed.length > 0) {
      console.log(`\n  ${key} removed (-${delta.removed.length}):`);
      console.table(delta.removed);
    }
  }
}
