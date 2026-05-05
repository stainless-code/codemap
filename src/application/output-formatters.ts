/**
 * Pure transport-agnostic output formatters for `codemap query`. SARIF 2.1.0
 * for GitHub Code Scanning (and any SARIF-aware viewer); GitHub Actions
 * `::notice file=…,line=…::msg` annotations for inline PR-comment surfacing.
 *
 * Location columns auto-detected (`file_path` / `path` / `to_path` /
 * `from_path`, in that priority); `line_start` (+ optional `line_end`) for
 * the SARIF region. Recipes without a location column emit `results: []`
 * (SARIF) or no output (annotations) plus a stderr warning — they're
 * aggregates (`index-summary`, `markers-by-kind`), not findings. See
 * [`docs/architecture.md` § Output formatters](../../docs/architecture.md#cli-usage).
 *
 * Both formatters are pure: take rows + recipe metadata, return a string.
 * No I/O, no DB access. Same engine wired into both the CLI (`cmd-query.ts`)
 * and the MCP `query` / `query_recipe` tools.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { CODEMAP_VERSION } from "../version";

/** Priority-ordered column names that name a file path (D1). */
const LOCATION_COLUMNS = ["file_path", "path", "to_path", "from_path"] as const;

export interface FormatOpts {
  rows: Record<string, unknown>[];
  /**
   * `recipeId` is `undefined` for ad-hoc SQL — formatter falls back to
   * `codemap.adhoc` per plan § D2.
   */
  recipeId: string | undefined;
  /** `description` from the recipe catalog; passed straight to `rule.shortDescription`. */
  recipeDescription?: string | undefined;
  /** Body of `<id>.md`; passed to `rule.fullDescription`. Optional. */
  recipeBody?: string | undefined;
}

/**
 * Detect the file-path column on a row. Returns the column name or `null`
 * if none of the known location columns are present + populated.
 */
export function detectLocationColumn(
  row: Record<string, unknown>,
): (typeof LOCATION_COLUMNS)[number] | null {
  for (const col of LOCATION_COLUMNS) {
    const v = row[col];
    if (typeof v === "string" && v.length > 0) return col;
  }
  return null;
}

/**
 * Detect whether the row-set has any locatable rows. Used to decide whether
 * to emit a stderr warning that the recipe is not a "findings" shape.
 */
export function hasLocatableRows(rows: Record<string, unknown>[]): boolean {
  if (rows.length === 0) return false;
  return rows.some((r) => detectLocationColumn(r) !== null);
}

/**
 * Build a one-line message for a result row. Strips location columns and
 * stringifies what's left; if `name` is present, leads with it (e.g.
 * `"foo (function): @deprecated since v2"`). Per plan § D4.
 */
export function buildMessageText(row: Record<string, unknown>): string {
  const out: string[] = [];
  const name = row["name"];
  const kind = row["kind"];
  if (typeof name === "string" && name.length > 0) {
    if (typeof kind === "string" && kind.length > 0) {
      out.push(`${name} (${kind})`);
    } else {
      out.push(name);
    }
  }
  // Stringify remaining columns (skip location + already-included name/kind +
  // line_start/line_end since they're surfaced via SARIF region / annotation
  // line). Keep deterministic by iterating in insertion order of the row.
  const skip = new Set<string>([
    ...LOCATION_COLUMNS,
    "name",
    "kind",
    "line_start",
    "line_end",
  ]);
  const extras: string[] = [];
  for (const [k, v] of Object.entries(row)) {
    if (skip.has(k)) continue;
    if (v === null || v === undefined) continue;
    extras.push(`${k}=${typeof v === "string" ? v : JSON.stringify(v)}`);
  }
  if (extras.length > 0) {
    out.push(extras.join(", "));
  }
  if (out.length === 0) return "(no message)";
  return out.join(": ");
}

/**
 * Format the row-set as a SARIF 2.1.0 document (per plan § D2-D6). Always
 * returns a valid SARIF doc — `results: []` for empty / no-location rows so
 * SARIF tooling handles both gracefully.
 */
