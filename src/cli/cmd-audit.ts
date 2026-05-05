import {
  makeWorktreeReindex,
  resolveAuditBaselines,
  runAudit,
  runAuditFromRef,
  V1_DELTAS,
} from "../application/audit-engine";
import type { AuditEnvelope } from "../application/audit-engine";
import { formatAuditSarif } from "../application/output-formatters";
import type { AuditSarifDelta } from "../application/output-formatters";
import { runCodemapIndex } from "../application/run-index";
import { closeDb, openDb } from "../db";
import { getProjectRoot } from "../runtime";
import { bootstrapCodemap } from "./bootstrap-codemap";

/**
 * Output formats supported by `codemap audit`. `text` is the default human
 * terminal renderer; `json` matches the legacy `--json` flag's envelope;
 * `sarif` emits a SARIF 2.1.0 doc per {@link formatAuditSarif} for GitHub
 * Code Scanning + any SARIF-aware viewer. `--json` and `--format json` are
 * equivalent; mixing `--json` with `--format <other>` is a parse error.
 */
export const AUDIT_OUTPUT_FORMATS = ["text", "json", "sarif"] as const;
export type AuditOutputFormat = (typeof AUDIT_OUTPUT_FORMATS)[number];

// Per-delta CLI flag → delta key. Generated from V1_DELTAS so adding a delta
// in the engine surfaces a `--<key>-baseline` flag automatically.
const PER_DELTA_FLAGS: Record<string, string> = Object.fromEntries(
  V1_DELTAS.map((d) => [`--${d.key}-baseline`, d.key]),
);

/**
 * Parse `argv` after the global bootstrap: `rest[0]` must be `"audit"`.
 * v1 supports `--baseline <prefix>` (auto-resolve sugar), per-delta
 * `--<key>-baseline <name>` flags (explicit), `--json`, `--summary`,
 * `--format <text|json|sarif>`, `--no-index`.
 */