export function formatSarif(opts: FormatOpts): string {
  const ruleId = opts.recipeId ? `codemap.${opts.recipeId}` : "codemap.adhoc";
  const ruleShortDescription =
    opts.recipeDescription ?? opts.recipeId ?? "Ad-hoc SQL query";
  const rule: Record<string, unknown> = {
    id: ruleId,
    name: opts.recipeId ?? "adhoc",
    shortDescription: { text: ruleShortDescription },
    defaultConfiguration: { level: "note" },
  };
  if (opts.recipeBody !== undefined && opts.recipeBody.length > 0) {
    rule["fullDescription"] = { text: opts.recipeBody };
  }

  const results = opts.rows.flatMap((row) => {
    const locCol = detectLocationColumn(row);
    if (locCol === null) return [];
    const uri = row[locCol] as string;
    const lineStartRaw = row["line_start"];
    const lineEndRaw = row["line_end"];
    const region: Record<string, number> = {};
    if (typeof lineStartRaw === "number" && lineStartRaw > 0) {
      region["startLine"] = lineStartRaw;
    }
    if (typeof lineEndRaw === "number" && lineEndRaw > 0) {
      region["endLine"] = lineEndRaw;
    }
    const physicalLocation: Record<string, unknown> = {
      artifactLocation: { uri },
    };
    if (Object.keys(region).length > 0) {
      physicalLocation["region"] = region;
    }
    return [
      {
        ruleId,
        level: "note",
        message: { text: buildMessageText(row) },
        locations: [{ physicalLocation }],
      },
    ];
  });

  const sarif = {
    $schema:
      "https://raw.githubusercontent.com/oasis-tcs/sarif-spec/main/Schemata/sarif-schema-2.1.0.json",
    version: "2.1.0",
    runs: [
      {
        tool: {
          driver: {
            name: "codemap",
            informationUri: "https://github.com/stainless-code/codemap",
            version: CODEMAP_VERSION,
            rules: [rule],
          },
        },
        results,
      },
    ],
  };
  return JSON.stringify(sarif, null, 2);
}

/** Removed rows intentionally excluded — SARIF surfaces findings to act on, not cleanups. */
export interface AuditSarifDelta {
  key: string;
  added: Record<string, unknown>[];
}

/**
 * One rule per delta key (id `codemap.audit.<key>-added`); one result per
 * `added` row. Severity = `warning` (more actionable than per-recipe `note`
 * — a new dependency edge in a PR is a structural change). Locations
 * auto-detected via {@link detectLocationColumn}; aggregate rows without
 * a location field omit `locations` per SARIF spec.
 */
export function formatAuditSarif(deltas: AuditSarifDelta[]): string {
  const rules = deltas.map((d) => ({
    id: `codemap.audit.${d.key}-added`,
    name: `audit-${d.key}-added`,
    shortDescription: { text: `New ${d.key} since baseline` },
    defaultConfiguration: { level: "warning" },
  }));

  const results = deltas.flatMap((d) =>
    d.added.map((row) => {
      const ruleId = `codemap.audit.${d.key}-added`;
      const locCol = detectLocationColumn(row);
      // Files-added rows have only `path` (in the skip-set), so
      // buildMessageText returns "(no message)". Fall back to "new <key>: <uri>".
      const builtText = buildMessageText(row);
      const messageText =
        builtText === "(no message)" && locCol !== null
          ? `new ${d.key}: ${row[locCol] as string}`
          : builtText;
      const result: Record<string, unknown> = {
        ruleId,
        level: "warning",
        message: { text: messageText },
      };
      if (locCol !== null) {
        const uri = row[locCol] as string;
        const lineStartRaw = row["line_start"];
        const lineEndRaw = row["line_end"];
        const region: Record<string, number> = {};
        if (typeof lineStartRaw === "number" && lineStartRaw > 0) {
          region["startLine"] = lineStartRaw;
        }
        if (typeof lineEndRaw === "number" && lineEndRaw > 0) {
          region["endLine"] = lineEndRaw;
        }
        const physicalLocation: Record<string, unknown> = {
          artifactLocation: { uri },
        };
        if (Object.keys(region).length > 0) {
          physicalLocation["region"] = region;
        }
        result["locations"] = [{ physicalLocation }];
      }
      return result;
    }),
  );

  const sarif = {
    $schema:
      "https://raw.githubusercontent.com/oasis-tcs/sarif-spec/main/Schemata/sarif-schema-2.1.0.json",
    version: "2.1.0",
    runs: [
      {
        tool: {
          driver: {
            name: "codemap",
            informationUri: "https://github.com/stainless-code/codemap",
            version: CODEMAP_VERSION,
            rules,
          },
        },
        results,
      },
    ],
  };
  return JSON.stringify(sarif, null, 2);
}

export interface AnnotationsOpts {
  rows: Record<string, unknown>[];
  /** Same `recipeId` shape as {@link FormatOpts}; not currently rendered (annotation lines don't carry rule id). */
  recipeId: string | undefined;
  /**
   * Annotation level — `"notice" | "warning" | "error"` per GitHub Actions.
   * Default `"notice"` per plan § D7. Future per-recipe override via
   * frontmatter `sarifLevel:` (deferred to v1.x).
   */
  level?: "notice" | "warning" | "error";
}

/**
 * Escape a workflow-command **data payload** (everything after the `::`
 * delimiter) per [actions/toolkit `command.ts`](https://github.com/actions/toolkit/blob/master/packages/core/src/command.ts):
 * `%` → `%25`, `\r` → `%0D`, `\n` → `%0A`. Without this, a `%` in the message
 * (e.g. `coverage at 50%`) gets parsed as a malformed escape sequence by the
 * runner.
 */
export function escapeAnnotationData(value: string): string {
  return value.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
}

/**
 * Escape a workflow-command **property value** (the `value` in `key=value`):
 * data-payload escapes plus `:` → `%3A` and `,` → `%2C`. Without this, a
 * file path containing `:` (Windows drive letter, `C:\foo`) or `,` would
 * either prematurely terminate the property or split into two malformed
 * `key=value` pairs. Same actions/toolkit reference as
 * {@link escapeAnnotationData}.
 */
export function escapeAnnotationProperty(value: string): string {
  return escapeAnnotationData(value).replace(/:/g, "%3A").replace(/,/g, "%2C");
}

/**
 * Maximum edge count `formatMermaid` will render before rejecting with a
 * scope-suggestion error. Recipes / ad-hoc SQL must `LIMIT` to ≤ this; the
 * `impact` engine already bounds via `--depth` / `--limit`.
 * (`docs/plans/fts5-mermaid.md` Q4 — hard-coded for v1; promote to config
 * later if real-world data shows 50 is wrong.)
 */
export const MERMAID_MAX_EDGES = 50;

export interface MermaidOpts {
  /** Rows must shape as `{from, to, label?, kind?}` — alias other columns via SELECT. */
  rows: Record<string, unknown>[];
  /** Recipe id surfaced in the error message when the row-set is unbounded. */
  recipeId: string | undefined;
}

/**
 * Input contract for {@link formatDiff} / {@link formatDiffJson} /
 * {@link buildDiffJson}. Rows must shape as
 * `{file_path, line_start, before_pattern, after_pattern}`. The formatter
 * reads source files at format time from `projectRoot` to validate that the
 * indexed line still contains `before_pattern` (per `docs/plans/...`
 * Q6 — diff is a preview-only output mode, codemap never writes files).
 */
export interface DiffOpts {
  /** Recipe / SQL row set; rows missing required keys are silently skipped. */
  rows: Record<string, unknown>[];
  /** Absolute or process-cwd-relative root used when reading `file_path` from disk. */
  projectRoot: string;
}

/** A single textual line in a unified-diff hunk. */
export interface DiffLine {
  type: "remove" | "add";
  text: string;
}

/** A unified-diff hunk; `old_*` / `new_*` follow `git diff` 1-based indexing. */
export interface DiffHunk {
  old_start: number;
  old_count: number;
  new_start: number;
  new_count: number;
  lines: DiffLine[];
}

/**
 * One file's diff payload. `stale` and `missing` are mutually exclusive flags
 * set when the row's source line could not be matched against disk; `warnings`
 * carries every reason a row was skipped (the array preserves all entries
 * across multiple skips for the same file).
 */
export interface DiffFile {
  file_path: string;
  hunks: DiffHunk[];
  stale?: boolean;
  missing?: boolean;
  warnings?: string[];
}

/**
 * Structured `--format diff-json` payload. `files` carries every file that
 * had at least one row (including skipped ones — read `stale` / `missing` to
 * filter); `warnings` mirrors per-file warnings at the top level for quick
 * `jq` access; `summary` counts only files whose hunks were emitted.
 */
export interface DiffJsonPayload {
  files: DiffFile[];
  warnings: string[];
  summary: {
    files: number;
    hunks: number;
    insertions: number;
    deletions: number;
    skipped: number;
  };
}

/**
 * Render a `{from, to, label?, kind?}` row-set as a Mermaid `flowchart LR`
 * diagram (`docs/plans/fts5-mermaid.md` Q5). Rejects with a scope-suggestion
 * error when row count exceeds {@link MERMAID_MAX_EDGES} — auto-truncation
 * would be a verdict masquerading as an output mode (Q4 / moat A).
 *
 * Throws `Error` with a message naming the recipe + count + scoping knobs
 * (`LIMIT` / `--via` / `WHERE from_path LIKE`) when the contract is violated.
 */