export function parseAuditRest(rest: string[]):
  | { kind: "help" }
  | { kind: "error"; message: string }
  | {
      kind: "run";
      baselinePrefix: string | undefined;
      base: string | undefined;
      perDelta: Record<string, string>;
      format: AuditOutputFormat;
      summary: boolean;
      noIndex: boolean;
    } {
  if (rest[0] !== "audit") {
    throw new Error("parseAuditRest: expected audit");
  }

  let i = 1;
  // `--json` and `--format json` are equivalent; track whether the user passed
  // `--json` so we can reject `--json --format sarif` as a contradiction.
  let jsonShortcut = false;
  let format: AuditOutputFormat | undefined;
  let summary = false;
  let noIndex = false;
  let baselinePrefix: string | undefined;
  let base: string | undefined;
  const perDelta: Record<string, string> = {};

  while (i < rest.length) {
    const a = rest[i];
    if (a === "--help" || a === "-h") return { kind: "help" };
    if (a === "--json") {
      jsonShortcut = true;
      i++;
      continue;
    }
    if (a === "--format" || a.startsWith("--format=")) {
      const value = consumeFlagValue(rest, i, "--format");
      if (value.kind === "error") return value;
      if (!(AUDIT_OUTPUT_FORMATS as readonly string[]).includes(value.value)) {
        return {
          kind: "error",
          message: `codemap audit: --format must be one of ${AUDIT_OUTPUT_FORMATS.join(" / ")}; got "${value.value}".`,
        };
      }
      format = value.value as AuditOutputFormat;
      i = value.next;
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

    if (a === "--base" || a.startsWith("--base=")) {
      const value = consumeFlagValue(rest, i, "--base");
      if (value.kind === "error") return value;
      base = value.value;
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

  if (base !== undefined && baselinePrefix !== undefined) {
    return {
      kind: "error",
      message:
        "codemap audit: --base and --baseline are mutually exclusive. Use --base <ref> for ad-hoc git-ref comparison; --baseline <prefix> for saved snapshots. Per-delta --<delta>-baseline overrides compose with either.",
    };
  }

  if (
    base === undefined &&
    baselinePrefix === undefined &&
    Object.keys(perDelta).length === 0
  ) {
    return {
      kind: "error",
      message:
        "codemap audit: missing snapshot source. Pass --base <ref> (worktree+reindex against any committish), --baseline <prefix> (auto-resolves <prefix>-files / <prefix>-dependencies / <prefix>-deprecated) or --<delta>-baseline <name> per delta.",
    };
  }

  // Reconcile --json shortcut with --format. Both → must agree on `json`.
  // Neither → default to `text`.
  let resolvedFormat: AuditOutputFormat;
  if (jsonShortcut && format !== undefined) {
    if (format !== "json") {
      return {
        kind: "error",
        message: `codemap audit: --json is shorthand for --format json; cannot combine with --format ${format}.`,
      };
    }
    resolvedFormat = "json";
  } else if (jsonShortcut) {
    resolvedFormat = "json";
  } else {
    resolvedFormat = format ?? "text";
  }

  return {
    kind: "run",
    baselinePrefix,
    base,
    perDelta,
    format: resolvedFormat,
    summary,
    noIndex,
  };
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
 * Print **`codemap audit`** usage + flags to stdout.
 */
export function printAuditCmdHelp(): void {
  const perDeltaLines = V1_DELTAS.map(
    (d) =>
      `  --${d.key}-baseline <name>  Explicit baseline for the ${d.key} delta.`,
  ).join("\n");

  console.log(`Usage: codemap audit [--base <ref> | --baseline <prefix>] [--<delta>-baseline <name>]... [--json] [--summary] [--no-index]

Diff the current .codemap.db against per-delta baselines (saved by \`codemap query --save-baseline\`)
or against a git ref (\`--base <ref>\` materialises a worktree + reindex), and emit structural deltas
as a {head, deltas} envelope. Each delta carries its own \`base\` metadata. v1 ships three deltas:
files, dependencies, deprecated. No verdict / threshold / non-zero exit codes — compose --json + jq
for CI exit codes.

Snapshot sources (one of these must resolve; --base and --baseline are mutually exclusive):

  --base <ref>                 Materialise <ref> via git worktree to a sha-keyed cache
                               under .codemap/audit-cache/, reindex into a temp DB, then
                               diff. <ref> = any committish (origin/main, HEAD~5, sha,
                               tag, …). Cache hit on second run against same sha is
                               sub-100ms. Requires a git repository.

  --baseline <prefix>          Auto-resolve sugar — looks up <prefix>-files,
                               <prefix>-dependencies, <prefix>-deprecated in
                               query_baselines. Slots that don't exist are
                               silently absent (no error per missing slot).

${perDeltaLines}
                               Each per-delta flag overrides one delta's source —
                               composes with both --base and --baseline.

Other flags:
  --format <fmt>      Output format: text | json | sarif. Default: text.
                      sarif emits a SARIF 2.1.0 doc (one rule per delta key,
                      one result per added row) for GitHub Code Scanning.
  --json              Shortcut for --format json. Cannot combine with --format
                      <other>. Emits {head, deltas} envelope; on error: {"error":"<message>"}.
  --summary           Collapse rows to counts. With --format json: deltas.<key>.{added: N, removed: N}.
                      With --format text: a single line "drift: files +1/-0, dependencies +3/-2, ...".
                      No-op with --format sarif (results are per-row).
  --no-index          Skip the auto-incremental-index prelude. Default: re-index first
                      so 'head' reflects the current source tree.
  --help, -h          Show this help.

Examples:

  # Compare current branch to origin/main (no setup — worktree + reindex on first run)
  codemap audit --base origin/main --json

  # Compare to a tag, with explicit per-delta override for one slot
  codemap audit --base v1.0.0 --files-baseline pre-release-files

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
  stateDir?: string | undefined;
  baselinePrefix: string | undefined;
  base: string | undefined;
  perDelta: Record<string, string>;
  format: AuditOutputFormat;
  summary: boolean;
  noIndex: boolean;
}): Promise<void> {
  try {
    await bootstrapCodemap(opts);

    const db = openDb();
    try {
      // Auto-incremental-index prelude — same code path as a bare `codemap`
      // invocation. Sub-second when no source changed since last index.
      // Default behaviour per the codemap rule's "re-index after editing source"
      // discipline; --no-index is the escape hatch for frozen-DB CI scenarios.
      if (!opts.noIndex) {
        await runCodemapIndex(db, { mode: "incremental", quiet: true });
      }

      const result =
        opts.base !== undefined
          ? await runAuditFromRef({
              db,
              ref: opts.base,
              perDeltaOverrides: opts.perDelta,
              projectRoot: getProjectRoot(),
              reindex: makeWorktreeReindex(),
            })
          : runAudit({
              db,
              baselines: resolveAuditBaselines({
                db,
                baselinePrefix: opts.baselinePrefix,
                perDelta: opts.perDelta,
              }),
            });

      if ("error" in result) {
        emitAuditError(result.error, opts.format);
        return;
      }
      renderAudit(result, { format: opts.format, summary: opts.summary });
    } finally {
      closeDb(db, { readonly: opts.noIndex });
    }
  } catch (err) {
    emitAuditError(
      err instanceof Error ? err.message : String(err),
      opts.format,
    );
  }
}

// Errors are JSON-shaped for any structured format (`json` / `sarif`) so
// programmatic consumers always parse the same envelope; text-mode errors
// stay on stderr for terminal users.
function emitAuditError(message: string, format: AuditOutputFormat) {
  if (format === "text") {
    console.error(message);
  } else {
    console.log(JSON.stringify({ error: message }));
  }
  process.exitCode = 1;
}

function renderAudit(
  envelope: AuditEnvelope,
  opts: { format: AuditOutputFormat; summary: boolean },
): void {
  if (opts.format === "sarif") {
    // SARIF flattens added rows across deltas. `--summary` is a no-op here:
    // SARIF results are individual rows, not counts. Document this in
    // --help; surface a stderr warning if both are set.
    if (opts.summary) {
      console.error(
        "codemap audit: --summary has no effect with --format sarif (SARIF emits one result per added row, not counts).",
      );
    }
    const sarifDeltas: AuditSarifDelta[] = Object.entries(envelope.deltas).map(
      ([key, delta]) => ({
        key,
        added: delta.added as Record<string, unknown>[],
      }),
    );
    console.log(formatAuditSarif(sarifDeltas));
    return;
  }

  if (opts.format === "json") {
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

  // format === "text"
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
    // base.source narrows the union: "baseline" carries `name`; "ref" carries `ref`.
    const provenanceLabel =
      delta.base.source === "baseline" ? delta.base.name : delta.base.ref;
    const provenance = `← ${provenanceLabel}${sha}`;
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