export function formatMermaid(opts: MermaidOpts): string {
  if (opts.rows.length > MERMAID_MAX_EDGES) {
    const recipe = opts.recipeId ?? "(ad-hoc SQL)";
    throw new Error(
      `[mermaid] ${recipe} produced ${opts.rows.length} edges (> ${MERMAID_MAX_EDGES}). ` +
        `Auto-truncation is out of scope (would be a verdict, not an output mode). ` +
        `Scope the input via 'LIMIT ${MERMAID_MAX_EDGES}', '--via <backend>' (impact), or 'WHERE from_path LIKE …' (recipe / ad-hoc).`,
    );
  }

  const ids = new Map<string, string>();
  let nextId = 0;
  function nodeId(name: string): string {
    const cached = ids.get(name);
    if (cached !== undefined) return cached;
    const id = `n${nextId++}`;
    ids.set(name, id);
    return id;
  }

  const lines: string[] = ["flowchart LR"];
  const seen = new Set<string>();
  for (const row of opts.rows) {
    const from = readMermaidEndpoint(row, "from");
    const to = readMermaidEndpoint(row, "to");
    if (from === undefined || to === undefined) continue;

    const fromId = nodeId(from);
    const toId = nodeId(to);
    if (!seen.has(from)) {
      lines.push(`  ${fromId}[${quoteMermaidLabel(from)}]`);
      seen.add(from);
    }
    if (!seen.has(to)) {
      lines.push(`  ${toId}[${quoteMermaidLabel(to)}]`);
      seen.add(to);
    }

    const labelRaw = row["label"];
    const label =
      typeof labelRaw === "string" && labelRaw.length > 0
        ? `|${quoteMermaidLabel(labelRaw)}|`
        : "";
    lines.push(`  ${fromId} --> ${label} ${toId}`.replace(/\s+$/, ""));
  }
  return lines.join("\n");
}

/**
 * Build the structured {@link DiffJsonPayload} from a row set. Reads every
 * `file_path` from disk under `projectRoot` and verifies that the indexed
 * line still contains `before_pattern`; rows where the file is gone or the
 * line drifted are kept in `files` with a `stale` / `missing` flag so callers
 * can decide what to do. Performs no writes.
 */
export function buildDiffJson(opts: DiffOpts): DiffJsonPayload {
  const files = new Map<string, DiffFile>();
  const warnings: string[] = [];

  for (const row of opts.rows) {
    const filePath = readString(row, "file_path");
    const lineStart = readPositiveInt(row, "line_start");
    const before = readString(row, "before_pattern");
    const after = readString(row, "after_pattern");
    if (
      filePath === undefined ||
      lineStart === undefined ||
      before === undefined ||
      after === undefined
    ) {
      continue;
    }

    const file = ensureDiffFile(files, filePath);
    let source: string;
    try {
      source = readFileSync(join(opts.projectRoot, filePath), "utf8");
    } catch {
      markSkipped(
        file,
        warnings,
        "missing",
        `${filePath}: missing or unreadable`,
      );
      continue;
    }
    const lines = source.split(/\r?\n/);
    const actual = lines[lineStart - 1];
    if (actual === undefined || !actual.includes(before)) {
      markSkipped(
        file,
        warnings,
        "stale",
        `${filePath}:${lineStart}: stale line range`,
      );
      continue;
    }

    // `String.prototype.replace(string, string)` interprets `$&` / `$`/`$1`...
    // in the replacement argument per ECMAScript GetSubstitution. Identifiers
    // legitimately containing `$` (`$inject`, `$$factory`) would otherwise be
    // silently mangled. Pre-escape so the replacement is literal.
    const updated = actual.replace(before, after.replace(/\$/g, "$$$$"));
    file.hunks.push({
      old_start: lineStart,
      old_count: 1,
      new_start: lineStart,
      new_count: 1,
      lines: [
        { type: "remove", text: actual },
        { type: "add", text: updated },
      ],
    });
  }

  const fileList = [...files.values()];
  let hunks = 0;
  let insertions = 0;
  let deletions = 0;
  let skipped = 0;
  for (const file of fileList) {
    hunks += file.hunks.length;
    for (const hunk of file.hunks) {
      insertions += hunk.lines.filter((l) => l.type === "add").length;
      deletions += hunk.lines.filter((l) => l.type === "remove").length;
    }
    if (file.stale === true || file.missing === true) skipped++;
  }

  return {
    files: fileList,
    warnings,
    summary: {
      files: fileList.filter((f) => f.hunks.length > 0).length,
      hunks,
      insertions,
      deletions,
      skipped,
    },
  };
}

/**
 * Render the row set as plain unified-diff text. Stale / missing rows are
 * surfaced as `# WARNING: ...` comments at the top of the output (legal in
 * unified diff and tolerated by `git apply`). Pipe the result into
 * `git apply --check` to validate before applying — codemap never writes
 * files.
 */
export function formatDiff(opts: DiffOpts): string {
  const payload = buildDiffJson(opts);
  const lines: string[] = [];
  for (const warning of payload.warnings) {
    lines.push(`# WARNING: ${warning}`);
  }
  for (const file of payload.files) {
    if (file.hunks.length === 0) continue;
    lines.push(`--- a/${file.file_path}`);
    lines.push(`+++ b/${file.file_path}`);
    for (const hunk of file.hunks) {
      lines.push(
        `@@ -${hunk.old_start},${hunk.old_count} +${hunk.new_start},${hunk.new_count} @@`,
      );
      for (const line of hunk.lines) {
        lines.push(`${line.type === "remove" ? "-" : "+"}${line.text}`);
      }
    }
  }
  return lines.join("\n");
}

/**
 * Render the row set as a structured {@link DiffJsonPayload} JSON string —
 * for agents that want hunks they can filter / partially apply rather than
 * raw text.
 */
export function formatDiffJson(opts: DiffOpts): string {
  return JSON.stringify(buildDiffJson(opts), null, 2);
}

function ensureDiffFile(
  files: Map<string, DiffFile>,
  filePath: string,
): DiffFile {
  const existing = files.get(filePath);
  if (existing !== undefined) return existing;
  const next: DiffFile = { file_path: filePath, hunks: [] };
  files.set(filePath, next);
  return next;
}

function markSkipped(
  file: DiffFile,
  warnings: string[],
  kind: "stale" | "missing",
  warning: string,
): void {
  if (kind === "stale") file.stale = true;
  else file.missing = true;
  if (file.warnings === undefined) file.warnings = [];
  file.warnings.push(warning);
  warnings.push(warning);
}

function readString(
  row: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = row[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readPositiveInt(
  row: Record<string, unknown>,
  key: string,
): number | undefined {
  const value = row[key];
  return Number.isInteger(value) && typeof value === "number" && value > 0
    ? value
    : undefined;
}

function readMermaidEndpoint(
  row: Record<string, unknown>,
  key: "from" | "to",
): string | undefined {
  const v = row[key];
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

/** Mermaid label quoting: `"` and `\` need escaping; everything else is literal. */
function quoteMermaidLabel(s: string): string {
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/**
 * Format the row-set as GitHub Actions annotation commands. One line per
 * locatable row: `::<level> file=<path>,line=<n>::<message>`.
 *
 * Per plan § D7: rows without a location column are skipped; empty input
 * → empty string. Caller decides whether to print a stderr warning.
 *
 * **Escaping:** property values (`file`) and the message payload are
 * percent-encoded per actions/toolkit so paths with `:` / `,` and messages
 * with `%` / `\r` / `\n` round-trip correctly through the GH runner.
 *
 * Reference: <https://docs.github.com/en/actions/using-workflows/workflow-commands-for-github-actions#setting-an-error-message>
 */
export function formatAnnotations(opts: AnnotationsOpts): string {
  const level = opts.level ?? "notice";
  const lines: string[] = [];
  for (const row of opts.rows) {
    const locCol = detectLocationColumn(row);
    if (locCol === null) continue;
    const file = row[locCol] as string;
    const lineStartRaw = row["line_start"];
    const lineN =
      typeof lineStartRaw === "number" && lineStartRaw > 0
        ? lineStartRaw
        : undefined;
    const params: string[] = [`file=${escapeAnnotationProperty(file)}`];
    if (lineN !== undefined) params.push(`line=${lineN}`);
    // Collapse internal whitespace runs into a single space so the message
    // is one logical line; THEN escape so the GH runner reads it back as
    // a single annotation (escaped %0A still terminates the command).
    const message = escapeAnnotationData(
      buildMessageText(row).replace(/\s+/g, " ").trim(),
    );
    lines.push(`::${level} ${params.join(",")}::${message}`);
  }
  return lines.join("\n");
}
